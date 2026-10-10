import {AppError,need,text,berlinISO} from '../src/domain.mjs';
import {bookingCalendarMetadata} from '../src/booking-calendar.mjs';
import {recordOperationIssue} from '../src/operations.mjs';
import {getOrder} from '../src/worker.mjs';
import {digest} from './auth.mjs';
import {validateBookingCalendar,bookingCalendarSchema} from './booking-calendar.mjs';
import {customerAccessRequire,customerAccessGuards} from '../src/customer-access.mjs';

const ready=new WeakMap();
export async function calendarAdjustmentSchema(env){
  await bookingCalendarSchema(env);
  if(!ready.has(env.DB))ready.set(env.DB,env.DB.batch([
    "CREATE TABLE IF NOT EXISTS calendar_adjustments(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),version INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL CHECK(state IN ('pending','accepted','withdrawn','declined')),data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
    "CREATE UNIQUE INDEX IF NOT EXISTS calendar_adjustments_pending ON calendar_adjustments(order_id) WHERE state='pending'"
  ].map(sql=>env.DB.prepare(sql))).catch(error=>{ready.delete(env.DB);throw error;}));
  await ready.get(env.DB);
}
const parse=row=>row?{...JSON.parse(row.data),id:row.id,orderId:row.order_id,version:row.version,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at}:null;
function available(order){const issue=recordOperationIssue(order,'appointment');need(!issue,issue,409);need(order.status==='Termin verbindlich'&&order.appointment&&!order.intake&&!order.return&&!order.handovers?.intake&&!order.handovers?.return,'Terminänderungen sind nur vor der Fahrzeugannahme für einen verbindlichen Termin möglich. Bestehende Protokolle bleiben erhalten.',409);}
function dto(item,order){return {...item,orderVersion:order.version,wg:order.wg,canRespond:!recordOperationIssue(order,'appointment')&&item.state==='pending'&&order.status==='Termin verbindlich'&&!order.intake&&!order.handovers?.intake&&!order.handovers?.return&&JSON.stringify(order.appointment)===JSON.stringify(item.before),snapshotHash:digest(JSON.stringify({id:item.id,version:item.version,before:item.before,after:item.after,reason:item.reason}))};}
export async function calendarAdjustmentData(env,order){
  await calendarAdjustmentSchema(env);
  const result=await env.DB.prepare('SELECT * FROM calendar_adjustments WHERE order_id=? ORDER BY created_at DESC,id').bind(order.id).all();
  return result.results.map(row=>dto(parse(row),order));
}
async function inputOf(request){
  need(request.headers.get('origin')===new URL(request.url).origin,'Ungültiger Ursprung.',403);
  need(request.headers.get('content-type')?.startsWith('application/json'),'JSON-Eingabe erforderlich.',415);
  const raw=await request.text();need(raw.length<=15000,'Eingabe zu groß.',413);
  let input;try{input=JSON.parse(raw);}catch{throw new AppError('Ungültige Eingabe.');}
  need(input&&typeof input==='object'&&!Array.isArray(input),'Ungültige Eingabe.');return input;
}
async function change(env,input,identity,isOwner){
  const order=await getOrder(env,input.orderId),at=new Date().toISOString();
  const access=isOwner?null:await customerAccessRequire(env,order,identity,'sign-calendar');
  if(input.action==='propose'){
    need(isOwner,'Nur der Betreiber erstellt Terminvorschläge.',403);available(order);
    need(typeof input.requestId==='string'&&/^[a-f0-9-]{36}$/.test(input.requestId),'Aktionskennung fehlt.');
    need(typeof input.reason==='string'&&input.reason.trim().length>=3&&input.reason.length<=2000,'Bitte einen konkreten Änderungsgrund angeben.');
    const start=berlinISO(input.start),end=berlinISO(input.end),duration=(Date.parse(end)-Date.parse(start))/60000;
    const id=input.requestId,existing=parse(await env.DB.prepare('SELECT * FROM calendar_adjustments WHERE id=?').bind(id).first());
    if(existing){need(existing.orderId===order.id&&existing.after.start===start&&existing.after.end===end&&existing.reason===input.reason.trim(),'Diese Aktionskennung wurde bereits für andere Angaben verwendet.',409);return {ok:true,adjustment:dto(existing,order),repeated:true};}
    need(Number.isInteger(input.orderVersion)&&input.orderVersion===order.version,'Auftrag inzwischen geändert. Bitte Kalender neu laden.',409);
    need(duration===order.appointment.duration,'Die vereinbarte Arbeitsdauer bleibt erhalten. Leistungsänderungen benötigen den bestehenden Nachtragsablauf.',409);
    need(start!==order.appointment.start||end!==order.appointment.end,'Der neue Termin entspricht bereits der Vereinbarung.');
    const after={...structuredClone(order.appointment),id:crypto.randomUUID(),start,end,duration};Object.assign(after,bookingCalendarMetadata(after));
    await validateBookingCalendar(env,after,{synthetic:order.synthetic===true,excludeOrderId:order.id});
    need(!(await env.DB.prepare("SELECT id FROM calendar_adjustments WHERE order_id=? AND state='pending'").bind(order.id).first()),'Zuerst die offene Terminänderung zurückziehen oder vom Kunden beantworten lassen.',409);
    const operationId=crypto.randomUUID(),record={before:structuredClone(order.appointment),after,reason:input.reason.trim(),proposedBy:identity,proposedAt:at},updated={...order,operationId};
    const results=await env.DB.batch([
      env.DB.prepare('UPDATE orders SET data=?,version=version+1,updated_at=?,actor=?,action=? WHERE id=? AND version=?').bind(JSON.stringify(updated),at,'owner','Terminänderung vorgeschlagen; bisherige Kundenzusage unverändert',order.id,order.version),
      env.DB.prepare("INSERT INTO calendar_adjustments(id,order_id,state,data,created_at,updated_at) SELECT ?,?,'pending',?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)").bind(id,order.id,JSON.stringify(record),at,at,order.id,order.version+1,operationId)
    ]);
    need(results[0].meta.changes>0&&results[1].meta.changes>0,'Auftrag inzwischen geändert. Bitte Kalender neu laden.',409);
    return {ok:true,adjustment:dto(parse(await env.DB.prepare('SELECT * FROM calendar_adjustments WHERE id=?').bind(id).first()),await getOrder(env,order.id))};
  }
  const item=parse(await env.DB.prepare('SELECT * FROM calendar_adjustments WHERE id=? AND order_id=?').bind(input.id,order.id).first());need(item,'Terminänderung nicht gefunden.',404);
  if(input.action==='accept'&&!isOwner&&item.state==='accepted'&&item.acceptance?.identity===identity&&item.acceptance?.snapshotHash===input.snapshotHash)return {ok:true,state:'accepted',appointment:item.after,repeated:true};
  need(Number.isInteger(input.version)&&item.version===input.version,'Terminänderung inzwischen beantwortet oder geändert. Bitte neu laden.',409);
  if(input.action==='withdraw'||input.action==='decline'){
    need(input.action==='withdraw'?isOwner:!isOwner,'Diese Aktion ist diesem Zugang nicht erlaubt.',403);
    need(item.state==='pending','Terminänderung ist bereits abgeschlossen.',409);
    need(text(input.reason).length>=3,'Bitte einen Grund angeben.');
    const record={...item,closedAt:at,closedBy:identity,closeReason:text(input.reason)},state=input.action==='withdraw'?'withdrawn':'declined';
    const result=await env.DB.batch([env.DB.prepare("UPDATE calendar_adjustments SET version=version+1,state=?,data=?,updated_at=? WHERE id=? AND version=? AND state='pending'").bind(state,JSON.stringify(record),at,item.id,item.version),...(access?customerAccessGuards(env,access):[])]);
    need(result[0].meta.changes>0,'Terminänderung inzwischen beantwortet. Bitte neu laden.',409);return {ok:true,state};
  }
  need(input.action==='accept','Unbekannte Terminänderung.');need(!isOwner,'Nur der persönlich angemeldete Kunde kann dieser Terminänderung zustimmen.',403);
  need(item.state==='pending','Terminänderung ist bereits abgeschlossen.',409);available(order);
  need(input.confirmed===true,'Bitte dem konkret angezeigten neuen Termin ausdrücklich zustimmen.');
  need(input.snapshotHash===dto(item,order).snapshotHash,'Angezeigter Terminvorschlag verändert. Bitte neu laden.',409);
  need(order.version===input.orderVersion&&JSON.stringify(order.appointment)===JSON.stringify(item.before),'Auftrag oder bisheriger Termin inzwischen geändert. Bitte neu laden.',409);
  await validateBookingCalendar(env,item.after,{synthetic:order.synthetic===true,excludeOrderId:order.id});
  if(env.operations?.validateAppointment)await env.operations.validateAppointment(env,{...order,appointment:item.after});
  const operationId=crypto.randomUUID(),acceptance={at,identity,snapshotHash:input.snapshotHash,confirmed:true},record={...item,acceptance,supersededAt:at};
  const updated={...order,appointment:structuredClone(item.after),operationId,appointmentRevisions:[...(order.appointmentRevisions??[]),{id:item.id,before:item.before,after:item.after,reason:item.reason,proposedAt:item.proposedAt,acceptance,supersededAt:at}]};
  // The pending-state predicate and order version bind the agreement, reservation and proof to one transaction.
  const guard="EXISTS(SELECT 1 FROM orders WHERE id=? AND version=? AND json_extract(data,'$.operationId')=?)";
  const result=await env.DB.batch([
    env.DB.prepare("UPDATE orders SET data=?,version=version+1,updated_at=?,actor=?,action=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM calendar_adjustments WHERE id=? AND version=? AND state='pending') AND EXISTS(SELECT 1 FROM appointments WHERE order_id=? AND start=? AND end=?)").bind(JSON.stringify(updated),at,'customer','Terminänderung persönlich bestätigt; ursprüngliche Vereinbarung erhalten',order.id,order.version,item.id,item.version,order.id,item.before.start,item.before.end),
    env.DB.prepare("UPDATE calendar_adjustments SET state='accepted',version=version+1,data=?,updated_at=? WHERE id=? AND version=? AND state='pending' AND "+guard).bind(JSON.stringify(record),at,item.id,item.version,order.id,order.version+1,operationId),
    ...customerAccessGuards(env,access),
    env.DB.prepare('UPDATE appointments SET start=?,end=? WHERE order_id=? AND '+guard).bind(item.after.start,item.after.end,order.id,order.id,order.version+1,operationId),
    env.DB.prepare("UPDATE jobs SET state='cancelled',detail='Termin persönlich geändert; alte Bestätigung darf nicht versendet werden',updated_at=? WHERE order_id=? AND (kind IN ('appointment-confirmation','reminder') OR kind LIKE 'reminder:%') AND state IN ('queued','failed') AND "+guard).bind(at,order.id,order.id,order.version+1,operationId)
  ]);
  need(result[0].meta.changes>0&&result[1].meta.changes>0,'Terminänderung inzwischen beantwortet oder Auftrag verändert. Bitte neu laden.',409);
  return {ok:true,state:'accepted',appointment:item.after,message:'Neuer Termin persönlich bestätigt. Die ursprüngliche Vereinbarung und diese Terminänderung bleiben gespeichert.'};
}
export async function calendarAdjustmentEndpoint(env,request,identity,isOwner){
  const url=new URL(request.url);
  if(!['/api/calendar/adjustments','/api/calendar/history'].includes(url.pathname))return null;
  await calendarAdjustmentSchema(env);
  if(url.pathname==='/api/calendar/history'){
    need(isOwner,'Nur für den Betreiber vorgesehen.',403);need(request.method==='GET','Methode nicht erlaubt.',405);
    const rows=await env.DB.prepare('SELECT * FROM calendar_entry_history WHERE entry_id=? ORDER BY id DESC').bind(url.searchParams.get('id')).all();
    return Response.json({history:rows.results.map(row=>({...row,before:row.before_data?JSON.parse(row.before_data):null,after:row.after_data?JSON.parse(row.after_data):null,before_data:undefined,after_data:undefined}))});
  }
  if(request.method==='GET'){
    const order=await getOrder(env,url.searchParams.get('orderId'));
    if(!isOwner)await customerAccessRequire(env,order,identity,'read-calendar');
    const adjustments=await calendarAdjustmentData(env,order);if(!isOwner)await customerAccessRequire(env,await getOrder(env,order.id),identity,'read-calendar');
    return Response.json({adjustments});
  }
  need(request.method==='POST','Methode nicht erlaubt.',405);
  try{return Response.json(await change(env,await inputOf(request),identity,isOwner));}
  catch(error){if(!(error instanceof AppError)&&/Terminüberschneidung|Wochenendtag gesperrt|UNIQUE constraint failed: calendar_adjustments/.test(error.message))throw new AppError('Termin oder Freigabe inzwischen verändert. Bitte Kalender neu laden und eine freie Zeit wählen.',409);throw error;}
}
