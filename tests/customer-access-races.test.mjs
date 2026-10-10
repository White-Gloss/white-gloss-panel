import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handoverFixture,ok,customer,foreign,syntheticSignature} from './fixtures/handover.mjs';
import {digest} from '../server/auth.mjs';

const chat=id=>'/api/customer-portal/chat?id='+id;
const send=body=>({action:'send',requestId:randomUUID(),body});
function reassign(f,id){f.env.DB.sql.prepare("UPDATE orders SET data=json_set(data,'$.source.email',?),version=version+1 WHERE id=?").run(foreign,id);}
function onceBeforeBatch(f,change){
  const batch=f.env.DB.batch.bind(f.env.DB);let called=false;
  f.env.DB.batch=async statements=>{f.env.DB.batch=batch;called=true;await change();return batch(statements);};
  return ()=>assert.equal(called,true,'the race must run immediately before the transaction');
}
function expireOrRevoke(f,token,expire=false){
  f.env.DB.sql.prepare('UPDATE customer_link_controls SET expires_at=?,revoked=?,version=version+1 WHERE hash=?').run(expire?'2020-01-01T00:00:00.000Z':new Date(Date.now()+86400000).toISOString(),expire?0:1,digest(token));
}
function persisted(f,order){
  return {order:f.env.DB.sql.prepare('SELECT * FROM orders WHERE id=?').get(order.id),assets:f.env.DB.sql.prepare('SELECT * FROM assets WHERE order_id=? ORDER BY id').all(order.id),bindings:f.env.DB.sql.prepare('SELECT * FROM signature_bindings ORDER BY asset_id').all(),files:[...f.files.keys()].sort()};
}

test('chat send cannot save after the customer identity changes immediately before INSERT',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add(),input=send('TEST · no longer authorized'),raced=onceBeforeBatch(f,()=>reassign(f,o.id));
  const response=await f.req(chat(o.id),input,'customer');raced();assert.equal(response.status,409,await response.clone().text());
  assert.equal(f.env.DB.sql.prepare('SELECT COUNT(*) n FROM customer_messages WHERE order_id=?').get(o.id).n,0);
  assert.equal((await f.current(o)).source.email,foreign);
});

test('chat read position stays unchanged when reassigned after initial authorization',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add();
  const first=await ok(f.req('/api/customer-chat?id='+o.id,send('TEST · first'))),second=await ok(f.req('/api/customer-chat?id='+o.id,send('TEST · unread')));
  await ok(f.req(chat(o.id),{action:'read',lastId:first.id},'customer'));
  const raced=onceBeforeBatch(f,()=>reassign(f,o.id)),response=await f.req(chat(o.id),{action:'read',lastId:second.id},'customer');
  raced();assert.equal(response.status,409,await response.clone().text());
  assert.equal(f.env.DB.sql.prepare("SELECT last_id FROM customer_message_reads WHERE order_id=? AND reader_role='customer'").get(o.id).last_id,first.id);
});

test('chat GET rechecks authorization after the final unread query and returns no old customer content',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add(),secret='TEST · confidential owner message';
  await ok(f.req('/api/customer-chat?id='+o.id,send(secret)));
  const prepare=f.env.DB.prepare.bind(f.env.DB);let raced=false;
  f.env.DB.prepare=query=>{
    const statement=prepare(query);
    if(query.startsWith('SELECT COUNT(*) n FROM customer_messages')){const first=statement.first;statement.first=async()=>{const rows=await first();reassign(f,o.id);raced=true;return rows;};}
    return statement;
  };
  const response=await f.req(chat(o.id),undefined,'customer');assert.equal(raced,true);assert.equal(response.status,404);
  assert.ok(!(await response.text()).includes(secret));assert.equal((await f.current(o)).source.email,foreign);
});

for(const expire of [false,true])test('handover image never leaves storage after link '+(expire?'expiry':'revocation')+' during Bucket.get',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.publish(await f.add()),view=await f.displayed(o),photo=view.protocol.photos[0],token=o.handovers.intake.token;
  const get=f.env.BUCKET.get;let raced=false;
  f.env.BUCKET.get=async id=>{const object=await get(id);if(id===photo){expireOrRevoke(f,token,expire);raced=true;}return object;};
  const response=await f.req('/api/handover/'+token+'/asset/'+photo,undefined,'customer');assert.equal(raced,true);assert.equal(response.status,404);
  assert.ok(!response.headers.get('content-type').startsWith('image/'));assert.ok(f.files.has(photo));assert.equal((await f.current(o)).handovers.intake.status,'pending');
});

for(const boundary of ['bucket','transaction'])test('handover signature is completely rolled back when link is revoked at '+boundary+' boundary',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.publish(await f.add()),view=await f.displayed(o),token=o.handovers.intake.token,before=persisted(f,o);let raced=false;
  if(boundary==='bucket'){
    const put=f.env.BUCKET.put;f.env.BUCKET.put=async(...args)=>{await put(...args);expireOrRevoke(f,token);raced=true;};
  }else onceBeforeBatch(f,()=>{expireOrRevoke(f,token);raced=true;});
  const response=await f.req('/api/handover/'+token,{snapshotHash:view.hash,signature:syntheticSignature,confirmed:true},'customer');
  assert.equal(raced,true);assert.equal(response.status,boundary==='bucket'?404:409,await response.clone().text());
  assert.deepEqual(persisted(f,o),before,'no order status, asset row, signature binding, or uploaded bytes may survive');
});

test('review consent rolls back order update and receipt if delegated membership is revoked before commit',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),o=await f.add(),before=persisted(f,o);
  f.env.DB.sql.exec('CREATE TABLE synthetic_membership(allowed INTEGER NOT NULL); INSERT INTO synthetic_membership VALUES(1)');
  f.env.customerOrderAccess=async(_env,order,identity,operation)=>({allowed:identity===customer&&!!f.env.DB.sql.prepare('SELECT allowed FROM synthetic_membership').get().allowed,scope:'synthetic-company',identity,orderId:order.id,operation});
  f.env.customerOrderAccessGuards=()=>[f.env.DB.prepare('INSERT INTO customer_access_guard SELECT allowed FROM synthetic_membership'),f.env.DB.prepare('DELETE FROM customer_access_guard')];
  const raced=onceBeforeBatch(f,()=>f.env.DB.sql.exec('UPDATE synthetic_membership SET allowed=0'));
  const response=await f.req('/api/customer-portal/review-consent',{id:o.id,version:o.version,granted:false,requestId:randomUUID()},'customer');
  raced();assert.equal(response.status,409,await response.clone().text());assert.deepEqual(persisted(f,o),before);
  assert.equal(f.env.DB.sql.prepare('SELECT COUNT(*) n FROM customer_consent_requests WHERE order_id=?').get(o.id).n,0);
});

test('generated protocol PDF is withheld when customer identity changes during asynchronous asset reading',async t=>{
  const f=await handoverFixture(t),pending=await f.publish(await f.add()),{order:o}=await f.complete(pending),photo=o.intake.photos[0],get=f.env.BUCKET.get;let raced=false;
  f.env.BUCKET.get=async id=>{const object=await get(id);if(id===photo&&!raced){reassign(f,o.id);raced=true;}return object;};
  const response=await f.req('/api/customer-portal/document?id='+o.id+'&kind=intake',undefined,'customer');
  assert.equal(raced,true);assert.equal(response.status,404,await response.clone().text());assert.ok(!response.headers.get('content-type').includes('application/pdf'));
  assert.ok(f.files.has(photo));assert.equal((await f.current(o)).intake.signaturesConfirmed,true);
});
