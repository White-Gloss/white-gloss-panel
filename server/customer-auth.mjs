import {createHmac,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import {authResponse,digest,limited,sessionCookie,REMEMBER_DEVICE_MS} from './auth.mjs';
import {derive,inputFor} from './password-auth.mjs';
import {configuration,protect,unprotect} from '../src/worker.mjs';
import {AppError} from '../src/domain.mjs';

const lifetime=600000;
const neutral={message:'Wenn Ihre E-Mail-Adresse berechtigt ist, erhalten Sie einen Bestätigungscode. Prüfen Sie auch den Spamordner.'};
const denied=()=>authResponse({error:'Der Code ist ungültig, abgelaufen oder bereits verwendet. Bitte einen neuen Code anfordern.'},401);
const emailKey=value=>String(value??'').trim().toLowerCase();
const validEmail=email=>email.length<=180&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const cookieValue=request=>(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-wg-setup='))?.slice(16)??'';
const mac=(env,id,code)=>createHmac('sha256',Buffer.from(env.CONFIG_KEY,'base64')).update('customer-account:'+id+':'+code).digest('hex');
const setupCookie=(response,value,age=600)=>{response.headers.set('Set-Cookie','__Host-wg-setup='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+age);return response;};

export async function customerAuthSchema(env){await env.DB.batch([
 env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_customer_codes(email TEXT PRIMARY KEY,id TEXT NOT NULL,purpose TEXT NOT NULL,credential_revision TEXT,code_digest TEXT NOT NULL,payload TEXT,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,setup_hash TEXT,provider_id TEXT)`),
 env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS auth_customer_setup_hash ON auth_customer_codes(setup_hash) WHERE setup_hash IS NOT NULL'),
 env.DB.prepare('CREATE TABLE IF NOT EXISTS auth_customer_remembered(session_hash TEXT PRIMARY KEY,revision TEXT NOT NULL)'),
 env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_customer_invites(email TEXT PRIMARY KEY,created_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'queued')")
]);}

async function eligible(env,email){
 if(digest(email)===env.OWNER_EMAIL_SHA256)return false;
 return Boolean(await env.DB.prepare(`SELECT 1 FROM orders WHERE synthetic=0 AND lower(trim(json_extract(data,'$.source.email')))=? AND json_extract(data,'$.trash.deletedAt') IS NULL AND COALESCE(json_extract(data,'$.recordsRestriction.status'),'') NOT IN ('blocked','anonymized') AND COALESCE(json_array_length(data,'$.documentCancellations'),0)=0 LIMIT 1`).bind(email).first()||await env.DB.prepare(`SELECT 1 FROM customers c WHERE c.synthetic=0 AND lower(trim(json_extract(c.data,'$.email')))=? AND NOT EXISTS(SELECT 1 FROM customer_orders l WHERE l.customer_id=c.id) LIMIT 1`).bind(email).first());
}
async function rate(env,request,email,kind,now,max=10){
 const ip=(request.headers.get('x-forwarded-for')??'unknown').slice(0,80);
 const ipLimit=await limited(env,'customer-'+kind+'-ip:'+ip,now,30),emailLimit=await limited(env,'customer-'+kind+'-email:'+email,now,max);
 if(ipLimit||emailLimit)throw new AppError('Zu viele Versuche. Bitte später erneut versuchen.',429);
}

// Only explicit customer self-service queues a code. No provider call here.
export async function queueCustomerCode(env,email,purpose='setup',now=Date.now()){
 email=emailKey(email);if(!validEmail(email)||!['setup','reset'].includes(purpose)||!await eligible(env,email))return false;
 const credential=await env.DB.prepare('SELECT revision FROM auth_customer_credentials WHERE email=?').bind(email).first();
 if(purpose==='setup'&&credential||purpose==='reset'&&!credential)return false;
 const id=randomBytes(32).toString('hex'),code=String(randomInt(0,1000000)).padStart(6,'0');
 const payload=await protect(env,code);
 const result=await env.DB.prepare(`INSERT INTO auth_customer_codes(email,id,purpose,credential_revision,code_digest,payload,state,created_at,expires_at) VALUES(?,?,?,?,?,?,'queued',?,?) ON CONFLICT(email) DO UPDATE SET id=excluded.id,purpose=excluded.purpose,credential_revision=excluded.credential_revision,code_digest=excluded.code_digest,payload=excluded.payload,state='queued',attempts=0,created_at=excluded.created_at,expires_at=excluded.expires_at,setup_hash=NULL,provider_id=NULL WHERE auth_customer_codes.created_at<=? AND (auth_customer_codes.state<>'sending' OR auth_customer_codes.expires_at<=?)`).bind(email,id,purpose,credential?.revision??null,mac(env,id,code),payload,now,now+lifetime,now-60000,now).run();
 return result.meta.changes>0;
}

export async function deliverCustomerCodes(env,now=Date.now()){
 const config=await configuration(env,['resendKey']);
 if(!config.emailVerified||!config.sendApproved||!config.resendKey||!config.sender)return;
 // Legacy invitation rows remain as history, but never initiate another email.
 // Website receipts and explicitly sent offers already explain customer access.
 const rows=(await env.DB.prepare("SELECT * FROM auth_customer_codes WHERE state='queued' AND expires_at>? ORDER BY created_at LIMIT 10").bind(now).all()).results;
 for(const row of rows){
  if(!await eligible(env,row.email)){await env.DB.prepare("UPDATE auth_customer_codes SET state='cancelled',payload=NULL WHERE id=? AND state='queued'").bind(row.id).run();continue;}
  const code=await unprotect(env,row.payload);
  const claimed=await env.DB.prepare("UPDATE auth_customer_codes SET state='sending',payload=NULL,expires_at=? WHERE id=? AND state='queued'").bind(now+lifetime,row.id).run();if(!claimed.meta.changes)continue;
  // A crash after this claim is deliberately not retried: provider outcome is unknown.
  try{
   // No await between the current record/credential check and the provider call.
   const active=env.DB.sql.prepare("SELECT 1 FROM orders WHERE synthetic=0 AND lower(trim(json_extract(data,'$.source.email')))=? AND json_extract(data,'$.trash.deletedAt') IS NULL AND COALESCE(json_extract(data,'$.recordsRestriction.status'),'') NOT IN ('blocked','anonymized') AND COALESCE(json_array_length(data,'$.documentCancellations'),0)=0 LIMIT 1").get(row.email)||env.DB.sql.prepare("SELECT 1 FROM customers c WHERE c.synthetic=0 AND lower(trim(json_extract(c.data,'$.email')))=? AND NOT EXISTS(SELECT 1 FROM customer_orders l WHERE l.customer_id=c.id) LIMIT 1").get(row.email);
   const credential=env.DB.sql.prepare('SELECT revision FROM auth_customer_credentials WHERE email=?').get(row.email);
   if(!active||(row.purpose==='setup'?Boolean(credential):credential?.revision!==row.credential_revision)){await env.DB.prepare("UPDATE auth_customer_codes SET state='cancelled' WHERE id=? AND state='sending'").bind(row.id).run();continue;}
   const result=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+config.resendKey,'Content-Type':'application/json','Idempotency-Key':'wg-account-'+row.id},body:JSON.stringify({from:config.sender,to:[row.email],subject:row.purpose==='reset'?'Ihr Code für ein neues White-Gloss-Passwort':'Ihr Code für den White-Gloss-Kundenbereich',text:'Hallo,\n\n'+(row.purpose==='reset'?'mit diesem Code können Sie ein neues Passwort festlegen:':'schön, dass Sie Ihren Kundenbereich nutzen möchten. Hier ist Ihr Bestätigungscode:')+'\n\n'+code+'\n\nÖffnen Sie '+env.PANEL_ORIGIN+'/auth/customer und wählen Sie „Code eingeben“. Danach legen Sie Ihr persönliches Passwort fest. Der Code ist 10 Minuten gültig und kann einmal verwendet werden.\n\nAnschließend können Sie sich jederzeit mit Ihrer E-Mail-Adresse und Ihrem Passwort anmelden.\n\nFalls Sie diesen Code nicht angefordert haben, brauchen Sie nichts zu tun.\n\nViele Grüße\nLars Hägele\nWhite-Gloss Detailing'})});
   const data=await result.json();if(!result.ok||typeof data.id!=='string'||!data.id)throw Error('Unconfirmed delivery');
   await env.DB.prepare("UPDATE auth_customer_codes SET state='sent',provider_id=? WHERE id=? AND state='sending'").bind(data.id,row.id).run();
  }catch{await env.DB.prepare("UPDATE auth_customer_codes SET state='unknown' WHERE id=? AND state='sending'").bind(row.id).run();}
 }
}

async function verify(env,request,input,now){
 const email=emailKey(input.email);await rate(env,request,email,'verify',now,20);
 if(!validEmail(email)||!/^\d{6}$/.test(input.code??''))return denied();
 const attempted=await env.DB.prepare("UPDATE auth_customer_codes SET attempts=attempts+1 WHERE email=? AND state='sent' AND attempts<5 AND expires_at>?").bind(email,now).run();if(!attempted.meta.changes)return denied();
 const row=await env.DB.prepare('SELECT * FROM auth_customer_codes WHERE email=?').bind(email).first();
 if(row.state!=='sent'||!timingSafeEqual(Buffer.from(row.code_digest,'hex'),Buffer.from(mac(env,row.id,input.code),'hex')))return denied();
 const raw=randomBytes(32).toString('hex');
 const result=await env.DB.prepare("UPDATE auth_customer_codes SET state='verified',setup_hash=?,expires_at=? WHERE id=? AND state='sent' AND attempts<=5 AND expires_at>? AND code_digest=?").bind(digest(raw),now+lifetime,row.id,now,mac(env,row.id,input.code)).run();
 if(!result.meta.changes)return denied();
 return setupCookie(authResponse({returnTo:'/auth/customer?step=password',message:'E-Mail bestätigt. Wählen Sie jetzt Ihr Passwort.'}),raw);
}

async function save(env,request,input,now){
 const raw=cookieValue(request);if(!/^[a-f0-9]{64}$/.test(raw))return denied();
 const setupHash=digest(raw),row=await env.DB.prepare("SELECT * FROM auth_customer_codes WHERE setup_hash=? AND state='verified' AND expires_at>?").bind(setupHash,now).first();if(!row)return denied();
 await rate(env,request,row.email,'save',now);
 if(typeof input.password!=='string'||Array.from(input.password).length<15||input.password.length>128||input.password!==input.confirmation)return authResponse({error:'Bitte zweimal dasselbe Passwort mit 15 bis 128 Zeichen eingeben.'},400);
 if(!await eligible(env,row.email))return denied();
 const salt=randomBytes(32).toString('hex'),derived=(await derive(input.password,salt)).toString('hex'),revision=randomBytes(32).toString('hex');
 const guard="EXISTS(SELECT 1 FROM auth_customer_codes WHERE id=? AND setup_hash=? AND state='verified' AND expires_at>?)";
 const mutation=row.purpose==='setup'?env.DB.prepare('INSERT INTO auth_customer_credentials SELECT ?,?,?,?,? WHERE '+guard+' ON CONFLICT(email) DO NOTHING').bind(row.email,salt,derived,revision,now,row.id,setupHash,now):env.DB.prepare('UPDATE auth_customer_credentials SET salt=?,derived=?,revision=?,changed_at=? WHERE email=? AND revision=? AND '+guard).bind(salt,derived,revision,now,row.email,row.credential_revision,row.id,setupHash,now);
 const current='EXISTS(SELECT 1 FROM auth_customer_credentials WHERE email=? AND revision=?)';
 const result=await env.DB.batch([
  mutation,
  env.DB.prepare("UPDATE auth_customer_codes SET state='used',setup_hash=NULL,payload=NULL WHERE email=? AND "+current).bind(row.email,row.email,revision),
  env.DB.prepare('DELETE FROM auth_sessions WHERE email=? AND '+current).bind(row.email,row.email,revision),
  env.DB.prepare('UPDATE auth_tokens SET consumed=1 WHERE email=? AND '+current).bind(row.email,row.email,revision)
 ]);
 if(!result[0].meta.changes)return authResponse({error:'Der Zugang wurde inzwischen geändert. Bitte einen neuen Code anfordern.'},409);
 return setupCookie(authResponse({returnTo:'/auth/customer?step=success',message:'Ihr Passwort ist gespeichert. Melden Sie sich jetzt an.'}),'',0);
}

async function login(env,request,input,now){
 const email=emailKey(input.email),password=input.password;
 if(!validEmail(email)||typeof password!=='string'||!password||password.length>128)return authResponse({error:'E-Mail-Adresse oder Passwort stimmen nicht.'},401);
 await rate(env,request,email,'login',now);
 const row=digest(email)!==env.OWNER_EMAIL_SHA256?await env.DB.prepare('SELECT * FROM auth_customer_credentials WHERE email=?').bind(email).first():null;
 const key=await derive(password,row?.salt??'00'.repeat(32));
 if(!row||!/^[a-f0-9]{128}$/.test(row.derived)||!timingSafeEqual(key,Buffer.from(row.derived,'hex')))return authResponse({error:'E-Mail-Adresse oder Passwort stimmen nicht.'},401);
 const raw=randomBytes(32).toString('hex'),hash=digest(raw),remember=input.remember===true;
 const result=await env.DB.batch([
  env.DB.prepare('INSERT INTO auth_sessions SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM auth_customer_credentials WHERE email=? AND revision=?)').bind(hash,email,now+(remember?REMEMBER_DEVICE_MS:86400000),now,email,row.revision),
  env.DB.prepare('INSERT INTO auth_customer_sessions SELECT ?,? WHERE EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(hash,row.revision,hash),
  ...(remember?[env.DB.prepare('INSERT INTO auth_customer_remembered SELECT ?,? WHERE EXISTS(SELECT 1 FROM auth_sessions WHERE hash=?)').bind(hash,row.revision,hash)]:[])
 ]);
 if(!result[0].meta.changes)return authResponse({error:'Bitte erneut anmelden.'},409);
 return sessionCookie(authResponse({returnTo:'/kunde'}),raw,remember);
}

export async function customerAuth(env,request,now=Date.now()){
 const input=await inputFor(env,request),action=new URL(request.url).pathname.split('/').at(-1);
 if(action==='request'){
  const email=emailKey(input.email);if(!validEmail(email))return authResponse({error:'Bitte eine gültige E-Mail-Adresse eingeben.'},400);
  await rate(env,request,email,'request',now,5);
  await queueCustomerCode(env,email,input.purpose==='reset'?'reset':'setup',now);return authResponse(neutral);
 }
 if(action==='verify')return verify(env,request,input,now);
 if(action==='password')return save(env,request,input,now);
 if(action==='login')return login(env,request,input,now);
 return authResponse({error:'Nicht gefunden.'},404);
}

export function customerAuthPage(){return new Response(`<!doctype html><html lang="de" data-area="customer"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mein White Gloss · Kundenkonto</title><script src="/theme.js"></script><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/brand.css"><link rel="stylesheet" href="/customer-auth.css"><link rel="stylesheet" href="/surface.css"><main class="appoff card customer-access"><span class="brandmark">WG</span><p class="customer-access-eyebrow">MEIN WHITE GLOSS</p><h1 id="customer-auth-title" tabindex="-1" aria-label="Willkommen zurück">Will&shy;kommen zurück</h1><p id="customer-auth-description">Ihre Aufträge, Dokumente und Nachrichten an einem Ort.</p><div id="customer-auth-content"></div><p id="customer-auth-message" role="status" aria-live="polite"></p><noscript>Bitte JavaScript aktivieren, um sich sicher anzumelden.</noscript><footer><a href="https://white-gloss.de">Zur Website</a> · <a href="/auth/login">Betreiberzugang</a></footer></main><script type="module" src="/customer-auth.js"></script></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
