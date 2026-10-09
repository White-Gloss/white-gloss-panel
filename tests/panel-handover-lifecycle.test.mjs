import test from 'node:test';
import assert from 'node:assert/strict';
import {handoverFixture,ok,syntheticSignature} from './fixtures/handover.mjs';
test('cancelled operator-signed handover preserves immutable original for owner and blocks customer signature',async t=>{
  const f=await handoverFixture(t);const order=await f.publish(await f.add()),original=structuredClone(order.handovers.intake),preview=await ok(f.req('/api/records-lifecycle?kind=project&id='+order.id)),doc=preview.documents.find(d=>d.key==='handover:intake');assert.ok(doc);
  await ok(f.req('/api/records-lifecycle',{action:'documentCancel',id:order.id,version:order.version,documentKey:doc.key,documentHash:doc.hash,reason:'TEST Protokollinhalt korrigieren',confirmed:true}));
  const saved=await f.current(order);assert.deepEqual(saved.handovers.intake,original);assert.equal(saved.documentCancellations.length,1);
  const path='/api/handover/'+original.token,archived=await ok(f.req(path));assert.equal(archived.status,'cancelled');assert.equal(archived.ownerPreview,true);assert.equal(archived.cancellation.reason,'TEST Protokollinhalt korrigieren');assert.equal(archived.hash,original.hash);
  assert.equal((await f.req(path,undefined,'customer')).status,404);assert.equal((await f.req(path,{snapshotHash:original.hash,signature:syntheticSignature,confirmed:true},'customer')).status,404);assert.equal((await f.req(path+'/asset/'+original.protocol.operatorSignature)).status,200);assert.equal((await f.current(order)).intake,undefined);
});
test('existing operator signature prevents later appointment proposal and blocked customer signature',async t=>{
  const f=await handoverFixture(t);let order=await f.publish(await f.add());const response=await f.req('/api/calendar/adjustments',{action:'propose',orderId:order.id,orderVersion:order.version,start:'2035-10-09T10:00',end:'2035-10-09T12:00',reason:'TEST Terminverschiebung'});assert.equal(response.status,409);
  order=await f.update(order,{recordsRestriction:{status:'blocked'}});assert.equal((await f.req('/api/handover/'+order.handovers.intake.token,{snapshotHash:order.handovers.intake.hash,signature:syntheticSignature,confirmed:true},'customer')).status,409);assert.equal((await f.current(order)).intake,undefined);
});
