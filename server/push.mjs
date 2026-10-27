// Betreiber-Web-Push ohne Kundendaten im Sperrbildschirm. Abos und privater VAPID-Schlüssel
// bleiben geschützt; nur der angemeldete Betreiber kann sein eigenes Gerät registrieren.
import {createHash} from 'node:crypto';
import {AppError,need} from '../src/domain.mjs';
import {protect,unprotect} from '../src/worker.mjs';
import {COMPANY} from '../src/company.mjs';

const {webPush}=await import(new URL('../dist/runtime/push.mjs',import.meta.url).href);
const ROOT='/api/push';
const MESSAGES=Object.freeze({
  website:{body:'Neue Website-Anfrage im Panel.',url:'/#requests'},
  chat:{body:'Neue Kundennachricht im Panel.',url:'/#chat'},
  whatsapp:{body:'Neue WhatsApp-Nachricht im Panel.',url:'/#whatsapp'}
});
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
const endpointHash=value=>createHash('sha256').update(value).digest('hex');
const at=()=>new Date().toISOString();

export async function pushSchema(env){
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS push_settings(id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_key TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT)',
    'CREATE TABLE IF NOT EXISTS push_subscriptions(endpoint_hash TEXT PRIMARY KEY,subscription_sealed TEXT NOT NULL,session_hash TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT,last_status TEXT,last_error TEXT)',
    'CREATE INDEX IF NOT EXISTS push_subscriptions_session ON push_subscriptions(session_hash)'
  ].map(sql=>env.DB.prepare(sql)));
}
async function input(request,maximum){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const raw=await request.text();need(raw.length<=maximum,'Anfrage zu groß.',413);
  try{const value=JSON.parse(raw);need(value&&typeof value==='object'&&!Array.isArray(value),'Ungültige Eingabe.');return value;}catch(error){if(error instanceof AppError)throw error;throw new AppError('Ungültige Eingabe.');}
}
function validSubscription(value){
  need(value&&typeof value==='object'&&!Array.isArray(value),'Push-Registrierung fehlt.');
  need(typeof value.endpoint==='string'&&value.endpoint.length<=4096,'Push-Endpunkt ist ungültig.');
  let endpoint;try{endpoint=new URL(value.endpoint);}catch{throw new AppError('Push-Endpunkt ist ungültig.',400);}
  need(endpoint.protocol==='https:'&&!endpoint.username&&!endpoint.password,'Push-Endpunkt ist ungültig.');
  need(value.expirationTime===null||value.expirationTime===undefined||(Number.isFinite(value.expirationTime)&&value.expirationTime>0),'Push-Ablaufzeit ist ungültig.');
  need(value.keys&&typeof value.keys==='object'&&!Array.isArray(value.keys),'Push-Schlüssel fehlen.');
  for(const [key,size] of [['p256dh',65],['auth',16]]){
    const encoded=value.keys[key];need(typeof encoded==='string'&&encoded.length<=120&&/^[A-Za-z0-9_-]+$/.test(encoded),'Push-Schlüssel sind ungültig.');
    let bytes;try{bytes=Buffer.from(encoded,'base64url');}catch{throw new AppError('Push-Schlüssel sind ungültig.');}
    need(bytes.length===size&&bytes.toString('base64url')===encoded,'Push-Schlüssel sind ungültig.');
  }
  return {endpoint:value.endpoint,expirationTime:value.expirationTime??null,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}
async function setup(env,renew=false){
  let row=await env.DB.prepare('SELECT * FROM push_settings WHERE id=1').first();
  if(row&&!renew)return {publicKey:row.public_key};
  const keys=env.PUSH_ADAPTERS?.generateVAPIDKeys?await env.PUSH_ADAPTERS.generateVAPIDKeys():webPush.generateVAPIDKeys();
  const validKey=(value,size)=>{if(typeof value!=='string'||value.length>200||!/^[A-Za-z0-9_-]+$/.test(value))return false;const bytes=Buffer.from(value,'base64url');return bytes.length===size&&bytes.toString('base64url')===value;};
  need(validKey(keys?.publicKey,65)&&validKey(keys?.privateKey,32),'Push-Schlüssel konnten nicht erzeugt werden.',502);
  const timestamp=at(),sealed=await protect(env,keys.privateKey);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO push_settings(id,public_key,private_key,created_at,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET public_key=excluded.public_key,private_key=excluded.private_key,updated_at=excluded.updated_at,last_error=NULL`).bind(keys.publicKey,sealed,timestamp,timestamp),
    ...(renew?[env.DB.prepare('DELETE FROM push_subscriptions')]:[])
  ]);
  row=await env.DB.prepare('SELECT public_key FROM push_settings WHERE id=1').first();
  return {publicKey:row.public_key};
}
async function status(env,sessionHash){
  const config=await env.DB.prepare('SELECT public_key,last_error FROM push_settings WHERE id=1').first();
  const devices=await env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions').first();
  const current=sessionHash?await env.DB.prepare('SELECT last_used_at,last_status,last_error FROM push_subscriptions WHERE session_hash=? ORDER BY created_at DESC LIMIT 1').bind(sessionHash).first():null;
  return {configured:Boolean(config),devices:Number(devices.n),thisDevice:Boolean(current),lastUsedAt:current?.last_used_at??null,lastStatus:current?.last_status??null,lastError:config?.last_error??current?.last_error??null};
}
export async function revokePushSession(env,sessionHash){
  if(!/^[a-f0-9]{64}$/.test(sessionHash??''))return;
  if(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='push_subscriptions'").first())await env.DB.prepare('DELETE FROM push_subscriptions WHERE session_hash=?').bind(sessionHash).run();
}
export async function prunePush(env){
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE NOT EXISTS(SELECT 1 FROM auth_sessions s WHERE s.hash=session_hash)').run();
}

/** Send only a generic activity hint, never an order, person, price or message body. */
export async function notifyOwner(env,kind){
  const message=MESSAGES[kind];if(!message)return {sent:0,failed:0,removed:0};
  const rows=(await env.DB.prepare('SELECT * FROM push_subscriptions ORDER BY created_at LIMIT 20').all()).results;
  if(!rows.length)return {sent:0,failed:0,removed:0};
  const config=await env.DB.prepare('SELECT * FROM push_settings WHERE id=1').first();
  if(!config)return {sent:0,failed:0,removed:0};
  let privateKey;
  try{privateKey=await unprotect(env,config.private_key);}catch{
    await env.DB.prepare("UPDATE push_settings SET last_error='Push-Schlüssel kann nicht entschlüsselt werden. Bitte Push neu einrichten.' WHERE id=1").run();
    return {sent:0,failed:rows.length,removed:0};
  }
  const payload=JSON.stringify({title:'White Gloss',body:message.body,url:message.url,tag:'wg-'+kind});
  const results=await Promise.all(rows.map(async row=>{
    try{
      const subscription=JSON.parse(await unprotect(env,row.subscription_sealed));
      if(env.PUSH_ADAPTERS?.send)await env.PUSH_ADAPTERS.send({subscription,payload,publicKey:config.public_key,privateKey});
      else await webPush.sendNotification(subscription,payload,{vapidDetails:{subject:'mailto:'+COMPANY.email,publicKey:config.public_key,privateKey},TTL:300});
      await env.DB.prepare("UPDATE push_subscriptions SET last_used_at=?,last_status='sent',last_error=NULL WHERE endpoint_hash=?").bind(at(),row.endpoint_hash).run();
      return 'sent';
    }catch(error){
      const statusCode=Number(error?.statusCode??error?.status??0);
      if(statusCode===404||statusCode===410){await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash=?').bind(row.endpoint_hash).run();return 'removed';}
      const message=statusCode?'Push-Dienst: HTTP '+statusCode:'Push-Zustellung nicht bestätigt.';
      await env.DB.prepare('UPDATE push_subscriptions SET last_used_at=?,last_status=?,last_error=? WHERE endpoint_hash=?').bind(at(),'failed',message,row.endpoint_hash).run();
      return 'failed';
    }
  }));
  return {sent:results.filter(x=>x==='sent').length,failed:results.filter(x=>x==='failed').length,removed:results.filter(x=>x==='removed').length};
}
export async function handlePush(env,request,isOwner,sessionHash){
  const url=new URL(request.url),path=url.pathname;if(path!==ROOT&&!path.startsWith(ROOT+'/'))return null;
  need(isOwner,'Nur der Betreiber kann Push-Benachrichtigungen verwalten.',403);
  need(/^[a-f0-9]{64}$/.test(sessionHash??''),'Bitte erneut persönlich anmelden.',401);
  if(request.method==='GET'&&path===ROOT)return json(await status(env,sessionHash));
  if(request.method==='POST'&&path===ROOT+'/setup'){
    const body=await input(request,200),result=await setup(env,body.renew===true);
    return json({...await status(env,sessionHash),...result});
  }
  if(request.method==='POST'&&path===ROOT+'/subscription'){
    const subscription=validSubscription(await input(request,10000)),hash=endpointHash(subscription.endpoint),existing=await env.DB.prepare('SELECT session_hash FROM push_subscriptions WHERE endpoint_hash=?').bind(hash).first();
    if(!existing)need(Number((await env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions').first()).n)<20,'Höchstens 20 Betreibergeräte können registriert werden.',409);
    need(Boolean(await env.DB.prepare('SELECT public_key FROM push_settings WHERE id=1').first()),'Push zuerst einrichten.',409);
    await env.DB.prepare(`INSERT INTO push_subscriptions(endpoint_hash,subscription_sealed,session_hash,created_at) VALUES(?,?,?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET subscription_sealed=excluded.subscription_sealed,session_hash=excluded.session_hash,last_status=NULL,last_error=NULL`).bind(hash,await protect(env,JSON.stringify(subscription)),sessionHash,at()).run();
    return json({ok:true,...await status(env,sessionHash)});
  }
  if(request.method==='POST'&&path===ROOT+'/subscription/delete'){
    const body=await input(request,5000);need(typeof body.endpoint==='string'&&body.endpoint.length<=4096,'Push-Endpunkt fehlt.');
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint_hash=? AND session_hash=?').bind(endpointHash(body.endpoint),sessionHash).run();
    return json({ok:true,...await status(env,sessionHash)});
  }
  return json({error:'Funktion nicht gefunden.'},404);
}
