import test from 'node:test';
import assert from 'node:assert/strict';
import {handoverFixture,ok,customer,foreign,owner} from './fixtures/handover.mjs';
import {catalogQuote,catalogCheckedAt} from '../src/catalog.mjs';
import {assessmentSeed} from '../src/assessment.mjs';
import {customerFiles,updateCustomerFile} from '../server/customer-files.mjs';
import {setting} from '../src/worker.mjs';

const route=o=>'/api/rebooking?orderId='+o.id;
async function setup(t,overrides={}){
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add({status:'Bezahlt',source:{name:'TEST Kundin',email:customer,vehicle:'TEST Fahrzeug',plate:'TEST 17',packageId:'premium',classId:'suv',amountCents:1,extraIds:['tierhaare']},offer:{services:'TEST frühere Reinigung',totalCents:1},invoice:{id:'private-invoice'},notes:[{note:'PRIVATE CUSTOMER NOTE'}],payments:[{amountCents:1}],...overrides}),view=await ok(f.req(route(o),undefined,'customer'));
  const input={requestId:crypto.randomUUID(),orderVersion:view.orderVersion,customerId:view.customerId,customerVersion:view.customerVersion,vehicleId:view.vehicleId,vehicleVersion:view.vehicleVersion,catalogCheckedAt,selection:{packageId:'basis',classId:'kompakt',extraIds:[],delivery:'Kunde bringt',citySlug:'',pickupKm:''},condition:'TEST · Neue Verschmutzung',wishes:'TEST · Aktueller Wunsch',desiredDate:'',timeWindow:'Nachmittags bevorzugt',confirmed:true};
  return {...f,o,view,input,submit:(data=input,role='customer')=>f.req(route(o),data,role)};
}

test('rebooking creates only a new inquiry with current catalogue data and reuses existing customer and vehicle',async t=>{
  const f=await setup(t),before=await f.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(f.o.id).first(),masters=await customerFiles(f.env,true),result=await ok(f.submit()),created=await f.current(result.id);
  assert.equal(created.status,'Preise prüfen');assert.notEqual(created.id,f.o.id);assert.equal(created.source.vehicle,f.view.vehicle.name);assert.equal(created.source.plate,'TEST 17');assert.equal(created.source.amountCents,catalogQuote(f.input.selection).totalCents);assert.notEqual(created.source.amountCents,1);assert.equal(created.source.condition,f.input.condition);assert.equal(created.source.rebooking.wishes,f.input.wishes);assert.equal(created.source.desiredDate,'');assert.equal(created.source.timeWindow,f.input.timeWindow);assert.equal(created.source.rebooking.requestedBy,customer);
  for(const field of ['acceptance','offer','assessment','appointment','appointmentOptions','invoice','intake','return','handovers','cancellationTerms','reviewConsent','pickupRelease'])assert.equal(created[field],undefined,field);assert.deepEqual(created.notes,[]);assert.deepEqual(created.payments,[]);assert.equal(created.source.reviewConsent,false);assert.ok(!JSON.stringify(created).includes('PRIVATE CUSTOMER NOTE'));assert.ok(!JSON.stringify(created).includes('private-invoice'));
  const linked=await f.env.DB.prepare('SELECT * FROM order_files WHERE order_id=?').bind(created.id).first();assert.equal(linked.customer_id,f.view.customerId);assert.equal(linked.vehicle_id,f.view.vehicleId);
  const after=await customerFiles(f.env,true);assert.equal(after.customers.length,masters.customers.length);assert.equal(after.vehicles.length,masters.vehicles.length);assert.deepEqual(await f.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(f.o.id).first(),before);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM appointments').first()).n,0);
});

test('repeated opening creates no request and proposal exposes only safe vehicle data and previous approved services',async t=>{
  const f=await setup(t),before=await f.current(f.o);await f.update(f.o,{amendments:[{state:'open',services:'UNAPPROVED EXTRA'},{state:'accepted',services:'TEST freigegebener Nachtrag'}]});
  await f.env.DB.prepare("UPDATE customer_files SET data=json_set(data,'$.notes','PRIVATE MASTER NOTE') WHERE id=?").bind(f.view.customerId).run();await f.env.DB.prepare("UPDATE vehicle_files SET data=json_set(data,'$.notes','PRIVATE VEHICLE NOTE') WHERE id=?").bind(f.view.vehicleId).run();
  for(let n=0;n<3;n++){const view=await ok(f.req(route(f.o),undefined,'customer'));assert.match(view.previousServices,/TEST freigegebener Nachtrag/);assert.ok(!JSON.stringify(view).includes('PRIVATE'));assert.ok(!JSON.stringify(view).includes('UNAPPROVED'));assert.equal(view.selection.packageId,'premium');assert.equal(view.customer.email,undefined);}
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM rebooking_requests').first()).n,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,1);assert.deepEqual((await f.current(f.o)).offer,before.offer);
});

test('parallel taps and later reloads yield one new order and same saved receipt even after source changes',async t=>{
  const f=await setup(t),responses=await Promise.all([f.submit(),f.submit(),f.submit()]),results=await Promise.all(responses.map(response=>ok(response)));
  assert.equal(new Set(results.map(result=>result.id)).size,1);assert.equal(results.filter(result=>!result.replayed).length,1);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,2);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM rebooking_requests').first()).n,1);
  await f.update(f.o,{source:{...f.o.source,amountCents:999999}});const repeated=await ok(f.submit());assert.equal(repeated.replayed,true);assert.equal(repeated.id,results[0].id);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,2);
});

test('same idempotency key with different content or account is denied; explicit fresh draft can create a second inquiry',async t=>{
  const f=await setup(t),first=await ok(f.submit());assert.equal((await f.submit({...f.input,wishes:'Andere Angaben'})).status,409);assert.equal((await f.submit(f.input,'owner')).status,409);
  const next=await ok(f.submit({...f.input,requestId:crypto.randomUUID()}));assert.notEqual(next.id,first.id);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,3);
});

test('a replay cannot reveal a reassigned target or bypass a later source restriction or changed customer identity',async t=>{
  for(const mode of ['source-block','customer-email','target-email','target-link','target-block']){
    const f=await setup(t),created=await ok(f.submit());
    if(mode==='source-block')await f.update(f.o,{recordsRestriction:{status:'blocked'}});
    if(mode==='customer-email')await f.env.DB.prepare("UPDATE customer_files SET data=json_set(data,'$.email',?),version=version+1 WHERE id=?").bind(foreign,f.view.customerId).run();
    if(mode==='target-email'){const target=await f.current(created.id);await f.update(target,{source:{...target.source,email:foreign}});}
    if(mode==='target-block')await f.update(created.id,{recordsRestriction:{status:'blocked'}});
    if(mode==='target-link'){const other=await f.add({source:{name:'TEST andere Person',email:foreign,vehicle:'TEST anderes Auto'}}),otherView=await ok(f.req(route(other),undefined,'owner'));await f.env.DB.prepare('UPDATE order_files SET customer_id=?,vehicle_id=? WHERE order_id=?').bind(otherView.customerId,otherView.vehicleId,created.id).run();}
    const result=await f.submit();assert.ok([404,409].includes(result.status),mode+': '+await result.clone().text());const data=await result.json();assert.equal(data.id,undefined);assert.equal(data.wg,undefined);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM rebooking_requests').first()).n,1);
  }
});

test('authentication, foreign order isolation, source spoofing and cross-origin requests are enforced',async t=>{
  const f=await setup(t),other=await f.add({source:{name:'TEST andere Person',email:foreign,vehicle:'ANDERES FAHRZEUG'}}),otherData=await ok(f.req(route(other),undefined,'owner'));
  assert.equal((await f.req(route(f.o),undefined,'')).status,401);assert.equal((await f.req(route(f.o),undefined,'foreign')).status,404);assert.equal((await f.submit(f.input,'foreign')).status,404);assert.equal((await f.req(route(f.o),f.input,'foreign',{'oai-authenticated-user-email':owner})).status,404);assert.equal((await f.req(route(f.o),f.input,'customer',{Origin:'https://foreign.invalid'})).status,403);
  assert.equal((await f.submit({...f.input,customerId:otherData.customerId,vehicleId:otherData.vehicleId})).status,409);
  const result=await ok(f.submit({...f.input,source:{email:foreign,vehicle:'FORGED'},amountCents:1,appointment:{start:'2030-01-01'}}));const order=await f.current(result.id);assert.equal(order.source.email,customer);assert.equal(order.source.vehicle,f.o.source.vehicle);assert.equal(order.appointment,undefined);
});

test('condition, explicit confirmation, valid current catalogue and fresh date are required',async t=>{
  const f=await setup(t);
  for(const change of [{condition:''},{confirmed:false},{catalogCheckedAt:'1990-01-01'},{desiredDate:'2026-02-31'},{desiredDate:'2020-01-01'},{selection:{...f.input.selection,packageId:'unknown'}},{selection:{...f.input.selection,customPickupCents:1}},{selection:{...f.input.selection,extraIds:['not-approved']}}]){const response=await f.submit({...f.input,...change});assert.ok([400,409].includes(response.status),await response.clone().text());assert.equal((await response.json()).rejected,true);}
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,1);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM rebooking_requests').first()).n,0);
});

test('unknown pickup quote remains explicitly unpriced and never inherits an earlier special price',async t=>{
  const f=await setup(t),result=await ok(f.submit({...f.input,selection:{...f.input.selection,delivery:'Abholung',pickupKm:500}})),order=await f.current(result.id);
  assert.equal(order.source.catalogQuote.pickupOnRequest,true);assert.equal(order.source.catalogQuote.pickupCents,null);assert.equal(order.source.amountCents,null);assert.equal(order.source.pickupCents,null);assert.equal(order.status,'Preise prüfen');
  const assessment=assessmentSeed(order.source);assert.equal(assessment.pricesReviewed,false);assert.equal(assessment.pickupPricePending,true);assert.equal(assessment.lines.find(line=>line.kind==='package').amountCents,catalogQuote(f.input.selection).packageCents);assert.equal(assessment.lines.find(line=>line.kind==='pickup').pricePending,true);
});

test('changed master versions, assignment, or customer email cannot be silently reused',async t=>{
  const f=await setup(t),files=await customerFiles(f.env,true),vehicle=files.vehicles[0];
  await updateCustomerFile(f.env,{kind:'vehicle',id:vehicle.id,version:vehicle.version,data:{...vehicle,name:'TEST geändertes Fahrzeug'}});assert.equal((await f.submit()).status,409);
  const fresh=await ok(f.req(route(f.o),undefined,'customer'));assert.equal(fresh.vehicle.name,'TEST geändertes Fahrzeug');
  await f.env.DB.prepare("UPDATE customer_files SET data=json_set(data,'$.email',?),version=version+1 WHERE id=?").bind(foreign,f.view.customerId).run();const denied=await ok(f.req(route(f.o),undefined,'customer'));assert.equal(denied.canRequest,false);assert.equal((await f.submit({...f.input,vehicleVersion:fresh.vehicleVersion,customerVersion:denied.customerVersion})).status,409);
  const ownerView=await ok(f.req(route(f.o),undefined,'owner'));assert.equal(ownerView.canRequest,true);
});

test('blocked source or master denies requests including a delegated access hook with no personal fallback',async t=>{
  const f=await setup(t);await f.env.DB.prepare("UPDATE customer_files SET data=json_set(data,'$.lifecycle.status','blocked') WHERE id=?").bind(f.view.customerId).run();assert.equal((await ok(f.req(route(f.o),undefined,'customer'))).canRequest,false);assert.equal((await f.submit()).status,409);
  f.env.customerOrderAccess=async()=>({allowed:false,scope:'denied',identity:customer,orderId:f.o.id});assert.equal((await f.req(route(f.o),undefined,'customer')).status,404);assert.equal((await f.submit()).status,404);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,1);
});

test('receipt insertion failure rolls back new order, master link, audit and WG sequence',async t=>{
  const f=await setup(t,{synthetic:false});await setting(f.env,'numberAudit',true);const sequence=(await f.env.DB.prepare("SELECT value FROM sequences WHERE name='WG'").first()).value,audits=(await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n;
  f.env.DB.sql.exec("CREATE TRIGGER synthetic_rebooking_failure BEFORE INSERT ON rebooking_requests BEGIN SELECT RAISE(ABORT,'synthetic receipt storage failure'); END");assert.equal((await f.submit()).status,500);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,1);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM order_files').first()).n,1);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n,audits);assert.equal((await f.env.DB.prepare("SELECT value FROM sequences WHERE name='WG'").first()).value,sequence);
  f.env.DB.sql.exec('DROP TRIGGER synthetic_rebooking_failure');const result=await ok(f.submit());assert.equal(result.wg,'WG-'+String(sequence+1).padStart(6,'0'));assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);
});

test('owner uses the same request workflow from the existing vehicle file and still leaves acceptance and calendar empty',async t=>{
  const f=await setup(t),result=await ok(f.submit(f.input,'owner')),saved=await f.current(result.id);assert.equal(saved.source.rebooking.requestedBy,owner);assert.equal(saved.status,'Preise prüfen');assert.equal(saved.acceptance,undefined);assert.equal(saved.appointment,undefined);assert.equal(saved.source.amountCents,catalogQuote(f.input.selection).totalCents);
});
