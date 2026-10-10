import {AppError,need} from '../src/domain.mjs';
import {catalogQuote,catalogCheckedAt,packages,vehicleClasses,extras,cities} from '../src/catalog.mjs';
import {customerAccessRequire,customerAccessGuards,customerAccessIdentity} from '../src/customer-access.mjs';
import {getOrder,createOrder} from '../src/worker.mjs';
import {digest} from './auth.mjs';
import {indexCustomerFiles} from './customer-files.mjs';
import {panelJSON,requestKey} from './customer-create.mjs';

export async function rebookingSchema(env){
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS rebooking_requests(request_id TEXT PRIMARY KEY,actor TEXT NOT NULL,payload_hash TEXT NOT NULL,source_order_id TEXT NOT NULL REFERENCES orders(id),order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),created_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS rebooking_guard(value INTEGER NOT NULL CONSTRAINT rebooking_current CHECK(value=1))'
  ].map(sql=>env.DB.prepare(sql)));
}
const active=data=>!['blocked','anonymized'].includes(data?.lifecycle?.status);
const bounded=(value,max,label)=>{need(typeof value==='string'&&value.length<=max&&!value.includes('\u0000'),label+' ist ungültig oder zu lang.');return value.trim();};
async function context(env,id,identity){
  let order=await getOrder(env,id);const owner=digest(identity)===env.OWNER_EMAIL_SHA256;
  let access=owner?null:await customerAccessRequire(env,order,identity,'request');
  let row=await relation(env,id);
  // Reuse the existing index for historical orders; never create a second master-data system.
  if(!row){await indexCustomerFiles(env);order=await getOrder(env,id);if(!owner)access=await customerAccessRequire(env,order,identity,'request');row=await relation(env,id);}
  need(row&&row.customer_id===row.vehicle_customer_id&&Boolean(row.synthetic)===Boolean(order.synthetic),'Die Kunden- und Fahrzeugzuordnung muss zuerst im Betrieb geprüft werden.',409);
  const customer=JSON.parse(row.customer_data),vehicle=JSON.parse(row.vehicle_data);
  const restricted=['blocked','anonymized'].includes(order.recordsRestriction?.status)||!active(customer);
  const accountMatches=owner||access.scope!=='private'||customerAccessIdentity(customer.email)===customerAccessIdentity(identity);
  return {order,row,customer,vehicle,owner,access,canRequest:!restricted&&accountMatches,reason:restricted?'Diese Kundenakte ist für neue Anfragen gesperrt. Bitte White Gloss kontaktieren.':!accountMatches?'Die Kontaktdaten der Kundenakte wurden geändert. Eine neue Anfrage benötigt zuerst eine Zuordnungsprüfung durch White Gloss.':null};
}
const relation=(env,id)=>env.DB.prepare('SELECT f.customer_id,f.vehicle_id,c.version AS customer_version,c.data AS customer_data,c.synthetic,v.version AS vehicle_version,v.data AS vehicle_data,v.customer_id AS vehicle_customer_id FROM order_files f JOIN customer_files c ON c.id=f.customer_id JOIN vehicle_files v ON v.id=f.vehicle_id WHERE f.order_id=?').bind(id).first();
function priorServices(order){
  const agreed=[order.offer?.services,...(order.amendments??[]).filter(item=>item.state==='accepted').map(item=>item.services)].filter(Boolean).join('\n');
  return (order.return?.signaturesConfirmed?order.return.services:null)??agreed;
}
function selectionFor(order){
  const source=order.source,packageId=packages.find(item=>[item.id,item.name].includes(source.packageId??source.package))?.id??'',classId=vehicleClasses.find(item=>[item.id,item.label].includes(source.classId??source.vehicleClass))?.id??'';
  return {packageId,classId,extraIds:[],delivery:source.delivery==='Abholung'?'Abholung':'Kunde bringt',citySlug:cities.some(item=>item.slug===source.citySlug)?source.citySlug:'',pickupKm:source.pickupKm??''};
}
function view(c){return {orderId:c.order.id,orderVersion:c.order.version,wg:c.order.wg,customerId:c.row.customer_id,customerVersion:c.row.customer_version,vehicleId:c.row.vehicle_id,vehicleVersion:c.row.vehicle_version,customer:{name:c.customer.name},vehicle:{name:c.vehicle.name,plate:c.vehicle.plate??'',vin:c.vehicle.vin??''},previousServices:priorServices(c.order),selection:selectionFor(c.order),catalogCheckedAt,canRequest:c.canRequest,reason:c.reason};}
function inputData(input){
  const selected=input.selection;need(selected&&typeof selected==='object'&&!Array.isArray(selected),'Paket und Fahrzeugklasse bitte prüfen.');
  need(selected.customPickupCents===undefined,'Individuelle Abholpreise werden erst vom Betrieb geprüft.');
  need(Array.isArray(selected.extraIds)&&selected.extraIds.length<=extras.length&&selected.extraIds.every(id=>typeof id==='string'),'Zusatzleistungen bitte prüfen.');
  const selection={packageId:bounded(selected.packageId,60,'Paket'),classId:bounded(selected.classId,60,'Fahrzeugklasse'),extraIds:[...new Set(selected.extraIds)].sort(),delivery:bounded(selected.delivery,40,'Übergabeart'),citySlug:bounded(selected.citySlug??'',100,'Ort'),pickupKm:selected.pickupKm===''||selected.pickupKm===null||selected.pickupKm===undefined?'':Number(selected.pickupKm)};
  const condition=bounded(input.condition,2000,'Aktueller Fahrzeugzustand'),wishes=bounded(input.wishes??'',4000,'Wünsche'),desiredDate=bounded(input.desiredDate??'',10,'Terminwunsch'),timeWindow=bounded(input.timeWindow??'',100,'Zeitfenster');need(condition.length>=3,'Bitte den aktuellen Fahrzeugzustand neu beschreiben.');
  if(desiredDate){const timestamp=Date.parse(desiredDate+'T12:00:00Z');need(/^\d{4}-\d{2}-\d{2}$/.test(desiredDate)&&Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===desiredDate,'Terminwunsch ist kein gültiges Datum.');}
  need(input.confirmed===true,'Bitte die Angaben und die unverbindliche neue Anfrage ausdrücklich bestätigen.');
  for(const key of ['orderVersion','customerVersion','vehicleVersion'])need(Number.isSafeInteger(input[key])&&input[key]>0,'Angezeigte Datenversion fehlt. Bitte neu öffnen.');
  need(typeof input.customerId==='string'&&typeof input.vehicleId==='string','Kunden- und Fahrzeugzuordnung fehlt.');
  return {orderVersion:input.orderVersion,customerId:input.customerId,customerVersion:input.customerVersion,vehicleId:input.vehicleId,vehicleVersion:input.vehicleVersion,catalogCheckedAt:bounded(input.catalogCheckedAt,30,'Preisgrundlagenstand'),selection,condition,wishes,desiredDate,timeWindow,confirmed:true};
}
async function receipt(env,key,actor,fingerprint,c,identity){
  const row=await env.DB.prepare('SELECT r.*,o.wg,o.status FROM rebooking_requests r JOIN orders o ON o.id=r.order_id WHERE request_id=?').bind(key).first();
  if(!row)return null;
  need(row.actor===actor&&row.payload_hash===fingerprint&&row.source_order_id===c.order.id,'Diese Wiederholungskennung wurde bereits für andere Angaben verwendet. Bitte die gespeicherte Anfrage öffnen oder bewusst eine neue Anfrage beginnen.',409);
  const current=await context(env,c.order.id,identity);need(current.canRequest,current.reason,409);
  const target=await getOrder(env,row.order_id),link=await relation(env,row.order_id);
  need(link?.customer_id===current.row.customer_id&&link?.vehicle_id===current.row.vehicle_id&&active(JSON.parse(link.customer_data))&&!['blocked','anonymized'].includes(target.recordsRestriction?.status),'Die gespeicherte Anfrage wurde anders zugeordnet oder gesperrt. Bitte White Gloss kontaktieren; es wurde keine zweite Anfrage angelegt.',409);
  if(!current.owner)await customerAccessRequire(env,target,identity,'read');
  return {ok:true,replayed:true,id:row.order_id,wg:row.wg,status:row.status};
}
function guards(env,c){
  const r=c.row;
  return [...(c.access?customerAccessGuards(env,c.access):[]),env.DB.prepare("INSERT INTO rebooking_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM orders o JOIN order_files f ON f.order_id=o.id JOIN customer_files c ON c.id=f.customer_id JOIN vehicle_files v ON v.id=f.vehicle_id WHERE o.id=? AND o.version=? AND f.customer_id=? AND f.vehicle_id=? AND c.version=? AND c.data=? AND v.version=? AND v.data=? AND v.customer_id=c.id AND o.synthetic=c.synthetic AND COALESCE(json_extract(o.data,'$.recordsRestriction.status'),'active') NOT IN ('blocked','anonymized') AND COALESCE(json_extract(c.data,'$.lifecycle.status'),'active') NOT IN ('blocked','anonymized')) THEN 1 ELSE 0 END").bind(c.order.id,c.order.version,r.customer_id,r.vehicle_id,r.customer_version,r.customer_data,r.vehicle_version,r.vehicle_data),env.DB.prepare('DELETE FROM rebooking_guard')];
}
async function submit(env,id,input,identity){
  const key=requestKey(input.requestId),data=inputData(input),actor=digest(identity),fingerprint=digest(JSON.stringify({sourceOrderId:id,...data})),c=await context(env,id,identity);
  // A matching receipt wins over an old source version or later catalogue update.
  // Access to the original order is still checked for every retry.
  need(c.canRequest,c.reason,409);const replay=await receipt(env,key,actor,fingerprint,c,identity);if(replay)return replay;
  need(data.orderVersion===c.order.version&&data.customerId===c.row.customer_id&&data.vehicleId===c.row.vehicle_id&&data.customerVersion===c.row.customer_version&&data.vehicleVersion===c.row.vehicle_version,'Kunden-, Fahrzeug- oder Auftragsdaten wurden geändert. Bitte die Angaben neu prüfen.',409);
  need(data.catalogCheckedAt===catalogCheckedAt,'Preisgrundlagen wurden aktualisiert. Bitte neue Orientierung prüfen.',409);
  if(data.desiredDate)need(data.desiredDate>=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),'Der Terminwunsch liegt in der Vergangenheit. Bitte neu wählen.');
  let quote;try{quote=catalogQuote(data.selection);}catch(error){throw new AppError(error.message,400);}
  const now=new Date().toISOString(),newId=crypto.randomUUID(),source={name:c.customer.name,email:c.customer.email??c.order.source.email,phone:c.customer.phone??'',address:c.customer.address??'',vehicle:c.vehicle.name,plate:c.vehicle.plate??'',vin:c.vehicle.vin??'',package:quote.packageName,packageId:quote.packageId,vehicleClass:quote.className,classId:quote.classId,extras:quote.extras.map(item=>item.name),extraIds:quote.extras.map(item=>item.id),delivery:quote.delivery,city:quote.city,citySlug:quote.citySlug,pickupKm:quote.distanceKm,amountCents:quote.totalCents,pickupCents:quote.pickupCents,catalogQuote:quote,desiredDate:data.desiredDate,timeWindow:data.timeWindow,condition:data.condition,note:'Neue unverbindliche Anfrage. Preis, Fahrzeugzustand und Termin werden persönlich geprüft.\nAktueller Zustand: '+data.condition+(data.wishes?'\nWünsche: '+data.wishes:''),rebooking:{sourceOrderId:c.order.id,sourceWg:c.order.wg,customerId:c.row.customer_id,vehicleId:c.row.vehicle_id,requestedBy:identity,requestedAt:now,wishes:data.wishes,confirmed:true},reviewConsent:false,createdAt:now};
  const after=[env.DB.prepare('INSERT INTO order_files VALUES(?,?,?)').bind(newId,c.row.customer_id,c.row.vehicle_id),env.DB.prepare('INSERT INTO rebooking_requests VALUES(?,?,?,?,?,?)').bind(key,actor,fingerprint,c.order.id,newId,now)];
  try{
    const order=await createOrder(env,source,c.order.synthetic===true,{id:newId,actor:c.owner?'owner':'customer',action:'Neue unverbindliche Wiederanfrage; Preis und Termin offen',before:guards(env,c),after});
    return {ok:true,replayed:false,id:order.id,wg:order.wg,status:order.status};
  }catch(error){
    const concurrent=await receipt(env,key,actor,fingerprint,c,identity);if(concurrent)return concurrent;
    if(/rebooking_current|customer_access_authorized|customer_files_cas_guard|UNIQUE constraint failed: rebooking_requests/.test(error.message))throw new AppError('Kundenzugang oder zugeordnete Daten wurden inzwischen geändert. Bitte neu öffnen. Es wurde keine neue Anfrage gespeichert.',409);
    throw error;
  }
}
export async function rebookingEndpoint(env,request,identity){
  const url=new URL(request.url);if(url.pathname!=='/api/rebooking')return null;
  const id=url.searchParams.get('orderId');need(typeof id==='string'&&id.length<=80,'Ursprünglicher Auftrag fehlt.');
  if(request.method==='GET'){const c=await context(env,id,identity),result=view(c);if(!c.owner)await customerAccessRequire(env,await getOrder(env,id),identity,'request');return Response.json(result);}
  try{return Response.json(await submit(env,id,await panelJSON(env,request),identity));}
  catch(error){if(error instanceof AppError&&[400,403,404,405,409,413].includes(error.status))return Response.json({error:error.message,rejected:true},{status:error.status});throw error;}
}
