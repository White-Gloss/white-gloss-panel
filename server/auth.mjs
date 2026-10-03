import {createHash,createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {configuration,init} from '../src/worker.mjs';
export const digest=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const authHeaders={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export const authResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...authHeaders,'Content-Type':'application/json'}});
const response=authResponse;
const safeReturn=value=>value==='/auth/password'||/^\/angebot\/[a-f0-9]{64}$/.test(value??'')?value:'/';
function cookie(request,name){const entry=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return entry?.slice(name.length+1)??'';}
export async function authSchema(env){await init(env);await env.DB.batch([
  'CREATE TABLE IF NOT EXISTS auth_tokens(hash TEXT PRIMARY KEY,email TEXT NOT NULL,return_to TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS auth_sessions(hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires_at INTEGER NOT NULL,last_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS auth_rates(subject TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(subject,bucket))',
  'CREATE TABLE IF NOT EXISTS auth_session_proofs(session_hash TEXT PRIMARY KEY,email_verified_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS auth_passwords(owner_hash TEXT PRIMARY KEY,salt TEXT NOT NULL,derived TEXT NOT NULL,revision TEXT NOT NULL,changed_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS auth_customer_pins(login_hash TEXT PRIMARY KEY,pin_digest TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0)'
].map(query=>env.DB.prepare(query)));}
export const sessionHash=request=>digest(cookie(request,'__Host-wg-session'));
export function sessionCookie(result,raw){result.headers.set('Set-Cookie','__Host-wg-session='+raw+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400');return result;}
export async function sessionIdentity(env,request,now=Date.now()){const raw=cookie(request,'__Host-wg-session');if(!/^[a-f0-9]{64}$/.test(raw))return null;const row=await env.DB.prepare('SELECT email,expires_at,last_at FROM auth_sessions WHERE hash=?').bind(digest(raw)).first();if(!row||row.expires_at<=now||row.last_at+4*3600000<=now)return null;await env.DB.prepare('UPDATE auth_sessions SET last_at=? WHERE hash=?').bind(now,digest(raw)).run();return row.email;}
export async function limited(env,subject,now,max){const bucket=Math.floor(now/3600000);await env.DB.prepare('INSERT INTO auth_rates(subject,bucket,count) VALUES(?,?,1) ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1').bind(digest(subject),bucket).run();return (await env.DB.prepare('SELECT count FROM auth_rates WHERE subject=? AND bucket=?').bind(digest(subject),bucket).first()).count>max;}
async function eligible(env,email,returnTo,now){if(digest(email)===env.OWNER_EMAIL_SHA256)return true;if(returnTo==='/')return false;const offerToken=returnTo.slice('/angebot/'.length);const row=await env.DB.prepare('SELECT o.data FROM offer_tokens t JOIN orders o ON o.id=t.order_id WHERE t.hash=? AND t.revoked=0 AND t.expires_at>?').bind(digest(offerToken),new Date(now).toISOString()).first();if(!row)return false;const order=JSON.parse(row.data);return !order.synthetic&&(order.source.email??'').trim().toLowerCase()===email;}
const pinDigest=(env,hash,pin)=>createHmac('sha256',Buffer.from(env.CONFIG_KEY,'base64')).update('customer-pin:'+hash+':'+pin).digest('hex');
export async function issueCustomerAccess(env,email,returnTo,now=Date.now(),expiresAt=now+600000){
  email=email.trim().toLowerCase();
  if(digest(email)===env.OWNER_EMAIL_SHA256||!/^\/angebot\/[a-f0-9]{64}$/.test(returnTo)||!await eligible(env,email,returnTo,now))throw Error('Kundenzugang gehört nicht zu einem gültigen persönlichen Angebot.');
  const rawToken=token(),hash=digest(rawToken),pin=String(randomInt(0,1000000)).padStart(6,'0');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO auth_tokens(hash,email,return_to,expires_at) VALUES(?,?,?,?)').bind(hash,email,returnTo,expiresAt),
    env.DB.prepare('INSERT INTO auth_customer_pins(login_hash,pin_digest) VALUES(?,?)').bind(hash,pinDigest(env,hash,pin))
  ]);
  const url=new URL('/auth/verify',env.PANEL_ORIGIN);url.searchParams.set('token',rawToken);url.searchParams.set('pin','required');
  return {hash,url:url.href,pin};
}
export async function requestLogin(env,request,now=Date.now()){
  if(request.headers.get('origin')!==env.PANEL_ORIGIN||!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'Ungültiger Ursprung.'},403);
  const raw=await request.text();if(raw.length>2048)return response({error:'Anfrage zu groß.'},413);let input;try{input=JSON.parse(raw);}catch{return response({error:'Ungültige Anfrage.'},400);}
  const email=String(input.email??'').trim().toLowerCase(),returnTo=safeReturn(input.returnTo);
  if(email.length>180||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))return response({error:'Bitte eine gültige E-Mail-Adresse eingeben.'},400);
  const ip=(request.headers.get('x-forwarded-for')??'unknown').slice(0,80);
  if(await limited(env,'ip:'+ip,now,20)||await limited(env,'email:'+email,now,5))return response({error:'Bitte später erneut versuchen.'},429);
  const neutral={message:'Wenn diese E-Mail für den Zugang berechtigt ist, erhältst du einen persönlichen Anmeldelink. Er gilt 10 Minuten.'};
  if(!await eligible(env,email,returnTo,now))return response(neutral);
  const config=await configuration(env,['resendKey']);if(!config.resendKey||!config.emailVerified||!config.sender)return response({error:'Der E-Mail-Zugang wird gerade eingerichtet. Bitte später erneut versuchen.'},503);
  let login;
  if(digest(email)!==env.OWNER_EMAIL_SHA256)login=await issueCustomerAccess(env,email,returnTo,now);
  else{const rawToken=token(),hash=digest(rawToken);await env.DB.prepare('INSERT INTO auth_tokens(hash,email,return_to,expires_at) VALUES(?,?,?,?)').bind(hash,email,returnTo,now+600000).run();const url=new URL('/auth/verify',env.PANEL_ORIGIN);url.searchParams.set('token',rawToken);login={hash,url:url.href,pin:null};}
  try{const result=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-login-'+login.hash},body:JSON.stringify({from:config.sender,to:[email],subject:'Dein persönlicher White-Gloss-Zugang',text:'Öffne diesen persönlichen Link und bestätige die Anmeldung: '+login.url+(login.pin?'\n\nDeine persönliche einmalige PIN: '+login.pin:'')+'\n\nDer Link gilt 10 Minuten und kann einmal verwendet werden. Wenn du keine Anmeldung angefordert hast, ignoriere diese E-Mail.'})});const provider=await result.json();if(!result.ok||typeof provider.id!=='string')throw Error('Kein eindeutiges Providerergebnis.');}catch{await env.DB.prepare('DELETE FROM auth_tokens WHERE hash=?').bind(login.hash).run();return response({error:'Der Versand konnte nicht bestätigt werden. Bitte später einen neuen Anmeldelink anfordern.'},502);}
  return response(neutral);
}
export async function redeemLogin(env,request,now=Date.now()){
  if(request.headers.get('origin')!==env.PANEL_ORIGIN||!request.headers.get('content-type')?.startsWith('application/json'))return response({error:'Ungültiger Ursprung.'},403);
  const raw=await request.text();if(raw.length>200)return response({error:'Ungültige Anfrage.'},400);let value,pin;try{const input=JSON.parse(raw);value=input.token;pin=input.pin;}catch{return response({error:'Ungültiger Link.'},400);}
  if(!/^[a-f0-9]{64}$/.test(value??''))return response({error:'Ungültiger Link.'},400);
  const loginHash=digest(value),sessionToken=token(),sessionHash=digest(sessionToken);
  const loginRecord=await env.DB.prepare('SELECT email,consumed,expires_at FROM auth_tokens WHERE hash=?').bind(loginHash).first();
  if(!loginRecord||loginRecord.consumed||loginRecord.expires_at<=now)return response({error:'Dieser Link ist abgelaufen oder bereits verwendet. Bitte einen neuen Link anfordern.'},409);
  const customer=digest(loginRecord.email)!==env.OWNER_EMAIL_SHA256;
  if(customer){
    if(typeof pin!=='string'||!/^\d{6}$/.test(pin))return response({error:'Bitte die sechsstellige PIN aus derselben E-Mail eingeben.',pinRequired:true},400);
    const attempted=await env.DB.prepare('UPDATE auth_customer_pins SET attempts=attempts+1 WHERE login_hash=? AND attempts<5').bind(loginHash).run();
    if(!attempted.meta.changes)return response({error:'Bitte einen neuen persönlichen Link mit PIN anfordern.'},429);
    const expected=await env.DB.prepare('SELECT pin_digest,attempts FROM auth_customer_pins WHERE login_hash=?').bind(loginHash).first();
    if(!timingSafeEqual(Buffer.from(expected.pin_digest,'hex'),Buffer.from(pinDigest(env,loginHash,pin),'hex'))){if(expected.attempts>=5)await env.DB.prepare('UPDATE auth_tokens SET consumed=1 WHERE hash=?').bind(loginHash).run();return response({error:'Die PIN stimmt nicht. Nach fünf Fehlversuchen benötigst du einen neuen Link.',pinRequired:true},401);}
  }
  const pinGuard=customer?' AND EXISTS(SELECT 1 FROM auth_customer_pins WHERE login_hash=? AND pin_digest=? AND attempts<=5)':'';
  const results=await env.DB.batch([
    env.DB.prepare('INSERT INTO auth_sessions(hash,email,expires_at,last_at) SELECT ?,email,?,? FROM auth_tokens WHERE hash=? AND consumed=0 AND expires_at>?'+pinGuard).bind(sessionHash,now+86400000,now,loginHash,now,...(customer?[loginHash,pinDigest(env,loginHash,pin)]:[])),
    env.DB.prepare('UPDATE auth_tokens SET consumed=1 WHERE hash=? AND EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(loginHash,sessionHash),
    env.DB.prepare('INSERT INTO auth_session_proofs SELECT ?,? WHERE EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(sessionHash,now,sessionHash)
  ]);
  if(!results[0].meta.changes)return response({error:'Dieser Link ist abgelaufen oder bereits verwendet. Bitte einen neuen Link anfordern.'},409);
  const login=await env.DB.prepare('SELECT return_to FROM auth_tokens WHERE hash=?').bind(loginHash).first();
  const result=response({returnTo:safeReturn(login.return_to)});result.headers.set('Set-Cookie','__Host-wg-session='+sessionToken+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400');return result;
}
export async function logout(env,request){if(request.headers.get('origin')!==env.PANEL_ORIGIN)return response({error:'Ungültiger Ursprung.'},403);const raw=cookie(request,'__Host-wg-session');if(raw)await env.DB.prepare('DELETE FROM auth_sessions WHERE hash=?').bind(digest(raw)).run();const result=response({ok:true});result.headers.set('Set-Cookie','__Host-wg-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');return result;}
export function loginPage(){return new Response('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>White Gloss · Anmeldung</title><link rel="stylesheet" href="/style.css"><main class="appoff card"><span class="brandmark">WG</span><h1>Dein persönlicher Zugang</h1><p id="auth-description">Melde dich mit deiner Betreiber-E-Mail und deinem Passwort an.</p><form id="auth-form"><label>E-Mail-Adresse<input id="auth-email" type="email" autocomplete="username" maxlength="180" required></label><label id="auth-password-label">Passwort<input id="auth-password" type="password" autocomplete="current-password" maxlength="128" required></label><button class="primary" type="submit">Anmelden</button></form><p><button id="auth-recovery" type="button">Passwort einrichten / vergessen</button></p><p id="auth-message" role="status"></p><script type="module" src="/auth.js"></script></main></html>',{headers:{...authHeaders,'Content-Type':'text/html; charset=utf-8'}});}
export async function pruneAuth(env,now=Date.now()){await env.DB.batch([env.DB.prepare('DELETE FROM auth_tokens WHERE expires_at<?').bind(now-86400000),env.DB.prepare('DELETE FROM auth_customer_pins WHERE NOT EXISTS(SELECT 1 FROM auth_tokens WHERE hash=login_hash)'),env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at<? OR last_at<?').bind(now,now-4*3600000),env.DB.prepare('DELETE FROM auth_session_proofs WHERE NOT EXISTS(SELECT 1 FROM auth_sessions WHERE hash=session_hash)'),env.DB.prepare('DELETE FROM auth_rates WHERE bucket<?').bind(Math.floor(now/3600000)-24)]);}
