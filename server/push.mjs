import {protect,unprotect,settings} from '../src/worker.mjs';
import {need,text} from '../src/domain.mjs';
import {digest} from './auth.mjs';
const libraryURL=new URL('../dist/mcp/web-push.mjs',import.meta.url);
const pushLibrary=async()=> (await import(libraryURL.href)).default;
export async function pushSchema(env){
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS push_devices(id TEXT PRIMARY KEY,secret TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS push_events(id TEXT PRIMARY KEY,data TEXT NOT NULL,created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS push_deliveries(event_id TEXT NOT NULL,device_id TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(event_id,device_id))'
  ].map(sql=>env.DB.prepare(sql)));
}
export function validPushSubscription(input){
  let url;try{url=new URL(input?.endpoint);}catch{need(false,'Push-Adresse ungültig.');}
  need(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)&&url.href.length<2500,'Dieser Push-Dienst wird nicht unterstützt.');
  const key=input.keys;need(key&&/^[A-Za-z0-9_-]{87}$/.test(key.p256dh??'')&&/^[A-Za-z0-9_-]{22}$/.test(key.auth??''),'Push-Schlüssel ungültig.');
  return {endpoint:url.href,keys:{p256dh:key.p256dh,auth:key.auth}};
}
async function pushKeys(env){
  let config=await settings(env);
  if(!config.pushKeys){const library=await pushLibrary(),key=library.generateVAPIDKeys();await env.DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('pushKeys',?)").bind(JSON.stringify(await protect(env,JSON.stringify(key)))).run();config=await settings(env);}
  return JSON.parse(await unprotect(env,config.pushKeys));
}
export async function pushStatus(env){
  const keys=await pushKeys(env),devices=await env.DB.prepare('SELECT id,label,created_at FROM push_devices ORDER BY created_at').all();
  const delivery=await env.DB.prepare('SELECT state,COUNT(*) count FROM push_deliveries GROUP BY state').all();
  return {publicKey:keys.publicKey,devices:devices.results,delivery:delivery.results};
}
export async function pushDevice(env,input){
  if(input.action==='remove'){need(/^[a-f0-9]{64}$/.test(input.id??''),'Geräte-ID ungültig.');await env.DB.batch([env.DB.prepare('DELETE FROM push_devices WHERE id=?').bind(input.id),env.DB.prepare('DELETE FROM push_deliveries WHERE device_id=?').bind(input.id)]);return {ok:true};}
  if(input.action==='test'){
    const device=await env.DB.prepare('SELECT id FROM push_devices WHERE id=?').bind(input.id).first();need(device,'Gerät nicht verbunden.',404);
    await queuePush(env,'test:'+crypto.randomUUID(),{title:'White Gloss · Test',body:'Dieses Gerät ist mit deinem Panel verbunden.',url:'/'},device.id);
    await deliverPush(env);return {ok:true,message:'Test angefordert. Erst die sichtbare Meldung auf deinem Gerät bestätigt den Empfang.'};
  }
  need(input.action==='subscribe','Unbekannte Push-Aktion.');const subscription=validPushSubscription(input.subscription),id=digest(subscription.endpoint);
  const count=await env.DB.prepare('SELECT COUNT(*) n FROM push_devices WHERE id<>?').bind(id).first();need(count.n<10,'Höchstens zehn Geräte. Bitte ein altes Gerät entfernen.',409);
  await pushKeys(env);
  const now=new Date().toISOString(),cursor=(await env.DB.prepare('SELECT COALESCE(MAX(id),0) id FROM audit').first()).id;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('pushCursor',?)").bind(JSON.stringify(cursor)),
    env.DB.prepare('INSERT INTO push_devices VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET secret=excluded.secret,label=excluded.label').bind(id,await protect(env,JSON.stringify(subscription)),text(input.label,80)||'Mein Gerät',now)
  ]);return {ok:true,id};
}
async function queuePush(env,id,data,deviceId=null){
  const now=new Date().toISOString();await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO push_events VALUES(?,?,?)').bind(id,JSON.stringify(data),now),
    env.DB.prepare("INSERT OR IGNORE INTO push_deliveries(event_id,device_id,state) SELECT ?,id,'queued' FROM push_devices WHERE (? IS NULL OR id=?) AND created_at<=?").bind(id,deviceId,deviceId,now)
  ]);
}
export async function collectPush(env){
  const record=await env.DB.prepare("SELECT value FROM settings WHERE key='pushCursor'").first();if(!record)return;const config={pushCursor:JSON.parse(record.value)};
  const rows=await env.DB.prepare('SELECT a.*,o.synthetic FROM audit a JOIN orders o ON o.id=a.order_id WHERE a.id>? ORDER BY a.id LIMIT 300').bind(config.pushCursor).all();
  for(const a of rows.results){
    if(a.synthetic)continue;
    const title=a.version===1?'Neue Anfrage':a.actor==='customer'?'Kundenfreigabe eingegangen':null;
    if(title)await queuePush(env,'audit:'+a.id,{title:'White Gloss · '+title,body:'Details findest du im geschützten Auftrag.',url:'/?order='+a.order_id});
  }
  if(rows.results.length)await env.DB.prepare("UPDATE settings SET value=? WHERE key='pushCursor' AND CAST(value AS INTEGER)<?").bind(JSON.stringify(rows.results.at(-1).id),rows.results.at(-1).id).run();
  const failed=await env.DB.prepare("SELECT j.id,j.order_id,j.state FROM jobs j JOIN orders o ON o.id=j.order_id WHERE o.synthetic=0 AND j.state IN ('failed','unknown') AND j.updated_at >= (SELECT MIN(created_at) FROM push_devices)").all();
  for(const j of failed.results)await queuePush(env,'job:'+j.id+':'+j.state,{title:'White Gloss · Versand prüfen',body:'Eine Zustellung oder Verbindung benötigt deine Prüfung.',url:'/?order='+j.order_id});
}
export async function deliverPush(env,send=null){
  if(!(await env.DB.prepare('SELECT id FROM push_devices LIMIT 1').first()))return;
  const rows=await env.DB.prepare("SELECT d.*,p.secret,e.data FROM push_deliveries d JOIN push_devices p ON p.id=d.device_id JOIN push_events e ON e.id=d.event_id WHERE d.state='queued' AND d.next_at<=? ORDER BY e.created_at LIMIT 5").bind(Date.now()).all();
  if(!rows.results.length)return;const keys=await pushKeys(env),library=send?null:await pushLibrary();
  for(const row of rows.results){
    const claimed=await env.DB.prepare("UPDATE push_deliveries SET state='sending',attempts=attempts+1,next_at=? WHERE event_id=? AND device_id=? AND state='queued'").bind(Date.now()+60000,row.event_id,row.device_id).run();if(!claimed.meta.changes)continue;
    let state='sent',next=0;
    try{await (send??library.sendNotification)(JSON.parse(await unprotect(env,row.secret)),row.data,{vapidDetails:{subject:env.PANEL_ORIGIN,publicKey:keys.publicKey,privateKey:keys.privateKey},TTL:3600,timeout:3000});}
    catch(error){if([404,410].includes(error.statusCode)){state='expired';await env.DB.prepare('DELETE FROM push_devices WHERE id=?').bind(row.device_id).run();}else{state=row.attempts>=2?'failed':'queued';next=Date.now()+Math.pow(2,row.attempts+1)*60000;}}
    await env.DB.prepare('UPDATE push_deliveries SET state=?,next_at=? WHERE event_id=? AND device_id=?').bind(state,next,row.event_id,row.device_id).run();
  }
}
export async function pushMaintenance(env){
  // Expired leases are visible as uncertain, not blindly sent twice.
  await env.DB.prepare("UPDATE push_deliveries SET state='unknown' WHERE state='sending' AND next_at<?").bind(Date.now()).run();
  await collectPush(env);await deliverPush(env);
  await env.DB.batch([env.DB.prepare('DELETE FROM push_deliveries WHERE event_id IN (SELECT id FROM push_events WHERE created_at<?)').bind(new Date(Date.now()-30*86400000).toISOString()),env.DB.prepare('DELETE FROM push_events WHERE created_at<?').bind(new Date(Date.now()-30*86400000).toISOString())]);
}
