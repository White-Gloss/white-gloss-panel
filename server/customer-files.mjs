import {need,text} from '../src/domain.mjs';
import {getOrder} from '../src/worker.mjs';
import {digest} from './auth.mjs';

export async function customerFilesSchema(env){
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS customer_files(id TEXT PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL,synthetic INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS vehicle_files(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customer_files(id),version INTEGER NOT NULL DEFAULT 1,data TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS order_files(order_id TEXT PRIMARY KEY REFERENCES orders(id),customer_id TEXT NOT NULL REFERENCES customer_files(id),vehicle_id TEXT NOT NULL REFERENCES vehicle_files(id))',
    'CREATE TABLE IF NOT EXISTS file_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL)'
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
      env.DB.prepare('INSERT OR IGNORE INTO vehicle_files(id,customer_id,data) VALUES(?,?,?)').bind(vid,cid,JSON.stringify({name:source.vehicle,plate,vin:'',notes:''})),
      env.DB.prepare('INSERT OR IGNORE INTO order_files VALUES(?,?,?)').bind(row.id,cid,vid)
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
    const order=await getOrder(env,input.orderId),vehicle=await env.DB.prepare('SELECT v.*,c.synthetic FROM vehicle_files v JOIN customer_files c ON c.id=v.customer_id WHERE v.id=?').bind(input.vehicleId).first();
    need(vehicle&&Boolean(vehicle.synthetic)===Boolean(order.synthetic),'Fahrzeugakte nicht gefunden.',404);need(order.version===input.orderVersion,'Auftrag wurde geändert. Bitte neu öffnen.',409);
    const old=await env.DB.prepare('SELECT * FROM order_files WHERE order_id=?').bind(order.id).first();need(old?.vehicle_id===input.previousVehicleId,'Zuordnung bereits geändert. Bitte neu laden.',409);
    need(input.confirmed===true,'Kunden- und Fahrzeugzuordnung bitte ausdrücklich prüfen.');
    const result=await env.DB.batch([env.DB.prepare('UPDATE order_files SET customer_id=?,vehicle_id=? WHERE order_id=? AND vehicle_id=?').bind(vehicle.customer_id,vehicle.id,order.id,input.previousVehicleId),env.DB.prepare('INSERT INTO file_audit(at,entity_id,action,data) SELECT ?,?,?,? WHERE changes()>0').bind(now,order.id,'Auftrag einer geprüften Fahrzeugakte zugeordnet',JSON.stringify({before:old,customerId:vehicle.customer_id,vehicleId:vehicle.id}))]);
    need(result[0].meta.changes,'Zuordnung verändert.',409);return {ok:true};
  }
  const vehicle=input.kind==='vehicle';need(vehicle||input.kind==='customer','Unbekannte Akte.');
  const table=vehicle?'vehicle_files':'customer_files',old=await env.DB.prepare('SELECT * FROM '+table+' WHERE id=?').bind(input.id).first();need(old,'Akte nicht gefunden.',404);
  need(old.version===input.version,'Akte wurde inzwischen geändert. Bitte neu laden.',409);
  const data=Object.fromEntries((vehicle?['name','plate','vin','notes']:['name','email','phone','address','notes']).map(key=>[key,text(input.data?.[key],key==='notes'?4000:600)]));
  need(data.name,'Name fehlt.');if(!vehicle)need(!data.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email),'E-Mail ungültig.');
  if(vehicle)need(!data.vin||/^[A-HJ-NPR-Z0-9]{17}$/.test(data.vin.toUpperCase()),'FIN muss 17 gültige Zeichen enthalten.');
  const changed=await env.DB.batch([env.DB.prepare('UPDATE '+table+' SET data=?,version=version+1 WHERE id=? AND version=?').bind(JSON.stringify(data),input.id,input.version),env.DB.prepare('INSERT INTO file_audit(at,entity_id,action,data) SELECT ?,?,?,? WHERE changes()>0').bind(now,input.id,'Stammdaten aktualisiert; Auftragsschnappschüsse unverändert',JSON.stringify({before:JSON.parse(old.data),after:data}))]);
  need(changed[0].meta.changes,'Akte inzwischen geändert.',409);return {ok:true};
}
