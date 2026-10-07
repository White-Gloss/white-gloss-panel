import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {getOrder,setting,protect} from '../src/worker.mjs';
import {transition} from '../src/domain.mjs';
import {agreedOffer,protocolAllowed,todayTasks} from '../src/operations.mjs';
import {createAmendment} from '../server/amendments.mjs';
import {customerFiles,updateCustomerFile} from '../server/customer-files.mjs';
import {validPushSubscription,pushDevice,collectPush,deliverPush,pushStatus} from '../server/push.mjs';
import {COMPANY} from '../src/company.mjs';
import {signatureBytes,syntheticSignature} from './fixtures/signature.mjs';
import {createTestLetterhead} from './fixtures/letterhead.mjs';

const origin='https://panel.example.invalid',customer='operations-test@example.invalid';
async function fixture(t){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(COMPANY.email),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,opts){files.set(id,{body:new Uint8Array(bytes),httpMetadata:opts.httpMetadata});},async get(id){return files.get(id);},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());const app=await createApplication(env),cookies={};
  for(const [role,email] of [['owner',COMPANY.email],['customer',customer],['foreign','foreign@example.invalid']]){const raw=digest(role);cookies[role]='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+600000,Date.now()).run();}
  const req=(path,data,role='owner',extra={})=>app.fetch(new Request(origin+path,{method:data===undefined?'GET':'POST',headers:{cookie:cookies[role],...(data===undefined?{}:{origin,'Content-Type':'application/json'}),...extra},...(data===undefined?{}:{body:JSON.stringify(data)})}));
  const add=async(overrides={})=>{const id=crypto.randomUUID(),o={id,wg:'TEST-'+id,version:1,synthetic:true,status:'Termin verbindlich',createdAt:new Date().toISOString(),source:{name:'TEST · Kunde',email:customer,vehicle:'TEST · Fahrzeug'},offer:{services:'Innenreinigung',totalCents:10000},acceptance:{at:new Date().toISOString(),signature:'original-signature'},notes:[],payments:[],...overrides};await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(o.id,o.wg,o.status,JSON.stringify(o),o.createdAt,'test','fixture',Number(o.synthetic)).run();return o;};
  const action=async(o,name,input={})=>{const latest=await getOrder(env,o.id);return req('/api/action',{id:o.id,version:latest.version,action:name,input});};
  const upload=async(id,kind,params='')=>{const r=await app.fetch(new Request(origin+'/api/upload/'+id+'?kind='+kind+params,{method:'POST',headers:{cookie:cookies.owner,origin,'Content-Type':'image/png'},body:signatureBytes()}));assert.equal(r.status,200);return (await r.json()).id;};
  const signProtocol=async(o,kind,direct)=>{o=await getOrder(env,o.id);const photo=await upload(o.id,'photo'),p={kind,direct,directReason:'TEST · telefonisch vereinbarte Übergabe',plate:'TEST 1',at:'2026-10-06T12:00',location:'TEST · Betrieb',condition:'TEST · Kratzer dokumentiert',customerName:o.source.name,operatorName:COMPANY.owner,mileage:100,keys:1,delivery:'Kunde bringt',photos:[photo],workComplete:true,services:'TEST · Innenreinigung'};const response=await req('/api/protocol/prepare',{id:o.id,version:o.version,kind,protocol:p});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const draft=await response.json(),params='&draft='+draft.id+'&hash='+draft.hash;return action(o,kind,{draftId:draft.id,snapshotHash:draft.hash,customerSignature:await upload(o.id,'signature',params),operatorSignature:await upload(o.id,'signature',params),signaturesConfirmed:true});};
  return {env,app,req,add,action,signProtocol};
}
test('amendment acceptance preserves original offer/signature, charges only approved work and is idempotent',async t=>{
  const f=await fixture(t),o=await f.add(),original=structuredClone(o);
  const created=await f.action(o,'amendmentCreate',{services:'Tierhaare entfernen',reason:'Stärkerer Zustand',amountCents:2500,extraMinutes:45});assert.equal(created.status,200);const updated=await created.json(),a=updated.amendments[0],route='/api/offer/'+a.token;
  assert.equal(agreedOffer(updated).totalCents,10000);assert.equal((await f.req(route,undefined,'foreign')).status,403);
  const view=await(await f.req(route,undefined,'customer')).json(),input={signature:syntheticSignature,paymentObligation:true,snapshotHash:digest(JSON.stringify(view))};
  assert.equal((await f.req(route,input,'owner')).status,403);assert.equal((await f.req(route,{...input,snapshotHash:'wrong'},'customer')).status,409);
  assert.equal((await f.req(route,input,'customer')).status,200);assert.equal((await f.req(route,input,'customer')).status,200);
  const saved=await getOrder(f.env,o.id);assert.equal(agreedOffer(saved).totalCents,12500);assert.deepEqual(saved.offer,original.offer);assert.deepEqual(saved.acceptance,original.acceptance);assert.equal(saved.amendments[0].acceptance.snapshotHash,input.snapshotHash);
  assert.equal((await f.action(saved,'amendmentWithdraw',{amendmentId:a.id,reason:'x'})).status,409);
});
test('open amendment blocks another amendment and return; withdrawal revokes signing without changing base price',async t=>{
  const f=await fixture(t),o=await f.add({status:'In Arbeit',intake:{plate:'TEST'}}),input={services:'Zusatz',reason:'Zustand',amountCents:100,extraMinutes:0};
  const created=await(await f.action(o,'amendmentCreate',input)).json(),a=created.amendments[0],route='/api/offer/'+a.token;
  assert.equal(protocolAllowed(created,'return',true),false);assert.equal((await f.action(created,'amendmentCreate',input)).status,409);
  const view=await(await f.req(route,undefined,'customer')).json();assert.equal((await f.action(created,'amendmentWithdraw',{amendmentId:a.id,reason:'Nicht benötigt'})).status,200);
  assert.equal((await f.req(route,{signature:syntheticSignature,paymentObligation:true,snapshotHash:digest(JSON.stringify(view))},'customer')).status,409);
  const saved=await getOrder(f.env,o.id);assert.equal(agreedOffer(saved).totalCents,10000);assert.equal(protocolAllowed(saved,'return'),true);
  assert.throws(()=>createAmendment({...o,invoice:{id:'existing'}},input),/Nachträge/);
});
test('a stale competing amendment creates one token and one audited amendment',async t=>{
  const f=await fixture(t),o=await f.add(),b={id:o.id,version:o.version,action:'amendmentCreate',input:{services:'TEST',reason:'TEST',amountCents:500,extraMinutes:30}};
  const results=await Promise.all([f.req('/api/action',b),f.req('/api/action',b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM offer_tokens').first()).n,1);
});
test('direct intake then return works without offer or appointment, sends both PDFs with owner copies',async t=>{
  const f=await fixture(t),o=await f.add({status:'Preise prüfen',synthetic:false,offer:undefined,acceptance:undefined}),sent=[];
  await createTestLetterhead(f.env);
  for(const [k,v] of Object.entries({emailVerified:true,sendApproved:true,sender:'test@example.invalid'}))await setting(f.env,k,v);await setting(f.env,'resendKey',await protect(f.env,'fake-test-key'));
  t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(init.body));return Response.json({id:'test-'+sent.length});});
  for(const kind of ['intake','return']){const response=await f.signProtocol(o,kind,true);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.protocolDelivery.state,'sent');assert.equal(saved.offer,undefined);assert.equal(saved.appointment,undefined);assert.equal(saved.acceptance,undefined);assert.equal(saved[kind].direct,true);assert.match(Buffer.from(sent.at(-1).attachments[0].content,'base64').subarray(0,5).toString(),/%PDF-/);assert.deepEqual(sent.at(-1).cc,[COMPANY.email]);}
  assert.equal(sent.length,2);assert.equal((await f.action(o,'payment',{amountCents:100,method:'Bar',cashConfirmed:true,at:new Date().toISOString()})).status,409);
});
test('direct return can stand alone while signatures, reason and closed-order guards remain mandatory',async t=>{
  const f=await fixture(t),o=await f.add({status:'Preise prüfen',offer:undefined,acceptance:undefined});
  assert.equal(protocolAllowed(o,'return'),false);assert.equal(protocolAllowed(o,'return',true),true);
  assert.equal((await f.req('/api/protocol/prepare',{id:o.id,version:1,kind:'return',protocol:{direct:true}})).status,400);
  const response=await f.signProtocol(o,'return',true);assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.status,'Erledigt');assert.equal(saved.intake,undefined);assert.equal(protocolAllowed(saved,'intake',true),false);
  assert.equal((await f.action(saved,'return',{direct:true})).status,409);
});
test('daily work prioritizes failed delivery, due followups, arrivals, returns and signatures in Berlin',()=>{
  const base={id:'a',wg:'TEST',source:{name:'TEST'},status:'Termin verbindlich',appointment:{start:'2026-10-06T06:00:00Z',end:'2026-10-06T08:00:00Z'},notes:[{note:'Rückruf',followUp:'2026-10-06'},{note:'Erledigt',followUp:'2026-10-05',completedAt:'now'}]},tasks=todayTasks([base],[{id:'job',order_id:'a',state:'unknown',kind:'protocol-intake'}],'2026-10-06T07:00:00Z');
  assert.equal(tasks.length,3);assert.match(tasks[0].title,/Versand/);assert.match(tasks[1].title,/Rückruf/);assert.equal(tasks[2].tab,'intake');
  const done=transition(base,'followUpDone',{index:0});assert.ok(done.notes[0].completedAt);assert.equal(base.notes[0].completedAt,undefined);
});
test('customer files preserve all orders, isolate test data, avoid model-only merging and audit corrected assignments',async t=>{
  const f=await fixture(t),a=await f.add(),b=await f.add(),live=await f.add({synthetic:false});
  let data=await customerFiles(f.env,true);assert.equal(data.customers.length,1);assert.equal(data.vehicles.length,2);assert.equal(data.orders.length,2);assert.equal((await customerFiles(f.env,false)).orders.length,1);
  const first=data.orders.find(o=>o.id===a.id),second=data.orders.find(o=>o.id===b.id);
  await updateCustomerFile(f.env,{kind:'link',orderId:b.id,orderVersion:b.version,previousVehicleId:second.vehicleId,vehicleId:first.vehicleId,confirmed:true});
  data=await customerFiles(f.env,true);assert.equal(data.orders.find(o=>o.id===b.id).vehicleId,first.vehicleId);assert.deepEqual((await getOrder(f.env,b.id)).source,b.source);
  const liveData=await customerFiles(f.env,false);await assert.rejects(updateCustomerFile(f.env,{kind:'link',orderId:live.id,orderVersion:live.version,previousVehicleId:liveData.orders[0].vehicleId,vehicleId:first.vehicleId,confirmed:true}));
  const c=data.customers[0];await updateCustomerFile(f.env,{kind:'customer',id:c.id,version:c.version,data:{...c,name:'TEST · Neu'}});await assert.rejects(updateCustomerFile(f.env,{kind:'customer',id:c.id,version:c.version,data:c}),/geändert/);
  assert.equal((await f.req('/api/customer-files',undefined,'customer')).status,403);assert.equal((await f.req('/api/customer-files',{kind:'customer'},'owner',{origin:'https://foreign.invalid'})).status,403);
});
test('approved amendments participate in payment totals while unapproved extras never do',()=>{
  const o={status:'Erledigt',offer:{totalCents:10000,services:'TEST'},acceptance:{at:'today'},payments:[],amendments:[{state:'accepted',amountCents:2000,services:'TEST approved'},{state:'open',amountCents:9000}]};
  const paid=transition(o,'payment',{amountCents:12000,at:new Date().toISOString(),method:'Bar',cashConfirmed:true,receivedConfirmed:true});assert.equal(paid.status,'Bezahlt');assert.equal(paid.offer.totalCents,10000);
});
test('push endpoints prevent local network abuse and owner-only subscription secrets are encrypted',async t=>{
  const f=await fixture(t),sub={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-test',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}};
  for(const endpoint of ['http://fcm.googleapis.com/test','https://127.0.0.1/test','https://fcm.googleapis.com.evil.invalid/test','https://user@fcm.googleapis.com/test','https://fcm.googleapis.com:444/test'])assert.throws(()=>validPushSubscription({...sub,endpoint}));
  assert.equal((await f.req('/api/push',{action:'subscribe',subscription:sub},'customer')).status,403);
  assert.equal((await f.req('/api/push',{action:'subscribe',subscription:sub},'owner',{origin:'https://foreign.invalid'})).status,403);
  const result=await pushDevice(f.env,{action:'subscribe',subscription:sub,label:'Testgerät'}),row=await f.env.DB.prepare('SELECT * FROM push_devices').first();assert.ok(!row.secret.includes('synthetic-test'));assert.equal(row.id,result.id);
  const status=await pushStatus(f.env);assert.ok(!JSON.stringify(status).includes(sub.endpoint));assert.ok(!JSON.stringify(status).includes('privateKey'));
});
test('push skips historical/synthetic records, deduplicates events, sends once and removes expired devices',async t=>{
  const f=await fixture(t);await f.add({synthetic:false});const sub={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-test',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}};await pushDevice(f.env,{action:'subscribe',subscription:sub});
  await f.add();const real=await f.add({synthetic:false});await collectPush(f.env);await collectPush(f.env);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM push_events').first()).n,1);
  const sent=[];await deliverPush(f.env,async(subscription,payload)=>sent.push(JSON.parse(payload)));await deliverPush(f.env,async()=>assert.fail('duplicate'));assert.equal(sent.length,1);assert.equal(sent[0].url,'/?order='+real.id);assert.ok(!JSON.stringify(sent).includes(customer));
  await f.add({synthetic:false});await collectPush(f.env);await deliverPush(f.env,async()=>{throw Object.assign(Error('Gone'),{statusCode:410});});assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM push_devices').first()).n,0);
});
