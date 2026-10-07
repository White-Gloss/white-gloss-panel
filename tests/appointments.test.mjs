import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication,maintenance} from '../server/application.mjs';
import {digest,issueCustomerAccess} from '../server/auth.mjs';
import {transition,normalizeAppointmentOptions,customerSignaturePNG} from '../src/domain.mjs';
import {getOrder,saveOrder,setting,protect,background} from '../src/worker.mjs';
import {COMPANY} from '../src/company.mjs';
import {providerOperations} from '../server/providers.mjs';
import {appointmentConfirmationPayload,deliverAppointmentConfirmation,pendingAppointmentConfirmations} from '../server/appointment-mail.mjs';
import {signatureBytes,syntheticSignature as signature} from './fixtures/signature.mjs';

const origin='https://panel.example.invalid',customer='customer@example.invalid';
const options=()=>[{start:'2099-12-01T10:00',duration:120,delivery:'Kunde bringt',location:'TEST · Betrieb'},{start:'2099-12-02T14:00',duration:90,delivery:'Abholung',location:'TEST · Kundenadresse'},{start:'2099-12-03T11:00',duration:60,delivery:'Kunde bringt',location:'TEST · Betrieb'}];
const now='2026-10-04T10:00:00.000Z';
async function fixture(t,{synthetic=false,legacy=false}={}){
  const sent=[],env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(COMPANY.email),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('shell')}};t.after(()=>env.DB.close());
  const app=await createApplication(env),cookies={};
  for(const [name,email,character] of [['owner',COMPANY.email,'a'],['customer',customer,'b'],['foreign','foreign@example.invalid','c']]){const raw=character.repeat(64);cookies[name]='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+600000,Date.now()).run();}
  const request=(path,body,who='customer',headers={})=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{...(cookies[who]?{cookie:cookies[who]}:{}),...(body===undefined?{}:{origin,'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  async function addOrder({proposal=options(),email=customer,isSynthetic=synthetic,isLegacy=legacy}={}){
    let order={id:randomUUID(),wg:'WG-TEST-'+randomUUID(),version:1,status:'Preise prüfen',synthetic:isSynthetic,source:{name:'TEST · Kunde',email,vehicle:'TEST · Fahrzeug'},payments:[]};
    order=transition(order,'price',{services:'TEST · Innenreinigung',condition:'TEST · geprüfter Fahrzeugzustand',totalCents:11900,pickupCents:0},now);
    if(!isLegacy)order=transition(order,'appointmentOptions',{options:proposal},now);
    order=transition(order,'confirm',{},new Date().toISOString());if(isLegacy)delete order.offer.requiresAppointmentSelection;order.offerToken=digest(randomUUID());
    await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture',Number(isSynthetic)).run();
    await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(order.offerToken),order.id,order.offer.expiresAt).run();return order;
  }
  const order=await addOrder(),route='/api/offer/'+order.offerToken;
  await setting(env,'resendKey',await protect(env,'synthetic-api-key'));await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);await setting(env,'sender','test@example.invalid');
  t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(url,'https://api.resend.com/emails');sent.push({payload:JSON.parse(init.body),key:init.headers['Idempotency-Key']});return Response.json({id:'synthetic-mail-'+sent.length});});
  async function inputFor(currentRoute=route,id){const response=await request(currentRoute);assert.equal(response.status,200);const visible=await response.json(),appointmentOptionId=id??visible.appointmentOptions?.[0]?.id;return {signature,paymentObligation:true,...(appointmentOptionId?{appointmentOptionId}:{}),snapshotHash:digest(JSON.stringify(visible.appointmentOptions.length?{...visible,selectedAppointmentOptionId:appointmentOptionId}:visible))};}
  const count=async table=>(await env.DB.prepare('SELECT COUNT(*) n FROM '+table).first()).n;
  return {env,app,order,route,cookies,request,addOrder,inputFor,sent,count};
}

test('one to three Berlin proposals are normalized, distinct, future, bounded and owner-only',()=>{
  const list=normalizeAppointmentOptions(options(),now);assert.equal(list.length,3);assert.equal(new Set(list.map(o=>o.id)).size,3);assert.equal(list[0].start,'2099-12-01T09:00:00.000Z');assert.equal(list[0].end,'2099-12-01T11:00:00.000Z');
  for(const bad of [[],[...options(),options()[0]],[{...options()[0],duration:14}],[{...options()[0],duration:1441}],[{...options()[0],duration:1.5}],[{...options()[0],delivery:'Unbekannt'}],[{...options()[0],location:''}],[{...options()[0],location:'x'.repeat(601)}],[{...options()[0],start:'2020-01-01T10:00'}],[options()[0],options()[0]],[{...options()[0],start:'2026-10-25T02:30'}]])assert.throws(()=>normalizeAppointmentOptions(bad,now));
  const order={status:'Preise prüfen'};assert.throws(()=>transition(order,'appointmentOptions',{options:options()},now,'customer'),/Betreiber/);
  const first=transition(order,'appointmentOptions',{options:options()},now),second=transition(first,'appointmentOptions',{options:options()},now);assert.equal(second.appointmentOptionsVersion,2);assert.notDeepEqual(second.appointmentOptions.map(x=>x.id),first.appointmentOptions.map(x=>x.id));assert.equal(first.appointmentOptionsVersion,1);
});

test('customer signs price, services and one selected appointment together; one email contains owner copy',async t=>{
  const f=await fixture(t),input=await f.inputFor(f.route,f.order.appointmentOptions[1].id),response=await f.request(f.route,input);assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,'Termin verbindlich');assert.equal(result.confirmationDelivery.state,'sent');assert.deepEqual(result.appointment,f.order.appointmentOptions[1]);
  const saved=await getOrder(f.env,f.order.id);assert.equal(saved.acceptance.appointmentOptionId,input.appointmentOptionId);assert.equal(saved.acceptance.snapshotHash,input.snapshotHash);assert.deepEqual(saved.acceptance.snapshot.offer,f.order.offer);assert.deepEqual(saved.acceptance.snapshot.appointment,saved.appointment);assert.equal(await f.count('appointments'),1);assert.equal(await f.count('appointment_confirmations'),1);
  const message=f.sent[0].payload;assert.deepEqual(message.to,[customer]);assert.deepEqual(message.cc,[COMPANY.email]);assert.equal(message.reply_to,COMPANY.email);assert.match(message.subject,/Verbindliche Terminbestätigung/);assert.match(message.text,/119,00\s*€/);assert.match(message.text,/TEST · Innenreinigung/);assert.match(message.text,/02\.12\.2099|02\.12\.99/);assert.match(message.text,/Abholung/);assert.ok(!message.text.includes(signature));
  const visible=await(await f.request(f.route)).json();assert.ok(!JSON.stringify(visible).includes(signature));assert.equal(visible.acceptance.appointmentOptionId,input.appointmentOptionId);
});

test('simultaneous same-selection redemption persists exactly one acceptance, appointment and email',async t=>{
  const f=await fixture(t),input=await f.inputFor(),before=await f.count('audit'),responses=await Promise.all([f.request(f.route,input),f.request(f.route,input),f.request(f.route,input)]);assert.ok(responses.every(r=>r.status===200));assert.equal(await f.count('audit'),before+1);assert.equal(await f.count('appointment_confirmations'),1);assert.equal(await f.count('appointments'),1);assert.equal(f.sent.length,1);
  assert.equal((await f.request(f.route,input)).status,200);await deliverAppointmentConfirmation(f.env,f.order.id);await maintenance(f.env);assert.equal(f.sent.length,1);
  assert.equal((await f.request(f.route,{...input,appointmentOptionId:f.order.appointmentOptions[1].id})).status,409);assert.equal((await f.request(f.route,{...input,snapshotHash:'f'.repeat(64)})).status,409);assert.equal(f.sent.length,1);
});

test('competing signatures for different options of one offer cannot silently replace the winner',async t=>{
  const f=await fixture(t),first=await f.inputFor(f.route,f.order.appointmentOptions[0].id),second=await f.inputFor(f.route,f.order.appointmentOptions[1].id),before=await f.count('audit');
  const responses=await Promise.all([f.request(f.route,first),f.request(f.route,second)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const saved=await getOrder(f.env,f.order.id);assert.ok([first.appointmentOptionId,second.appointmentOptionId].includes(saved.acceptance.appointmentOptionId));assert.equal(saved.appointment.id,saved.acceptance.appointmentOptionId);assert.equal(await f.count('audit'),before+1);assert.equal(await f.count('appointment_confirmations'),1);assert.equal(f.sent.length,1);
});

test('a signature made for another selection, stale proposal list or foreign ID cannot accept',async t=>{
  const f=await fixture(t),input=await f.inputFor();assert.equal((await f.request(f.route,{...input,appointmentOptionId:f.order.appointmentOptions[1].id})).status,409);
  const unknown=await f.inputFor(f.route,'foreign-option');assert.equal((await f.request(f.route,unknown)).status,409);
  const changed=await f.request('/api/action',{id:f.order.id,version:f.order.version,action:'appointmentOptions',input:{options:[{...options()[0],start:'2099-12-04T10:00'}]}},'owner');assert.equal(changed.status,200);assert.equal((await f.request(f.route,input)).status,409);assert.equal(await f.count('appointments'),0);assert.equal(await f.count('appointment_confirmations'),0);assert.equal(f.sent.length,0);
  const fresh=await f.inputFor();assert.equal((await f.request(f.route,fresh)).status,200);
});

test('owner, foreign account, forged origin, missing signature or missing explicit obligation cannot accept',async t=>{
  const f=await fixture(t),input=await f.inputFor();assert.equal((await f.request(f.route,undefined,'foreign')).status,403);assert.equal((await f.request(f.route,input,'foreign')).status,403);assert.equal((await f.request(f.route,input,'owner')).status,403);assert.equal((await f.request(f.route,input,'anonymous')).status,401);assert.equal((await f.request(f.route,input,'customer',{origin:'https://foreign.example.invalid'})).status,403);
  assert.equal((await f.request(f.route,{...input,signature:null})).status,400);assert.equal((await f.request(f.route,{...input,paymentObligation:false})).status,400);assert.equal((await f.request(f.route,{...input,appointmentOptionId:undefined})).status,409);assert.equal(await f.count('appointments'),0);assert.equal(f.sent.length,0);
});

test('PNG structure, checksums, dimensions and decompressed scanlines must be genuine before any acceptance',async t=>{
  const f=await fixture(t),input=await f.inputFor(),valid=signatureBytes(),corrupt=Buffer.from(valid);corrupt[corrupt.length-1]^=1;
  const invalid=['data:image/png;base64,'+'A'.repeat(600),'data:image/png;base64,'+corrupt.toString('base64'),'data:image/png;base64,'+valid.subarray(0,valid.length-5).toString('base64'),'data:image/png;base64,'+signatureBytes({width:1,height:1}).toString('base64'),'data:image/png;base64,'+signatureBytes({compressed:Buffer.from('invalid-zlib')}).toString('base64')];
  for(const value of invalid)assert.equal((await f.request(f.route,{...input,signature:value})).status,400);
  const parsed=customerSignaturePNG(signature);assert.equal(parsed.width,64);assert.equal(parsed.height,32);assert.equal(await f.count('appointments'),0);assert.equal(await f.count('appointment_confirmations'),0);assert.equal(f.sent.length,0);
});

test('new confirmed offers cannot silently fall back to unsigned scheduling when proposals are missing',async t=>{
  const f=await fixture(t,{legacy:true}),saved=await getOrder(f.env,f.order.id);saved.offer.requiresAppointmentSelection=true;await saveOrder(f.env,saved,saved.version,'TEST new flagged offer','test');
  const input=await f.inputFor(),response=await f.request(f.route,input);assert.equal(response.status,409);assert.match((await response.json()).error,/Terminvorschläge/);assert.equal((await getOrder(f.env,f.order.id)).acceptance,undefined);assert.equal(await f.count('appointments'),0);assert.equal(f.sent.length,0);
  const fresh=transition(transition({status:'Preise prüfen'},'price',{services:'TEST',totalCents:100},now),'confirm',{},now);assert.equal(fresh.offer.requiresAppointmentSelection,true);
});

test('charged pickup cannot be combined with customer-brings options at edit, confirm, accept or send',async t=>{
  const charged=transition({status:'Preise prüfen'},'price',{services:'TEST',totalCents:10000,pickupCents:1000},now);assert.throws(()=>transition(charged,'appointmentOptions',{options:options()},now),/Abholkosten/);
  const free=transition(transition({status:'Preise prüfen'},'price',{services:'TEST',totalCents:10000,pickupCents:0},now),'appointmentOptions',{options:options()},now),changed=transition(free,'price',{services:'TEST',totalCents:10000,pickupCents:1000},now);assert.throws(()=>transition(changed,'confirm',{},now),/Abholkosten/);
  const f=await fixture(t),order=await getOrder(f.env,f.order.id);order.offer.pickupCents=1000;const saved=await saveOrder(f.env,order,order.version,'TEST inconsistent fixture','test');assert.equal((await f.request(f.route,await f.inputFor())).status,409);await assert.rejects(providerOperations.action(f.env,saved,'sendOffer',{}),/Abholkosten/);assert.equal(await f.count('appointments'),0);assert.equal(f.sent.length,0);
});

test('offer delivery requires every proposal to remain in the future',async t=>{
  const f=await fixture(t),order=await getOrder(f.env,f.order.id);order.appointmentOptions[0].start='2000-01-01T00:00:00.000Z';const saved=await saveOrder(f.env,order,order.version,'TEST elapsed offer proposal','test');await assert.rejects(providerOperations.action(f.env,saved,'sendOffer',{}),/zukünftige/);assert.equal(f.sent.length,0);assert.equal(await f.count('jobs'),0);
});

test('expired offers or elapsed proposals cannot produce acceptance, appointment or mail',async t=>{
  const f=await fixture(t);let order=await getOrder(f.env,f.order.id);order.appointmentOptions[0].start='2000-01-01T10:00:00.000Z';order=await saveOrder(f.env,order,order.version,'TEST elapsed option','test');assert.equal((await f.request(f.route,await f.inputFor())).status,409);
  order.offer.expiresAt='2000-01-01T00:00:00.000Z';await saveOrder(f.env,order,order.version,'TEST expired offer','test');assert.equal((await f.request(f.route,await f.inputFor(f.route,order.appointmentOptions[1].id))).status,409);assert.equal(await f.count('appointments'),0);assert.equal(f.sent.length,0);
  await f.env.DB.prepare('UPDATE offer_tokens SET expires_at=? WHERE order_id=?').bind('2000-01-01T00:00:00.000Z',order.id).run();assert.equal((await f.request(f.route)).status,404);
});

test('overlapping competing customer acceptances have one winner; loser transaction creates no signature or email',async t=>{
  const f=await fixture(t),second=await f.addOrder({proposal:[{...options()[0],start:'2099-12-01T11:00'}]}),secondRoute='/api/offer/'+second.offerToken,firstInput=await f.inputFor(),secondInput=await f.inputFor(secondRoute),before=await f.count('audit');
  const responses=await Promise.all([f.request(f.route,firstInput),f.request(secondRoute,secondInput)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(await f.count('audit'),before+1);assert.equal(await f.count('appointments'),1);assert.equal(await f.count('appointment_confirmations'),1);assert.equal(f.sent.length,1);
  const orders=await Promise.all([getOrder(f.env,f.order.id),getOrder(f.env,second.id)]),loser=orders.find(o=>o.status==='Angebot offen');assert.equal(loser.acceptance,undefined);assert.equal(loser.appointment,undefined);
});

test('queue insertion failure rolls back combined signature, local appointment and audit together',async t=>{
  const f=await fixture(t),input=await f.inputFor(),before=await f.count('audit');await f.env.DB.prepare("CREATE TRIGGER reject_test_confirmation BEFORE INSERT ON appointment_confirmations BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END").run();assert.equal((await f.request(f.route,input)).status,500);const order=await getOrder(f.env,f.order.id);assert.equal(order.status,'Angebot offen');assert.equal(order.acceptance,undefined);assert.equal(await f.count('appointments'),0);assert.equal(await f.count('jobs'),0);assert.equal(await f.count('audit'),before);assert.equal(f.sent.length,0);
});

test('Google availability is read before the transaction; a busy calendar cannot save or email acceptance',async t=>{
  const f=await fixture(t),input=await f.inputFor();for(const [key,value] of Object.entries({calendarVerified:true,calendarOAuth:true,calendarId:'calendar@example.invalid',calendarExpiresAt:Date.now()+3600000}))await setting(f.env,key,value);await setting(f.env,'calendarToken',await protect(f.env,'synthetic-calendar-token'));await setting(f.env,'calendarRefreshToken',await protect(f.env,'synthetic-refresh-token'));let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init={})=>{calls++;assert.equal(new URL(url).origin,'https://www.googleapis.com');assert.equal(init.method,undefined);return Response.json({items:[{start:{dateTime:f.order.appointmentOptions[0].start},end:{dateTime:f.order.appointmentOptions[0].end}}]});});
  const response=await f.request(f.route,input);assert.equal(response.status,409);assert.equal(calls,1);assert.equal((await getOrder(f.env,f.order.id)).status,'Angebot offen');assert.equal(await f.count('appointments'),0);assert.equal(await f.count('appointment_confirmations'),0);
});

test('proposal lists do not reserve capacity, and operator cannot change the jointly signed appointment',async t=>{
  const f=await fixture(t);assert.equal(await f.count('appointments'),0);assert.equal(f.sent.length,0);const input=await f.inputFor();await f.request(f.route,input);const saved=await getOrder(f.env,f.order.id),before=await f.count('audit');
  assert.equal((await f.request('/api/action',{id:saved.id,version:saved.version,action:'appointment',input:options()[1]},'owner')).status,409);assert.equal((await f.request('/api/action',{id:saved.id,version:saved.version,action:'appointmentOptions',input:{options:options()}},'owner')).status,409);assert.equal(await f.count('audit'),before);assert.deepEqual((await getOrder(f.env,f.order.id)).appointment,saved.appointment);
});

test('confirmation uncertainty never sends again, including duplicate acceptance or maintenance',async t=>{
  const f=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('synthetic lost provider response');});const input=await f.inputFor(),response=await f.request(f.route,input);assert.equal(response.status,200);assert.equal((await response.json()).confirmationDelivery.state,'unknown');assert.equal((await getOrder(f.env,f.order.id)).status,'Termin verbindlich');await f.request(f.route,input);await pendingAppointmentConfirmations(f.env);await maintenance(f.env);assert.equal(calls,1);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='appointment-confirmation'").first()).state,'unknown');
});

test('paused confirmation retries safely once when enabled, but cancellation removes it before any send',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);const input=await f.inputFor(),response=await f.request(f.route,input);assert.equal(response.status,200);assert.equal((await response.json()).confirmationDelivery.state,'failed');assert.equal(f.sent.length,0);await setting(f.env,'sendApproved',true);await Promise.all([deliverAppointmentConfirmation(f.env,f.order.id),deliverAppointmentConfirmation(f.env,f.order.id)]);assert.equal(f.sent.length,1);
  const second=await f.addOrder({proposal:[options()[2]]}),route='/api/offer/'+second.offerToken;await setting(f.env,'sendApproved',false);await f.request(route,await f.inputFor(route));const saved=await getOrder(f.env,second.id);const cancelled=await f.request('/api/action',{id:saved.id,version:saved.version,action:'cancel',input:{reason:'TEST cancellation'}},'owner');assert.equal(cancelled.status,200);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE order_id=? AND kind='appointment-confirmation'").bind(second.id).first()).state,'cancelled');await setting(f.env,'sendApproved',true);assert.equal((await maintenance(f.env)).ok,true);assert.equal((await deliverAppointmentConfirmation(f.env,second.id)).state,'cancelled');assert.equal(f.sent.length,1);
});

test('stale pending provider attempt becomes unknown and synthetic combined acceptance remains externally blocked',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);await f.request(f.route,await f.inputFor());await f.env.DB.prepare("UPDATE jobs SET state='pending' WHERE kind='appointment-confirmation'").run();await setting(f.env,'sendApproved',true);assert.equal((await deliverAppointmentConfirmation(f.env,f.order.id)).state,'unknown');assert.equal(f.sent.length,0);
  const synthetic=await f.addOrder({isSynthetic:true,proposal:[options()[2]]}),route='/api/offer/'+synthetic.offerToken;let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('Synthetic external call forbidden');});const response=await f.request(route,await f.inputFor(route));assert.equal(response.status,200);assert.equal((await response.json()).confirmationDelivery.state,'test');assert.equal((await getOrder(f.env,synthetic.id)).status,'Termin verbindlich');assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM appointment_confirmations WHERE order_id=?').bind(synthetic.id).first()).n,0);await assert.rejects(providerOperations.action(f.env,await getOrder(f.env,synthetic.id),'sendOffer',{}),/Testbereich/);assert.equal(calls,0);
});

test('global background cleanup does not overwrite an active send of a long-queued confirmation',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);await f.request(f.route,await f.inputFor());await f.env.DB.prepare('UPDATE jobs SET created_at=? WHERE kind=?').bind('2000-01-01T00:00:00.000Z','appointment-confirmation').run();await setting(f.env,'sendApproved',true);
  let start,finish;const started=new Promise(resolve=>start=resolve),released=new Promise(resolve=>finish=resolve);t.mock.method(globalThis,'fetch',async()=>{start();await released;return Response.json({id:'synthetic-held-provider-id'});});
  const delivery=deliverAppointmentConfirmation(f.env,f.order.id);await started;await background(f.env);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='appointment-confirmation'").first()).state,'pending');finish();assert.equal((await delivery).state,'sent');const stored=await f.env.DB.prepare("SELECT state,provider_id FROM jobs WHERE kind='appointment-confirmation'").first();assert.equal(stored.state,'sent');assert.equal(stored.provider_id,'synthetic-held-provider-id');
});

test('cancellation while a pre-send check fails cannot turn the cancelled job back into failed',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);await f.request(f.route,await f.inputFor());await setting(f.env,'sendApproved',true);
  let signal,release;const checking=new Promise(resolve=>signal=resolve),unblocked=new Promise(resolve=>release=resolve),prepare=f.env.DB.prepare.bind(f.env.DB);
  t.mock.method(f.env.DB,'prepare',query=>{const statement=prepare(query);if(query==='SELECT key,value FROM settings')statement.all=async()=>{signal();await unblocked;throw Error('Synthetic pre-send check failure');};return statement;});
  const delivery=deliverAppointmentConfirmation(f.env,f.order.id);await checking;const saved=await getOrder(f.env,f.order.id);assert.equal((await f.request('/api/action',{id:saved.id,version:saved.version,action:'cancel',input:{reason:'TEST concurrent cancellation'}},'owner')).status,200);release();assert.equal((await delivery).state,'cancelled');assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='appointment-confirmation'").first()).state,'cancelled');assert.equal(f.sent.length,0);
});

test('old offers retain their historical acceptance semantics; new real offer mail requires proposal choices',async t=>{
  const f=await fixture(t,{legacy:true}),input=await f.inputFor();await assert.rejects(providerOperations.action(f.env,f.order,'sendOffer',{}),/Termine/);assert.equal(f.sent.length,0);assert.equal(await f.count('jobs'),0);const response=await f.request(f.route,input);assert.equal(response.status,200);assert.equal((await response.json()).status,'Angenommen');assert.equal(await f.count('appointments'),0);assert.equal(await f.count('appointment_confirmations'),0);
  const saved=await getOrder(f.env,f.order.id),scheduled=await f.request('/api/action',{id:saved.id,version:saved.version,action:'appointment',input:options()[0]},'owner');assert.equal(scheduled.status,200);assert.equal((await scheduled.json()).status,'Termin verbindlich');
});

test('customer one-use link and PIN redemption yields one session before the combined signature step',async t=>{
  const f=await fixture(t),access=await issueCustomerAccess(f.env,customer,'/angebot/'+f.order.offerToken),token=new URL(access.url).searchParams.get('token');
  const redeem=()=>f.request('/auth/redeem',{token,pin:access.pin},'anonymous'),responses=await Promise.all([redeem(),redeem()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const winner=responses.find(r=>r.status===200),cookie=winner.headers.get('set-cookie').split(';')[0];
  const visible=await(await f.app.fetch(new Request(origin+f.route,{headers:{cookie}}))).json(),id=visible.appointmentOptions[2].id,input={signature,paymentObligation:true,appointmentOptionId:id,snapshotHash:digest(JSON.stringify({...visible,selectedAppointmentOptionId:id}))};
  const response=await f.app.fetch(new Request(origin+f.route,{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify(input)}));assert.equal(response.status,200);assert.equal((await response.json()).status,'Termin verbindlich');assert.equal(f.sent.length,1);
});

test('pure confirmation renderer uses signed condition and free pickup and avoids duplicate operator recipients',()=>{
  const order={wg:'WG-TEST',synthetic:true,source:{name:'TEST Betreiber',email:COMPANY.email,vehicle:'TEST'},appointment:{start:'untrusted'},acceptance:{snapshotHash:'f'.repeat(64),appointmentOptionId:'option',at:now,snapshot:{offer:{totalCents:10000,pickupCents:0,condition:'TEST · signed condition',services:'TEST · signed services'},appointment:{id:'option',start:'2099-12-01T09:00:00.000Z',end:'2099-12-01T11:00:00.000Z',duration:120,delivery:'Abholung',location:'TEST · signed location'}}}};
  const message=appointmentConfirmationPayload(order,'test@example.invalid');assert.equal(message.from,'test@example.invalid');assert.deepEqual(message.to,[COMPANY.email]);assert.equal(message.cc,undefined);assert.match(message.text,/signed services/);assert.match(message.text,/signed location/);assert.match(message.text,/signed condition/);assert.match(message.text,/Im Festpreis enthaltene Abholung: 0,00\s*€/);assert.ok(!message.text.includes('untrusted'));
});
