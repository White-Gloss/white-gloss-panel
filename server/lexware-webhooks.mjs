import crypto from 'node:crypto';
import {getOrder,init,setting,settings,unprotect} from '../src/worker.mjs';
import {AppError,need} from '../src/domain.mjs';

// Official signing key: https://developers.lexware.io/webhookSignature/public/public_key.pub
// Retrieved on 2026-10-03; SHA-256 edf3538d96ce463f40e05eee82c3972bd11d195c13ed093e5668e8d57b8285ae.
// It is public verification material, never an API credential.
export const LEXWARE_WEBHOOK_PUBLIC_KEY=`-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAtCkZXZqT2zFRmA83KsBC
tQSv9t+AaWiZpRWvzE4wiQEh0aHzNYkT/DlP419pngqoLxnqW9SsgWfKOG3utoEV
z+Lru9odZntW/n/yaRK3f0AcMtuWs/Z1PZ4BbN/RlFYyqlPg0VfuAvZMAa+J9WAl
Fuy0T4Y0EdO0d+EL8BpzSLqj3XLI+YuK4hUhlTOxHmdDtNUkugnT9b9khb+oPDmB
3yxRP6Rmo2qo6waSc+pihCdOiZKzwA4fA1HT8DM54OaNQ4qd9NRf5uECijFlpQu6
vZdW7Z+LZ8HTgGQVSsJdCzUtM1wiWOERrHvd8IpBMvUAvGM/qaJnAmwsEr4J/El4
yCmur8wwYBtSUH0Xue42YysdmSS0pOMMUAAvr70HQMDHagYkErMtu6FAyAmPz8p/
tAqJJpwAhxITbnc5WsmZOu0Ke255nXQ/2Go1TKv+45mSb7RLsvpmhVZ4nFByFt24
vG6IwNReuLhJJL468jrdTpxyZRn0QqkxiQV7jDd9Dp1NVd/W3+n86Aos9LnJa+ut
kN+jOOWmJdJjnQetJlbDVg3ex+XHVmCjiRYggCGPlpXVJwdEUNGzxhPGKjxmeiQT
ahwFA9iHtwBw7yK5VfM/hA+JeF2FXYhTdehfClAQt1YCYXkgUEFxm9idRdBoCY6U
bmFUXQLdi7tZyDor8Rxoq2MCAwEAAQ==
-----END PUBLIC KEY-----
`;
export const LEXWARE_WEBHOOK_KEY_SHA256='edf3538d96ce463f40e05eee82c3972bd11d195c13ed093e5668e8d57b8285ae';
if(crypto.createHash('sha256').update(LEXWARE_WEBHOOK_PUBLIC_KEY).digest('hex')!==LEXWARE_WEBHOOK_KEY_SHA256)throw Error('Lexware-Signaturschlüssel wurde verändert.');
const publicKey=crypto.createPublicKey(LEXWARE_WEBHOOK_PUBLIC_KEY),maxBodyBytes=262144;
const invoiceEvents=['invoice.changed','invoice.status.changed','payment.changed'];
const allEvents=new Set([...invoiceEvents,'token.revoked']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const reply=(data,status=200)=>new Response(status===204?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===405?{Allow:'POST, HEAD'}:{})}});

export async function lexwareWebhookSchema(env){
  await init(env);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS lexware_events(id TEXT PRIMARY KEY,body_hash TEXT NOT NULL UNIQUE,organization_id TEXT NOT NULL,event_type TEXT NOT NULL,resource_id TEXT NOT NULL,event_date TEXT NOT NULL,order_id TEXT,state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,detail TEXT)"),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS lexware_subscription_lock(id INTEGER PRIMARY KEY CHECK(id=1),lease_until INTEGER NOT NULL DEFAULT 0,lease_owner TEXT NOT NULL DEFAULT \'\')'),
    env.DB.prepare('INSERT OR IGNORE INTO lexware_subscription_lock(id) VALUES(1)')
  ]);
}

// The optional key supports isolated cryptographic unit tests; the HTTP entry point always uses the pinned key.
export function verifyLexwareSignature(payload,signature,key=publicKey){
  if(typeof signature!=='string'||signature.length>1400||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature))return false;
  try{const bytes=Buffer.from(signature,'base64'),verifiedKey=typeof key==='string'?crypto.createPublicKey(key):key;return bytes.length===verifiedKey.asymmetricKeyDetails.modulusLength/8&&bytes.toString('base64')===signature&&crypto.verify('RSA-SHA512',Buffer.from(JSON.stringify(payload)),verifiedKey,bytes);}catch{return false;}
}

async function readEvent(request){
  const length=request.headers.get('content-length');
  need(length===null||/^\d{1,12}$/.test(length),'Ungültige Inhaltslänge.');
  need(length===null||Number(length)<=maxBodyBytes,'Webhook-Nachricht ist zu groß.',413);
  need(!request.headers.get('content-encoding')||request.headers.get('content-encoding')==='identity','Komprimierte Webhook-Nachrichten werden nicht angenommen.',415);
  need(request.body,'Webhook-Nachricht fehlt.');const reader=request.body.getReader(),chunks=[];let size=0;
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>maxBodyBytes){await reader.cancel();throw new AppError('Webhook-Nachricht ist zu groß.',413);}chunks.push(item.value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch{throw new AppError('Ungültige Webhook-Nachricht.');}
}

function validEvent(event){
  need(event&&typeof event==='object'&&!Array.isArray(event),'Ungültige Webhook-Nachricht.');
  need(Object.keys(event).sort().join(',')==='eventDate,eventType,organizationId,resourceId','Ungültige Webhook-Felder.');
  need(uuid(event.organizationId)&&uuid(event.resourceId)&&allEvents.has(event.eventType),'Unbekanntes Lexware-Ereignis.');
  need(typeof event.eventDate==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(event.eventDate)&&Number.isFinite(Date.parse(event.eventDate)),'Ungültiges Ereignisdatum.');
}

export async function lexwareWebhook(request,env){
  try{
    const url=new URL(request.url);
    need(url.pathname==='/api/lexware/webhook'&&!url.search,'Ungültiger Webhook-Pfad.');
    if(request.method==='HEAD')return reply(null,204);
    if(request.method!=='POST')return reply({error:'Methode nicht erlaubt.'},405);
    need(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json','JSON-Nachricht erforderlich.',415);
    const event=await readEvent(request);
    need(verifyLexwareSignature(event,request.headers.get('x-lxo-signature')),'Webhook-Signatur ist ungültig.',401);
    validEvent(event);await lexwareWebhookSchema(env);
    const config=await settings(env);
    need(uuid(config.lexwareOrganizationId)&&event.organizationId===config.lexwareOrganizationId,'Webhook gehört nicht zum verbundenen Betrieb.',403);
    let orderId=null;
    if(event.eventType!=='token.revoked'){
      const orders=await env.DB.prepare("SELECT id FROM orders WHERE synthetic=0 AND json_extract(data,'$.invoice.provider')='lexware' AND json_extract(data,'$.invoice.id')=? LIMIT 2").bind(event.resourceId).all();
      if(orders.results.length!==1)return reply({ok:true,ignored:true},202);
      orderId=orders.results[0].id;
    }else if(config.lexwareConnectionId&&config.lexwareConnectionId!==event.resourceId)return reply({ok:true,ignored:true},202);
    const bodyHash=crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex'),id=crypto.randomUUID();
    const statements=[env.DB.prepare('INSERT OR IGNORE INTO lexware_events(id,body_hash,organization_id,event_type,resource_id,event_date,order_id,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,bodyHash,event.organizationId,event.eventType,event.resourceId,event.eventDate,orderId,new Date().toISOString())];
    if(event.eventType==='token.revoked')for(const key of ['lexwareVerified','lexwareWebhookReady'])statements.push(env.DB.prepare("INSERT INTO settings(key,value) SELECT ?,'false' WHERE EXISTS(SELECT 1 FROM lexware_events WHERE id=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,id));
    const result=await env.DB.batch(statements);
    return reply({ok:true,queued:result[0].meta.changes===1},202);
  }catch(error){return reply({error:error instanceof AppError?error.message:'Webhook konnte nicht sicher gespeichert werden.'},error instanceof AppError?error.status:500);}
}

export async function pendingLexwareEvents(env){
  await lexwareWebhookSchema(env);const now=Date.now(),errors=[];
  const records=await env.DB.prepare("SELECT * FROM lexware_events WHERE ((state IN ('queued','failed') AND next_attempt<=?) OR (state='processing' AND lease_until<=?)) ORDER BY created_at LIMIT 3").bind(now,now).all();
  for(const record of records.results){
    const leaseOwner=crypto.randomUUID(),lease=await env.DB.prepare("UPDATE lexware_events SET state='processing',attempts=attempts+1,lease_until=?,lease_owner=? WHERE id=? AND ((state IN ('queued','failed') AND next_attempt<=?) OR (state='processing' AND lease_until<=?))").bind(Date.now()+120000,leaseOwner,record.id,Date.now(),Date.now()).run();
    if(!lease.meta.changes)continue;
    try{
      const config=await settings(env);
      let ignored=record.organization_id!==config.lexwareOrganizationId;
      if(!ignored&&record.event_type!=='token.revoked'){
        need(config.lexwareVerified===true,'Lexware-Verbindung zuerst erneut prüfen.',409);
        const row=await env.DB.prepare("SELECT id FROM orders WHERE id=? AND synthetic=0 AND json_extract(data,'$.invoice.provider')='lexware' AND json_extract(data,'$.invoice.id')=?").bind(record.order_id,record.resource_id).first();
        ignored=!row;
        if(row){const {lexwareReconcile}=await import('./lexware.mjs');await lexwareReconcile(env,await getOrder(env,row.id));}
      }
      await env.DB.prepare("UPDATE lexware_events SET state=?,lease_until=0,lease_owner='',detail=? WHERE id=? AND lease_owner=?").bind(ignored?'ignored':'done',ignored?'Kein passender eigener Auftrag mehr.':'Signiertes Ereignis lesend abgeglichen.',record.id,leaseOwner).run();
    }catch{
      const message='Lexware-Ereignisabgleich steht aus; keine Rechnung oder Zahlung erzeugt.';
      await env.DB.prepare("UPDATE lexware_events SET state='failed',lease_until=0,lease_owner='',next_attempt=?,detail=? WHERE id=? AND lease_owner=?").bind(Date.now()+Math.min(1800000,60000*2**Math.min(record.attempts,5)),message,record.id,leaseOwner).run();errors.push(message);
    }
  }
  return errors;
}

async function subscriptionsList(config,beforeSend){
  const {lexwareJSON}=await import('./lexware.mjs'),first=await lexwareJSON(config,'/v1/event-subscriptions',{beforeSend}),items=[];
  need(Array.isArray(first.content),'Lexware-Webhook-Bestand ist unvollständig.',502);
  items.push(...first.content);
  if(first.totalPages!==undefined){
    need(Number.isInteger(first.totalPages)&&first.totalPages>=0&&first.totalPages<=100&&first.number===0,'Lexware-Webhook-Paginierung ist ungültig.',502);
    for(let page=1;page<first.totalPages;page++){const next=await lexwareJSON(config,'/v1/event-subscriptions?page='+page,{beforeSend});need(Array.isArray(next.content)&&next.number===page&&next.totalPages===first.totalPages,'Lexware-Webhook-Bestand hat sich geändert.',409);items.push(...next.content);}
    if(first.totalElements!==undefined)need(Number.isInteger(first.totalElements)&&items.length===first.totalElements,'Lexware-Webhook-Bestand ist unvollständig.',502);
  }
  const ids=new Set();
  for(const item of items){need(uuid(item.subscriptionId)&&!ids.has(item.subscriptionId)&&uuid(item.organizationId)&&typeof item.eventType==='string'&&typeof item.callbackUrl==='string','Lexware-Webhook-Daten sind unvollständig.',502);ids.add(item.subscriptionId);}
  return items;
}

export async function lexwareSubscriptions(env,input={}){
  await lexwareWebhookSchema(env);
  need(env.PANEL_ORIGIN==='https://panel.white-gloss.de','Webhook-Adresse muss die freigegebene Paneladresse sein.',409);
  const callbackUrl=env.PANEL_ORIGIN+'/api/lexware/webhook';
  if(input.reviewed!==true)return {reviewRequired:true,callbackUrl,eventTypes:[...invoiceEvents],message:'Diese Verbindung empfängt Rechnungs- und Zahlungsänderungen. Erst nach deiner ausdrücklichen Freigabe werden Lexware-Webhooks registriert.'};
  const savedConfig=await settings(env);
  /** @type {any} */
  const config={...savedConfig,lexwareKey:await unprotect(env,savedConfig.lexwareKey),_DB:env.DB};
  need(config.lexwareVerified===true&&config.lexwareKey&&uuid(config.lexwareOrganizationId),'Lexware zuerst mit dem geschützten API-Schlüssel prüfen.',409);
  const {lexwareSchema}=await import('./lexware.mjs');await lexwareSchema(env);
  const leaseOwner=crypto.randomUUID(),lease=await env.DB.prepare('UPDATE lexware_subscription_lock SET lease_until=?,lease_owner=? WHERE id=1 AND lease_until<=?').bind(Date.now()+120000,leaseOwner,Date.now()).run();
  need(lease.meta.changes===1,'Webhook-Einrichtung läuft bereits. Bitte später den Bestand prüfen.',409);
  const beforeSend=async()=>{const renewed=await env.DB.prepare('UPDATE lexware_subscription_lock SET lease_until=? WHERE id=1 AND lease_owner=? AND lease_until>?').bind(Date.now()+120000,leaseOwner,Date.now()).run();need(renewed.meta.changes===1,'Webhook-Einrichtungsfreigabe ist abgelaufen. Bestand zuerst erneut prüfen.',409);const current=await settings(env);need(current.lexwareKey===savedConfig.lexwareKey&&current.lexwareOrganizationId===savedConfig.lexwareOrganizationId&&current.lexwareVerified===true,'Lexware-Verbindung wurde während der Einrichtung verändert.',409);};
  try{
    await setting(env,'lexwareWebhookReady',false);let items=await subscriptionsList(config,beforeSend);const {lexwareJSON}=await import('./lexware.mjs');
    for(const eventType of invoiceEvents){
      const matching=items.filter(item=>item.eventType===eventType&&item.callbackUrl===callbackUrl);
      need(matching.length<=1&&matching.every(item=>item.organizationId===config.lexwareOrganizationId),'Webhook-Zuordnung ist nicht eindeutig.',409);
      if(!matching.length){const created=await lexwareJSON(config,'/v1/event-subscriptions',{method:'POST',body:JSON.stringify({eventType,callbackUrl}),beforeSend});need(uuid(created.id),'Webhook-Registrierung ist ungeklärt. Bestand zuerst erneut prüfen.',502);}
    }
    items=await subscriptionsList(config,beforeSend);const confirmed=invoiceEvents.map(eventType=>items.filter(item=>item.eventType===eventType&&item.callbackUrl===callbackUrl&&item.organizationId===config.lexwareOrganizationId));
    need(confirmed.every(matches=>matches.length===1),'Noch nicht alle Lexware-Webhooks sind eindeutig bestätigt. Keine automatische Wiederholung.',409);
    const guard="EXISTS(SELECT 1 FROM settings WHERE key='lexwareKey' AND value=?) AND EXISTS(SELECT 1 FROM settings WHERE key='lexwareOrganizationId' AND value=?) AND EXISTS(SELECT 1 FROM settings WHERE key='lexwareVerified' AND value='true')";
    const proof={organizationId:config.lexwareOrganizationId,callbackUrl,subscriptionIds:confirmed.map(matches=>matches[0].subscriptionId),at:new Date().toISOString()};
    const verified=await env.DB.batch([
      ['lexwareWebhookReady','true'],['lexwareWebhookError','null'],['lexwareWebhookSubscriptions',JSON.stringify(proof)]
    ].map(([key,value])=>env.DB.prepare('INSERT INTO settings(key,value) SELECT ?,? WHERE '+guard+' ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value,JSON.stringify(savedConfig.lexwareKey),JSON.stringify(config.lexwareOrganizationId))));
    need(verified.every(result=>result.meta.changes===1),'Lexware-Verbindung wurde während der Einrichtung verändert.',409);
    return {ok:true,callbackUrl,eventTypes:[...invoiceEvents],message:'Rechnungs- und Zahlungsänderungen werden über signierte Lexware-Webhooks empfangen.'};
  }catch(error){await setting(env,'lexwareWebhookReady',false);await setting(env,'lexwareWebhookError','Webhook-Einrichtung nicht vollständig bestätigt. Bestand zuerst erneut prüfen; keine automatische Neuanlage.');throw error;}
  finally{await env.DB.prepare("UPDATE lexware_subscription_lock SET lease_until=0,lease_owner='' WHERE id=1 AND lease_owner=?").bind(leaseOwner).run();}
}
