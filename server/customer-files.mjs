import {need,text} from '../src/domain.mjs';
import {getOrder} from '../src/worker.mjs';
import {digest} from './auth.mjs';

const phoneIdentity=value=>{const digits=String(value??'').replace(/\D/g,'');return digits.startsWith('0049')?'0'+digits.slice(4):digits.startsWith('49')?'0'+digits.slice(2):digits;};
export function customerIdentityHashes(data,synthetic){const scope=synthetic?'test:':'live:',email=String(data.email??'').trim().toLowerCase(),phone=phoneIdentity(data.phone);return [email?digest(scope+'email:'+email):null,phone?digest(scope+'phone:'+phone):null].filter(Boolean);}
export async function assertCustomerSourceActive(env,source,synthetic){
  const hashes=customerIdentityHashes(source,synthetic);if(!hashes.length)return;
  const rows=(await env.DB.prepare("SELECT id,data FROM customer_files WHERE synthetic=? AND json_extract(data,'$.lifecycle.status') IN ('blocked','anonymized')").bind(Number(synthetic)).all()).results;
  const blocked=rows.some(row=>{const data=JSON.parse(row.data);return [row.id,...customerIdentityHashes(data,synthetic),...(data.lifecycle?.identityHashes??[])].some(hash=>hashes.includes(hash));});
  need(!blocked,'Eine passende Kundenakte ist gesperrt oder anonymisiert. Neue Aufträge und Importe benötigen zuerst eine dokumentierte Prüfung dieser Akte.',409);
}
export function customerSourceGuardStatements(env,source,synthetic){
  const hashes=customerIdentityHashes(source,synthetic);if(!hashes.length)return [];
  const sql="INSERT INTO customer_files_cas_guard SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM customer_files c WHERE c.synthetic=? AND json_extract(c.data,'$.lifecycle.status') IN ('blocked','anonymized') AND (c.id IN (SELECT value FROM json_each(?)) OR EXISTS(SELECT 1 FROM json_each(c.data,'$.lifecycle.identityHashes') h WHERE h.value IN (SELECT value FROM json_each(?))))) THEN 1 ELSE 0 END";
  return [env.DB.prepare(sql).bind(Number(synthetic),JSON.stringify(hashes),JSON.stringify(hashes)),env.DB.prepare('DELETE FROM customer_files_cas_guard')];
}

export async function customerFilesSchema(env){
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS customer_files(id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL,synthetic INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS vehicle_files(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customer_files(id),version INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS order_files(order_id TEXT PRIMARY KEY REFERENCES orders(id),customer_id TEXT NOT NULL REFERENCES customer_files(id),vehicle_id TEXT NOT NULL REFERENCES vehicle_files(id))',
    'CREATE TABLE IF NOT EXISTS file_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS customer_files_cas_guard(value INTEGER NOT NULL CONSTRAINT customer_files_cas_guard CHECK(value=1))'
  ].map(sql=>env.DB.prepare(sql)));
}
// An email groups existing snapshots. Without it each order keeps its own identity.
// Vehicles merge only by a documented plate, never by a model name alone.
export async function indexCustomerFiles(env){
  const rows=await env.DB.prepare('SELECT o.* FROM orders o LEFT JOIN order_files f ON f.order_id=o.id WHERE f.order_id IS NULL ORDER BY o.updated_at').all();
  for(const row of rows.results){
    const o=JSON.parse(row.data),source=o.source,email=(source.email??'').trim().toLowerCase(),scope=row.synthetic?'test:':'live:';
    const cid=digest(scope+(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?'email:'+email:'order:'+row.id));
    const plate=o.intake?.plate??o.return?.plate??source.plate??'',vid=digest(cid+':'+(plate?'plate:'+plate.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g,''):'order:'+row.id));
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO customer_files(id,data,synthetic) VALUES(?,?,?)').bind(cid,JSON.stringify({name:source.name,email,phone:source.phone??'',address:source.address??'',notes:''}),row.synthetic),
      env.DB.prepare("INSERT OR IGNORE INTO vehicle_files(id,customer_id,data) SELECT ?,?,CASE WHEN json_extract(data,'$.lifecycle.status')='anonymized' THEN ? ELSE ? END FROM customer_files WHERE id=?").bind(vid,cid,JSON.stringify({name:'Anonymisierte Fahrzeugakte',plate:'',vin:'',notes:''}),JSON.stringify({name:source.vehicle,plate,vin:'',notes:''}),cid),
      env.DB.prepare('INSERT OR IGNORE INTO order_files VALUES(?,?,?)').bind(row.id,cid,vid),
      env.DB.prepare("UPDATE orders SET data=json_set(data,'$.recordsRestriction',json_object('status',(SELECT json_extract(c.data,'$.lifecycle.status') FROM customer_files c JOIN order_files f ON f.customer_id=c.id WHERE f.order_id=orders.id),'at',?,'reason','Sperre aus bestehender Kundenakte übernommen','customerId',(SELECT customer_id FROM order_files WHERE order_id=orders.id))),version=version+1,updated_at=?,actor='owner',action='Bestehende Kundensperre übernommen' WHERE id=? AND COALESCE(json_extract(data,'$.recordsRestriction.status'),'active') NOT IN ('blocked','anonymized') AND EXISTS(SELECT 1 FROM customer_files c JOIN order_files f ON f.customer_id=c.id WHERE f.order_id=orders.id AND json_extract(c.data,'$.lifecycle.status') IN ('blocked','anonymized'))").bind(new Date().toISOString(),new Date().toISOString(),row.id)
    ]);
  }
}
export async function customerFiles(env,synthetic){
  await indexCustomerFiles(env);
  const customers=await env.DB.prepare('SELECT * FROM customer_files WHERE synthetic=?').bind(Number(synthetic)).all();
  const vehicles=await env.DB.prepare('SELECT v.* FROM vehicle_files v JOIN customer_files c ON c.id=v.customer_id WHERE c.synthetic=?').bind(Number(synthetic)).all();
  const orders=await env.DB.prepare('SELECT o.*,f.customer_id,f.vehicle_id FROM orders o JOIN order_files f ON f.order_id=o.id WHERE o.synthetic=? ORDER BY o.updated_at DESC').bind(Number(synthetic)).all();
  return {customers:customers.results.map(r=>({id:r.id,version:r.version,...JSON.parse(r.data)})),vehicles:vehicles.results.map(r=>({id:r.id,customerId:r.customer_id,version:r.version,...JSON.parse(r.data)})),orders:orders.results.map(r=>({...JSON.parse(r.data),id:r.id,wg:r.wg,version:r.version,status:r.status,customerId:r.customer_id,vehicleId:r.vehicle_id}))};
}
export async function updateCustomerFile(env,input){
  await indexCustomerFiles(env);const now=new Date().toISOString();
  if(input.kind==='link'){
    const order=await getOrder(env,input.orderId),vehicle=await env.DB.prepare('SELECT v.*,c.synthetic,c.data AS customer_data,c.version AS customer_version FROM vehicle_files v JOIN customer_files c ON c.id=v.customer_id WHERE v.id=?').bind(input.vehicleId).first();
    need(vehicle&&Boolean(vehicle.synthetic)===Boolean(order.synthetic),'Fahrzeugakte nicht gefunden.',404);need(order.version===input.orderVersion,'Auftrag wurde geändert. Bitte neu öffnen.',409);
    need(!order.recordsRestriction&&!['blocked','anonymized'].includes(JSON.parse(vehicle.customer_data).lifecycle?.status),'Gesperrte Kundenakten können nicht neu zugeordnet werden.',409);
    const old=await env.DB.prepare('SELECT * FROM order_files WHERE order_id=?').bind(order.id).first();need(old?.vehicle_id===input.previousVehicleId,'Zuordnung bereits geändert. Bitte neu laden.',409);
    need(input.confirmed===true,'Kunden- und Fahrzeugzuordnung bitte ausdrücklich prüfen.');
    const operationId=crypto.randomUUID(),updated={...order,operationId};
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE orders SET data=?,version=version+1,updated_at=?,actor='owner',action='Geprüfte Kunden- und Fahrzeugzuordnung geändert' WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM order_files f JOIN customer_files c ON c.id=f.customer_id WHERE f.order_id=? AND f.vehicle_id=? AND COALESCE(json_extract(c.data,'$.lifecycle.status'),'active') NOT IN ('blocked','anonymized')) AND EXISTS(SELECT 1 FROM vehicle_files v JOIN customer_files c ON c.id=v.customer_id WHERE v.id=? AND v.version=? AND c.id=? AND c.version=? AND COALESCE(json_extract(c.data,'$.lifecycle.status'),'active') NOT IN ('blocked','anonymized'))").bind(JSON.stringify(updated),now,order.id,order.version,order.id,input.previousVehicleId,vehicle.id,vehicle.version,vehicle.customer_id,vehicle.customer_version),
      env.DB.prepare("UPDATE order_files SET customer_id=?,vehicle_id=? WHERE order_id=? AND vehicle_id=? AND EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)").bind(vehicle.customer_id,vehicle.id,order.id,input.previousVehicleId,order.id,order.version+1,operationId),
      env.DB.prepare('INSERT INTO file_audit(at,entity_id,action,data) SELECT ?,?,?,? WHERE changes()>0').bind(now,order.id,'Auftrag einer geprüften Fahrzeugakte zugeordnet',JSON.stringify({before:old,customerId:vehicle.customer_id,vehicleId:vehicle.id,orderVersion:order.version+1}))
    ]);
    need(result[0].meta.changes,'Zuordnung verändert.',409);return {ok:true};
  }
  const vehicle=input.kind==='vehicle';need(vehicle||input.kind==='customer','Unbekannte Akte.');
  const table=vehicle?'vehicle_files':'customer_files',old=await env.DB.prepare('SELECT * FROM '+table+' WHERE id=?').bind(input.id).first();need(old,'Akte nicht gefunden.',404);
  const customer=vehicle?await env.DB.prepare('SELECT * FROM customer_files WHERE id=?').bind(old.customer_id).first():old;
  need(!['blocked','anonymized'].includes(JSON.parse(customer.data).lifecycle?.status),'Kundenakte ist gesperrt. Zuerst die Sperre mit dokumentiertem Grund prüfen.',409);
  need(old.version===input.version,'Akte wurde inzwischen geändert. Bitte neu laden.',409);
  const data=Object.fromEntries((vehicle?['name','plate','vin','notes']:['name','email','phone','address','notes']).map(key=>[key,text(input.data?.[key],key==='notes'?4000:600)]));
  if(!vehicle&&JSON.parse(old.data).lifecycle)data.lifecycle=JSON.parse(old.data).lifecycle;
  need(data.name,'Name fehlt.');if(!vehicle)need(!data.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email),'E-Mail ungültig.');
  if(vehicle)need(!data.vin||/^[A-HJ-NPR-Z0-9]{17}$/.test(data.vin.toUpperCase()),'FIN muss 17 gültige Zeichen enthalten.');
  const changed=await env.DB.batch([env.DB.prepare("UPDATE "+table+" SET data=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM customer_files c WHERE c.id=? AND c.version=? AND COALESCE(json_extract(c.data,'$.lifecycle.status'),'active') NOT IN ('blocked','anonymized'))").bind(JSON.stringify(data),input.id,input.version,customer.id,customer.version),env.DB.prepare('INSERT INTO file_audit(at,entity_id,action,data) SELECT ?,?,?,? WHERE changes()>0').bind(now,input.id,'Stammdaten aktualisiert; Auftragsschnappschüsse unverändert',JSON.stringify({before:JSON.parse(old.data),after:data}))]);
  need(changed[0].meta.changes,'Akte inzwischen geändert.',409);return {ok:true};
}
