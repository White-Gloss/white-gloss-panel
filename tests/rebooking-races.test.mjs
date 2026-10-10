import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handoverFixture,ok,customer,foreign} from './fixtures/handover.mjs';
import {packages,vehicleClasses} from '../src/catalog.mjs';

async function setup(t){
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add(),path='/api/rebooking?orderId='+o.id,seed=await ok(f.req(path,undefined,'customer'));
  const input={requestId:randomUUID(),orderVersion:seed.orderVersion,customerId:seed.customerId,customerVersion:seed.customerVersion,vehicleId:seed.vehicleId,vehicleVersion:seed.vehicleVersion,catalogCheckedAt:seed.catalogCheckedAt,selection:{packageId:packages[0].id,classId:vehicleClasses[0].id,extraIds:[],delivery:'Kunde bringt',citySlug:'',pickupKm:''},condition:'TEST · aktuell verschmutzte Sitze',wishes:'TEST · neue Anfrage',desiredDate:'',timeWindow:'',confirmed:true};
  return {...f,o,path,seed,input};
}
const counts=f=>Object.fromEntries(['orders','customer_files','vehicle_files','order_files','rebooking_requests'].map(table=>[table,f.env.DB.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n]));
function onceBeforeBatch(f,change){
  const batch=f.env.DB.batch.bind(f.env.DB);let called=false;
  f.env.DB.batch=async statements=>{f.env.DB.batch=batch;called=true;change();return batch(statements);};
  return ()=>assert.equal(called,true);
}

test('simultaneous identical rebooking requests reuse one order and its existing customer and vehicle',async t=>{
  const f=await setup(t),before=await f.current(f.o),results=await Promise.all([f.req(f.path,f.input,'customer'),f.req(f.path,f.input,'customer')]),data=await Promise.all(results.map(response=>ok(Promise.resolve(response))));
  assert.equal(data[0].id,data[1].id);assert.equal(data.filter(item=>item.replayed).length,1);
  assert.deepEqual(counts(f),{orders:2,customer_files:1,vehicle_files:1,order_files:2,rebooking_requests:1});
  assert.deepEqual(await f.current(f.o),before);
  const link=f.env.DB.sql.prepare('SELECT * FROM order_files WHERE order_id=?').get(data[0].id);assert.equal(link.customer_id,f.seed.customerId);assert.equal(link.vehicle_id,f.seed.vehicleId);
});

test('simultaneous different payloads sharing a request key commit only one request',async t=>{
  const f=await setup(t),responses=await Promise.all([f.req(f.path,f.input,'customer'),f.req(f.path,{...f.input,condition:'TEST · andere geprüfte Angaben'},'customer')]);
  assert.deepEqual(responses.map(item=>item.status).sort(),[200,409]);
  assert.deepEqual(counts(f),{orders:2,customer_files:1,vehicle_files:1,order_files:2,rebooking_requests:1});
  const rejected=await responses.find(item=>item.status===409).json();assert.equal(rejected.rejected,true);
});

for(const change of ['order-assignment','customer-lifecycle','vehicle-revision'])test('rebooking creates no row when '+change+' changes immediately before the transaction',async t=>{
  const f=await setup(t),before=counts(f),raced=onceBeforeBatch(f,()=>{
    if(change==='order-assignment')f.env.DB.sql.prepare("UPDATE orders SET data=json_set(data,'$.source.email',?),version=version+1 WHERE id=?").run(foreign,f.o.id);
    if(change==='customer-lifecycle')f.env.DB.sql.prepare("UPDATE customer_files SET data=json_set(data,'$.lifecycle.status','blocked'),version=version+1 WHERE id=?").run(f.seed.customerId);
    if(change==='vehicle-revision')f.env.DB.sql.prepare("UPDATE vehicle_files SET data=json_set(data,'$.plate','TEST CHANGED'),version=version+1 WHERE id=?").run(f.seed.vehicleId);
  });
  const response=await f.req(f.path,f.input,'customer');raced();assert.equal(response.status,409,await response.clone().text());assert.deepEqual(counts(f),before);
});

test('delegated membership revocation inside the create transaction prevents rebooking without modifying the original',async t=>{
  const f=await setup(t),before=await f.current(f.o),initial=counts(f);
  f.env.DB.sql.exec('CREATE TABLE synthetic_rebooking_member(allowed INTEGER NOT NULL); INSERT INTO synthetic_rebooking_member VALUES(1)');
  f.env.customerOrderAccess=async(_env,order,identity,operation)=>({allowed:identity===customer&&!!f.env.DB.sql.prepare('SELECT allowed FROM synthetic_rebooking_member').get().allowed,scope:'synthetic-company',identity,orderId:order.id,operation});
  f.env.customerOrderAccessGuards=()=>[f.env.DB.prepare('INSERT INTO customer_access_guard SELECT allowed FROM synthetic_rebooking_member'),f.env.DB.prepare('DELETE FROM customer_access_guard')];
  const raced=onceBeforeBatch(f,()=>f.env.DB.sql.exec('UPDATE synthetic_rebooking_member SET allowed=0'));
  const response=await f.req(f.path,f.input,'customer');raced();assert.equal(response.status,409,await response.clone().text());assert.deepEqual(counts(f),initial);assert.deepEqual(await f.current(f.o),before);
});

test('replaying a lost success response remains successful after the new request has progressed',async t=>{
  const f=await setup(t),created=await ok(f.req(f.path,f.input,'customer'));
  f.env.DB.sql.prepare("UPDATE orders SET status='Angebot offen',version=version+1 WHERE id=?").run(created.id);
  const replay=await ok(f.req(f.path,f.input,'customer'));
  assert.equal(replay.id,created.id);assert.equal(replay.replayed,true);assert.equal(replay.status,'Angebot offen');assert.equal(counts(f).orders,2);
});

test('a request may not substitute another customer or vehicle while keeping the authorized source order',async t=>{
  const f=await setup(t),other=await f.add({source:{name:'TEST · anderer Kunde',email:foreign,vehicle:'TEST · anderes Fahrzeug',plate:'TEST 999'}}),otherSeed=await ok(f.req('/api/rebooking?orderId='+other.id)),before=counts(f);
  for(const input of [{...f.input,customerId:otherSeed.customerId},{...f.input,vehicleId:otherSeed.vehicleId}]){
    const response=await f.req(f.path,input,'customer');assert.equal(response.status,409);assert.deepEqual(counts(f),before);
  }
});
