import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {getOrder,setting,protect,background} from '../src/worker.mjs';
import {appointmentConfirmed,reminderSnapshot,suggestedPreparation,deliverAppointmentReminder,pendingAppointmentReminders} from '../server/appointment-reminders.mjs';
import {providerOperations} from '../server/providers.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='customer@example.invalid';
async function fixture(t,{synthetic=false,hours=20}={}){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{get:async()=>null},ASSETS:{fetch:async()=>new Response('shell')}};t.after(()=>env.DB.close());
  const app=await createApplication(env),cookies={};for(const [role,email] of Object.entries({owner,customer})){const raw=randomBytes(32).toString('hex');cookies[role]='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();}
  const now=Date.now(),id=randomUUID(),at=new Date(now-86400000).toISOString(),appointment={id:randomUUID(),start:new Date(now+hours*3600000).toISOString(),end:new Date(now+(hours+2)*3600000).toISOString(),duration:120,delivery:'Kunde bringt',location:'TEST vereinbarter Ort'},offer={services:'TEST Innenraumaufbereitung',totalCents:20000},order={id,wg:'TEST-'+id,version:1,status:'Termin verbindlich',source:{name:'TEST Kunde',email:customer,vehicle:'TEST Fahrzeug'},appointment,offer,acceptance:{at,appointmentOptionId:appointment.id,snapshotHash:'TEST-signed',snapshot:{appointment,offer}},synthetic,notes:[{note:'TEST interne Originalnotiz'}]};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,synthetic,updated_at,actor,action) VALUES(?,?,?,?,?,?,?,?)').bind(id,order.wg,order.status,JSON.stringify(order),Number(synthetic),at,'test','Isolierter Test').run();
  for(const [key,value] of Object.entries({emailVerified:true,sendApproved:true,backgroundApproved:true,sender:'sender@example.invalid'}))await setting(env,key,value);await setting(env,'resendKey',await protect(env,'synthetic-key'));
  const sent=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://api.resend.com/emails');sent.push({payload:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return Response.json({id:'TEST-provider-'+sent.length});});
  const path='/api/appointment-reminders?id='+id,req=(data,role='owner',headers={})=>app.fetch(new Request(origin+path,{...(data?{method:'POST',body:JSON.stringify(data)}:{}),headers:{cookie:cookies[role]??'',...(data?{origin,'Content-Type':'application/json'}:{}),...headers}}));
  const input={action:'save',enabled:true,channel:'email',leadHours:24,...suggestedPreparation(order),preparationReviewed:true,communicationApproved:true,evidence:'TEST: bestehende Termin-Kommunikation ausdrücklich vereinbart'};
  const save=async extra=>req({...input,orderVersion:(await getOrder(env,id)).version,...extra});
  const modify=async change=>{const current=await getOrder(env,id),updated=change(current);await env.DB.prepare("UPDATE orders SET data=?,status=?,version=version+1,updated_at=?,action='Synthetic change' WHERE id=?").bind(JSON.stringify(updated),updated.status,new Date().toISOString(),id).run();};
  function afterClaim(change){const original=env.DB.prepare.bind(env.DB);let changed=false;t.mock.method(env.DB,'prepare',query=>{const statement=original(query);if(query.startsWith("UPDATE jobs SET state='pending',detail='Versand wird geprüft'")){const run=statement.run.bind(statement);statement.run=async()=>{const result=await run();if(!changed&&result.meta.changes){changed=true;await change();}return result;};}return statement;});}
  return {env,app,req,save,modify,afterClaim,input,id,order,now,sent};
}
async function success(response){assert.equal(response.status,200,await response.clone().text());return response.json();}
function revised(order,hours=3){const after={...order.appointment,id:randomUUID(),start:new Date(Date.parse(order.appointment.start)+hours*3600000).toISOString(),end:new Date(Date.parse(order.appointment.end)+hours*3600000).toISOString()};return {...order,appointment:after,appointmentRevisions:[...(order.appointmentRevisions??[]),{after,acceptance:{at:new Date().toISOString(),confirmed:true,snapshotHash:'TEST-revision-proof'}}]};}

test('templates and confirmed appointment revisions preserve original agreements and require proof',async t=>{
  const f=await fixture(t);assert.equal(suggestedPreparation(f.order).template,'interior');assert.equal(appointmentConfirmed(f.order),true);assert.equal(appointmentConfirmed({...f.order,acceptance:{...f.order.acceptance,at:null}}),false);
  const next=revised(f.order);assert.equal(appointmentConfirmed(next),true);assert.equal(appointmentConfirmed({...next,appointmentRevisions:[]}),false);assert.deepEqual(next.acceptance,f.order.acceptance);
  const legacy={...f.order,acceptance:{at:'2026-01-01T10:00:00Z'}};assert.equal(appointmentConfirmed(legacy),true);assert.equal(appointmentConfirmed({...legacy,acceptance:{}}),false);
});

test('owner-only settings support a read-only preview and preserve order, price, signatures and source',async t=>{
  const f=await fixture(t);assert.equal((await f.req(null,'')).status,401);assert.equal((await f.req(null,'customer')).status,403);assert.equal((await f.req({...f.input,orderVersion:1},'owner',{origin:'https://foreign.invalid'})).status,403);
  const before=await getOrder(f.env,f.id),preview=await success(await f.req({...f.input,orderVersion:1,action:'preview'}));assert.match(preview.preview.text,/TEST vereinbarter Ort/);assert.match(preview.preview.text,/Innenraumaufbereitung/);assert.deepEqual(await getOrder(f.env,f.id),before);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);
  await success(await f.save());const after=await getOrder(f.env,f.id);for(const key of ['acceptance','offer','source','appointment','notes'])assert.deepEqual(after[key],before[key]);assert.equal(after.appointmentReminder.permission.recipient,customer);assert.equal(f.sent.length,0);
  assert.equal((await f.req({...f.input,orderVersion:1})).status,409);
});

test('unsupported channels, missing permission, unchecked preparation and invalid time never activate reminders',async t=>{
  const f=await fixture(t);for(const change of [{channel:'sms'},{communicationApproved:false},{evidence:''},{preparationReviewed:false},{leadHours:0},{leadHours:169},{leadHours:1.5}])assert.equal((await f.save(change)).status,400,JSON.stringify(change));
  await f.modify(o=>({...o,acceptance:null}));assert.equal((await f.save()).status,409);assert.equal((await getOrder(f.env,f.id)).appointmentReminder,undefined);assert.equal(f.sent.length,0);
});

test('timing, provider status, duplicate calls and changed preparation do not generate duplicate emails',async t=>{
  const f=await fixture(t,{hours:25});await success(await f.save());const saved=await getOrder(f.env,f.id),due=Date.parse(reminderSnapshot(saved).dueAt);
  assert.equal((await deliverAppointmentReminder(f.env,f.id,due-1)).state,'queued');assert.equal(f.sent.length,0);
  await Promise.all([deliverAppointmentReminder(f.env,f.id,due),deliverAppointmentReminder(f.env,f.id,due)]);assert.equal(f.sent.length,1);assert.match(f.sent[0].payload.text,/Vorbereitung/);assert.match(f.sent[0].key,/reminder:/);
  await success(await f.save({instructions:'TEST geprüfte neue Hinweise'}));await deliverAppointmentReminder(f.env,f.id,due);assert.equal(f.sent.length,1);
  const data=await success(await f.req());assert.match(data.jobs[0].message,/Zustellung.*noch nicht bestätigt/);
});

test('personally confirmed rescheduling sends only the new appointment snapshot; cancelled orders stay silent',async t=>{
  const f=await fixture(t);await success(await f.save());await deliverAppointmentReminder(f.env,f.id);assert.equal(f.sent.length,1);
  await f.modify(o=>revised(o));await deliverAppointmentReminder(f.env,f.id);assert.equal(f.sent.length,2);assert.notEqual(f.sent[0].key,f.sent[1].key);assert.notEqual(f.sent[0].payload.text,f.sent[1].payload.text);assert.deepEqual((await getOrder(f.env,f.id)).acceptance,f.order.acceptance);
  await f.modify(o=>({...revised(o),status:'Storniert'}));await deliverAppointmentReminder(f.env,f.id);assert.equal(f.sent.length,2);
});

test('unknown provider outcomes remain locked across restarts, rescheduling and repeated clicks',async t=>{
  const f=await fixture(t);await success(await f.save());let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('TEST timeout');});
  assert.equal((await deliverAppointmentReminder(f.env,f.id)).state,'unknown');await deliverAppointmentReminder(f.env,f.id);await f.modify(o=>revised(o));await deliverAppointmentReminder(f.env,f.id);await pendingAppointmentReminders(f.env);assert.equal(calls,1);
});

for(const change of ['cancel','revoke','recipient','reschedule','provider'])test('change after atomic claim prevents stale dispatch: '+change,async t=>{
  const f=await fixture(t);await success(await f.save());f.afterClaim(async()=>{if(change==='provider')return setting(f.env,'sendApproved',false);await f.modify(o=>change==='cancel'?{...o,status:'Storniert'}:change==='revoke'?{...o,appointmentReminder:{...o.appointmentReminder,permission:{...o.appointmentReminder.permission,revokedAt:new Date().toISOString()}}}:change==='recipient'?{...o,source:{...o.source,email:'changed@example.invalid'}}:revised(o));});
  await deliverAppointmentReminder(f.env,f.id);assert.equal(f.sent.length,0);assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE state='sent'").first()).n,0);
});

test('legacy dispatched reminders are visible and conservatively prevent any automatic resend',async t=>{
  const f=await fixture(t);await success(await f.save());for(const state of ['sent','unknown','pending']){await f.env.DB.prepare('INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(order_id,kind) DO UPDATE SET state=excluded.state').bind(randomUUID(),f.id,'reminder',state,new Date().toISOString(),new Date().toISOString()).run();assert.equal((await deliverAppointmentReminder(f.env,f.id)).state,'legacy');assert.equal((await success(await f.req())).legacyBlocked,true);}assert.equal(f.sent.length,0);
});

test('test data, disabled reminders and blocked customer records never contact a provider',async t=>{
  const f=await fixture(t,{synthetic:true});await success(await f.save());await background(f.env);await deliverAppointmentReminder(f.env,f.id);assert.equal(f.sent.length,0);
  await success(await f.save({enabled:false,communicationApproved:false}));const disabled=await getOrder(f.env,f.id);assert.equal(disabled.appointmentReminder.permission.granted,false);assert.ok(disabled.appointmentReminder.permission.revokedAt);assert.equal(disabled.appointmentReminder.history.length,2);
  await f.modify(o=>({...o,recordsRestriction:{status:'blocked'}}));assert.equal((await f.save()).status,409);assert.equal(f.sent.length,0);
});

test('existing background hook dispatches configured reminders and bounds provider attempts without starving older work',async t=>{
  const f=await fixture(t);await success(await f.save());const original=await getOrder(f.env,f.id);
  for(let i=0;i<6;i++){const id=randomUUID(),order={...original,id,wg:'TEST-more-'+i,appointmentReminder:{...original.appointmentReminder,permission:{...original.appointmentReminder.permission,orderId:id}}};await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,synthetic,updated_at,actor,action) VALUES(?,?,?,?,0,?,?,?)').bind(id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture').run();}
  await background(f.env);assert.equal(f.sent.length,5);await background(f.env);assert.equal(f.sent.length,7);await background(f.env);assert.equal(f.sent.length,7);
});

test('existing confirmed legacy reminders continue, while a saved disabled configuration has no second dispatch path',async t=>{
  const f=await fixture(t);await background(f.env);assert.equal(f.sent.length,1);assert.ok(f.sent[0].key.endsWith('-reminder'));await success(await f.save({enabled:false,communicationApproved:false}));await background(f.env);assert.equal(f.sent.length,1);
});

test('legacy reminders reject unconfirmed appointments and a changed snapshot after the claim',async t=>{
  const f=await fixture(t);await f.modify(o=>({...o,acceptance:null}));await background(f.env);assert.equal(f.sent.length,0);await f.modify(o=>({...o,acceptance:f.order.acceptance}));
  const original=f.env.DB.prepare.bind(f.env.DB);let changed=false;t.mock.method(f.env.DB,'prepare',query=>{const statement=original(query);if(query.startsWith('INSERT OR IGNORE INTO jobs')){const run=statement.run.bind(statement);statement.run=async()=>{const result=await run();if(!changed&&result.meta.changes){changed=true;await f.modify(o=>revised(o));}return result;};}return statement;});
  await background(f.env);assert.equal(f.sent.length,0);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='reminder'").first()).state,'cancelled');
});

for(const action of ['cancel','disable'])test('legacy final read catches '+action+' during asynchronous configuration decryption',async t=>{
  const f=await fixture(t),original=f.env.DB.prepare.bind(f.env.DB);let reads=0;
  t.mock.method(f.env.DB,'prepare',query=>{const statement=original(query);if(query==='SELECT key,value FROM settings'){const all=statement.all.bind(statement);statement.all=async()=>{const result=await all();if(++reads===3)await f.modify(o=>action==='cancel'?{...o,status:'Storniert'}:{...o,appointmentReminder:{enabled:false}});return result;};}return statement;});
  await background(f.env);assert.equal(f.sent.length,0);assert.notEqual((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='reminder'").first()).state,'sent');
});

test('new reminders do not dispatch if the version changes after recording the tentative provider attempt',async t=>{
  const f=await fixture(t);await success(await f.save());const original=f.env.DB.prepare.bind(f.env.DB);let changed=false;
  t.mock.method(f.env.DB,'prepare',query=>{const statement=original(query);if(query.startsWith('UPDATE appointment_reminder_deliveries SET attempted_at=?')){const run=statement.run.bind(statement);statement.run=async()=>{const result=await run();if(result.meta.changes&&!changed){changed=true;await f.modify(o=>({...o,status:'Storniert'}));}return result;};}return statement;});
  await deliverAppointmentReminder(f.env,f.id);assert.equal(f.sent.length,0);assert.equal((await f.env.DB.prepare('SELECT attempted_at FROM appointment_reminder_deliveries').first()).attempted_at,null);
});

test('read-only reminder reconciliation verifies the original stored recipient after a customer address changes',async t=>{
  const f=await fixture(t);await success(await f.save());await deliverAppointmentReminder(f.env,f.id);await f.env.DB.prepare("UPDATE jobs SET state='unknown' WHERE order_id=?").bind(f.id).run();await f.modify(o=>({...o,source:{...o.source,email:'changed@example.invalid'}}));
  let reads=0;t.mock.method(globalThis,'fetch',async(url,options={})=>{assert.equal(options.method,undefined);assert.equal(String(url),'https://api.resend.com/emails/TEST-provider-1');reads++;return Response.json({id:'TEST-provider-1',to:[customer]});});
  await providerOperations.action(f.env,await getOrder(f.env,f.id),'reconcile',{});assert.equal(reads,1);const job=await f.env.DB.prepare('SELECT state,detail FROM jobs WHERE order_id=?').bind(f.id).first();assert.equal(job.state,'sent');assert.match(job.detail,/Zustellung noch nicht bestätigt/);assert.equal(f.sent.length,1);
});

test('reconciliation rejects a mismatched or additional recipient without clearing the unknown lock',async t=>{
  const f=await fixture(t);await success(await f.save());await deliverAppointmentReminder(f.env,f.id);await f.env.DB.prepare("UPDATE jobs SET state='unknown' WHERE order_id=?").bind(f.id).run();
  for(const to of [['other@example.invalid'],[customer,'other@example.invalid']]){t.mock.method(globalThis,'fetch',async(_url,options={})=>{assert.equal(options.method,undefined);return Response.json({id:'TEST-provider-1',to});});await assert.rejects(providerOperations.action(f.env,await getOrder(f.env,f.id),'reconcile',{}),/gespeicherten Erinnerungsempfänger/);assert.equal((await f.env.DB.prepare('SELECT state FROM jobs WHERE order_id=?').bind(f.id).first()).state,'unknown');}
});
