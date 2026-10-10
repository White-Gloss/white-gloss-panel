import {AppError,need,transition} from '../src/domain.mjs';
import {recordOperationIssue} from '../src/operations.mjs';
import {getOrder,saveOrder,settings} from '../src/worker.mjs';
import {digest} from './auth.mjs';
import {indexCustomerFiles,customerIdentityHashes,customerSourceGuardStatements,assertCustomerSourceActive} from './customer-files.mjs';

const owner=(env,identity)=>need(identity&&digest(identity.trim().toLowerCase())===env.OWNER_EMAIL_SHA256,'Nur der angemeldete Betreiber darf Akten ändern.',403);
const actor=identity=>'owner:'+digest(identity.trim().toLowerCase()).slice(0,16);
const json=value=>JSON.stringify(value);
const bounded=(value,max,label)=>{need(typeof value==='string'&&value.trim().length<=max,label+' ist ungültig.');return value.trim();};
const tableExists=async(env,name)=>Boolean(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(name).first());
export async function recordsLifecycleSchema(env){
  await env.DB.batch([
    'CREATE TABLE IF NOT EXISTS records_revisions(id TEXT PRIMARY KEY,entity_id TEXT NOT NULL,entity_kind TEXT NOT NULL,version INTEGER NOT NULL,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,data TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS records_revisions_entity ON records_revisions(entity_id,at)',
    // A transaction guard fails closed and rolls back all related writes on a lost CAS.
    'CREATE TABLE IF NOT EXISTS records_cas_guard(value INTEGER NOT NULL CHECK(value=1))'
  ].map(sql=>env.DB.prepare(sql)));
}
export async function assertCustomerActive(env,id,synthetic){
  const row=await env.DB.prepare('SELECT * FROM customer_files WHERE id=?').bind(id).first();
  need(row&&Boolean(row.synthetic)===Boolean(synthetic),'Kundenakte nicht gefunden.',404);
  need(!['blocked','anonymized'].includes(JSON.parse(row.data).lifecycle?.status),'Diese Kundenakte ist für weitere Verarbeitung gesperrt. Erst die Sperre mit dokumentiertem Grund aufheben.',409);
  return row;
}
export function assertRecordsAction(order,action){
  const issue=recordOperationIssue(order,action);need(!issue,issue,409);
}
function documents(order){
  const result=[];
  if(order.offer)result.push({key:'offer',label:order.acceptance?'Angenommenes Angebot':'Angebot',signed:Boolean(order.acceptance),at:order.acceptance?.at??order.offer.createdAt,snapshot:{offer:order.offer,acceptance:order.acceptance??null,appointment:order.acceptance?.appointmentOptionId?order.appointment:null}});
  if(order.appointment?.delivery==='Abholung')result.push({key:'pickup',label:'Bestätigter Hol- und Bringservice',signed:true,at:order.acceptance?.at??order.updatedAt,snapshot:order.appointment});
  for(const key of ['intake','return'])if(order[key])result.push({key,label:key==='intake'?'Unterschriebenes Annahmeprotokoll':'Unterschriebenes Rückgabeprotokoll',signed:true,at:order[key].at,snapshot:order[key]});
  for(const key of ['intake','return'])if(order.handovers?.[key]&&!order[key])result.push({key:'handover:'+key,label:'Vom Betrieb unterschriebenes '+(key==='intake'?'Annahmeprotokoll':'Abgabeprotokoll')+' · Kundenbestätigung '+(order.handovers[key].status==='pending'?'offen':order.handovers[key].status),signed:true,at:order.handovers[key].operatorSignedAt,snapshot:order.handovers[key]});
  for(const item of order.amendments??[])if(item.state==='accepted')result.push({key:'amendment:'+item.id,label:'Angenommener Nachtrag: '+item.services,signed:true,at:item.acceptance?.at,snapshot:item});
  if(order.invoice)result.push({key:'invoice',label:'Rechnung',signed:true,at:order.invoice.createdAt??order.completedAt,snapshot:order.invoice,external:true});
  return result.map(item=>({...item,hash:digest(json(item.snapshot)),cancellation:(order.documentCancellations??[]).find(c=>c.documentKey===item.key||c.scope==='whole-agreement'&&(['offer','pickup'].includes(item.key)||item.key.startsWith('amendment:')))??null}));
}
async function related(env,id){
  const vehicles=(await env.DB.prepare('SELECT id,version,data FROM vehicle_files WHERE customer_id=? ORDER BY id').bind(id).all()).results;
  const orders=(await env.DB.prepare('SELECT o.*,f.vehicle_id AS linked_vehicle_id FROM orders o JOIN order_files f ON f.order_id=o.id WHERE f.customer_id=? ORDER BY o.id').bind(id).all()).results.map(r=>({...JSON.parse(r.data),id:r.id,wg:r.wg,version:r.version,status:r.status,linkedVehicleId:r.linked_vehicle_id}));
  const counts={assets:0,archiveFiles:0,messages:0,deliveryRecords:0,tasks:0,calendar:0,calendarAdjustments:0,resultReports:0,resultMaskPreviews:0};
  for(const [table,key,column] of [['assets','assets','order_id'],['customer_messages','messages','order_id'],['protocol_deliveries','deliveryRecords','order_id'],['invoice_mail_deliveries','deliveryRecords','order_id']])if(await tableExists(env,table))counts[key]+=(await env.DB.prepare('SELECT COUNT(*) n FROM '+table+' WHERE '+column+' IN (SELECT order_id FROM order_files WHERE customer_id=?)').bind(id).first()).n;
  for(const [table,key] of [['panel_tasks','tasks'],['calendar_entry_links','calendar']])if(await tableExists(env,table))counts[key]=(await env.DB.prepare('SELECT COUNT(*) n FROM '+table+' WHERE customer_id=? OR vehicle_id IN (SELECT id FROM vehicle_files WHERE customer_id=?) OR order_id IN (SELECT order_id FROM order_files WHERE customer_id=?)').bind(id,id,id).first()).n;
  const snapshots=[],addSnapshot=async(sql,bindings)=>{const value=(await env.DB.prepare(sql).bind(...bindings).first()).snapshot;snapshots.push({sql,bindings,value});};
  let resultReports=[];
  if(await tableExists(env,'result_reports')){
    resultReports=(await env.DB.prepare('SELECT r.order_id,r.version,r.updated_at,o.wg FROM result_reports r JOIN orders o ON o.id=r.order_id WHERE r.order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY r.order_id').bind(id).all()).results;
    counts.resultReports=resultReports.length;
    // Reports and image permissions have their own version. Order versions alone
    // cannot protect a deletion preview against a parallel release or revocation.
    await addSnapshot("SELECT json_group_array(json_object('order',order_id,'version',version,'data',data,'updated',updated_at)) snapshot FROM (SELECT * FROM result_reports WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY order_id)",[id]);
  }
  if(await tableExists(env,'result_mask_previews')){
    counts.resultMaskPreviews=(await env.DB.prepare('SELECT COUNT(*) n FROM result_mask_previews WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?)').bind(id).first()).n;
    await addSnapshot("SELECT json_group_array(json_object('id',id,'order',order_id,'original',original_id,'sourceHash',source_hash,'hash',hash,'data',data,'created',created_at)) snapshot FROM (SELECT * FROM result_mask_previews WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY id)",[id]);
  }
  if(await tableExists(env,'panel_tasks'))await addSnapshot("SELECT json_group_array(json_object('id',id,'version',version,'customer',customer_id,'vehicle',vehicle_id,'order',order_id,'calendar',calendar_id)) snapshot FROM (SELECT * FROM panel_tasks WHERE customer_id=? OR vehicle_id IN (SELECT id FROM vehicle_files WHERE customer_id=?) OR order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY id)",[id,id,id]);
  if(await tableExists(env,'calendar_entry_links'))await addSnapshot("SELECT json_group_array(json_object('id',entry_id,'version',version,'customer',customer_id,'vehicle',vehicle_id,'order',order_id)) snapshot FROM (SELECT l.*,e.version FROM calendar_entry_links l JOIN calendar_entries e ON e.id=l.entry_id WHERE customer_id=? OR vehicle_id IN (SELECT id FROM vehicle_files WHERE customer_id=?) OR order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY entry_id)",[id,id,id]);
  let calendarAdjustments=[];
  if(await tableExists(env,'calendar_adjustments')){
    calendarAdjustments=(await env.DB.prepare('SELECT a.id,a.order_id,a.version,a.state,a.created_at,a.updated_at,o.wg FROM calendar_adjustments a JOIN orders o ON o.id=a.order_id WHERE a.order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY a.id').bind(id).all()).results;
    counts.calendarAdjustments=calendarAdjustments.length;
    await addSnapshot("SELECT json_group_array(json_object('id',id,'version',version,'state',state,'updated',updated_at)) snapshot FROM (SELECT * FROM calendar_adjustments WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY id)",[id]);
  }
  await addSnapshot("SELECT json_group_array(json_object('id',id,'state',state,'updated',updated_at)) snapshot FROM (SELECT * FROM jobs WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY id)",[id]);
  for(const table of ['protocol_deliveries','invoice_mail_deliveries','appointment_confirmations'])if(await tableExists(env,table))await addSnapshot("SELECT json_group_array(json_object('id',job_id,'until',processing_until,'lease',lease_owner)) snapshot FROM (SELECT * FROM "+table+' WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY job_id)',[id]);
  for(const [table,key] of [['assets','id'],['customer_messages','id'],['agreement_documents','asset_id'],['payment_documents','asset_id'],['invoice_originals','asset_id'],['invoice_payment_documents','asset_id']])if(await tableExists(env,table)){
    await addSnapshot("SELECT json_group_array("+key+") snapshot FROM (SELECT "+key+' FROM '+table+' WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) ORDER BY '+key+')',[id]);
    if(key==='asset_id')counts.archiveFiles+=(await env.DB.prepare('SELECT COUNT(*) n FROM '+table+' WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?)').bind(id).first()).n;
  }
  const unsettledJobs=(await env.DB.prepare("SELECT j.id,j.order_id,j.kind,j.state,j.updated_at,o.wg FROM jobs j JOIN orders o ON o.id=j.order_id WHERE j.order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) AND j.state IN ('pending','unknown') ORDER BY j.id").bind(id).all()).results;
  for(const table of ['protocol_deliveries','invoice_mail_deliveries','appointment_confirmations'])if(await tableExists(env,table)){
    const leases=(await env.DB.prepare('SELECT j.id,j.order_id,j.kind,j.state,j.updated_at,o.wg,d.processing_until FROM '+table+' d JOIN jobs j ON j.id=d.job_id JOIN orders o ON o.id=j.order_id WHERE d.order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) AND d.processing_until>?').bind(id,Date.now()).all()).results;
    for(const lease of leases)if(!unsettledJobs.some(j=>j.id===lease.id))unsettledJobs.push({...lease,state:'processing'});
  }
  return {vehicles,orders,counts,snapshots,unsettledJobs,calendarAdjustments,resultReports};
}
const proofFor=(version,links)=>({version,vehicles:links.vehicles.map(v=>[v.id,v.version]),orders:links.orders.map(o=>[o.id,o.version,o.linkedVehicleId]),counts:links.counts,snapshots:links.snapshots.map(s=>s.value)});
export async function customerLifecyclePreview(env,id,identity){
  owner(env,identity);await indexCustomerFiles(env);
  const customer=await env.DB.prepare('SELECT * FROM customer_files WHERE id=?').bind(id).first();need(customer,'Kundenakte nicht gefunden.',404);
  const data=JSON.parse(customer.data),links=await related(env,id);
  const docs=[...links.orders.flatMap(order=>documents(order).map(d=>({orderId:order.id,wg:order.wg,key:d.key,label:d.label,at:d.at,cancelled:Boolean(d.cancellation)}))),...links.calendarAdjustments.map(a=>({orderId:a.order_id,wg:a.wg,key:'calendarAdjustment:'+a.id,label:'Terminvorschlag / Änderung · '+({pending:'Kundenzustimmung offen',accepted:'vom Kunden angenommen',withdrawn:'zurückgezogen',declined:'vom Kunden abgelehnt'})[a.state],at:a.updated_at,cancelled:['withdrawn','declined'].includes(a.state)}))];
  docs.push(...links.resultReports.map(report=>({orderId:report.order_id,wg:report.wg,key:'resultReport:'+report.order_id,label:'Ergebnisbericht und Bildfreigaben · Version '+report.version,at:report.updated_at,cancelled:false})));
  const canDelete=links.orders.length===0&&links.counts.tasks===0&&links.counts.calendar===0&&links.counts.resultReports===0&&links.counts.resultMaskPreviews===0;
  const reasons=[];
  if(links.orders.length)reasons.push('Verknüpfte Aufträge enthalten Originalanfragen und gegebenenfalls Vereinbarungen. Eine pauschale Löschung ist ohne Einzelfallprüfung der Dokumentarten, Fristbeginne und offenen Ansprüche gesperrt.');
  if(docs.some(d=>d.key==='invoice'))reasons.push('Rechnungskopien werden nach § 14b UStG grundsätzlich acht Jahre ab Jahresende aufbewahrt; steuerliche Verlängerungen bleiben möglich.');
  if(docs.length)reasons.push('Geschäftsbriefe und Buchungsbelege können nach § 147 AO sechs bzw. acht Jahre aufbewahrungspflichtig sein. Unterschriften allein bestimmen keine pauschale Löschfrist.');
  if(links.counts.tasks||links.counts.calendar)reasons.push('Verknüpfte Aufgaben oder Kalendereinträge zuerst einzeln prüfen und ihre Zuordnung entfernen.');
  if(links.counts.resultReports||links.counts.resultMaskPreviews)reasons.push('Ergebnisberichte, Bildfreigaben und Maskierungsnachweise bleiben mit den Originalaufnahmen im gesperrten Auftragsarchiv erhalten. Stammdaten-Anonymisierung löscht diese Nachweise nicht.');
  const proof=proofFor(customer.version,links);
  return {id,version:customer.version,name:data.name,lifecycle:data.lifecycle??{status:'active'},previewToken:digest(json(proof)),canDelete,canAnonymize:true,canBlock:true,vehicles:links.vehicles.map(v=>({id:v.id,...JSON.parse(v.data)})),orders:links.orders.map(o=>({id:o.id,wg:o.wg,status:o.status,version:o.version})),documents:docs,counts:links.counts,unsettledJobs:links.unsettledJobs,reasons,notice:'Stammdaten-Anonymisierung entfernt Kontaktfelder und freie Hinweise aus der Kunden-/Fahrzeugakte. Identifizierende Originalaufträge, Dokumente und gesetzlich benötigte Belege bleiben im gesperrten Archiv erhalten. Dies ist keine vollständige Anonymisierung des Bestands. Sicherungen können frühere Daten enthalten. Ihre Bereinigung muss im bestehenden Betriebsweg geprüft werden; bei Wiederherstellung muss die Sperre erneut angewandt werden.',sources:[{label:'§ 147 AO',url:'https://www.gesetze-im-internet.de/ao_1977/__147.html'},{label:'§ 14b UStG',url:'https://www.gesetze-im-internet.de/ustg_1980/__14b.html'},{label:'Art. 17 und 18 DSGVO',url:'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32016R0679'}]};
}
function revision(env,{id=crypto.randomUUID(),entityId,kind,version,at,identity,action,reason,data}){return env.DB.prepare('INSERT INTO records_revisions VALUES(?,?,?,?,?,?,?,?,?)').bind(id,entityId,kind,version,at,actor(identity),action,reason,json(data));}
export async function changeCustomerLifecycle(env,input,identity){
  owner(env,identity);const preview=await customerLifecyclePreview(env,input.id,identity);
  need(preview.version===input.version&&preview.previewToken===input.previewToken,'Verknüpfte Daten wurden geändert. Löschvorschau bitte erneut öffnen.',409);
  need(['delete','block','anonymize','restore'].includes(input.mode),'Unbekannter Aktenvorgang.');
  const reason=bounded(input.reason,2000,'Grund');need(reason,'Bitte den Grund dokumentieren.');need(input.confirmed===true,'Betroffene Daten und Folgen bitte ausdrücklich bestätigen.');
  if(input.mode==='delete')need(preview.canDelete,'Verknüpfte Daten verhindern endgültiges Löschen. Sperrung oder Stammdaten-Anonymisierung verwenden.',409);
  if(input.mode==='restore')need(preview.lifecycle.status==='blocked','Nur gesperrte, nicht anonymisierte Akten können wieder freigegeben werden.',409);
  if(input.mode==='block')need(preview.lifecycle.status!=='anonymized','Eine anonymisierte Akte kann nicht über eine neue Sperre wieder freigeschaltet werden.',409);
  const links=await related(env,input.id),row=await env.DB.prepare('SELECT * FROM customer_files WHERE id=?').bind(input.id).first(),data=JSON.parse(row.data),at=new Date().toISOString(),operationId=crypto.randomUUID();
  need(digest(json(proofFor(row.version,links)))===input.previewToken,'Verknüpfte Daten wurden verändert. Bitte neue Vorschau öffnen.',409);
  if(input.mode!=='restore')need(links.unsettledJobs.length===0,'Versand läuft oder sein Ergebnis ist ungeklärt. Vor Sperrung oder Datenlöschung die in der Vorschau genannten Vorgänge prüfen.',409);
  const status=({delete:'deleted',block:'blocked',anonymize:'anonymized',restore:'active'})[input.mode];
  const next={...data,lifecycle:{status,at,reason,actor:actor(identity),operationId,identityHashes:[...new Set([...(data.lifecycle?.identityHashes??[]),...customerIdentityHashes(data,Boolean(row.synthetic))])]}};
  if(input.mode==='anonymize')Object.assign(next,{name:'Anonymisierte Kundenakte',email:'',phone:'',address:'',notes:''});
  const statements=[env.DB.prepare('UPDATE customer_files SET data=?,version=version+1 WHERE id=? AND version=?').bind(json(next),input.id,input.version),env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END')];
  // New orders are indexed before every preview. A concurrent insertion cannot disappear from its scope.
  statements.push(env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM orders o LEFT JOIN order_files f ON f.order_id=o.id WHERE o.synthetic=? AND f.order_id IS NULL) THEN 1 ELSE 0 END').bind(row.synthetic));
  for(const snapshot of links.snapshots)statements.push(env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN snapshot=? THEN 1 ELSE 0 END FROM ('+snapshot.sql+')').bind(snapshot.value,...snapshot.bindings));
  // All linked order versions are checked inside the same transaction. Any stale order rolls back the customer edit.
  for(const order of links.orders){
    const updated={...order};delete updated.linkedVehicleId;if(status==='active')delete updated.recordsRestriction;else updated.recordsRestriction={status,at,reason,customerId:input.id};
    statements.push(env.DB.prepare('UPDATE orders SET data=?,version=version+1,updated_at=?,actor=?,action=? WHERE id=? AND version=?').bind(json(updated),at,actor(identity),'Kundenakte '+status,order.id,order.version),env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'));
    statements.push(env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM order_files WHERE order_id=? AND customer_id=? AND vehicle_id=?) THEN 1 ELSE 0 END').bind(order.id,input.id,order.linkedVehicleId));
  }
  if(status!=='active')statements.push(env.DB.prepare("UPDATE jobs SET state='cancelled',detail='Kundenakte gesperrt; weiterer Versand angehalten',updated_at=? WHERE order_id IN (SELECT order_id FROM order_files WHERE customer_id=?) AND state IN ('queued','failed')").bind(at,input.id));
  // Detect relationships added since the displayed preview, including otherwise unversioned link rows.
  statements.push(env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN (SELECT COUNT(*) FROM order_files WHERE customer_id=?)=? AND (SELECT COUNT(*) FROM vehicle_files WHERE customer_id=?)=? THEN 1 ELSE 0 END').bind(input.id,links.orders.length,input.id,links.vehicles.length));
  for(const [table,key] of [['panel_tasks','tasks'],['calendar_entry_links','calendar']])if(await tableExists(env,table))statements.push(env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN (SELECT COUNT(*) FROM '+table+' WHERE customer_id=? OR vehicle_id IN (SELECT id FROM vehicle_files WHERE customer_id=?) OR order_id IN (SELECT order_id FROM order_files WHERE customer_id=?))=? THEN 1 ELSE 0 END').bind(input.id,input.id,input.id,preview.counts[key]));
  if(input.mode==='anonymize'||input.mode==='delete'){
    statements.push(env.DB.prepare("UPDATE file_audit SET data=? WHERE entity_id=? OR entity_id IN (SELECT id FROM vehicle_files WHERE customer_id=?)").bind(json({redacted:true,at,reason:'Stammdaten entfernt; Änderungsvorgang bleibt nachweisbar'}),input.id,input.id));
    for(const v of links.vehicles)statements.push(env.DB.prepare('UPDATE vehicle_files SET data=?,version=version+1 WHERE id=? AND version=?').bind(json({name:'Anonymisierte Fahrzeugakte',plate:'',vin:'',notes:''}),v.id,v.version),env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'));
  }
  if(input.mode==='delete')statements.push(env.DB.prepare('DELETE FROM vehicle_files WHERE customer_id=?').bind(input.id),env.DB.prepare('DELETE FROM customer_files WHERE id=? AND version=?').bind(input.id,input.version+1));
  statements.push(revision(env,{entityId:input.id,kind:'customer',version:input.version+1,at,identity,action:input.mode,reason,data:{status,affected:{vehicles:links.vehicles.length,orders:links.orders.length,...links.counts}}}),env.DB.prepare('DELETE FROM records_cas_guard'));
  try{await env.DB.batch(statements);}catch(error){if(String(error.message).includes('records_cas_guard')||String(error.message).includes('CHECK constraint'))throw new AppError('Daten wurden während der Änderung bearbeitet. Bitte neue Vorschau öffnen.',409);throw error;}
  return {ok:true,mode:input.mode,id:input.id,status,version:input.version+1};
}
export async function projectRecords(env,id,identity){
  owner(env,identity);const order=await getOrder(env,id),history=(await env.DB.prepare("SELECT id,version,at,actor,action,reason,data FROM records_revisions WHERE entity_id=? ORDER BY at DESC,id DESC LIMIT 100").bind(id).all()).results;
  return {id,version:order.version,status:order.status,details:order.projectDetails??{title:order.wg,customerName:order.source.name??'',vehicle:order.source.vehicle??'',plate:order.intake?.plate??order.source.plate??'',phone:order.source.phone??'',email:order.source.email??'',address:order.source.address??'',notes:order.source.note??'',workSteps:[]},documents:documents(order).map(({snapshot,...item})=>item),history:history.map(r=>({...r,data:JSON.parse(r.data)})),replacementId:order.replacementOrderId??null};
}
function projectDetails(input){
  need(input&&typeof input==='object'&&!Array.isArray(input),'Projektdaten fehlen.');
  const limits={title:200,customerName:180,vehicle:180,plate:80,phone:80,email:180,address:600,notes:4000};
  need(Object.keys(input).every(k=>Object.hasOwn(limits,k)||k==='workSteps'),'Geschützte Projektfelder können hier nicht geändert werden.');
  const data=Object.fromEntries(Object.entries(limits).map(([key,max])=>[key,bounded(input[key]??'',max,key)]));
  need(data.title&&data.customerName&&data.vehicle,'Projektname, Kundenname und Fahrzeug fehlen.');need(!data.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email),'E-Mail ungültig.');
  need(Array.isArray(input.workSteps)&&input.workSteps.length<=100,'Höchstens 100 Arbeitsschritte.');
  const ids=new Set();data.workSteps=input.workSteps.map(step=>{need(step&&typeof step==='object'&&Object.keys(step).every(k=>['id','title','note','done'].includes(k)),'Arbeitsschritt ungültig.');need(/^[a-zA-Z0-9-]{1,80}$/.test(step.id)&&!ids.has(step.id),'Arbeitsschritt-ID fehlt oder ist doppelt.');ids.add(step.id);need(typeof step.done==='boolean','Arbeitsstatus ungültig.');const title=bounded(step.title,300,'Arbeitsschritt');need(title,'Arbeitsschritt braucht eine Bezeichnung.');return {id:step.id,title,note:bounded(step.note??'',2000,'Arbeitsnotiz'),done:step.done};});return data;
}
export async function editProject(env,input,identity){
  owner(env,identity);const order=await getOrder(env,input.id);need(order.version===input.version,'Auftrag wurde geändert. Bitte neu öffnen.',409);
  need(!['blocked','anonymized'].includes(order.recordsRestriction?.status),'Kundenakte ist gesperrt. Projektstammdaten erst nach dokumentierter Prüfung der Sperre ändern; interne Aktennotizen bleiben möglich.',409);
  const reason=bounded(input.reason,2000,'Änderungsgrund');need(reason,'Bitte den Änderungsgrund dokumentieren.');const details=projectDetails(input.details),at=new Date().toISOString(),operationId=crypto.randomUUID();
  const before=(await projectRecords(env,order.id,identity)).details,updated={...order,projectDetails:details,operationId};
  const extra=[env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),revision(env,{entityId:order.id,kind:'project',version:order.version+1,at,identity,action:'projectEdit',reason,data:{before,after:details}}),env.DB.prepare('DELETE FROM records_cas_guard')];
  try{return {ok:true,order:await saveOrder(env,updated,order.version,'Projektangaben und Arbeitsschritte korrigiert',actor(identity),extra)};}catch(error){if(String(error.message).includes('CHECK constraint'))throw new AppError('Auftrag wurde geändert. Bitte neu öffnen.',409);throw error;}
}
export async function cancelDocument(env,input,identity){
  owner(env,identity);const order=await getOrder(env,input.id);need(order.version===input.version,'Auftrag wurde geändert. Bitte neu öffnen.',409);
  const document=documents(order).find(d=>d.key===input.documentKey);need(document,'Dokument nicht gefunden.',404);need(!document.external,'Rechnungen müssen im vorhandenen Rechnungsweg mit einem passenden Korrekturbeleg berichtigt werden.',409);need(!document.cancellation,'Dokument wurde bereits storniert.',409);
  need(document.hash===input.documentHash,'Dokument wurde geändert. Bitte erneut prüfen.',409);const reason=bounded(input.reason,2000,'Stornogrund');need(reason,'Stornogrund fehlt.');need(input.confirmed===true,'Stornofolgen bitte ausdrücklich bestätigen.');
  await indexCustomerFiles(env);const link=await env.DB.prepare('SELECT customer_id FROM order_files WHERE order_id=?').bind(order.id).first(),links=link?await related(env,link.customer_id):null;
  need(!links?.unsettledJobs.some(job=>job.order_id===order.id),'Versand läuft oder sein Ergebnis ist ungeklärt. Vor dem Storno den Versandstatus prüfen.',409);
  const at=new Date().toISOString(),operationId=crypto.randomUUID(),cancellation={id:crypto.randomUUID(),documentKey:document.key,originalHash:document.hash,originalVersion:order.version,at,reason,actor:actor(identity),customerCommunication:'pending'};
  const contract=['offer','pickup'].includes(document.key)||document.key.startsWith('amendment:');
  let updated=structuredClone(order);
  if(contract){need(!order.intake&&!order.return&&!order.invoice&&!(order.payments??[]).length,'Vertrag bereits begonnen oder abgerechnet. Originalvereinbarung bleibt erhalten; Korrektur der abgewickelten Leistung bzw. Rechnung muss gesondert abgestimmt werden.',409);updated=transition(order,'cancel',{reason},at);cancellation.scope='whole-agreement';}
  else cancellation.scope='document-only';
  updated.documentCancellations=[...(order.documentCancellations??[]),cancellation];updated.operationId=operationId;
  const extra=[env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'),...(links?.snapshots??[]).map(snapshot=>env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN snapshot=? THEN 1 ELSE 0 END FROM ('+snapshot.sql+')').bind(snapshot.value,...snapshot.bindings)),revision(env,{entityId:order.id,kind:'document',version:order.version+1,at,identity,action:'documentCancel',reason,data:{...cancellation,original:document.snapshot}})];
  if(contract)extra.push(env.DB.prepare('DELETE FROM appointments WHERE order_id=?').bind(order.id),env.DB.prepare('UPDATE offer_tokens SET revoked=1 WHERE order_id=?').bind(order.id));
  if(await tableExists(env,'handover_tokens'))extra.push(env.DB.prepare('UPDATE handover_tokens SET revoked=1 WHERE order_id=?').bind(order.id));
  extra.push(env.DB.prepare("UPDATE jobs SET state='cancelled',detail='Dokumentstorno: weiterer Versand gesperrt; Abstimmung offen',updated_at=? WHERE order_id=? AND state IN ('queued','failed')").bind(at,order.id),env.DB.prepare('DELETE FROM records_cas_guard'));
  try{return {ok:true,order:await saveOrder(env,updated,order.version,'Dokument storniert: '+document.label,actor(identity),extra),notice:contract?'Gesamte Vereinbarung storniert. Kundenabstimmung bleibt offen; es wurde keine Nachricht versendet.':'Originalbeleg mit Stornovermerk erhalten. Status, bereits dokumentierte Leistungen und Zahlungen bleiben unverändert. Für Ersatz ist eine neue persönliche Freigabe nötig.'};}catch(error){if(String(error.message).includes('CHECK constraint'))throw new AppError('Auftrag wurde geändert. Bitte neu öffnen.',409);throw error;}
}
export async function replacementProject(env,input,identity){
  owner(env,identity);const order=await getOrder(env,input.id);need(order.version===input.version,'Auftrag wurde geändert. Bitte neu öffnen.',409);need(order.documentCancellations?.length||order.status==='Storniert','Zuerst den ursprünglichen Vorgang mit Grund stornieren.',409);
  if(order.replacementOrderId)return {ok:true,id:order.replacementOrderId,replayed:true};
  const reason=bounded(input.reason,2000,'Ersatzgrund');need(reason,'Ersatzgrund fehlt.');
  await indexCustomerFiles(env);const link=await env.DB.prepare('SELECT * FROM order_files WHERE order_id=?').bind(order.id).first();if(link)await assertCustomerActive(env,link.customer_id,order.synthetic);
  if(!order.synthetic)need((await settings(env)).numberAudit,'WG-Nummernstand muss zuerst geprüft sein.',409);
  const id=crypto.randomUUID(),at=new Date().toISOString(),source={...structuredClone(order.source)};delete source.id;delete source.raw;source.reviewConsent=false;
  await assertCustomerSourceActive(env,source,order.synthetic);
  const replacement={id,source,synthetic:order.synthetic===true,status:'Preise prüfen',notes:[],payments:[],createdAt:at,updatedAt:at,replaces:{id:order.id,wg:order.wg,version:order.version,reason,at},projectDetails:order.projectDetails?{...structuredClone(order.projectDetails),workSteps:order.projectDetails.workSteps.map(s=>({...s,done:false}))}:undefined};
  const updated={...order,replacementOrderId:id},statements=[...customerSourceGuardStatements(env,source,order.synthetic),env.DB.prepare('UPDATE orders SET data=?,version=version+1,updated_at=?,actor=?,action=? WHERE id=? AND version=?').bind(json(updated),at,actor(identity),'Ersatzvorgang angelegt',order.id,order.version),env.DB.prepare('INSERT INTO records_cas_guard SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END')];
  if(order.synthetic)statements.push(env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,1)').bind(id,'TEST-'+id.slice(0,8),replacement.status,json(replacement),at,actor(identity),'Ersatzentwurf ohne übertragene Freigaben'));
  else statements.push(env.DB.prepare("UPDATE sequences SET value=value+1 WHERE name='WG'"),env.DB.prepare("INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) SELECT ?,printf('WG-%06d',value),?,?,?,?,?,0 FROM sequences WHERE name='WG'").bind(id,replacement.status,json(replacement),at,actor(identity),'Ersatzentwurf ohne übertragene Freigaben'));
  if(link)statements.push(env.DB.prepare('INSERT INTO order_files(order_id,customer_id,vehicle_id) VALUES(?,?,?)').bind(id,link.customer_id,link.vehicle_id));
  statements.push(revision(env,{entityId:order.id,kind:'project',version:order.version+1,at,identity,action:'replacement',reason,data:{replacementId:id}}),env.DB.prepare('DELETE FROM records_cas_guard'));
  try{await env.DB.batch(statements);}catch(error){if(String(error.message).includes('CHECK constraint'))throw new AppError('Auftrag wurde geändert. Bitte neu öffnen.',409);throw error;}
  return {ok:true,id,order:await getOrder(env,id)};
}
export async function recordsLifecycleEndpoint(env,request,identity){
  const url=new URL(request.url);if(url.pathname!=='/api/records-lifecycle')return null;owner(env,identity);
  if(request.method==='GET'){const kind=url.searchParams.get('kind');need(['customer','project'].includes(kind),'Unbekannte Aktenansicht.');return Response.json(kind==='customer'?await customerLifecyclePreview(env,url.searchParams.get('id'),identity):await projectRecords(env,url.searchParams.get('id'),identity));}
  need(request.method==='POST','Methode nicht erlaubt.',405);need(request.headers.get('origin')===env.PANEL_ORIGIN&&request.headers.get('content-type')?.startsWith('application/json'),'Ungültiger Ursprung oder Inhalt.',403);
  const raw=await request.text();need(raw.length<=300000,'Eingabe zu groß.',413);let input;try{input=JSON.parse(raw);}catch{throw new AppError('Ungültige JSON-Eingabe.');}need(input&&typeof input==='object'&&!Array.isArray(input),'Ungültige Eingabe.');
  const action=({customerLifecycle:changeCustomerLifecycle,projectEdit:editProject,documentCancel:cancelDocument,replacement:replacementProject})[input.action];need(action,'Unbekannter Aktenvorgang.');return Response.json(await action(env,input,identity));
}
