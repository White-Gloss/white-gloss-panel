import worker,{init,setting,protect,settings,configuration,background} from '../src/worker.mjs';
import {AppError} from '../src/domain.mjs';
import {authSchema,sessionIdentity,requestLogin,redeemLogin,logout,loginPage,pruneAuth,digest} from './auth.mjs';
import {passwordLogin,savePassword,passwordPage} from './password-auth.mjs';
import {calendarOAuthSchema,calendarAuthorize,calendarCallback,calendarAccessToken} from './calendar-oauth.mjs';
import {createStorage} from './storage.mjs';
import {providerOperations,providerSchema} from './providers.mjs';
import {agentAuthSchema,agentAuthEndpoint,pruneAgentAuth} from './agent-auth.mjs';
import {agentActionSchema,agentMcpEndpoint} from './agent-tools.mjs';
const lockedHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com"};
function errorResponse(message,status=500){return new Response(JSON.stringify({error:message}),{status,headers:{'Content-Type':'application/json'}});}
export async function createApplication(env){
  const origin=new URL(env.PANEL_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PANEL_ORIGIN||origin.username||origin.password)throw Error('PANEL_ORIGIN muss ein eindeutiger HTTPS-Ursprung sein.');
  if(!/^[a-f0-9]{64}$/.test(env.OWNER_EMAIL_SHA256??''))throw Error('Betreiberidentität fehlt.');
  await init(env);await authSchema(env);await calendarOAuthSchema(env);await providerSchema(env);await agentAuthSchema(env);await agentActionSchema(env);
  env.passwordResetStatements=newHash=>[env.DB.prepare('UPDATE agent_grants SET revoked=1 WHERE EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(newHash)];
  env.CUSTOMER_ACCESS_APPROVED='true';env.STANDALONE_AUTH='true';env.operations=providerOperations;
  const handle=async request=>{
    try{
      const url=new URL(request.url);if(url.origin!==env.PANEL_ORIGIN)return errorResponse('Ungültiger Host.',400);
      if(url.pathname==='/healthz')return new Response('ok',{headers:{'Content-Type':'text/plain'}});
      if(url.pathname==='/mcp')return await agentMcpEndpoint(env,request);
      const agent=await agentAuthEndpoint(env,request);if(agent)return agent;
      if(request.method==='GET'&&/^\/[a-zA-Z0-9_-]+\.(css|js|mjs)$/.test(url.pathname))return env.ASSETS.fetch(request);
      if(request.method==='GET'&&['/auth/login','/auth/verify'].includes(url.pathname))return loginPage();
      if(request.method==='POST'&&url.pathname==='/auth/request')return await requestLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/redeem')return await redeemLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/password/login')return await passwordLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/logout')return await logout(env,request);
      const identity=await sessionIdentity(env,request);
      if(!identity){if(request.method==='GET'&&!url.pathname.startsWith('/api/')){const login=new URL('/auth/login',env.PANEL_ORIGIN);if(/^\/angebot\/[a-f0-9]{64}$/.test(url.pathname))login.searchParams.set('returnTo',url.pathname);if(url.pathname==='/'&&/^[a-f0-9-]{36}$/.test(url.searchParams.get('order')??''))login.searchParams.set('returnTo','/?order='+url.searchParams.get('order'));if(url.pathname==='/auth/password')login.searchParams.set('setup','1');return Response.redirect(login,303);}return errorResponse('Bitte persönlich anmelden.',401);}
      const isOwner=digest(identity)===env.OWNER_EMAIL_SHA256;
      if(url.pathname==='/auth/password'){
        if(!isOwner)return errorResponse('Nur für den Betreiber vorgesehen.',403);
        if(request.method==='GET')return passwordPage(env,request);
        if(request.method==='POST')return await savePassword(env,request);
        return errorResponse('Ungültige Anfrage.',405);
      }
      if(url.pathname==='/auth/calendar/start'&&request.method==='POST'){
        if(request.headers.get('origin')!==env.PANEL_ORIGIN)return errorResponse('Ungültiger Ursprung.',403);
        const authorization=await calendarAuthorize(env,identity);
        // Complete the same-origin request before navigating to Google's consent page.
        // This avoids submitting a cross-origin redirect through a generated form.
        if(request.headers.get('content-type')?.startsWith('application/json'))return new Response(JSON.stringify({authorizationUrl:authorization.headers.get('location')}),{headers:{'Content-Type':'application/json'}});
        return authorization;
      }
      if(url.pathname==='/auth/calendar/callback'&&request.method==='GET')return calendarCallback(env,request,identity);
      if(!isOwner&&!url.pathname.startsWith('/angebot/')&&!url.pathname.startsWith('/api/offer/'))return errorResponse('Dieser Zugang ist für das persönliche Angebot vorgesehen.',403);
      if(isOwner&&url.pathname==='/api/protocol/pdf'&&request.method==='GET')return await providerOperations.protocolDownload(env,url.searchParams.get('id'),url.searchParams.get('kind'));
      if(isOwner&&url.pathname==='/api/check'&&request.method==='POST'){
        const input=await request.clone().json().catch(()=>({}));if(input.kind==='calendar'&&(await settings(env)).calendarOAuth)await calendarAccessToken(env);
      }
      const headers=new Headers(request.headers);headers.delete('oai-authenticated-user-email');headers.set('oai-authenticated-user-email',identity);
      const trusted=new Request(request,{headers});
      return worker.fetch(trusted,env);
    }catch(error){return errorResponse(error instanceof AppError?error.message:'Verbindung oder Speicherung fehlgeschlagen. Kein Erfolg wurde bestätigt.',error instanceof AppError?error.status:500);}
  };
  return {env,async fetch(request){const result=await handle(request);const secured=new Response(result.body,{status:result.status,headers:result.headers});for(const [key,value] of Object.entries(lockedHeaders))secured.headers.set(key,value);
    // Native consent/revoke forms need their real same-origin Origin header.
    // Keep referrers private across origins, including the OAuth callback.
    if(request.method==='GET'&&new URL(request.url).pathname==='/agent/connect'&&result.status===200&&result.headers.get('content-type')?.startsWith('text/html')){
      secured.headers.set('Referrer-Policy','same-origin');
      // Chrome applies the source form's CSP to OAuth redirects as well.
      // Permit only the OpenAI callback paths also validated by agent-auth.
      secured.headers.set('Content-Security-Policy',lockedHeaders['Content-Security-Policy'].replace("form-action 'self' https://accounts.google.com","form-action 'self' https://chatgpt.com/connector_platform_oauth_redirect https://chatgpt.com/connector/oauth/"));
    }
    return secured;}};
}
export async function configureFromEnvironment(env){await init(env);const old=await settings(env);const secrets={HUB_SYNC_TOKEN:'hubKey',RESEND_API_KEY:'resendKey',QONTO_API_KEY:'qontoKey'};for(const [key,settingKey] of Object.entries(secrets))if(env[key]&&!old[settingKey])await setting(env,settingKey,await protect(env,env[key]));for(const [key,settingKey] of Object.entries({EMAIL_SENDER:'sender',QONTO_LOGIN:'qontoLogin',CALENDAR_ID:'calendarId',REVIEW_URL:'reviewUrl'}))if(env[key]&&old[settingKey]===undefined)await setting(env,settingKey,env[key]);await setting(env,'standaloneAuth',true);}
/** @returns {Promise<any>} */
export async function applicationEnvironment(variables=process.env){const env={...variables,...await createStorage(variables.PANEL_DATA_DIR,variables.PANEL_ASSETS_DIR)};await configureFromEnvironment(env);return env;}
export async function maintenance(env,now=Date.now()){
  await providerSchema(env);const lease=digest(String(now)+crypto.randomUUID());const claimed=await env.DB.prepare("INSERT INTO runtime_locks(name,owner,expires_at) VALUES('maintenance',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE runtime_locks.expires_at<?").bind(lease,now+30*60000,now).run();if(!claimed.meta.changes)return {skipped:true,ok:true,deliveryError:null};
  try{
    await setting(env,'lastScheduledAttempt',new Date(now).toISOString());await pruneAuth(env,now);await agentAuthSchema(env);await pruneAgentAuth(env,now);
    await env.DB.prepare('DELETE FROM calendar_oauth_states WHERE expires_at<?').bind(now).run();
    let errors=[];try{errors=(await providerOperations.background(env)).errors;}catch(error){errors.push('Anbieterabgleich: '+error.message);}
    let result;try{result=await background(env);if(result.deliveryError)errors.push(result.deliveryError);}catch(error){errors.push('Fälligkeitsprüfung: '+error.message);result={ok:false};}
    const deliveryError=errors.length?errors.join(' · '):null;await setting(env,'lastScheduledError',deliveryError);
    if(!deliveryError)await setting(env,'lastScheduledAt',new Date().toISOString());
    return {...result,ok:!deliveryError,deliveryError};
  }finally{await env.DB.prepare("DELETE FROM runtime_locks WHERE name='maintenance' AND owner=?").bind(lease).run();}
}
