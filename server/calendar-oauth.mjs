import {randomBytes,createHash} from 'node:crypto';
import {settings,setting,protect,unprotect} from '../src/worker.mjs';
import {AppError,need} from '../src/domain.mjs';
import {digest} from './auth.mjs';
const calendarScopes=['openid','email','https://www.googleapis.com/auth/calendar.calendars.readonly','https://www.googleapis.com/auth/calendar.events.owned'];
async function calendarCredentials(env){
  if(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET)return {id:env.GOOGLE_CLIENT_ID,secret:env.GOOGLE_CLIENT_SECRET};
  const config=await settings(env);need(config.googleClientId&&config.googleClientSecret,'Google-Webclient ist noch nicht eingerichtet.',409);
  return {id:config.googleClientId,secret:await unprotect(env,config.googleClientSecret)};
}
export async function calendarOAuthSchema(env){await env.DB.prepare('CREATE TABLE IF NOT EXISTS calendar_oauth_states(hash TEXT PRIMARY KEY,owner_hash TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL)').run();}
export async function calendarAuthorize(env,email,now=Date.now()){
  need(digest(email)===env.OWNER_EMAIL_SHA256,'Nur der Betreiber darf den Kalender verbinden.',403);
  const client=await calendarCredentials(env);
  const state=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url');
  await env.DB.prepare('INSERT INTO calendar_oauth_states VALUES(?,?,?,?)').bind(digest(state),digest(email),await protect(env,verifier),now+600000).run();
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [key,value] of Object.entries({client_id:client.id,redirect_uri:env.PANEL_ORIGIN+'/auth/calendar/callback',response_type:'code',scope:calendarScopes.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',login_hint:env.CALENDAR_OWNER_EMAIL??'anfrage@white-gloss.de'}))url.searchParams.set(key,value);
  return Response.redirect(url,303);
}
async function exchange(env,params){const client=await calendarCredentials(env);const result=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...params,client_id:client.id,client_secret:client.secret})});const data=await result.json();need(result.ok&&typeof data.access_token==='string'&&Number.isFinite(data.expires_in)&&data.expires_in>0,'Google hat keinen verwendbaren Kalenderzugang bestätigt.',502);return data;}
export async function calendarCallback(env,request,email,now=Date.now()){
  need(email&&digest(email)===env.OWNER_EMAIL_SHA256,'Bitte zuerst als Betreiber anmelden.',403);
  const url=new URL(request.url),state=url.searchParams.get('state');need(/^[a-f0-9]{64}$/.test(state??''),'OAuth-Zustand ungültig.',403);
  const record=await env.DB.prepare('DELETE FROM calendar_oauth_states WHERE hash=? AND owner_hash=? AND expires_at>? RETURNING verifier').bind(digest(state),digest(email),now).first();need(record,'OAuth-Freigabe abgelaufen oder bereits verwendet.',403);
  need(!url.searchParams.has('error')&&url.searchParams.get('code'),'Google-Freigabe wurde nicht abgeschlossen.',409);
  const data=await exchange(env,{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:env.PANEL_ORIGIN+'/auth/calendar/callback',code_verifier:await unprotect(env,record.verifier)});
  const granted=new Set(String(data.scope??'').split(' '));need(calendarScopes.slice(2).every(scope=>granted.has(scope)),'Bitte die benötigten Kalenderrechte freigeben.',409);
  const identityResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+data.access_token}});const identity=await identityResponse.json();need(identityResponse.ok&&identity.email_verified===true&&identity.sub&&identity.email?.toLowerCase()===(env.CALENDAR_OWNER_EMAIL??'anfrage@white-gloss.de').toLowerCase(),'Bitte den geschäftlichen Kalender mit dem vorgesehenen Google-Konto verbinden.',403);
  const config=await settings(env);need(data.refresh_token||config.calendarRefreshToken,'Google hat keinen dauerhaften Refresh-Token geliefert. Bitte Zugriff erneut freigeben.',409);
  const statements=[['calendarToken',await protect(env,data.access_token)],['calendarExpiresAt',now+data.expires_in*1000],['calendarProvider','Google'],['calendarAccount',identity.email],['calendarSubject',identity.sub],['calendarVerified',false],['calendarOAuth',true]];
  if(data.refresh_token)statements.push(['calendarRefreshToken',await protect(env,data.refresh_token)]);
  await env.DB.batch(statements.map(([key,value])=>env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value))));
  return Response.redirect(env.PANEL_ORIGIN+'/#settings',303);
}
let calendarRefreshing=new WeakMap();
export async function calendarAccessToken(env,now=Date.now()){
  const config=await settings(env);need(config.calendarOAuth&&config.calendarRefreshToken,'Dauerhafter Google-Kalenderzugang fehlt.',409);
  if(config.calendarExpiresAt>now+60000)return unprotect(env,config.calendarToken);
  if(!calendarRefreshing.has(env.DB))calendarRefreshing.set(env.DB,(async()=>{try{const data=await exchange(env,{grant_type:'refresh_token',refresh_token:await unprotect(env,config.calendarRefreshToken)});const statements=[env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('calendarToken',JSON.stringify(await protect(env,data.access_token))),env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('calendarExpiresAt',JSON.stringify(now+data.expires_in*1000))];if(data.refresh_token)statements.push(env.DB.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('calendarRefreshToken',JSON.stringify(await protect(env,data.refresh_token))));await env.DB.batch(statements);return data.access_token;}catch(error){await setting(env,'calendarVerified',false);throw error instanceof AppError?error:new AppError('Kalenderzugang muss erneut verbunden werden.',502);}finally{calendarRefreshing.delete(env.DB);}})());
  return calendarRefreshing.get(env.DB);
}
