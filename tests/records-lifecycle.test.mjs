import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {init,getOrder} from '../src/worker.mjs';
import {digest} from '../server/auth.mjs';
import {customerFilesSchema,customerFiles,indexCustomerFiles,updateCustomerFile,assertCustomerSourceActive,customerSourceGuardStatements} from '../server/customer-files.mjs';
import {recordsLifecycleSchema,customerLifecyclePreview,changeCustomerLifecycle,projectRecords,editProject,cancelDocument,replacementProject,recordsLifecycleEndpoint,assertRecordsAction} from '../server/records-lifecycle.mjs';

const identity='owner@example.invalid',origin='https://panel.example.invalid';
async function fixture(t){
  const env={DB:new PanelDatabase(':memory:'),OWNER_EMAIL_SHA256:digest(identity),PANEL_ORIGIN:origin};t.after(()=>env.DB.close());await init(env);await customerFilesSchema(env);await recordsLifecycleSchema(env);
  const add=async overrides=>{const id=crypto.randomUUID(),at='2026-10-09T12:00:00.000Z',o={id,wg:'TEST-'+id,version:1,synthetic:true,status:'Termin verbindlich',createdAt:at,source:{name:'TEST · Marie Muster',vehicle:'TEST · Auto',email:'test@example.invalid',phone:'+49 111 111111',address:'Testweg 1'},offer:{services:'Innenpflege',totalCents:10000,pickupCents:1000},acceptance:{at,signature:'synthetic-fixture',snapshotHash:'a'.repeat(64)},appointment:{start:'2026-11-02T09:00:00.000Z',end:'2026-11-02T10:00:00.000Z',delivery:'Abholung',location:'Testweg 1'},notes:[],payments:[],...overrides};await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,1)').bind(id,o.wg,o.status,JSON.stringify(o),at,'test','synthetic fixture').run();return o;};
  return {env,add};
}
test('customer deletion previews dependencies, blocks linked originals and anonymizes only master data',async t=>{
  const {env,add}=await fixture(t),order=await add({invoice:{id:'TEST-INVOICE'}});let files=await customerFiles(env,true),c=files.customers[0];
  const preview=await customerLifecyclePreview(env,c.id,identity);assert.equal(preview.canDelete,false);assert.equal(preview.orders[0].id,order.id);assert.ok(preview.documents.some(d=>d.key==='invoice'));assert.match(preview.reasons.join(' '),/acht Jahre/);
  await assert.rejects(changeCustomerLifecycle(env,{...preview,mode:'delete',reason:'TEST',confirmed:true},identity),/Verknüpfte Daten/);
  await changeCustomerLifecycle(env,{...preview,mode:'anonymize',reason:'TEST · Datenminimierung',confirmed:true},identity);
  files=await customerFiles(env,true);c=files.customers[0];assert.equal(c.name,'Anonymisierte Kundenakte');assert.equal(c.email,'');assert.equal(c.lifecycle.status,'anonymized');assert.equal(files.vehicles[0].plate,'');
  const saved=await getOrder(env,order.id);assert.deepEqual(saved.source,order.source);assert.deepEqual(saved.acceptance,order.acceptance);assert.equal(saved.recordsRestriction.status,'anonymized');
  await assert.rejects(updateCustomerFile(env,{kind:'customer',id:c.id,version:c.version,data:{name:'Override'} }),/gesperrt/);
  assert.throws(()=>assertRecordsAction(saved,'payment'),/gesperrt/);assert.doesNotThrow(()=>assertRecordsAction(saved,'note'));
  const project=await projectRecords(env,order.id,identity);await assert.rejects(editProject(env,{id:order.id,version:saved.version,reason:'TEST · Erneute Datenbefüllung',details:project.details},identity),/gesperrt/);
});
test('standalone customers can be deleted only with a fresh exact dependency preview',async t=>{
  const {env}=await fixture(t),id='standalone-test';await env.DB.prepare('INSERT INTO customer_files(id,data,synthetic) VALUES(?,?,1)').bind(id,JSON.stringify({name:'TEST Alone',email:''})).run();
  const preview=await customerLifecyclePreview(env,id,identity);assert.equal(preview.canDelete,true);
  await env.DB.prepare('INSERT INTO vehicle_files(id,customer_id,data) VALUES(?,?,?)').bind('new-vehicle',id,'{"name":"TEST"}').run();
  await assert.rejects(changeCustomerLifecycle(env,{...preview,mode:'delete',reason:'TEST',confirmed:true},identity),/geändert|verändert/);
  const fresh=await customerLifecyclePreview(env,id,identity);await changeCustomerLifecycle(env,{...fresh,mode:'delete',reason:'TEST',confirmed:true},identity);
  assert.equal(await env.DB.prepare('SELECT * FROM customer_files WHERE id=?').bind(id).first(),null);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM records_revisions WHERE entity_id=?').bind(id).first()).n,1);
});
test('customer lifecycle is owner-only, checks origin and refuses unconfirmed destructive input',async t=>{
  const {env,add}=await fixture(t);await add();const c=(await customerFiles(env,true)).customers[0];
  await assert.rejects(customerLifecyclePreview(env,c.id,'foreign@example.invalid'),e=>e.status===403);
  await assert.rejects(recordsLifecycleEndpoint(env,new Request(origin+'/api/records-lifecycle',{method:'POST',headers:{origin:'https://foreign.invalid','Content-Type':'application/json'},body:'{}'}),identity),e=>e.status===403);
  const p=await customerLifecyclePreview(env,c.id,identity);await assert.rejects(changeCustomerLifecycle(env,{...p,mode:'block',reason:'TEST'},identity),/bestätigen/);
});
test('project edits work in paid phase, retain immutable records and audit before/after with CAS',async t=>{
  const {env,add}=await fixture(t),o=await add({status:'Bezahlt',payments:[{amountCents:10000,method:'Bar'}],intake:{at:'2026-10-08',signature:'original'},return:{at:'2026-10-09',signature:'original'}}),view=await projectRecords(env,o.id,identity);
  const details={...view.details,vehicle:'TEST korrigiert',workSteps:[{id:'step-1',title:'Felgen reinigen',note:'TEST',done:true}]};
  const result=await editProject(env,{id:o.id,version:o.version,reason:'TEST · Schreibfehler',details},identity);assert.equal(result.order.status,'Bezahlt');assert.deepEqual(result.order.source,o.source);assert.deepEqual(result.order.offer,o.offer);assert.deepEqual(result.order.payments,o.payments);assert.deepEqual(result.order.return,o.return);assert.equal(result.order.projectDetails.vehicle,'TEST korrigiert');
  await assert.rejects(editProject(env,{id:o.id,version:o.version,reason:'stale',details},identity),e=>e.status===409);
  const history=(await projectRecords(env,o.id,identity)).history;assert.equal(history.length,1);assert.equal(history[0].data.before.vehicle,o.source.vehicle);assert.equal(history[0].data.after.vehicle,'TEST korrigiert');
  await assert.rejects(editProject(env,{id:o.id,version:result.order.version,reason:'forgery',details:{...details,offer:{totalCents:1}}},identity),/Geschützte/);
});
test('cancellation preserves signed offer and pickup, releases appointment and makes replacement a fresh draft',async t=>{
  const {env,add}=await fixture(t),o=await add();await env.DB.prepare('INSERT INTO appointments VALUES(?,?,?)').bind(o.id,o.appointment.start,o.appointment.end).run();
  const view=await projectRecords(env,o.id,identity),d=view.documents.find(d=>d.key==='pickup');
  const result=await cancelDocument(env,{id:o.id,version:o.version,documentKey:d.key,documentHash:d.hash,reason:'TEST · Kundenabstimmung',confirmed:true},identity),saved=result.order;
  assert.equal(saved.status,'Storniert');assert.deepEqual(saved.appointment,o.appointment);assert.deepEqual(saved.offer,o.offer);assert.deepEqual(saved.acceptance,o.acceptance);assert.equal(await env.DB.prepare('SELECT * FROM appointments WHERE order_id=?').bind(o.id).first(),null);assert.equal(saved.documentCancellations[0].reason,'TEST · Kundenabstimmung');
  const replacement=await replacementProject(env,{id:o.id,version:saved.version,reason:'TEST · Neuer Termin'},identity),draft=replacement.order;assert.equal(draft.status,'Preise prüfen');assert.equal(draft.offer,undefined);assert.equal(draft.acceptance,undefined);assert.equal(draft.appointment,undefined);assert.deepEqual(draft.payments,[]);assert.equal(draft.replaces.id,o.id);
  const original=await getOrder(env,o.id),again=await replacementProject(env,{id:o.id,version:original.version,reason:'TEST'},identity);assert.equal(again.id,draft.id);assert.equal(again.replayed,true);
});
test('signed protocol gets an immutable cancellation annotation without changing finance or workflow history',async t=>{
  const {env,add}=await fixture(t),o=await add({status:'Bezahlt',return:{at:'2026-10-09T10:00:00.000Z',signature:'TEST-original'},payments:[{amountCents:10000}]});const view=await projectRecords(env,o.id,identity),d=view.documents.find(d=>d.key==='return');
  const result=await cancelDocument(env,{id:o.id,version:o.version,documentKey:d.key,documentHash:d.hash,reason:'TEST · Fehler im Dokument',confirmed:true},identity);
  assert.equal(result.order.status,'Bezahlt');assert.deepEqual(result.order.return,o.return);assert.deepEqual(result.order.payments,o.payments);assert.throws(()=>assertRecordsAction(result.order,'payment'),/storniert/);
  const offer=(await projectRecords(env,o.id,identity)).documents.find(d=>d.key==='offer');await assert.rejects(cancelDocument(env,{id:o.id,version:result.order.version,documentKey:'offer',documentHash:offer.hash,reason:'TEST',confirmed:true},identity),/begonnen oder abgerechnet/);
});
test('transactional CAS rolls back a losing project revision, not only the order write',async t=>{
  const {env,add}=await fixture(t),o=await add(),view=await projectRecords(env,o.id,identity),input={id:o.id,version:o.version,reason:'TEST concurrent',details:view.details};
  const results=await Promise.allSettled([editProject(env,input,identity),editProject(env,input,identity)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM records_revisions WHERE entity_id=?').bind(o.id).first()).n,1);assert.equal((await getOrder(env,o.id)).version,2);
});
test('pending or unknown delivery blocks restriction, whereas queued work is cancelled atomically',async t=>{
  const {env,add}=await fixture(t),o=await add(),c=(await customerFiles(env,true)).customers[0];
  await env.DB.prepare('INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('mail-test',o.id,'offer','pending',o.createdAt,o.createdAt).run();
  let p=await customerLifecyclePreview(env,c.id,identity);assert.equal(p.unsettledJobs[0].kind,'offer');await assert.rejects(changeCustomerLifecycle(env,{...p,mode:'block',reason:'TEST',confirmed:true},identity),/Versand läuft/);
  await env.DB.prepare("UPDATE jobs SET state='unknown' WHERE id='mail-test'").run();p=await customerLifecyclePreview(env,c.id,identity);await assert.rejects(changeCustomerLifecycle(env,{...p,mode:'anonymize',reason:'TEST',confirmed:true},identity),/ungeklärt/);
  await env.DB.prepare("UPDATE jobs SET state='queued' WHERE id='mail-test'").run();p=await customerLifecyclePreview(env,c.id,identity);await changeCustomerLifecycle(env,{...p,mode:'block',reason:'TEST',confirmed:true},identity);assert.equal((await env.DB.prepare("SELECT state FROM jobs WHERE id='mail-test'").first()).state,'cancelled');
});
test('active delivery lease prevents restriction even before the job is marked pending',async t=>{
  const {env,add}=await fixture(t),o=await add(),c=(await customerFiles(env,true)).customers[0];
  await env.DB.prepare('CREATE TABLE appointment_confirmations(job_id TEXT,order_id TEXT,processing_until INTEGER,lease_owner TEXT)').run();await env.DB.prepare('INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('lease-test',o.id,'appointment-confirmation','queued',o.createdAt,o.createdAt).run();await env.DB.prepare('INSERT INTO appointment_confirmations VALUES(?,?,?,?)').bind('lease-test',o.id,Date.now()+60000,'test-lease').run();
  const p=await customerLifecyclePreview(env,c.id,identity);assert.equal(p.unsettledJobs[0].state,'processing');await assert.rejects(changeCustomerLifecycle(env,{...p,mode:'block',reason:'TEST',confirmed:true},identity),/Versand/);
});
test('same-count calendar relinking invalidates deletion preview and anonymized identity cannot be recreated',async t=>{
  const {env,add}=await fixture(t),o=await add(),c=(await customerFiles(env,true)).customers[0];
  await env.DB.prepare('CREATE TABLE calendar_entry_links(entry_id TEXT PRIMARY KEY,customer_id TEXT,vehicle_id TEXT,order_id TEXT)').run();await env.DB.prepare('INSERT INTO calendar_entries(id,synthetic,kind,title,start,end,updated_at) VALUES(?,1,?,?,?,?,?)').bind('calendar-test','appointment','TEST','2026-10-12T09:00:00Z','2026-10-12T10:00:00Z',o.createdAt).run();await env.DB.prepare('INSERT INTO calendar_entry_links VALUES(?,?,NULL,NULL)').bind('calendar-test',c.id).run();
  const p=await customerLifecyclePreview(env,c.id,identity);await env.DB.prepare('UPDATE calendar_entry_links SET order_id=? WHERE entry_id=?').bind(o.id,'calendar-test').run();await assert.rejects(changeCustomerLifecycle(env,{...p,mode:'anonymize',reason:'TEST',confirmed:true},identity),/geändert|verändert/);
  const fresh=await customerLifecyclePreview(env,c.id,identity);await changeCustomerLifecycle(env,{...fresh,mode:'anonymize',reason:'TEST',confirmed:true},identity);await assert.rejects(assertCustomerSourceActive(env,{email:o.source.email},true),/gesperrt oder anonymisiert/);await assert.rejects(assertCustomerSourceActive(env,{phone:o.source.phone},true),/gesperrt oder anonymisiert/);
});
test('operator-signed pending handovers retain their exact snapshot while cancellation revokes access',async t=>{
  const {env,add}=await fixture(t),handover={workflow:'remote',kind:'intake',status:'pending',token:'b'.repeat(64),hash:'c'.repeat(64),operatorSignedAt:'2026-10-09T11:00:00Z',protocol:{condition:'TEST',operatorSignature:'TEST-asset'}},o=await add({handovers:{intake:handover}});
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS handover_tokens(hash TEXT PRIMARY KEY,order_id TEXT,kind TEXT,revoked INTEGER DEFAULT 0)').run();await env.DB.prepare('INSERT INTO handover_tokens(hash,order_id,kind) VALUES(?,?,?)').bind(digest(handover.token),o.id,'intake').run();
  const d=(await projectRecords(env,o.id,identity)).documents.find(d=>d.key==='handover:intake');assert.ok(d);const result=await cancelDocument(env,{id:o.id,version:o.version,documentKey:d.key,documentHash:d.hash,reason:'TEST · Korrektur',confirmed:true},identity);assert.deepEqual(result.order.handovers.intake,handover);assert.equal((await env.DB.prepare('SELECT revoked FROM handover_tokens').first()).revoked,1);assert.equal(result.order.status,o.status);
});
test('concurrent customer block cannot be bypassed by a stale vehicle master edit',async t=>{
  const {env,add}=await fixture(t);await add();const files=await customerFiles(env,true),c=files.customers[0],v=files.vehicles[0],batch=env.DB.batch.bind(env.DB);let armed=true;
  env.DB.batch=async statements=>{if(armed){armed=false;await batch([env.DB.prepare("UPDATE customer_files SET data=json_set(data,'$.lifecycle.status','blocked'),version=version+1 WHERE id=?").bind(c.id)]);}return batch(statements);};
  await assert.rejects(updateCustomerFile(env,{kind:'vehicle',id:v.id,version:v.version,data:{...v,name:'Race overwrite'}}),e=>e.status===409);
  const saved=await env.DB.prepare('SELECT * FROM vehicle_files WHERE id=?').bind(v.id).first();assert.equal(JSON.parse(saved.data).name,v.name);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM file_audit WHERE entity_id=?').bind(v.id).first()).n,0);
});
test('concurrent target block makes stale relinking lose without order or audit side effects',async t=>{
  const {env,add}=await fixture(t),a=await add(),b=await add({source:{name:'TEST Other',email:'other@example.invalid',vehicle:'TEST Other Auto'}});const files=await customerFiles(env,true),source=files.orders.find(o=>o.id===a.id),target=files.orders.find(o=>o.id===b.id),batch=env.DB.batch.bind(env.DB);let armed=true;
  env.DB.batch=async statements=>{if(armed){armed=false;await batch([env.DB.prepare("UPDATE customer_files SET data=json_set(data,'$.lifecycle.status','blocked'),version=version+1 WHERE id=?").bind(target.customerId)]);}return batch(statements);};
  await assert.rejects(updateCustomerFile(env,{kind:'link',orderId:a.id,orderVersion:a.version,previousVehicleId:source.vehicleId,vehicleId:target.vehicleId,confirmed:true}),e=>e.status===409);assert.equal((await getOrder(env,a.id)).version,a.version);assert.equal((await env.DB.prepare('SELECT vehicle_id FROM order_files WHERE order_id=?').bind(a.id).first()).vehicle_id,source.vehicleId);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM file_audit WHERE entity_id=?').bind(a.id).first()).n,0);
});
test('successful relinking increments the order version and rejects an ABA stale link request',async t=>{
  const {env,add}=await fixture(t),a=await add(),b=await add({source:{name:'TEST Other',email:'other@example.invalid',vehicle:'TEST Other Auto'}}),files=await customerFiles(env,true),source=files.orders.find(o=>o.id===a.id),target=files.orders.find(o=>o.id===b.id);
  await updateCustomerFile(env,{kind:'link',orderId:a.id,orderVersion:a.version,previousVehicleId:source.vehicleId,vehicleId:target.vehicleId,confirmed:true});assert.equal((await getOrder(env,a.id)).version,2);await updateCustomerFile(env,{kind:'link',orderId:a.id,orderVersion:2,previousVehicleId:target.vehicleId,vehicleId:source.vehicleId,confirmed:true});
  await assert.rejects(updateCustomerFile(env,{kind:'link',orderId:a.id,orderVersion:a.version,previousVehicleId:source.vehicleId,vehicleId:target.vehicleId,confirmed:true}),e=>e.status===409);assert.equal((await getOrder(env,a.id)).version,3);
});
test('source guard runs inside insertion transaction after an earlier active preflight',async t=>{
  const {env,add}=await fixture(t),o=await add(),c=(await customerFiles(env,true)).customers[0],p=await customerLifecyclePreview(env,c.id,identity);await assertCustomerSourceActive(env,o.source,true);await changeCustomerLifecycle(env,{...p,mode:'block',reason:'TEST',confirmed:true},identity);
  await assert.rejects(env.DB.batch([...customerSourceGuardStatements(env,o.source,true),env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,1)').bind('race-id','TEST-RACE','Preise prüfen',JSON.stringify({source:o.source}),o.createdAt,'test','fixture')]),/CHECK constraint/);assert.equal(await env.DB.prepare("SELECT * FROM orders WHERE id='race-id'").first(),null);
});
test('index restriction preserves a concurrent note instead of restoring its stale order snapshot',async t=>{
  const {env,add}=await fixture(t),first=await add(),c=(await customerFiles(env,true)).customers[0],p=await customerLifecyclePreview(env,c.id,identity);await changeCustomerLifecycle(env,{...p,mode:'block',reason:'TEST',confirmed:true},identity);const next=await add({source:first.source}),batch=env.DB.batch.bind(env.DB);let armed=true;
  env.DB.batch=async statements=>{if(armed){armed=false;await batch([env.DB.prepare("UPDATE orders SET data=json_set(data,'$.notes',json(?)),version=version+1 WHERE id=?").bind(JSON.stringify([{note:'Concurrent note'}]),next.id)]);}return batch(statements);};await indexCustomerFiles(env);const saved=await getOrder(env,next.id);assert.equal(saved.notes[0].note,'Concurrent note');assert.equal(saved.recordsRestriction.status,'blocked');
});
test('calendar agreement evidence is named in the deletion preview and version checked',async t=>{
  const {env,add}=await fixture(t),o=await add(),c=(await customerFiles(env,true)).customers[0];await env.DB.prepare('CREATE TABLE IF NOT EXISTS calendar_adjustments(id TEXT PRIMARY KEY,order_id TEXT,version INTEGER,state TEXT,data TEXT,created_at TEXT,updated_at TEXT)').run();await env.DB.prepare('INSERT INTO calendar_adjustments VALUES(?,?,1,?,?,?,?)').bind('adjustment-test',o.id,'accepted','{}',o.createdAt,o.createdAt).run();const p=await customerLifecyclePreview(env,c.id,identity);assert.equal(p.counts.calendarAdjustments,1);assert.ok(p.documents.some(d=>d.key==='calendarAdjustment:adjustment-test'&&d.label.includes('angenommen')));await env.DB.prepare("UPDATE calendar_adjustments SET version=2,state='withdrawn' WHERE id='adjustment-test'").run();await assert.rejects(changeCustomerLifecycle(env,{...p,mode:'block',reason:'TEST',confirmed:true},identity),e=>e.status===409);
});
