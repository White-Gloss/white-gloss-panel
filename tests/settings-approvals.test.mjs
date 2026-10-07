import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {setting,settings} from '../src/worker.mjs';
import {cancellationPolicyErrors,proposedCancellationPolicy,reviewPolicyErrors} from '../src/customer-policy.mjs';

async function fixture(t){
  const origin='https://panel.example.invalid',owner='operator@example.invalid',env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,12).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('synthetic shell')}};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+600000,Date.now()).run();
  const save=input=>app.fetch(new Request(origin+'/api/settings',{method:'POST',headers:{origin,'Content-Type':'application/json',cookie:'__Host-wg-session='+raw},body:JSON.stringify(input)}));
  return {env,save};
}
function cancellation(){const policy={...structuredClone(proposedCancellationPolicy),version:'synthetic-settings-policy-v1',approved:true,approvedBy:'Synthetic operator',approvedAt:'2020-01-01T12:00:00Z',terms:'Synthetic accepted wording for isolated test only.',legalReview:{approved:true,reviewer:'Synthetic reviewer',reviewedAt:'2020-01-01T11:00:00Z',evidence:'Synthetic isolated legal proof'}};assert.deepEqual(cancellationPolicyErrors(policy),[]);return policy;}
function review(){const policy={active:true,approved:true,approvedBy:'Synthetic operator',approvedAt:'2020-01-01T12:00:00Z',version:'synthetic-settings-review-v1',channel:'email',schedule:'elapsed-72-hours',timeZone:'Europe/Berlin',googleUrl:'https://g.page/r/SYNTHETIC-SETTINGS/review',googleUrlVerified:true,googleUrlVerifiedAt:'2020-01-01T11:00:00Z',googleUrlEvidence:'Synthetic verified target only',optOutText:'Synthetic withdrawal in customer panel.'};assert.deepEqual(reviewPolicyErrors(policy),[]);return policy;}

test('combined document approvals reject invalid cash evidence before changing valid Qonto approval',async t=>{
  const {env,save}=await fixture(t);for(const [key,value] of Object.entries({qontoDocumentLayoutApproved:false,qontoDocumentLayoutEvidence:'Synthetic previous Qonto evidence',cashRecordingApproved:false,cashSystemEvidence:'Synthetic previous cash evidence'}))await setting(env,key,value);
  const before=await settings(env),response=await save({qontoDocumentLayoutApproved:true,qontoDocumentLayoutEvidence:'Synthetic valid Qonto layout proof',cashRecordingApproved:true,cashSystemEvidence:''});assert.equal(response.status,409);assert.deepEqual(await settings(env),before);
});
test('combined policy approvals reject invalid review settings without saving otherwise valid cancellation policy',async t=>{
  const {env,save}=await fixture(t);await setting(env,'reviewPolicy',{active:false});const before=await settings(env),response=await save({cancellationPolicy:cancellation(),reviewPolicy:{...review(),googleUrlVerified:false}});assert.equal(response.status,409);assert.deepEqual(await settings(env),before);assert.equal((await settings(env)).cancellationPolicy,undefined);
});
test('combined approvals still save all explicitly valid document and customer policy fields',async t=>{
  const {env,save}=await fixture(t),cancellationPolicy=cancellation(),reviewPolicy=review(),response=await save({cancellationPolicy,reviewPolicy,qontoDocumentLayoutApproved:true,qontoDocumentLayoutEvidence:'Synthetic Qonto proof',cashRecordingApproved:true,cashSystemEvidence:'Synthetic cash and TSE proof'});assert.equal(response.status,200);const saved=await settings(env);assert.deepEqual(saved.cancellationPolicy,cancellationPolicy);assert.deepEqual(saved.reviewPolicy,reviewPolicy);assert.equal(saved.qontoDocumentLayoutApproved,true);assert.equal(saved.cashRecordingApproved,true);assert.equal(saved.qontoDocumentLayoutEvidence,'Synthetic Qonto proof');assert.equal(saved.cashSystemEvidence,'Synthetic cash and TSE proof');
});
