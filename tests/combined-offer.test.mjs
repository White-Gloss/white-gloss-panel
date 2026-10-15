import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{getOrder} from '../src/worker.mjs';
import {AppError,transition,appointmentSnapshot,berlin} from '../src/domain.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {handlePortal} from '../server/portal.mjs';
import {acceptanceDocument} from '../server/acceptance-document.mjs';
import {PDFDocument} from '../dist/pdf/library.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='customer@example.invalid';
const at='2030-10-01T10:00:00.000Z',appointment={start:'2030-10-15T09:00',duration:180,delivery:'Kunde bringt',location:'TEST · Werkstatt'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const signature='data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(400)]).toString('base64');
function offered(withAppointment=true){
  let o=transition({id:crypto.randomUUID(),wg:'WG-TEST-COMBINED',status:'Preise prüfen',source:{name:'TEST · Kunde',email:customer,vehicle:'TEST · Fahrzeug'},notes:[],payments:[]},'price',{services:'TEST · Pflege',totalCents:12500},at);
  if(withAppointment)o=transition(o,'appointment',appointment,at);
  return transition(o,'confirm',{},at);
}
async function fixture(t,withAppointment=true){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,6).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options.httpMetadata});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());await createApplication(env);
  // All operations use an isolated in-memory record and private fake files. No provider calls.
  env.operations={};
  const initial=offered(withAppointment),token='a'.repeat(64);initial.offerToken=token;
  initial.offer.expiresAt=new Date(Date.now()+86400000).toISOString();
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(initial.id,initial.wg,initial.status,JSON.stringify(initial),at,'test','fixture').run();
  if(initial.appointment)await env.DB.prepare('INSERT INTO appointments VALUES(?,?,?)').bind(initial.id,initial.appointment.start,initial.appointment.end).run();
  await env.DB.prepare('INSERT INTO offer_tokens(hash,order_id,expires_at) VALUES(?,?,?)').bind(digest(token),initial.id,initial.offer.expiresAt).run();
  const request=(path,data,email=owner)=>worker.fetch(new Request(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-email':email},body:data===undefined?undefined:JSON.stringify(data)}),env);
  const ok=async(path,data,email)=>{const response=await request(path,data,email),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const action=async(name,input)=>{const o=await getOrder(env,initial.id);return ok('action',{id:o.id,version:o.version,action:name,input});};
  return {env,files,id:initial.id,route:'offer/'+token,request,ok,action};
}
test('one explicit on-site signature confirms the offer and appointment, and a reschedule retains the signed date',()=>{
  const initial=offered(),accepted=transition(initial,'onsiteAccept',{signature:'one-customer-signature',snapshotHash:'shown-combined-hash',confirmAppointment:true,paymentObligation:true},at);
  assert.equal(accepted.status,'Termin verbindlich');assert.equal(accepted.acceptance.signature,accepted.appointment.confirmation.signature);
  assert.equal(accepted.acceptance.confirmationId,accepted.appointment.confirmation.acceptanceId);
  assert.deepEqual(accepted.acceptance.snapshot.appointment,appointmentSnapshot(initial));
  assert.ok(!('confirmation' in accepted.acceptance.snapshot.appointment));
  const moved=transition(accepted,'appointment',{...appointment,start:'2030-10-16T09:00'},at);
  assert.equal(moved.status,'Angenommen');assert.equal(moved.appointment.confirmation,undefined);
  assert.equal(moved.acceptance.snapshot.appointment.start,accepted.appointment.start);
  assert.equal(moved.appointmentHistory[0].confirmation.signature,accepted.acceptance.signature);
  const separate=transition(initial,'onsiteAccept',{signature:'offer-only'},at);
  assert.equal(separate.status,'Angenommen');assert.equal(separate.appointment.confirmation,undefined);assert.equal(separate.acceptance.snapshot.appointment,undefined);
  const released=transition(initial,'onsiteAccept',{release:true,releaseReason:'TEST · telefonisch'},at);
  const laterSigned=transition(released,'onsiteAccept',{signature:'later-personal-signature',confirmAppointment:true},at);
  assert.equal(laterSigned.status,'Termin verbindlich');assert.equal(laterSigned.acceptance.signature,laterSigned.appointment.confirmation.signature);
});
test('online combined acceptance rejects an outdated date and saves one signature and audit under concurrent retries',async t=>{
  const f=await fixture(t),shown=await f.ok(f.route,undefined,customer);
  assert.deepEqual(shown.appointment,appointmentSnapshot(await getOrder(f.env,f.id)));assert.ok(shown.business.name);
  const input={signature,snapshotHash:digest(JSON.stringify(shown)),paymentObligation:true,confirmAppointment:true};
  assert.equal((await f.request(f.route,input,owner)).status,403);assert.equal((await f.request(f.route,input,'stranger@example.invalid')).status,403);
  await f.action('appointment',{...appointment,start:'2030-10-16T09:00'});
  assert.equal((await f.request(f.route,input,customer)).status,409);assert.equal(f.files.size,0);assert.equal((await getOrder(f.env,f.id)).acceptance,undefined);
  const current=await f.ok(f.route,undefined,customer);input.snapshotHash=digest(JSON.stringify(current));
  const results=await Promise.all([f.request(f.route,input,customer),f.request(f.route,input,customer),f.request(f.route,input,customer)]);
  assert.ok(results.every(r=>r.status===200));
  const saved=await getOrder(f.env,f.id);assert.equal(saved.status,'Termin verbindlich');assert.equal(saved.acceptance.signature,saved.appointment.confirmation.signature);
  assert.equal(saved.acceptance.snapshot.appointment.start,current.appointment.start);assert.equal(f.files.size,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM assets WHERE order_id=?').bind(f.id).first()).n,1);
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM audit WHERE order_id=? AND actor='customer'").bind(f.id).first()).n,1);
});
test('legacy offers without an appointment remain acceptible and invalid combined on-site input stores no signature',async t=>{
  const f=await fixture(t,false),shown=await f.ok(f.route,undefined,customer);assert.equal(shown.appointment,null);
  const initial=await getOrder(f.env,f.id);
  const invalid=await f.request('action',{id:f.id,version:initial.version,action:'onsiteAccept',input:{signature,confirmAppointment:true}});
  assert.equal(invalid.status,409);assert.equal(f.files.size,0);assert.equal((await getOrder(f.env,f.id)).acceptance,undefined);
  await f.ok(f.route,{signature,snapshotHash:digest(JSON.stringify(shown)),paymentObligation:true},customer);
  const saved=await getOrder(f.env,f.id);assert.equal(saved.status,'Angenommen');assert.equal(saved.acceptance.snapshot.appointment,undefined);
});
for(const mode of ['online','onsite'])test(mode+' combined acceptance rechecks calendar availability before storing a signature and permits a later safe retry',async t=>{
  const f=await fixture(t);
  await f.action('appointment',appointment);
  const original=await getOrder(f.env,f.id),shown=await f.ok(f.route,undefined,customer),input={signature,paymentObligation:true,confirmAppointment:true,snapshotHash:digest(JSON.stringify(shown))};
  const submit=()=>mode==='online'?f.request(f.route,input,customer):f.request('action',{id:f.id,version:original.version,action:'onsiteAccept',input});
  const auditCount=(await f.env.DB.prepare('SELECT COUNT(*) n FROM audit WHERE order_id=?').bind(f.id).first()).n;
  let calls=0,blocked=null;
  f.env.operations.validateAppointment=async(_env,preview)=>{
    calls++;assert.equal(f.files.size,0);assert.equal(preview.status,'Termin verbindlich');assert.equal(preview.appointment.start,original.appointment.start);
    assert.equal(preview.acceptance.signature,'pruefung');
    if(blocked)throw blocked;
  };
  for(const error of [new AppError('TEST · Termin inzwischen belegt',409),new AppError('TEST · Kalender vorübergehend nicht erreichbar',502)]){
    blocked=error;const response=await submit();assert.equal(response.status,error.status);
    assert.deepEqual(await getOrder(f.env,f.id),original);assert.equal(f.files.size,0);
    assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM assets WHERE order_id=?').bind(f.id).first()).n,0);
    assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM audit WHERE order_id=?').bind(f.id).first()).n,auditCount);
  }
  blocked=null;const response=await submit();assert.equal(response.status,200,JSON.stringify(await response.json()));assert.equal(calls,3);
  const saved=await getOrder(f.env,f.id);assert.equal(saved.status,'Termin verbindlich');assert.equal(saved.acceptance.signature,saved.appointment.confirmation.signature);assert.equal(f.files.size,1);
});
test('portal offers one combined signing action and preserves separate confirmation when its offer link is unavailable',async t=>{
  const f=await fixture(t),read=async()=>{const response=await handlePortal(f.env,new Request(origin+'/api/portal/me'),customer,false);assert.equal(response.status,200);return (await response.json()).orders[0];};
  let view=await read();assert.match(view.todo.find(t=>t.kind==='offer-open').label,/Angebot & Termin/);assert.ok(!view.todo.some(t=>t.kind==='confirm-appointment'));assert.equal(view.appointment.canConfirm,false);
  await f.env.DB.prepare('UPDATE offer_tokens SET revoked=1 WHERE order_id=?').bind(f.id).run();
  view=await read();assert.ok(view.todo.some(t=>t.kind==='confirm-appointment'));assert.equal(view.appointment.canConfirm,true);
});
test('confirmation PDF records the appointment signed with the offer even after rescheduling',async t=>{
  const drawn=[],addPage=PDFDocument.prototype.addPage;
  t.mock.method(PDFDocument.prototype,'addPage',function(...args){const page=addPage.apply(this,args),drawText=page.drawText;page.drawText=function(value,options){drawn.push(value);return drawText.call(this,value,options);};return page;});
  const accepted=transition(offered(),'onsiteAccept',{release:true,releaseReason:'TEST · Betreiberfreigabe',confirmAppointment:true},at);
  const moved=transition(accepted,'appointment',{...appointment,start:'2030-10-16T09:00'},at);
  const pdf=await acceptanceDocument({},moved),text=drawn.join('\n');
  assert.equal(Buffer.from(pdf.bytes.subarray(0,5)).toString(),'%PDF-');assert.match(text,/Gemeinsam vereinbarter Termin/);
  assert.ok(text.includes(berlin(accepted.appointment.start)));assert.ok(!text.includes(berlin(moved.appointment.start)));assert.match(text,/gemeinsam vom Betreiber freigegeben/);
});
