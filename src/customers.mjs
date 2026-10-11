import {AppError,need,text} from './domain.mjs';
import {vehicleClasses} from './catalog.mjs';

// Customer and vehicle master data. Records are only created or updated, never deleted.
const CUSTOMER_FIELDS={name:180,company:180,email:180,phone:80,address:600,city:180,billingAddress:600,note:2000};
const VEHICLE_FIELDS={plate:40,label:180,make:80,model:80,color:60,vin:40,note:1000};
export const emailKey=value=>text(value,180).toLowerCase();
export const phoneKey=value=>{const digits=String(value??'').replace(/[^0-9]/g,'').replace(/^0049/,'0').replace(/^49(?=1)/,'0');return digits.length>=6?digits:'';};
export const plateKey=value=>String(value??'').toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g,'');
export function normalizeCustomer(input,old){
  need(input&&typeof input==='object'&&!Array.isArray(input),'Kundendaten fehlen.');
  const c={...(old??{})};for(const [key,max] of Object.entries(CUSTOMER_FIELDS))if(input[key]!==undefined)c[key]=text(input[key],max);
  if(input.reviewConsent!==undefined)c.reviewConsent=input.reviewConsent===true;
  c.emailKey=emailKey(c.email);c.phoneKey=phoneKey(c.phone);return c;
}
export function normalizeVehicle(input,old){
  need(input&&typeof input==='object'&&!Array.isArray(input),'Fahrzeugdaten fehlen.');
  const v={...(old??{})};for(const [key,max] of Object.entries(VEHICLE_FIELDS))if(input[key]!==undefined)v[key]=text(input[key],max);
  if(input.year!==undefined){const year=input.year===''||input.year===null?null:Number(input.year);need(year===null||Number.isInteger(year)&&year>=1900&&year<=2100,'Baujahr ist ungültig.');v.year=year;}
  if(input.classId!==undefined){v.classId=text(input.classId,40);need(!v.classId||vehicleClasses.some(c=>c.id===v.classId),'Fahrzeugklasse ist unbekannt.');}
  v.plate=v.plate?String(v.plate).toUpperCase():v.plate??'';v.plateKey=plateKey(v.plate);
  if(!v.label)v.label=[v.make,v.model].filter(Boolean).join(' ');
  return v;
}
export const vehicleTitle=v=>[v?.label||[v?.make,v?.model].filter(Boolean).join(' '),v?.plate].filter(Boolean).join(' · ');
const customerSearch=c=>[c.name,c.company,c.emailKey,c.phone,c.phoneKey,c.address,c.city].filter(Boolean).join(' ').toLowerCase();
const vehicleSearch=v=>[v.plate,v.plateKey,v.label,v.make,v.model,v.color,v.vin].filter(Boolean).join(' ').toLowerCase();
const parseCustomer=row=>row?{...JSON.parse(row.data),id:row.id,version:row.version,synthetic:row.synthetic===1,createdAt:row.created_at,updatedAt:row.updated_at}:null;
const parseVehicle=row=>row?{...JSON.parse(row.data),id:row.id,customerId:row.customer_id,createdAt:row.created_at,updatedAt:row.updated_at}:null;
export async function getCustomer(env,id){const c=parseCustomer(await env.DB.prepare('SELECT * FROM customers WHERE id=?').bind(id).first());need(c,'Kunde nicht gefunden.',404);return c;}
export async function getVehicle(env,id){const v=parseVehicle(await env.DB.prepare('SELECT * FROM vehicles WHERE id=?').bind(id).first());need(v,'Fahrzeug nicht gefunden.',404);return v;}
export function customerInsert(env,id,data,synthetic,at){return [env.DB.prepare('INSERT INTO customers(id,data,search,synthetic,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').bind(id,JSON.stringify(data),customerSearch(data),synthetic?1:0,at,at)];}
export function vehicleInsert(env,id,customerId,data,at){return env.DB.prepare('INSERT INTO vehicles(id,customer_id,data,search,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,customerId,JSON.stringify(data),vehicleSearch(data),at,at);}
async function findCustomer(env,data,synthetic){
  if(!data.emailKey&&!data.phoneKey)return null;
  return parseCustomer(await env.DB.prepare("SELECT * FROM customers WHERE synthetic=? AND ((?<>'' AND json_extract(data,'$.emailKey')=?) OR (?<>'' AND json_extract(data,'$.phoneKey')=?)) ORDER BY created_at LIMIT 1").bind(synthetic?1:0,data.emailKey,data.emailKey,data.phoneKey,data.phoneKey).first());
}
async function findVehicle(env,customerId,data){
  const byPlate=data.plateKey?await env.DB.prepare("SELECT * FROM vehicles WHERE customer_id=? AND json_extract(data,'$.plateKey')=? LIMIT 1").bind(customerId,data.plateKey).first():null;if(byPlate)return parseVehicle(byPlate);
  if(data.plateKey||!data.label)return null;
  return parseVehicle(await env.DB.prepare("SELECT * FROM vehicles WHERE customer_id=? AND lower(json_extract(data,'$.label'))=? AND json_extract(data,'$.plateKey')='' LIMIT 1").bind(customerId,data.label.toLowerCase()).first());
}
// Resolves (or prepares) customer and vehicle for an order. Returns ids and the statements that create missing records.
export async function resolveOrderLink(env,{source,synthetic=false,customerId=null,vehicleId=null,at=new Date().toISOString()}){
  const statements=[];let customer=null;
  if(customerId){customer=await getCustomer(env,customerId);need(customer.synthetic===Boolean(synthetic),'Kunde gehört nicht zu diesem Bereich.',409);}
  else{const data=normalizeCustomer({name:source.name,company:source.company,email:source.email,phone:source.phone,address:source.address,city:source.city,reviewConsent:source.reviewConsent});customer=await findCustomer(env,data,synthetic);if(!customer){if(!data.name&&!data.emailKey&&!data.phoneKey&&!data.company)return {customerId:null,vehicleId:null,statements};customer={...data,id:crypto.randomUUID()};statements.push(...customerInsert(env,customer.id,data,synthetic,at));}}
  let vehicle=null;
  if(vehicleId){vehicle=await getVehicle(env,vehicleId);need(vehicle.customerId===customer.id,'Fahrzeug gehört zu einem anderen Kunden.',409);}
  else{const data=normalizeVehicle({label:source.vehicle,plate:source.plate,classId:source.classId??''});if(data.label||data.plateKey){vehicle=customer.version?await findVehicle(env,customer.id,data):null;if(!vehicle){vehicle={...data,id:crypto.randomUUID()};statements.push(vehicleInsert(env,vehicle.id,customer.id,data,at));}}}
  return {customerId:customer.id,vehicleId:vehicle?.id??null,statements};
}
export const linkStatement=(env,orderId,customerId,vehicleId)=>env.DB.prepare('INSERT INTO customer_orders(order_id,customer_id,vehicle_id) VALUES(?,?,?) ON CONFLICT(order_id) DO UPDATE SET customer_id=excluded.customer_id,vehicle_id=excluded.vehicle_id').bind(orderId,customerId,vehicleId);
// Existing orders from before the customer master are linked step by step without changing the orders themselves.
export async function linkUnlinkedOrders(env,limit=200){
  const rows=await env.DB.prepare('SELECT id,data,synthetic FROM orders o WHERE NOT EXISTS(SELECT 1 FROM customer_orders l WHERE l.order_id=o.id) ORDER BY o.rowid LIMIT ?').bind(limit).all();
  for(const row of rows.results){const o=JSON.parse(row.data);const link=await resolveOrderLink(env,{source:o.source??{},synthetic:row.synthetic===1});await env.DB.batch([...link.statements,link.customerId?linkStatement(env,row.id,link.customerId,link.vehicleId):env.DB.prepare("INSERT OR IGNORE INTO customer_orders(order_id,customer_id,vehicle_id) VALUES(?,'',NULL)").bind(row.id)]);}
  return rows.results.length;
}
export async function searchCustomers(env,query,synthetic=false,limit=100){
  const q='%'+String(query??'').trim().toLowerCase().replace(/[%_\\]/g,m=>'\\'+m)+'%',qPlate='%'+plateKey(query).toLowerCase()+'%';
  const rows=await env.DB.prepare("SELECT * FROM customers c WHERE synthetic=? AND (search LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM vehicles v WHERE v.customer_id=c.id AND (v.search LIKE ? ESCAPE '\\' OR (?<>'%%' AND lower(json_extract(v.data,'$.plateKey')) LIKE ?)))) ORDER BY updated_at DESC LIMIT ?").bind(synthetic?1:0,q,q,qPlate,qPlate,limit).all();
  const customers=rows.results.map(parseCustomer);if(!customers.length)return [];
  const ids=customers.map(c=>c.id),marks=ids.map(()=>'?').join(',');
  const vehicles=(await env.DB.prepare('SELECT * FROM vehicles WHERE customer_id IN ('+marks+') ORDER BY updated_at DESC').bind(...ids).all()).results.map(parseVehicle);
  const counts=(await env.DB.prepare('SELECT l.customer_id id,COUNT(*) n,MAX(o.updated_at) last FROM customer_orders l JOIN orders o ON o.id=l.order_id WHERE l.customer_id IN ('+marks+') GROUP BY l.customer_id').bind(...ids).all()).results;
  return customers.map(c=>({...c,vehicles:vehicles.filter(v=>v.customerId===c.id),orderCount:counts.find(x=>x.id===c.id)?.n??0,lastOrderAt:counts.find(x=>x.id===c.id)?.last??null}));
}
export async function saveCustomer(env,input,synthetic=false){
  const at=new Date().toISOString();
  if(!input.id){const data=normalizeCustomer(input.customer??{});const id=crypto.randomUUID();await env.DB.batch(customerInsert(env,id,data,synthetic,at));return getCustomer(env,id);}
  const old=await getCustomer(env,input.id);need(input.version===undefined||input.version===old.version,'Diese Kundenansicht ist veraltet. Bitte neu öffnen.',409);
  const {id:_id,version:_version,synthetic:_synthetic,createdAt:_created,updatedAt:_updated,...stored}=old;
  const data=normalizeCustomer(input.customer??{},stored);data.history=[...(stored.history??[]),{at,before:Object.fromEntries(Object.keys(input.customer??{}).filter(key=>key in CUSTOMER_FIELDS||key==='reviewConsent').map(key=>[key,stored[key]??null]))}].slice(-50);
  const r=await env.DB.batch([env.DB.prepare('UPDATE customers SET data=?,search=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(JSON.stringify(data),customerSearch(data),at,old.id,old.version)]);
  if(!r[0].meta.changes)throw new AppError('Diese Kundenansicht ist veraltet. Bitte neu öffnen.',409);return getCustomer(env,old.id);
}
export async function saveVehicle(env,input){
  const at=new Date().toISOString();
  if(!input.id){const customer=await getCustomer(env,input.customerId);const data=normalizeVehicle(input.vehicle??{});const id=crypto.randomUUID();await env.DB.batch([vehicleInsert(env,id,customer.id,data,at)]);return getVehicle(env,id);}
  const old=await getVehicle(env,input.id);const {id:_id,customerId:_customer,createdAt:_created,updatedAt:_updated,...stored}=old;const data=normalizeVehicle(input.vehicle??{},stored);data.history=[...(stored.history??[]),{at,before:Object.fromEntries(Object.keys(input.vehicle??{}).map(key=>[key,stored[key]??null]))}].slice(-50);
  await env.DB.prepare('UPDATE vehicles SET data=?,search=?,updated_at=? WHERE id=?').bind(JSON.stringify(data),vehicleSearch(data),at,old.id).run();return getVehicle(env,old.id);
}
export async function customerDetail(env,id){
  const customer=await getCustomer(env,id);const vehicles=(await env.DB.prepare('SELECT * FROM vehicles WHERE customer_id=? ORDER BY updated_at DESC').bind(id).all()).results.map(parseVehicle);
  const orders=(await env.DB.prepare('SELECT o.id,o.wg,o.status,o.version,o.updated_at,l.vehicle_id FROM customer_orders l JOIN orders o ON o.id=l.order_id WHERE l.customer_id=? ORDER BY o.updated_at DESC LIMIT 500').bind(id).all()).results.map(r=>({id:r.id,wg:r.wg,status:r.status,version:r.version,updatedAt:r.updated_at,vehicleId:r.vehicle_id}));
  return {customer,vehicles,orders};
}
export async function orderLink(env,orderId){const row=await env.DB.prepare('SELECT customer_id,vehicle_id FROM customer_orders WHERE order_id=?').bind(orderId).first();if(!row?.customer_id)return {customer:null,vehicle:null};const customer=await getCustomer(env,row.customer_id).catch(()=>null);const vehicle=row.vehicle_id?await getVehicle(env,row.vehicle_id).catch(()=>null):null;return {customer,vehicle};}
