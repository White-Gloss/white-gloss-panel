import worker,{init,setting,protect,settings,configuration,background} from '../src/worker.mjs';
import {customerFilesSchema,customerFiles,updateCustomerFile,assertCustomerSourceActive} from './customer-files.mjs';
import {pushSchema,pushStatus,pushDevice,pushMaintenance,collectPush} from './push.mjs';
import {AppError} from '../src/domain.mjs';
import {authSchema,sessionIdentity,requestLogin,redeemLogin,customerPinLogin,customerResetRequest,logout,loginPage,pruneAuth,digest} from './auth.mjs';
import {customerPortalSchema,customerPortalData,customerPortalPage,customerPortalDocument,customerPaymentPDF,customerInvoicePaymentPDF,customerAgreement,customerReviewConsent,customerChat,ownerChatSummary} from './customer-portal.mjs';
import {invoicePaymentDocument} from './invoice-payment.mjs';
import {invoiceMailStatuses} from './invoice-mail.mjs';
import {validatePaymentPDF} from './payment-receipt-upload.mjs';
import {documentEndpoint} from './document-template.mjs';
import {passwordLogin,savePassword,passwordPage} from './password-auth.mjs';
import {calendarOAuthSchema,calendarAuthorize,calendarCallback,calendarAccessToken} from './calendar-oauth.mjs';
import {createStorage} from './storage.mjs';
import {providerOperations,providerSchema} from './providers.mjs';
import {agentAuthSchema,agentAuthEndpoint,pruneAgentAuth} from './agent-auth.mjs';
import {agentActionSchema,agentMcpEndpoint} from './agent-tools.mjs';
import {recordsLifecycleSchema,recordsLifecycleEndpoint} from './records-lifecycle.mjs';
import {calendarAdjustmentSchema,calendarAdjustmentEndpoint} from './calendar-adjustments.mjs';
import {tasksSchema,tasksEndpoint} from './tasks.mjs';
import {panelAssistantSchema,panelAssistantEndpoint} from './panel-assistant.mjs';
import {customerCreateEndpoint} from './customer-create.mjs';
import {assistantProviderSchema,assistantProviderEndpoint} from './assistant-provider.mjs';
const lockedHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com"};
function errorResponse(message,status=500){return new Response(JSON.stringify({error:message}),{status,headers:{'Content-Type':'application/json'}});}
export async function createApplication(env){
  const origin=new URL(env.PANEL_ORIGIN);if(origin.protocol!=='https:'||origin.origin!==env.PANEL_ORIGIN||origin.username||origin.password)throw Error('PANEL_ORIGIN muss ein eindeutiger HTTPS-Ursprung sein.');
  if(!/^[a-f0-9]{64}$/.test(env.OWNER_EMAIL_SHA256??''))throw Error('Betreiberidentität fehlt.');
  await init(env);await authSchema(env);await customerPortalSchema(env);await calendarOAuthSchema(env);await providerSchema(env);await agentAuthSchema(env);await agentActionSchema(env);await customerFilesSchema(env);await pushSchema(env);await recordsLifecycleSchema(env);await calendarAdjustmentSchema(env);await tasksSchema(env);await panelAssistantSchema(env);await assistantProviderSchema(env);
  env.passwordResetStatements=newHash=>[env.DB.prepare('UPDATE agent_grants SET revoked=1 WHERE EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(newHash)];
  env.CUSTOMER_ACCESS_APPROVED='true';env.STANDALONE_AUTH='true';env.operations=providerOperations;
  env.validatePaymentPDF=validatePaymentPDF;env.assertCustomerSourceActive=assertCustomerSourceActive;
  const handle=async request=>{
    try{
      const url=new URL(request.url);if(url.origin!==env.PANEL_ORIGIN)return errorResponse('Ungültiger Host.',400);
      if(url.pathname==='/healthz')return new Response('ok',{headers:{'Content-Type':'text/plain'}});
      if(url.pathname==='/mcp')return await agentMcpEndpoint(env,request);
      const agent=await agentAuthEndpoint(env,request);if(agent)return agent;
      if(request.method==='GET'&&(/^\/[a-zA-Z0-9_-]+\.(css|js|mjs)$/.test(url.pathname)||['/manifest.webmanifest','/panel-icon.svg'].includes(url.pathname)))return env.ASSETS.fetch(request);
      if(request.method==='GET'&&['/auth/login','/auth/verify'].includes(url.pathname))return loginPage();
      if(request.method==='GET'&&url.pathname==='/api/calendar/availability')return await worker.fetch(request,env);
      if(request.method==='POST'&&url.pathname==='/auth/request')return await requestLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/redeem')return await redeemLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/customer/login')return await customerPinLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/customer/reset/request')return await customerResetRequest(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/password/login')return await passwordLogin(env,request);
      if(request.method==='POST'&&url.pathname==='/auth/logout')return await logout(env,request);
      const identity=await sessionIdentity(env,request);
      if(!identity){if(request.method==='GET'&&!url.pathname.startsWith('/api/')){const login=new URL('/auth/login',env.PANEL_ORIGIN);if(/^\/angebot\/[a-f0-9]{64}$/.test(url.pathname))login.searchParams.set('returnTo',url.pathname);if(url.pathname==='/kundenportal')login.searchParams.set('customer','1');if(url.pathname==='/'&&/^[a-f0-9-]{36}$/.test(url.searchParams.get('order')??''))login.searchParams.set('returnTo','/?order='+url.searchParams.get('order'));if(url.pathname==='/auth/password')login.searchParams.set('setup','1');return Response.redirect(login,303);}return errorResponse('Bitte persönlich anmelden.',401);}
      const isOwner=digest(identity)===env.OWNER_EMAIL_SHA256;
      const calendarAdjustment=await calendarAdjustmentEndpoint(env,request,identity,isOwner);if(calendarAdjustment)return calendarAdjustment;
      for(const endpoint of [recordsLifecycleEndpoint,tasksEndpoint,panelAssistantEndpoint,customerCreateEndpoint,assistantProviderEndpoint]){const response=await endpoint(env,request,identity);if(response)return response;}
      if(!isOwner&&url.pathname==='/'&&request.method==='GET')return Response.redirect(new URL('/kundenportal',env.PANEL_ORIGIN),303);
      if(!isOwner&&url.pathname==='/kundenportal'&&request.method==='GET')return customerPortalPage();
      if(!isOwner&&url.pathname==='/api/customer-portal'&&request.method==='GET')return Response.json(await customerPortalData(env,identity));
      if(!isOwner&&url.pathname==='/api/customer-portal/document'&&request.method==='GET')return await customerPortalDocument(env,request,identity);
      if(!isOwner&&url.pathname==='/api/customer-portal/agreement'&&request.method==='GET')return await customerAgreement(env,request,identity);
      if(!isOwner&&url.pathname==='/api/customer/payment/pdf'&&request.method==='GET')return await customerPaymentPDF(env,request,identity);
      if(!isOwner&&url.pathname==='/api/customer/invoice/payment/pdf'&&request.method==='GET')return await customerInvoicePaymentPDF(env,request,identity);
      if(isOwner&&url.pathname==='/api/invoice/payment/pdf'&&request.method==='GET'){const version=url.searchParams.get('version');if(!/^[a-f0-9]{64}$/.test(version??''))return errorResponse('Gespeicherte Rechnungskopienversion fehlt.',400);const pdf=await invoicePaymentDocument(env,url.searchParams.get('id'),version);return new Response(pdf.bytes,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+pdf.filename+'"'}});}
      if(isOwner&&url.pathname==='/api/customer-portal/review-consent')return errorResponse('Diese Einwilligung kann nur der persönlich angemeldete Kunde erteilen oder widerrufen.',403);
      if(!isOwner&&url.pathname==='/api/customer-portal/review-consent')return await customerReviewConsent(env,request,identity);
      if(!isOwner&&url.pathname==='/api/customer-portal/chat')return await customerChat(env,request,identity,false);
      if(isOwner&&url.pathname==='/api/customer-chat')return await customerChat(env,request,identity,true);
      if(isOwner&&url.pathname==='/api/customer-chat/summary'&&request.method==='GET')return Response.json(await ownerChatSummary(env));
      if(isOwner){const documentResponse=await documentEndpoint(env,request);if(documentResponse)return documentResponse;}
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
      if(!isOwner&&!url.pathname.startsWith('/angebot/')&&!url.pathname.startsWith('/api/offer/')&&!(url.pathname==='/api/calendar/availability'&&request.method==='GET'))return errorResponse('Dieser Zugang ist für eigene Angebote und das persönliche Kundenpanel vorgesehen.',403);
      if(isOwner&&['/api/customer-files','/api/push'].includes(url.pathname)){
        if(request.method==='GET')return Response.json(url.pathname==='/api/push'?await pushStatus(env):await customerFiles(env,url.searchParams.get('test')==='true'));
        if(request.method!=='POST')return errorResponse('Methode nicht erlaubt.',405);
        if(request.headers.get('origin')!==env.PANEL_ORIGIN||!request.headers.get('content-type')?.startsWith('application/json'))return errorResponse('Ungültiger Ursprung oder Inhalt.',403);
        const raw=await request.text();if(raw.length>20000)return errorResponse('Eingabe zu groß.',413);
        const input=JSON.parse(raw);return Response.json(url.pathname==='/api/push'?await pushDevice(env,input):await updateCustomerFile(env,input));
      }
      if(isOwner&&url.pathname==='/api/protocol/pdf'&&request.method==='GET')return await providerOperations.protocolDownload(env,url.searchParams.get('id'),url.searchParams.get('kind'));
      if(isOwner&&url.pathname==='/api/check'&&request.method==='POST'){
        const input=await request.clone().json().catch(()=>({}));if(input.kind==='calendar'&&(await settings(env)).calendarOAuth)await calendarAccessToken(env);
      }
      const headers=new Headers(request.headers);headers.delete('oai-authenticated-user-email');headers.set('oai-authenticated-user-email',identity);
      const trusted=new Request(request,{headers});
      const result=await worker.fetch(trusted,env);
      if(isOwner&&request.method==='GET'&&result.ok&&['/api/state','/api/order'].includes(url.pathname)){
        const data=await result.json(),orders=url.pathname==='/api/state'?data.orders:[data],statuses=await invoiceMailStatuses(env,orders.map(order=>order.id));
        // Canonical delivery state overrides an older cached outcome without rewriting signed orders.
        // No delivery record means the existing pre-queue error or absent legacy status is preserved.
        for(const order of orders){const status=statuses.get(order.id);if(status)order.invoiceMail=status;}
        return new Response(JSON.stringify(data),{status:result.status,headers:result.headers});
      }
      if(request.method==='POST'&&url.pathname.startsWith('/api/')&&result.ok){try{await collectPush(env);}catch{await setting(env,'pushError','Benachrichtigungen konnten noch nicht vorgemerkt werden.');}}return result;
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
    try{await pushMaintenance(env);await setting(env,'pushError',null);}catch{errors.push('Handy-Benachrichtigungen konnten nicht verarbeitet werden.');}
    let result;try{result=await background(env);if(result.deliveryError)errors.push(result.deliveryError);}catch(error){errors.push('Fälligkeitsprüfung: '+error.message);result={ok:false};}
    const deliveryError=errors.length?errors.join(' · '):null;await setting(env,'lastScheduledError',deliveryError);
    if(!deliveryError)await setting(env,'lastScheduledAt',new Date().toISOString());
    return {...result,ok:!deliveryError,deliveryError};
  }finally{await env.DB.prepare("DELETE FROM runtime_locks WHERE name='maintenance' AND owner=?").bind(lease).run();}
}
