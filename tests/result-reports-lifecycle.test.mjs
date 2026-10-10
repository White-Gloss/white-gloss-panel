import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {init,getOrder} from '../src/worker.mjs';
import {digest} from '../server/auth.mjs';
import {customerFilesSchema,customerFiles} from '../server/customer-files.mjs';
import {resultReportsSchema} from '../server/result-reports.mjs';
import {recordsLifecycleSchema,customerLifecyclePreview,changeCustomerLifecycle} from '../server/records-lifecycle.mjs';

const owner='owner@example.invalid',at='2026-10-10T08:00:00.000Z';
async function fixture(t){
  const env={DB:new PanelDatabase(':memory:'),OWNER_EMAIL_SHA256:digest(owner),PANEL_ORIGIN:'https://panel.example.invalid'};
  t.after(()=>env.DB.close());await init(env);await customerFilesSchema(env);await recordsLifecycleSchema(env);await resultReportsSchema(env);
  async function order(email='customer@example.invalid'){
    const id=crypto.randomUUID(),source={name:'TEST Kunde',email,vehicle:'TEST Fahrzeug',plate:'TEST-1'},data={id,source,synthetic:true,status:'Erledigt',notes:[],payments:[],createdAt:at,updatedAt:at};
    await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,1)').bind(id,'TEST-'+id.slice(0,8),data.status,JSON.stringify(data),at,'test','synthetic fixture').run();
    const files=await customerFiles(env,true),linked=files.orders.find(item=>item.id===id);
    return {id,source,customerId:linked.customerId,vehicleId:linked.vehicleId};
  }
  async function report(o){
    const data={customerId:o.customerId,vehicleId:o.vehicleId,vehicle:o.source.vehicle,entries:[],completedServices:'Tatsächlich ausgeführte TEST-Pflege',completionConfirmedAt:at,customerReleased:true,grants:[{id:'test-grant',assetId:'test-photo',purpose:'Website',consentDate:'2026-10-09',evidence:'SYNTHETIC EXPLICIT CONSENT',recordedAt:at,revokedAt:null}],masks:{}};
    await env.DB.prepare('INSERT INTO result_reports VALUES(?,1,?,?)').bind(o.id,JSON.stringify(data),at).run();return data;
  }
  async function mask(o){
    const original=crypto.randomUUID(),id=crypto.randomUUID(),hash='a'.repeat(64),sourceHash='b'.repeat(64);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(original,o.id,'photo','image/png',sourceHash,3,at),
      env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(id,o.id,'advertising-mask','image/png',hash,3,at),
      env.DB.prepare('INSERT INTO result_mask_previews VALUES(?,?,?,?,?,?,?)').bind(id,o.id,original,sourceHash,hash,JSON.stringify({rectangles:[{x:0,y:0,width:0.1,height:0.1}]}),at)
    ]);return id;
  }
  const preview=o=>customerLifecyclePreview(env,o.customerId,owner);
  const change=(p,mode='block')=>changeCustomerLifecycle(env,{...p,mode,reason:'TEST · geprüfte Aktenbearbeitung',confirmed:true},owner);
  return {env,order,report,mask,preview,change};
}

test('lifecycle names reports and masks, prevents deletion and preserves evidence in the blocked archive',async t=>{
  const f=await fixture(t),o=await f.order(),report=await f.report(o),mask=await f.mask(o),p=await f.preview(o);
  assert.equal(p.counts.resultReports,1);assert.equal(p.counts.resultMaskPreviews,1);assert.equal(p.canDelete,false);
  assert.ok(p.documents.some(item=>item.key==='resultReport:'+o.id&&item.label.includes('Bildfreigaben')));
  assert.match(p.reasons.join(' '),/Maskierungsnachweise/);
  await assert.rejects(f.change(p,'delete'),error=>error.status===409);
  const before=await f.env.DB.prepare('SELECT * FROM result_mask_previews WHERE id=?').bind(mask).first();
  await f.change(p,'anonymize');
  const customer=JSON.parse((await f.env.DB.prepare('SELECT data FROM customer_files WHERE id=?').bind(o.customerId).first()).data);
  assert.equal(customer.email,'');assert.equal(customer.lifecycle.status,'anonymized');
  assert.equal((await getOrder(f.env,o.id)).recordsRestriction.status,'anonymized');
  assert.deepEqual(JSON.parse((await f.env.DB.prepare('SELECT data FROM result_reports WHERE order_id=?').bind(o.id).first()).data),report);
  assert.deepEqual(await f.env.DB.prepare('SELECT * FROM result_mask_previews WHERE id=?').bind(mask).first(),before);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM assets WHERE order_id=?').bind(o.id).first()).n,2);
  const revision=JSON.parse((await f.env.DB.prepare('SELECT data FROM records_revisions WHERE entity_id=?').bind(o.customerId).first()).data);
  assert.equal(revision.affected.resultReports,1);assert.equal(revision.affected.resultMaskPreviews,1);
});

test('a report created after the displayed lifecycle preview invalidates it without an order version change',async t=>{
  const f=await fixture(t),o=await f.order(),p=await f.preview(o);
  await f.report(o);assert.equal((await getOrder(f.env,o.id)).version,1);
  await assert.rejects(f.change(p),error=>error.status===409);
  assert.equal((await getOrder(f.env,o.id)).recordsRestriction,undefined);
});

test('image permission changes invalidate lifecycle previews even when report row count stays unchanged',async t=>{
  const f=await fixture(t),o=await f.order();await f.report(o);const p=await f.preview(o);
  await f.env.DB.prepare("UPDATE result_reports SET data=json_set(data,'$.grants[0].revokedAt',?),version=version+1 WHERE order_id=?").bind(at,o.id).run();
  await assert.rejects(f.change(p),error=>error.status===409);
  assert.equal((await getOrder(f.env,o.id)).version,1);
});

test('a report release racing the final lifecycle transaction rolls all lifecycle writes back',async t=>{
  const f=await fixture(t),o=await f.order();await f.report(o);const p=await f.preview(o),batch=f.env.DB.batch.bind(f.env.DB);let armed=true;
  f.env.DB.batch=async statements=>{if(armed){armed=false;await batch([f.env.DB.prepare("UPDATE result_reports SET data=json_set(data,'$.customerReleased',json('false')),version=version+1 WHERE order_id=?").bind(o.id)]);}return batch(statements);};
  await assert.rejects(f.change(p,'anonymize'),error=>error.status===409);
  const customer=await f.env.DB.prepare('SELECT * FROM customer_files WHERE id=?').bind(o.customerId).first();
  assert.equal(customer.version,p.version);assert.equal(JSON.parse(customer.data).email,o.source.email);
  assert.equal((await getOrder(f.env,o.id)).version,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM records_revisions').first()).n,0);
  assert.equal((await f.env.DB.prepare('SELECT version FROM result_reports WHERE order_id=?').bind(o.id).first()).version,2);
});

test('a new report racing the final lifecycle transaction is detected by the empty report snapshot',async t=>{
  const f=await fixture(t),o=await f.order(),p=await f.preview(o),batch=f.env.DB.batch.bind(f.env.DB);let armed=true;
  f.env.DB.batch=async statements=>{if(armed){armed=false;await f.report(o);}return batch(statements);};
  await assert.rejects(f.change(p),error=>error.status===409);
  assert.equal((await getOrder(f.env,o.id)).recordsRestriction,undefined);
  assert.equal((await f.env.DB.prepare('SELECT version FROM customer_files WHERE id=?').bind(o.customerId).first()).version,p.version);
});

test('mask evidence updates are checked inside the lifecycle transaction independently of asset IDs',async t=>{
  const f=await fixture(t),o=await f.order(),mask=await f.mask(o),p=await f.preview(o),batch=f.env.DB.batch.bind(f.env.DB);let armed=true;
  f.env.DB.batch=async statements=>{if(armed){armed=false;await batch([f.env.DB.prepare('UPDATE result_mask_previews SET data=? WHERE id=?').bind(JSON.stringify({rectangles:[],noPlateVisible:true}),mask)]);}return batch(statements);};
  await assert.rejects(f.change(p),error=>error.status===409);
  assert.equal((await getOrder(f.env,o.id)).version,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM assets WHERE order_id=?').bind(o.id).first()).n,2);
});

test('another customer report does not change the scoped lifecycle proof',async t=>{
  const f=await fixture(t),own=await f.order(),other=await f.order('other@example.invalid'),p=await f.preview(own);
  await f.report(other);await f.mask(other);
  await f.change(p);
  assert.equal((await getOrder(f.env,own.id)).recordsRestriction.status,'blocked');
  assert.equal((await getOrder(f.env,other.id)).recordsRestriction,undefined);
});

test('existing standalone-customer deletion remains available with empty report tables',async t=>{
  const f=await fixture(t),id='test-standalone';
  await f.env.DB.prepare('INSERT INTO customer_files(id,data,synthetic) VALUES(?,?,1)').bind(id,JSON.stringify({name:'TEST Unlinked',email:''})).run();
  const p=await f.preview({customerId:id});assert.equal(p.canDelete,true);assert.equal(p.counts.resultReports,0);assert.equal(p.counts.resultMaskPreviews,0);
  await f.change(p,'delete');assert.equal(await f.env.DB.prepare('SELECT * FROM customer_files WHERE id=?').bind(id).first(),null);
});
