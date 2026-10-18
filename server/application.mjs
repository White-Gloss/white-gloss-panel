import worker,{init,setting,protect,settings,configuration,background} from '../src/worker.mjs';
import {AppError} from '../src/domain.mjs';
import {authSchema,sessionIdentity,requestLogin,redeemLogin,logout,loginPage,pruneAuth,digest} from './auth.mjs';
import {passwordLogin,savePassword,passwordPage} from './password-auth.mjs';
import {calendarOAuthSchema,calendarAuthorize,calendarCallback,calendarAccessToken} from './calendar-oauth.mjs';
import {createStorage} from './storage.mjs';
import {providerOperations,providerSchema} from './providers.mjs';
import {chatSchema,handleChat,chatBackground,CUSTOMER_CHAT_PREFIXES} from './chat.mjs';
import {portalSchema,handlePortal,handlePortalAdmin,PORTAL_PATH,PORTAL_PREFIXES} from './portal.mjs';
import {businessPortalSchema,handleBusinessPortal,handleBusinessAdmin} from './business-portal.mjs';
import {accountingSchema,handleAccounting} from './accounting.mjs';
import {bankAccountingSchema,handleBankAccounting} from './bank-accounting.mjs';
import {advisorSchema} from './advisor-auth.mjs';
import {handleAdvisor} from './advisor.mjs';
const lockedHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com"};
function errorResponse(message,status=500){return new Response(JSON.stringify({error:message}),{status,headers:{'Content-Type':'application/json'}});}
export async function createApplication(env){
  const origin=new URL(env.PANEL_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PANEL_ORIGIN||origin.username||origin.password)throw Error('PANEL_ORIGIN muss ein eindeutiger HTTPS-Ursprung sein.');
  if(!/^[a-f0-9]{64}$/.test(env.OWNER_EMAIL_SHA256??''))throw Error('Betreiberidentität fehlt.');
  await init(env);await authSchema(env);await calendarOAuthSchema(env);await providerSchema(env);await chatSchema(env);await portalSchema(env);await businessPortalSchema(env);await accountingSchema(env);await bankAccountingSchema(env);await advisorSchema(env);
  env.CUSTOMER_ACCESS_APPROVED='true';env.STANDALONE_AUTH='true';env.operations=providerOperations;
  const handle=async request=>{
    try{
      const url=new URL(request.url);if(url.origin!==env.PANEL_ORIGIN)return errorResponse('Ungültiger Host.',400);
      if(url.pathname==='/healthz')return new Response('ok',{headers:{'Content-Type':'text/plain'}});
      // Scripts, styles, the web app manifest and icons are public; customer data never is.
      if(request.method==='GET'&&/^\/[a-zA-Z0-9_-]+\.(css|js|mjs|webmanifest|png|svg|woff2)$/.test(url.pathname))return env.ASSETS.fetch(request);
      if(request.method==='GET'&&['/auth/login','/auth/verify'].includes(url.pathname))return loginPage();
      if(request.method==='POST'&&url.pathname==='/auth/request')return await requestLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/redeem')return await redeemLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/password/login')return await passwordLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/logout')return await logout(env,request);
      const advisor=await handleAdvisor(env,request);if(advisor)return advisor;
      const identity=await sessionIdentity(env,request);
      if(!identity){if(request.method==='GET'&&!url.pathname.startsWith('/api/')){const login=new URL('/auth/login',env.PANEL_ORIGIN);if(/^\/(?:angebot|dokument|rechnung|chat)\/[a-f0-9]{64}$/.test(url.pathname)||url.pathname==='/vor-ort'||url.pathname===PORTAL_PATH)login.searchParams.set('returnTo',url.pathname);if(url.pathname==='/auth/password')login.searchParams.set('setup','1');return Response.redirect(login,303);}return errorResponse('Bitte persönlich anmelden.',401);}
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
      if(!isOwner&&url.pathname!==PORTAL_PATH&&!['/angebot/','/api/offer/','/dokument/','/api/document/','/rechnung/','/api/rechnung/',...CUSTOMER_CHAT_PREFIXES,...PORTAL_PREFIXES].some(prefix=>url.pathname.startsWith(prefix)))return errorResponse('Dieser Zugang ist für das persönliche Angebot vorgesehen.',403);
      if(url.pathname.startsWith('/api/chats')||url.pathname.startsWith('/api/kundenchat/')){const chat=await handleChat(env,request,identity,isOwner);if(chat)return chat;}
      if(url.pathname.startsWith('/api/portal/business/')){const business=await handleBusinessPortal(env,request,identity,isOwner);if(business)return business;}
      if(url.pathname.startsWith('/api/portal-admin/business/')){const business=await handleBusinessAdmin(env,request,isOwner);if(business)return business;}
      if(url.pathname.startsWith('/api/portal/')){const portal=await handlePortal(env,request,identity,isOwner);if(portal)return portal;}
      if(url.pathname.startsWith('/api/portal-admin/')){const admin=await handlePortalAdmin(env,request,isOwner);if(admin)return admin;}
      if(url.pathname==='/api/accounting/bank'||url.pathname.startsWith('/api/accounting/bank/')){const bank=await handleBankAccounting(env,request,isOwner);if(bank)return bank;}
      if(url.pathname==='/api/accounting'||url.pathname.startsWith('/api/accounting/')){const accounting=await handleAccounting(env,request,isOwner);if(accounting)return accounting;}
      if(url.pathname===PORTAL_PATH&&request.method==='GET')return env.ASSETS.fetch(request);
      if(isOwner&&url.pathname==='/api/invoice/pdf'&&request.method==='GET')return await providerOperations.invoiceDownload(env,await (await import('../src/worker.mjs')).getOrder(env,url.searchParams.get('id')));
      if(isOwner&&url.pathname==='/api/protocol/pdf'&&request.method==='GET')return await providerOperations.protocolDownload(env,url.searchParams.get('id'),url.searchParams.get('kind'));
      if(isOwner&&url.pathname==='/api/check'&&request.method==='POST'){
        const input=await request.clone().json().catch(()=>({}));if(input.kind==='calendar'&&(await settings(env)).calendarOAuth)await calendarAccessToken(env);
      }
      const headers=new Headers(request.headers);headers.delete('oai-authenticated-user-email');headers.set('oai-authenticated-user-email',identity);
      const trusted=new Request(request,{headers});
      return worker.fetch(trusted,env);
    }catch(error){if(error?.message==='Eine Anbieteraktion ist noch nicht bestätigt. Bitte zuerst lesend abgleichen und danach löschen.')return errorResponse(error.message,409);if(error?.message==='Terminüberschneidung')return errorResponse('Dieser Termin überschneidet sich mit einem anderen Auftrag. Bitte den Termin zuerst ändern.',409);return errorResponse(error instanceof AppError?error.message:'Verbindung oder Speicherung fehlgeschlagen. Kein Erfolg wurde bestätigt.',error instanceof AppError?error.status:500);}
  };
  return {env,async fetch(request){const result=await handle(request);const secured=new Response(result.body,{status:result.status,headers:result.headers});const sandboxed=result.headers.get('content-security-policy')?.startsWith('sandbox;');for(const [key,value] of Object.entries(lockedHeaders))if(!(sandboxed&&key==='Content-Security-Policy'))secured.headers.set(key,value);return secured;}};
}
export async function configureFromEnvironment(env){await init(env);const old=await settings(env);const secrets={HUB_SYNC_TOKEN:'hubKey',RESEND_API_KEY:'resendKey'};for(const [key,settingKey] of Object.entries(secrets))if(env[key]&&!old[settingKey])await setting(env,settingKey,await protect(env,env[key]));for(const [key,settingKey] of Object.entries({EMAIL_SENDER:'sender',CALENDAR_ID:'calendarId',REVIEW_URL:'reviewUrl'}))if(env[key]&&old[settingKey]===undefined)await setting(env,settingKey,env[key]);await setting(env,'standaloneAuth',true);}
/** @returns {Promise<any>} */
export async function applicationEnvironment(variables=process.env){const env={...variables,...await createStorage(variables.PANEL_DATA_DIR,variables.PANEL_ASSETS_DIR)};await configureFromEnvironment(env);return env;}
export async function maintenance(env,now=Date.now()){
  await providerSchema(env);const lease=digest(String(now)+crypto.randomUUID());const claimed=await env.DB.prepare("INSERT INTO runtime_locks(name,owner,expires_at) VALUES('maintenance',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE runtime_locks.expires_at<?").bind(lease,now+30*60000,now).run();if(!claimed.meta.changes)return {skipped:true,ok:true,deliveryError:null};
  try{
    await setting(env,'lastScheduledAttempt',new Date(now).toISOString());await pruneAuth(env,now);
    await env.DB.prepare('DELETE FROM calendar_oauth_states WHERE expires_at<?').bind(now).run();
    let errors=[];try{errors=(await providerOperations.background(env)).errors;}catch(error){errors.push('Anbieterabgleich: '+error.message);}
    try{errors.push(...await chatBackground(env,now));}catch(error){errors.push('Kundenchat: '+error.message);}
    let result;try{result=await background(env);if(result.deliveryError)errors.push(result.deliveryError);}catch(error){errors.push('Fälligkeitsprüfung: '+error.message);result={ok:false};}
    const deliveryError=errors.length?errors.join(' · '):null;await setting(env,'lastScheduledError',deliveryError);
    if(!deliveryError)await setting(env,'lastScheduledAt',new Date().toISOString());
    return {...result,ok:!deliveryError,deliveryError};
  }finally{await env.DB.prepare("DELETE FROM runtime_locks WHERE name='maintenance' AND owner=?").bind(lease).run();}
}
