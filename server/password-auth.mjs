import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {AppError} from '../src/domain.mjs';
import {authResponse,digest,limited,safeReturn,sessionHash,sessionCookie,sessionIdentity,REMEMBER_DEVICE_MS} from './auth.mjs';

// OWASP scrypt minimum: N=2^17, r=8, p=1. Salt and derived key only; no plaintext.
const cost={N:131072,r:8,p:1,maxmem:256*1024*1024};
let hashing=0;
/** @returns {Promise<Buffer>} */
export async function derive(password,salt){
  if(hashing>=2)throw new AppError('Bitte kurz warten und erneut versuchen.',429);
  hashing++;
  try{return await new Promise((resolve,reject)=>scrypt(password,Buffer.from(salt,'hex'),64,cost,(error,key)=>error?reject(error):resolve(key)));}finally{hashing--;}
}
export async function inputFor(env,request,maxBytes=4096){
  if(request.headers.get('origin')!==env.PANEL_ORIGIN||!request.headers.get('content-type')?.startsWith('application/json'))throw new AppError('Ungültiger Ursprung.',403);
  const reader=request.body?.getReader();if(!reader)throw new AppError('Ungültige Anfrage.',400);
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new AppError('Anfrage zu groß.',413);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  try{const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!input||typeof input!=='object'||Array.isArray(input))throw Error();return input;}catch{throw new AppError('Ungültige Anfrage.',400);}
}
async function throttled(env,request,email,now){
  const ip=(request.headers.get('x-forwarded-for')??'unknown').slice(0,80);
  const ipLimit=await limited(env,'password-ip:'+ip,now,20),emailLimit=await limited(env,'password-email:'+email,now,10);
  if(ipLimit||emailLimit)throw new AppError('Zu viele Versuche. Bitte später erneut versuchen oder den persönlichen E-Mail-Link nutzen.',429);
}
async function matches(password,row){
  const key=await derive(password,row?.salt??'00'.repeat(32));
  return Boolean(row&&/^[a-f0-9]{128}$/.test(row.derived)&&timingSafeEqual(key,Buffer.from(row.derived,'hex')));
}
export async function passwordLogin(env,request,now=Date.now()){
  const input=await inputFor(env,request),email=String(input.email??'').trim().toLowerCase(),password=input.password;
  if(email.length>180||typeof password!=='string'||password.length<1||password.length>128)throw new AppError('E-Mail-Adresse oder Passwort stimmen nicht.',401);
  await throttled(env,request,email,now);
  const row=digest(email)===env.OWNER_EMAIL_SHA256?await env.DB.prepare('SELECT * FROM auth_passwords WHERE owner_hash=?').bind(env.OWNER_EMAIL_SHA256).first():null;
  if(!await matches(password,row))return authResponse({error:'E-Mail-Adresse oder Passwort stimmen nicht. Für die erste Anmeldung bitte „Passwort einrichten / vergessen“ verwenden.'},401);
  const raw=randomBytes(32).toString('hex'),remember=input.remember===true,hash=digest(raw);
  // A concurrent password reset cannot turn a previously checked password into a new session.
  const results=await env.DB.batch([
    env.DB.prepare('INSERT INTO auth_sessions(hash,email,expires_at,last_at) SELECT ?,?,?,? FROM auth_passwords WHERE owner_hash=? AND revision=?').bind(hash,email,now+(remember?REMEMBER_DEVICE_MS:86400000),now,env.OWNER_EMAIL_SHA256,row.revision),
    ...(remember?[env.DB.prepare('INSERT INTO auth_session_preferences SELECT ?,1 WHERE EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(hash,hash)]:[])
  ]);
  if(!results[0].meta.changes)return authResponse({error:'Bitte erneut anmelden.'},409);
  return sessionCookie(authResponse({returnTo:input.returnTo==='/vor-ort'?safeReturn(input.returnTo):'/'}),raw,remember);
}
export async function savePassword(env,request,now=Date.now()){
  const input=await inputFor(env,request),email=await sessionIdentity(env,request,now);
  if(!email)return authResponse({error:'Bitte persönlich anmelden.'},401);
  if(digest(email)!==env.OWNER_EMAIL_SHA256)return authResponse({error:'Nur der Betreiber kann sein Passwort festlegen.'},403);
  await throttled(env,request,email,now);
  if(typeof input.password!=='string'||Array.from(input.password).length<15||input.password.length>128||input.password!==input.confirmation)return authResponse({error:'Bitte zweimal dasselbe Passwort mit 15 bis 128 Zeichen eingeben.'},400);
  const currentHash=sessionHash(request),row=await env.DB.prepare('SELECT * FROM auth_passwords WHERE owner_hash=?').bind(env.OWNER_EMAIL_SHA256).first();
  const proof=await env.DB.prepare('SELECT email_verified_at FROM auth_session_proofs WHERE session_hash=?').bind(currentHash).first();
  const fresh=proof&&proof.email_verified_at<=now&&proof.email_verified_at>=now-600000;
  let needsProof=true;
  if(!fresh){
    if(!row||typeof input.currentPassword!=='string'||!input.currentPassword||input.currentPassword.length>128)return authResponse({error:'Bestätige deinen Zugang zuerst mit einem neuen E-Mail-Link.',reauth:true},409);
    if(!await matches(input.currentPassword,row))return authResponse({error:'Das bisherige Passwort stimmt nicht.'},401);
    needsProof=false;
  }
  const salt=randomBytes(32).toString('hex'),derived=(await derive(input.password,salt)).toString('hex'),revision=randomBytes(32).toString('hex');
  const active="EXISTS(SELECT 1 FROM auth_sessions s WHERE s.hash=? AND s.email=? AND s.expires_at>? AND s.last_at+(CASE WHEN EXISTS(SELECT 1 FROM auth_session_preferences p WHERE p.session_hash=s.hash AND p.remember=1) THEN ? ELSE 14400000 END)>?)";
  const verified=needsProof?' AND EXISTS(SELECT 1 FROM auth_session_proofs WHERE session_hash=? AND email_verified_at BETWEEN ? AND ?)':'';
  const guards=[currentHash,email,now,REMEMBER_DEVICE_MS,now,...(needsProof?[currentHash,now-600000,now]:[])];
  const mutation=row?env.DB.prepare('UPDATE auth_passwords SET salt=?,derived=?,revision=?,changed_at=? WHERE owner_hash=? AND revision=? AND '+active+verified).bind(salt,derived,revision,now,env.OWNER_EMAIL_SHA256,row.revision,...guards):env.DB.prepare('INSERT INTO auth_passwords SELECT ?,?,?,?,? WHERE '+active+verified+' ON CONFLICT(owner_hash) DO NOTHING').bind(env.OWNER_EMAIL_SHA256,salt,derived,revision,now,...guards);
  const raw=randomBytes(32).toString('hex'),newHash=digest(raw);
  const results=await env.DB.batch([
    mutation,
    env.DB.prepare('INSERT INTO auth_sessions SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_passwords WHERE owner_hash=? AND revision=?)').bind(newHash,email,now+86400000,now,env.OWNER_EMAIL_SHA256,revision),
    env.DB.prepare('DELETE FROM auth_sessions WHERE email=? AND hash<>? AND EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(email,newHash,newHash),
    env.DB.prepare('UPDATE auth_tokens SET consumed=1 WHERE email=? AND EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(email,newHash),
    env.DB.prepare('DELETE FROM auth_session_proofs WHERE NOT EXISTS(SELECT 1 FROM auth_sessions WHERE hash=session_hash)')
  ]);
  if(!results[0].meta.changes)return authResponse({error:'Der Zugang wurde inzwischen geändert. Bitte erneut persönlich anmelden.'},409);
  return sessionCookie(authResponse({returnTo:'/',message:'Dein Passwort ist gespeichert.'}),raw);
}
export async function passwordPage(env,request){
  const row=await env.DB.prepare('SELECT revision FROM auth_passwords WHERE owner_hash=?').bind(env.OWNER_EMAIL_SHA256).first();
  const proof=await env.DB.prepare('SELECT email_verified_at FROM auth_session_proofs WHERE session_hash=?').bind(sessionHash(request)).first();
  const now=Date.now(),fresh=proof&&proof.email_verified_at>=now-600000&&proof.email_verified_at<=now;
  return new Response('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>White Gloss · Passwort</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/brand.css"><main class="appoff card"><span class="brandmark">WG</span><h1>Dein Passwort '+(row?'ändern':'einrichten')+'</h1><p>Wähle ein eigenes Passwort mit mindestens 15 Zeichen, zum Beispiel einen langen Satz. Du kannst deinen Passwortmanager verwenden.</p><form id="password-form">'+(row&&!fresh?'<label>Bisheriges Passwort<input name="currentPassword" type="password" autocomplete="current-password" maxlength="128" required></label>':'')+'<label>Neues Passwort<input name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label><label>Neues Passwort wiederholen<input name="confirmation" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label><button class="primary" type="submit">Passwort speichern</button></form><p id="password-message" role="status"></p><p><a href="/auth/login?setup=1">Zugang per E-Mail bestätigen</a> · <a href="/">Zurück zum Panel</a></p><script type="module" src="/password.js"></script></main></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
}
