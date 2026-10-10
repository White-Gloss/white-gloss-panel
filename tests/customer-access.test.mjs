import test from 'node:test';
import assert from 'node:assert/strict';
import {handoverFixture,ok,customer,foreign,owner,syntheticSignature} from './fixtures/handover.mjs';
import {digest} from '../server/auth.mjs';
import {customerAccessResolve,customerAccessGuards} from '../src/customer-access.mjs';
import {resultReportsHTML} from '../public/result-reports.js';

const path=o=>'/api/customer-access?id='+o.id;
const portal=f=>ok(f.req('/api/customer-portal',undefined,'customer'));
async function updateLink(f,o,extra={}){const data=await ok(f.req(path(o))),link=data.links.find(item=>item.type==='handover')??data.links[0];return f.req(path(o),{action:'link',version:data.version,hash:link.hash,linkVersion:link.version,expiresAt:link.expiresAt??new Date(Date.now()+86400000).toISOString(),revoked:true,confirmed:true,...extra});}

test('only personally confirmed pickup release changes customer status; saved signature and price remain unchanged',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add({status:'Erledigt'}),original=await f.current(o),request={action:'pickup',version:1,released:true,confirmed:true,instructions:'TEST · Bitte Schlüssel bereithalten.'};
  assert.equal((await portal(f)).orders[0].customerStatus,'Arbeiten abgeschlossen');assert.equal((await portal(f)).orders[0].pickup,null);
  assert.equal((await f.req(path(o),request,'customer')).status,403);assert.equal((await f.req(path(o),request,'foreign',{'oai-authenticated-user-email':owner})).status,403);assert.equal((await f.req(path(o),request,'')).status,401);
  assert.equal((await f.req(path(o),request,'owner',{Origin:'https://foreign.invalid'})).status,403);assert.equal((await f.req(path(o),{...request,confirmed:false})).status,400);
  const data=await ok(f.req(path(o),request));assert.equal(data.customerStatus,'Abholbereit');const visible=(await portal(f)).orders[0];assert.equal(visible.customerStatus,'Abholbereit');assert.equal(visible.pickup.instructions,request.instructions);assert.ok(!JSON.stringify(visible).includes('PRIVATE OPERATOR NOTE'));
  const changed=await f.current(o);assert.deepEqual(changed.acceptance,original.acceptance);assert.deepEqual(changed.offer,original.offer);assert.equal(changed.pickupReleaseHistory[0].identity,owner);
  assert.equal((await f.req(path(o),request)).status,409);
  await ok(f.req(path(o),{...request,version:changed.version,released:false}));assert.equal((await portal(f)).orders[0].pickup,null);assert.equal((await f.current(o)).pickupReleaseHistory.length,2);
});

test('pickup is denied before work, after signed return, and on restricted records',async t=>{
  const f=await handoverFixture(t,{withTemplate:false});
  for(const extra of [{status:'Termin verbindlich'},{status:'Erledigt',return:{signaturesConfirmed:true}},{status:'Erledigt',recordsRestriction:{status:'blocked'}}]){const o=await f.add(extra),response=await f.req(path(o),{action:'pickup',version:1,released:true,confirmed:true});assert.equal(response.status,409);assert.equal((await f.current(o)).pickupRelease,undefined);}
});

test('portal shows confirmed appointment only; a pending draft or mismatched accepted snapshot is hidden',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),confirmed=await f.add(),draft=await f.add({status:'Angenommen'}),unsigned=await f.add({acceptance:null}),stale=await f.add({acceptance:{at:new Date().toISOString(),appointmentOptionId:'test',snapshotHash:'original',snapshot:{appointment:{start:'2030-01-01T00:00:00Z'}}}});
  const data=await portal(f);assert.deepEqual(data.orders.find(o=>o.id===confirmed.id).appointment,confirmed.appointment);
  for(const o of [draft,unsigned,stale])assert.equal(data.orders.find(item=>item.id===o.id).appointment,null);
});

test('new handover link has a 30-day limit and reading links creates no business mutation',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add();await f.publish(o);const published=await f.current(o),hash=digest(published.handovers.intake.token),control=await f.env.DB.prepare('SELECT * FROM customer_link_controls WHERE hash=?').bind(hash).first();
  assert.ok(Date.parse(control.expires_at)>Date.now()+29*86400000);assert.ok(Date.parse(control.expires_at)<=Date.now()+30*86400000);assert.equal(control.revoked,0);
  const before=await f.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first(),assets=(await f.env.DB.prepare('SELECT COUNT(*) n FROM assets').first()).n,jobs=(await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n;
  for(let n=0;n<2;n++){await ok(f.req(path(o)));await f.displayed(published);await portal(f);}
  assert.deepEqual(await f.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first(),before);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM assets').first()).n,assets);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,jobs);
});

test('owner can revoke or shorten customer links; stale control writes cannot restore access',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add();await f.publish(o);const order=await f.current(o),url='/api/handover/'+order.handovers.intake.token,displayed=await f.displayed(order),state=await ok(f.req(path(o))),link=state.links.find(link=>link.type==='handover'),input={action:'link',version:state.version,hash:link.hash,linkVersion:link.version,expiresAt:link.expiresAt,revoked:true,confirmed:true};
  assert.equal((await f.req(path(o),input,'customer')).status,403);assert.equal((await f.req(path(o),{...input,confirmed:false})).status,400);await ok(f.req(path(o),input));
  assert.equal((await f.req(url,undefined,'customer')).status,404);assert.equal((await f.req(url,{snapshotHash:displayed.hash,signature:syntheticSignature,confirmed:true},'customer')).status,404);
  assert.equal((await f.req(url+'/asset/'+displayed.protocol.photos[0],undefined,'customer')).status,404);assert.equal((await portal(f)).orders[0].handovers.length,0);assert.equal((await f.req(url,undefined,'owner')).status,200);
  assert.equal((await f.req(path(o),{...input,revoked:false})).status,409);assert.equal((await f.current(o)).handovers.intake.status,'pending');
  await ok(updateLink(f,o,{revoked:false,expiresAt:new Date(Date.now()+600000).toISOString()}));assert.equal((await f.req(url,undefined,'customer')).status,200);
  await f.env.DB.prepare('UPDATE customer_link_controls SET expires_at=? WHERE hash=?').bind('2020-01-01T00:00:00.000Z',link.hash).run();assert.equal((await f.req(url,undefined,'customer')).status,404);
});

test('legacy handover links keep working until individually limited or revoked',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add();await f.publish(o);const order=await f.current(o),hash=digest(order.handovers.intake.token);await f.env.DB.prepare('DELETE FROM customer_link_controls WHERE hash=?').bind(hash).run();
  assert.equal((await ok(f.req(path(o)))).links.find(link=>link.hash===hash).legacy,true);await f.displayed(order);await ok(updateLink(f,o));assert.equal((await f.req('/api/handover/'+order.handovers.intake.token,undefined,'customer')).status,404);
});

test('offer expiry cannot be extended and revoke does not remove original signed agreements',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add(),state=await ok(f.req(path(o))),link=state.links[0];
  assert.equal((await updateLink(f,o,{revoked:false,expiresAt:new Date(Date.now()+3*86400000).toISOString()})).status,400);
  await ok(updateLink(f,o));assert.equal((await f.req('/api/offer/'+o.offerToken,undefined,'customer')).status,404);const dto=(await portal(f)).orders[0];assert.equal(dto.offerUrl,null);assert.ok(dto.documents.some(document=>document.kind==='agreement'));
  assert.equal((await f.req('/api/customer-portal/agreement?id='+o.id,undefined,'customer')).status,200);assert.equal((await f.req('/api/customer-portal/agreement?id='+o.id,undefined,'foreign')).status,404);assert.equal((await f.env.DB.prepare('SELECT expires_at FROM offer_tokens WHERE hash=?').bind(link.hash).first()).expires_at,link.expiresAt);
});

test('existing offer and amendment signatures record the actual customer; transactional link revocation prevents either acceptance',async t=>{
  const f=await handoverFixture(t,{withTemplate:false});
  for(const amendment of [false,true])for(const revoke of [false,true]){
    let o=await f.add(amendment?{}:{status:'Angebot offen',acceptance:null,appointment:null});
    if(amendment)o=await ok(f.req('/api/action',{id:o.id,version:o.version,action:'amendmentCreate',input:{services:'TEST · Zusatz',reason:'TEST · aktueller Zustand',amountCents:500,extraMinutes:15}}));
    const token=amendment?o.amendments[0].token:o.offerToken,route='/api/offer/'+token,view=await ok(f.req(route,undefined,'customer')),input={signature:syntheticSignature,paymentObligation:true,snapshotHash:digest(JSON.stringify(view))},batch=f.env.DB.batch.bind(f.env.DB);let revoked=false;
    if(revoke)f.env.DB.batch=async statements=>{f.env.DB.batch=batch;revoked=true;await f.env.DB.prepare('INSERT INTO customer_link_controls VALUES(?,1,?,1,?)').bind(digest(token),new Date(Date.now()+86400000).toISOString(),new Date().toISOString()).run();return batch(statements);};
    const response=await f.req(route,input,'customer');f.env.DB.batch=batch;assert.equal(response.status,revoke?409:200,await response.clone().text());const saved=await f.current(o);
    if(revoke){assert.equal(revoked,true);assert.equal(amendment?saved.amendments[0].state:saved.status,amendment?'open':'Angebot offen');assert.deepEqual(saved.acceptance,o.acceptance);}
    else{const proof=amendment?saved.amendments[0].acceptance:saved.acceptance;assert.equal(proof.authenticatedIdentity,customer);assert.equal(proof.snapshotHash,input.snapshotHash);}
  }
});

test('central private ACL preserves remote protocol identity and future explicit denial cannot fall back to original email',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add({intake:{workflow:'remote',customerEmail:customer.toUpperCase()}}),access=await customerAccessResolve(f.env,o,customer,'read-document',{protocolKind:'intake'});
  assert.equal(access.allowed,true);await f.env.DB.batch(customerAccessGuards(f.env,access));assert.equal((await customerAccessResolve(f.env,o,foreign)).allowed,false);
  f.env.customerOrderAccess=async()=>({allowed:false,scope:'synthetic-denial',identity:customer,orderId:o.id});assert.equal((await customerAccessResolve(f.env,o,customer)).allowed,false);assert.equal((await portal(f)).orders.length,0);assert.equal((await f.req('/api/customer-portal/agreement?id='+o.id,undefined,'customer')).status,404);
});

test('portal joins only released report images and renderer retains every image for repeated motifs',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add({status:'Erledigt'}),photos=[await f.upload(o),await f.upload(o),await f.upload(o)],url='/api/result-reports?id='+o.id;await ok(f.req(url));
  const save={action:'save',version:0,orderVersion:1,completedServices:'TEST · tatsächlich erledigt',completionConfirmed:true,entries:photos.map((assetId,i)=>({assetId,phase:'before',template:'exterior',motif:'Front',customerVisible:i<2}))};
  const report=await ok(f.req(url,save));assert.equal((await portal(f)).orders[0].resultReport,null);await ok(f.req(url,{...save,version:report.version,customerReleased:true,customerReleaseConfirmed:true}));
  const dto=(await portal(f)).orders[0].resultReport;assert.equal(dto.entries.length,2);assert.deepEqual(dto.entries.map(entry=>entry.assetId),photos.slice(0,2));assert.equal(dto.grants,undefined);assert.ok(!JSON.stringify(dto).includes('PRIVATE OPERATOR NOTE'));
  const html=resultReportsHTML(dto);assert.equal((html.match(/<img /g)??[]).length,2);for(const entry of dto.entries)assert.ok(html.includes(entry.url.replaceAll('&','&amp;')));assert.ok(!html.includes(photos[2]));assert.equal((await f.req('/api/customer/result-report?id='+o.id,undefined,'foreign')).status,404);
});
