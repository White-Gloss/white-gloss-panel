import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {getOrder,saveOrder,setting} from '../src/worker.mjs';
import {transition} from '../src/domain.mjs';
import {proposedCancellationPolicy} from '../src/customer-policy.mjs';
import {syntheticSignature} from './fixtures/signature.mjs';

async function fixture(t) {
  const origin = 'https://panel.example.invalid',owner = 'synthetic-owner@example.invalid',customer = 'synthetic-customer@example.invalid';
  const env = {PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async() => new Response('TEST shell')}};
  t.after(() => env.DB.close()); const app = await createApplication(env),time = Date.now();
  const cookies = {};
  for (const [who,email] of [['owner',owner],['customer',customer]]) {
    const token = digest(randomUUID()); cookies[who] = '__Host-wg-session='+token;
    await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(token),email,time+600000,time).run();
  }
  const policy = {...structuredClone(proposedCancellationPolicy),version:'TEST-acceptance-v1',approved:true,approvedBy:'TEST Betreiber',approvedAt:new Date(time-7200000).toISOString(),terms:'TEST: vollständiger, angenommener Wortlaut v1',legalReview:{approved:true,reviewer:'TEST Prüfer',reviewedAt:new Date(time-10800000).toISOString(),evidence:'TEST konkrete Vertragsprüfung'}};
  await setting(env,'cancellationPolicy',policy);
  const at = new Date(time).toISOString(),id = randomUUID();
  let order = {id,wg:'TEST-ACCEPTANCE',version:1,status:'Preise prüfen',synthetic:true,source:{name:'Synthetischer Kunde',email:customer,vehicle:'TEST Fahrzeug'},payments:[]};
  order = transition(order,'price',{services:'TEST Leistung',condition:'TEST geprüfter Zustand',totalCents:10000,pickupCents:0},at);
  order = transition(order,'appointmentOptions',{options:[{start:'2099-12-01T10:00',duration:120,delivery:'Kunde bringt',location:'TEST Betrieb'}]},at);
  await env.DB.prepare('INSERT INTO orders(id,wg,version,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,order.wg,1,order.status,JSON.stringify(order),at,'test','Isolierter Annahmetest').run();
  let fetchCalls = 0;t.mock.method(globalThis,'fetch',async() => {fetchCalls++;throw Error('Kein externer Aufruf im Annahmetest.');});
  const request = (path,body,who='customer') => app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie:cookies[who],...(body===undefined?{}:{origin,'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  assert.equal((await request('/api/action',{id,version:1,action:'confirm',input:{}},'owner')).status,200);
  const confirmed = await getOrder(env,id),route = '/api/offer/'+confirmed.offerToken;
  const visible = await (await request(route)).json(),appointmentOptionId = visible.appointmentOptions[0].id;
  const input = {signature:syntheticSignature,paymentObligation:true,appointmentOptionId,snapshotHash:digest(JSON.stringify({...visible,selectedAppointmentOptionId:appointmentOptionId}))};
  return {env,id,policy,request,route,input,fetchCalls:() => fetchCalls};
}

test('confirmed policy must be personally accepted and persists the version displayed before signing',async t => {
  const f = await fixture(t),confirmed = await getOrder(f.env,f.id);
  assert.deepEqual(confirmed.offer.cancellationPolicy,f.policy);
  for (const extra of [{},{cancellationTermsAccepted:false,cancellationVersion:f.policy.version},{cancellationTermsAccepted:true,cancellationVersion:'TEST-other-version'}]) {
    const response = await f.request(f.route,{...f.input,...extra}); assert.equal(response.status,409);
    assert.equal((await getOrder(f.env,f.id)).acceptance,undefined);
  }
  const response = await f.request(f.route,{...f.input,cancellationTermsAccepted:true,cancellationVersion:f.policy.version});
  assert.equal(response.status,200);const accepted = await getOrder(f.env,f.id);
  assert.equal(accepted.status,'Termin verbindlich');assert.deepEqual(accepted.cancellationTerms.policy,f.policy);
  assert.equal(accepted.cancellationTerms.acceptance.role,'customer');assert.equal(accepted.cancellationTerms.acceptance.orderId,f.id);
  assert.equal(accepted.cancellationTerms.acceptance.version,f.policy.version);assert.equal(accepted.cancellationTerms.acceptance.at,accepted.acceptance.at);
  await setting(f.env,'cancellationPolicy',{...f.policy,version:'TEST-current-v2',terms:'TEST: neuer Wortlaut v2'});
  const agreement = await f.request('/api/customer-portal/agreement?id='+encodeURIComponent(f.id));assert.equal(agreement.status,200);
  const signedCopy = await agreement.text();assert.ok(signedCopy.includes(f.policy.terms));assert.ok(signedCopy.includes(f.policy.version));assert.ok(!signedCopy.includes('TEST-current-v2'));
  const preview = await f.request('/api/cancellation/preview',{id:f.id,input:{reason:'customer'}},'owner');assert.equal(preview.status,200);
  const result = await preview.json();assert.equal(result.eligible,true);assert.equal(result.policyVersion,f.policy.version);
  assert.equal(f.fetchCalls(),0);
});

test('a newer approved global policy cannot create retrospective fees for an old accepted order',async t => {
  const f = await fixture(t),order = await getOrder(f.env,f.id);
  order.status = 'Termin verbindlich';order.acceptance = {at:new Date().toISOString()};order.appointment = order.appointmentOptions[0];delete order.offer.cancellationPolicy;
  await saveOrder(f.env,order,order.version,'TEST Altauftrag ohne angenommene Stornobedingungen','test');
  const response = await f.request('/api/cancellation/preview',{id:f.id,input:{reason:'customer'}},'owner');assert.equal(response.status,200);
  const result = await response.json();assert.equal(result.eligible,false);assert.equal(result.issueAllowed,false);
  assert.match(result.blocked.join(' '),/Keine rückwirkende/);assert.equal((await getOrder(f.env,f.id)).cancellationTerms,undefined);
  assert.equal(f.fetchCalls(),0);
});
