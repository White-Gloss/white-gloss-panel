import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import worker,{init,getOrder,setting} from '../src/worker.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {digest} from '../server/auth.mjs';
import {cancellationSnapshot,proposedCancellationPolicy} from '../src/customer-policy.mjs';

async function fixture(t) {
  const email = 'synthetic-owner@example.invalid',env = {DB:new PanelDatabase(':memory:'),OWNER_EMAIL_SHA256:digest(email)};
  t.after(() => env.DB.close()); await init(env);
  const time = Date.now(),at = new Date(time-3600000).toISOString(),id = randomUUID();
  const policy = {...structuredClone(proposedCancellationPolicy),version:'TEST-accepted-v1',approved:true,approvedBy:'TEST Betreiber',approvedAt:new Date(time-7200000).toISOString(),terms:'TEST: angenommener Wortlaut v1',legalReview:{approved:true,reviewer:'TEST Prüfer',reviewedAt:new Date(time-10800000).toISOString(),evidence:'TEST konkrete Vertragsprüfung'}};
  const order = {id,wg:'TEST-CANCELLATION',version:1,status:'Termin verbindlich',synthetic:true,source:{name:'Synthetischer Kunde'},offer:{totalCents:10000,services:'TEST Leistung'},acceptance:{at},appointment:{start:new Date(time+48*3600000).toISOString()},payments:[]};
  order.cancellationTerms = cancellationSnapshot(policy,{accepted:true,role:'customer',orderId:id,customerId:'TEST-customer',at,version:policy.version},time);
  await env.DB.prepare('INSERT INTO orders(id,wg,version,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,order.wg,1,order.status,JSON.stringify(order),at,'test','Isolierter Versionstest').run();
  await setting(env,'cancellationPolicy',{...policy,version:'TEST-current-v2',terms:'TEST: neuer Wortlaut v2'});
  const input = {reason:'customer',documentedLossCents:10000,sparedCostsCents:0,replacementEarningsCents:0,lossEvidence:'TEST Verlustbeleg'};
  const request = async(path,body) => worker.fetch(new Request('https://panel.example.invalid'+path,{method:'POST',headers:{origin:'https://panel.example.invalid','content-type':'application/json','oai-authenticated-user-email':email},body:JSON.stringify(body)}),env);
  return {env,id,input,request};
}

test('preview retains the accepted cancellation version after the global policy changes',async t => {
  const f = await fixture(t),response = await f.request('/api/cancellation/preview',{id:f.id,input:f.input});
  assert.equal(response.status,200); const result = await response.json();
  assert.equal(result.eligible,true); assert.equal(result.policyVersion,'TEST-accepted-v1'); assert.equal(result.maxFeeCents,5000);
  assert.equal((await getOrder(f.env,f.id)).version,1);
});

test('manual cancellation records the accepted version rather than the latest global policy',async t => {
  const f = await fixture(t),response = await f.request('/api/action',{id:f.id,version:1,action:'cancel',input:{reason:'TEST: Absage nach persönlicher Rücksprache',feeDecision:{...f.input,feeCents:0,waiverReason:'TEST: persönliche Kulanzentscheidung'}}});
  assert.equal(response.status,200); const saved = await getOrder(f.env,f.id);
  assert.equal(saved.status,'Storniert'); assert.equal(saved.cancellationDecision.policyVersion,'TEST-accepted-v1');
  assert.equal(saved.cancellationDecision.confirmed,true); assert.equal(saved.cancellationDecision.feeCents,0);
  assert.equal(saved.cancellationDecision.issueAllowed,false); assert.equal(saved.invoice,undefined);
});
