import test from 'node:test';
import assert from 'node:assert/strict';
import {handoverFixture,ok,origin,customer,foreign,syntheticSignature} from './fixtures/handover.mjs';

test('customer portal lists own pending handovers and reveals signed documents only after completion',async t=>{
  const f=await handoverFixture(t),one=await f.publish(await f.add()),two=await f.publish(await f.add()),other=await f.publish(await f.add({source:{name:'TEST foreign customer',email:foreign,vehicle:'TEST foreign car'}}));
  const portal=await ok(f.req('/api/customer-portal',undefined,'customer'));
  assert.equal(portal.orders.length,2);assert.ok(!portal.orders.some(order=>order.id===other.id));
  assert.ok(!JSON.stringify(portal).includes('PRIVATE OPERATOR NOTE'));
  for(const order of [one,two]){
    const row=portal.orders.find(item=>item.id===order.id);assert.deepEqual(row.handovers,[{kind:'intake',status:'pending',url:'/protokoll/'+order.handovers.intake.token,operatorSignedAt:order.handovers.intake.operatorSignedAt,customerSignedAt:null}]);
    assert.ok(!row.documents.some(doc=>doc.kind==='intake'));
    assert.equal((await f.req('/api/customer-portal/document?id='+order.id+'&kind=intake',undefined,'customer')).status,404);
  }
  const complete=(await f.complete(one)).order,updated=(await ok(f.req('/api/customer-portal',undefined,'customer'))).orders.find(item=>item.id===one.id);
  assert.equal(updated.handovers[0].status,'completed');assert.equal(updated.handovers[0].customerSignedAt,complete.handovers.intake.customerSignedAt);
  const document=updated.documents.find(item=>item.kind==='intake');assert.ok(document);
  const response=await f.req(document.url,undefined,'customer');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');
  assert.equal((await f.req(document.url,undefined,'foreign')).status,404);
  assert.equal((await f.req('/api/customer-portal/document?id='+other.id+'&kind=intake',undefined,'customer')).status,404);
});

test('existing personal PIN opens a handover directly and works again after offer expiry and signing',async t=>{
  const f=await handoverFixture(t);let order=await f.add({synthetic:false});const access=await f.activate(order);order=await f.publish(order);
  const path='/protokoll/'+order.handovers.intake.token;
  const anonymous=await f.req(path,undefined,'');assert.equal(anonymous.status,303);assert.equal(new URL(anonymous.headers.get('location')).searchParams.get('returnTo'),path);
  await f.env.DB.prepare('UPDATE offer_tokens SET expires_at=? WHERE order_id=?').bind('2020-01-01T00:00:00Z',order.id).run();
  const logged=await f.req('/auth/customer/login',{email:customer.toUpperCase(),pin:access.pin,returnTo:path},'');assert.equal(logged.status,200);assert.equal((await logged.json()).returnTo,path);
  const cookie=logged.headers.get('set-cookie').split(';')[0],view=await f.displayed(order,'intake',cookie);
  assert.equal(view.ownerPreview,false);assert.equal((await f.req(path,undefined,cookie)).status,200);
  await ok(f.req('/api/handover/'+order.handovers.intake.token,{snapshotHash:view.hash,signature:syntheticSignature,confirmed:true},cookie));
  const again=await f.req('/auth/customer/login',{email:customer,pin:access.pin,returnTo:path},'');assert.equal(again.status,200);assert.equal((await again.json()).returnTo,path);
  const completed=await f.displayed(order,'intake',again.headers.get('set-cookie').split(';')[0]);assert.equal(completed.status,'completed');assert.ok(completed.customerSignedAt);
  assert.equal((await f.req('/api/state',undefined,cookie)).status,403);
});

test('personal PIN return targets cannot select a foreign, revoked or missing protocol',async t=>{
  const f=await handoverFixture(t),own=await f.add({synthetic:false}),access=await f.activate(own),other=await f.publish(await f.add({synthetic:false,source:{name:'TEST foreign customer',email:foreign,vehicle:'TEST'}}));
  const pending=await f.publish(own),ownPath='/protokoll/'+pending.handovers.intake.token;
  await f.env.DB.prepare('UPDATE handover_tokens SET revoked=1 WHERE order_id=?').bind(pending.id).run();
  for(const returnTo of ['/protokoll/'+other.handovers.intake.token,ownPath,'/protokoll/'+'f'.repeat(64),'https://foreign.invalid/protokoll/'+pending.handovers.intake.token]){
    const response=await f.req('/auth/customer/login',{email:customer,pin:access.pin,returnTo},'');assert.equal(response.status,200);assert.equal((await response.json()).returnTo,'/kundenportal');
  }
  const logged=await f.req('/auth/customer/login',{email:customer,pin:access.pin},'');assert.equal(logged.status,200);const cookie=logged.headers.get('set-cookie').split(';')[0];
  assert.equal((await f.req('/api/handover/'+pending.handovers.intake.token,undefined,cookie)).status,404);
  const portal=await ok(f.req('/api/customer-portal',undefined,cookie));assert.equal(portal.orders.find(item=>item.id===pending.id).handovers.length,0);
});

test('handover pages and APIs remain personal while preparing and publishing stay operator-only',async t=>{
  const f=await handoverFixture(t),pending=await f.publish(await f.add()),token=pending.handovers.intake.token,view=await f.displayed(pending);
  assert.equal((await f.req('/protokoll/'+token,undefined,'customer')).status,200);
  const wrong=await f.req('/api/handover/'+token,undefined,'foreign');assert.equal(wrong.status,403);
  assert.equal((await f.req('/api/handover/'+token,{snapshotHash:view.hash,signature:syntheticSignature,confirmed:true},'owner')).status,403);
  for(const path of ['/api/handover/prepare','/api/handover/publish','/api/action','/api/asset/'+view.protocol.photos[0]]){
    assert.equal((await f.req(path,path.startsWith('/api/asset/')?undefined:{id:pending.id,version:pending.version},'customer')).status,403,path);
  }
  assert.equal((await f.req('/api/handover/'+token,undefined,'')).status,401);
  const redirected=await f.req('/protokoll/'+token,undefined,'');assert.equal(redirected.status,303);assert.equal(new URL(redirected.headers.get('location')).origin,origin);
});

test('owner access readiness reflects a personal PIN without storing or exposing it in orders',async t=>{
  const f=await handoverFixture(t),order=await f.add({synthetic:false});
  let row=(await ok(f.req('/api/state'))).orders.find(item=>item.id===order.id);assert.equal(row.customerPortalAccess.ready,false);
  const access=await f.activate(order);row=(await ok(f.req('/api/state'))).orders.find(item=>item.id===order.id);assert.equal(row.customerPortalAccess.ready,true);assert.equal(row.customerPortalAccess.url,'/kundenportal');
  assert.ok(!JSON.stringify(row).includes(access.pin));assert.equal((await f.current(order)).customerPortalAccess,undefined);
  assert.equal((await f.req('/api/state',undefined,access.cookie)).status,403);
});

test('a later customer reassignment cannot expose an earlier signed remote protocol PDF',async t=>{
  const f=await handoverFixture(t),pending=await f.publish(await f.add()),signed=(await f.complete(pending)).order;
  await f.update(signed,{source:{...signed.source,email:foreign}});
  const portal=await ok(f.req('/api/customer-portal',undefined,'foreign')),row=portal.orders.find(order=>order.id===signed.id);
  assert.ok(row);assert.equal(row.handovers.length,0);assert.ok(!row.documents.some(document=>document.kind==='intake'));
  assert.equal((await f.req('/api/customer-portal/document?id='+signed.id+'&kind=intake',undefined,'foreign')).status,404);
  assert.equal((await f.req('/api/handover/'+signed.handovers.intake.token,undefined,'foreign')).status,403);
});
