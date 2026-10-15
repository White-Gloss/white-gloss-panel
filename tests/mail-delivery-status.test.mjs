import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import worker,{init,protect,setting,getOrder,claimJob} from '../src/worker.mjs';
import {checkMailDelivery} from '../server/mail-delivery-status.mjs';
import {providerSchema,providerOperations} from '../server/providers.mjs';
import {deliverProtocol,pendingProtocolMails} from '../server/protocol-mail.mjs';
import {digest} from '../server/auth.mjs';

async function fixture(t){
  const env={CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:')};
  t.after(()=>env.DB.close());await init(env);
  await setting(env,'resendKey',await protect(env,'synthetic-read-key'));
  return env;
}
const recipient='customer@example.invalid';
const job={id:'job-test',state:'sent',provider_id:'synthetic-mail'};
function remote(last_event,extra={}){return new Response(JSON.stringify({id:job.provider_id,to:[recipient],last_event,...extra}));}

test('delivery evidence distinguishes rejection and suppression without changing a claimed send or exposing message content',async t=>{
  const env=await fixture(t),before=JSON.stringify(job),calls=[];
  let event='bounced';
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});return remote(event,{text:'private message content',subject:'private subject'});
  });
  for(event of ['bounced','suppressed','complained','failed','delivery_delayed']){
    const result=await checkMailDelivery(env,job,recipient);
    assert.equal(result.state,'sent');assert.equal(result.providerStatus,event);
    assert.equal(JSON.stringify(job),before);assert.doesNotMatch(JSON.stringify(result),/private|synthetic-read-key|customer@example/);
  }
  assert.match((await checkMailDelivery(env,job,recipient)).detail,/verzögert/);
  assert.equal(calls.length,6);
  for(const call of calls){assert.equal(call.url,'https://api.resend.com/emails/synthetic-mail');assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'manual');assert.equal(call.options.body,undefined);}
});

test('mailserver acceptance and tracking events never claim inbox placement or customer confirmation',async t=>{
  const env=await fixture(t);let event='delivered';
  t.mock.method(globalThis,'fetch',async()=>remote(event));
  const delivered=await checkMailDelivery(env,job,recipient);
  assert.match(delivered.detail,/Mailserver angenommen/);assert.match(delivered.detail,/Spamordner/);assert.match(delivered.detail,/nicht feststellbar/);
  event='opened';assert.match((await checkMailDelivery(env,job,recipient)).detail,/weder persönliches Lesen/);
  event='clicked';assert.match((await checkMailDelivery(env,job,recipient)).detail,/weder eine persönliche Bestätigung/);
  event='sent';assert.match((await checkMailDelivery(env,job,recipient)).detail,/Zustellung ist noch nicht bestätigt/);
});

test('a verified provider ID resolves an uncertain send without inventing a delivery result for unknown events',async t=>{
  const env=await fixture(t),uncertain={...job,state:'unknown'};
  t.mock.method(globalThis,'fetch',async()=>remote('unrecognized-private-value'));
  const result=await checkMailDelivery(env,uncertain,recipient.toUpperCase());
  assert.equal(result.state,'sent');assert.equal(result.providerStatus,'unknown');assert.doesNotMatch(result.detail,/unrecognized-private/);assert.match(result.detail,/keinen eindeutigen Zustellstatus/);
});

test('a mail with operator copies does not imply delivery to every recipient',async t=>{
  const env=await fixture(t);
  t.mock.method(globalThis,'fetch',async()=>remote('delivered',{cc:['operator@example.invalid']}));
  const result=await checkMailDelivery(env,job,recipient);
  assert.match(result.detail,/nicht die Zustellung an jeden Einzelnen/);
  assert.doesNotMatch(result.detail,/operator@example/);
});

test('a different provider ID or recipient is rejected without trusting its delivery claim',async t=>{
  const env=await fixture(t);let extra={id:'foreign-mail'};
  t.mock.method(globalThis,'fetch',async()=>remote('delivered',extra));
  await assert.rejects(checkMailDelivery(env,job,recipient),e=>e.status===409);
  extra={to:['other@example.invalid']};await assert.rejects(checkMailDelivery(env,job,recipient),e=>e.status===409);
  extra={to:recipient};await assert.rejects(checkMailDelivery(env,job,recipient),e=>e.status===409);
});

test('provider failures and malformed responses keep send state and credentials out of errors',async t=>{
  const env=await fixture(t);let mode='network';
  t.mock.method(globalThis,'fetch',async()=>{
    if(mode==='network')throw Error('Bearer synthetic-read-key');
    if(mode==='http')return new Response('private provider error',{status:429});
    return new Response('invalid JSON');
  });
  for(mode of ['network','http','json'])await assert.rejects(checkMailDelivery(env,job,recipient),e=>{assert.doesNotMatch(e.message,/synthetic-read-key|private provider/);return [409,502].includes(e.status);});
  assert.equal(job.state,'sent');
});

test('missing provider IDs and retryable jobs cannot trigger a lookup or a send',async t=>{
  const env=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return remote('sent');});
  for(const value of [{...job,provider_id:null},{...job,state:'failed'},{...job,state:'queued'}])await assert.rejects(checkMailDelivery(env,value,recipient),e=>e.status===409);
  await assert.rejects(checkMailDelivery(env,job,''),e=>e.status===409);assert.equal(calls,0);
});

async function providerFixture(t){
  const env=await fixture(t);
  env.PANEL_ORIGIN='https://panel.example.invalid';
  env.OWNER_EMAIL_SHA256=digest('owner@example.invalid');
  env.operations=providerOperations;
  await providerSchema(env);
  const order={id:'order-mail-test',wg:'WG-MAIL-TEST',version:1,status:'Angebot offen',synthetic:false,source:{name:'TEST',email:'changed@example.invalid'},offer:{services:'TEST',totalCents:10000,expiresAt:'2099-01-01T00:00:00Z'},offerToken:'a'.repeat(64)};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture').run();
  const addJob=async(id,kind,state='sent')=>{await env.DB.prepare('INSERT INTO jobs(id,order_id,kind,state,provider_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,order.id,kind,state,'provider-'+id,new Date().toISOString(),new Date().toISOString()).run();};
  const action=async name=>{const current=await getOrder(env,order.id);return worker.fetch(new Request(env.PANEL_ORIGIN+'/api/action',{method:'POST',headers:{origin:env.PANEL_ORIGIN,'oai-authenticated-user-email':'owner@example.invalid','Content-Type':'application/json'},body:JSON.stringify({id:order.id,version:current.version,action:name,input:{}})}),env);};
  return {env,order,addJob,action};
}

test('manual provider reconciliation reads sent protocol and acceptance delivery using their original recipients and never retries',async t=>{
  const f=await providerFixture(t),calls=[];
  await f.addJob('intake-mail','protocol-intake');await f.addJob('acceptance-mail','protocol-acceptance-v1');
  await f.env.DB.prepare('INSERT INTO protocol_deliveries(job_id,order_id,kind,snapshot_hash,recipient,copy_to) VALUES(?,?,?,?,?,?)').bind('intake-mail',f.order.id,'intake','snapshot',recipient,'').run();
  await f.env.DB.prepare('INSERT INTO acceptance_deliveries(job_id,order_id,acceptance_version,snapshot_hash,snapshot,recipient,copy_to) VALUES(?,?,?,?,?,?,?)').bind('acceptance-mail',f.order.id,'v1','snapshot','{}',recipient,'').run();
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,method:options.method});assert.equal(options.method,'GET');
    const id=url.split('/').at(-1);return new Response(JSON.stringify({id,to:[recipient],last_event:id==='provider-intake-mail'?'suppressed':'bounced'}));
  });
  await providerOperations.action(f.env,f.order,'reconcile',{});
  const jobs=(await f.env.DB.prepare('SELECT * FROM jobs ORDER BY id').all()).results;
  assert.equal(jobs.length,2);assert.ok(jobs.every(row=>row.state==='sent'));
  assert.match(jobs.find(row=>row.id==='intake-mail').detail,/Versand unterdrückt/);
  assert.match(jobs.find(row=>row.id==='acceptance-mail').detail,/Nicht zugestellt/);
  assert.deepEqual(jobs.map(row=>row.provider_id),['provider-acceptance-mail','provider-intake-mail']);
  assert.equal((await deliverProtocol(f.env,f.order.id,'intake')).state,'sent');
  assert.equal((await deliverProtocol(f.env,f.order.id,'acceptance')).state,'sent');
  await pendingProtocolMails(f.env);
  assert.equal(calls.length,2);assert.equal((await claimJob(f.env,f.order,'protocol-intake')),null);
  assert.equal((await getOrder(f.env,f.order.id)).version,1);
});

test('resolving an unknown offer send allows deliberate link renewal while the original send remains claimed',async t=>{
  const f=await providerFixture(t);await f.addJob('offer-mail','offer','unknown');
  await f.env.DB.prepare('INSERT INTO offer_tokens(hash,order_id,expires_at) VALUES(?,?,?)').bind(digest(f.order.offerToken),f.order.id,f.order.offer.expiresAt).run();
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(options.method);assert.equal(options.method,'GET');return new Response(JSON.stringify({id:'provider-offer-mail',to:[f.order.source.email],last_event:'suppressed'}));});
  assert.equal((await f.action('renewOfferLink')).status,409);
  await providerOperations.action(f.env,f.order,'reconcile',{});
  const stored=await f.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind('offer-mail').first();
  assert.equal(stored.state,'sent');assert.equal(stored.provider_id,'provider-offer-mail');assert.match(stored.detail,/Versand unterdrückt/);
  assert.equal((await claimJob(f.env,f.order,'offer')),null);
  const response=await f.action('renewOfferLink');assert.equal(response.status,200,await response.clone().text());
  assert.notEqual((await getOrder(f.env,f.order.id)).offerToken,f.order.offerToken);
  assert.equal((await f.env.DB.prepare('SELECT revoked FROM offer_tokens WHERE hash=?').bind(digest(f.order.offerToken)).first()).revoked,1);
  assert.deepEqual(calls,['GET']);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,1);
});

test('a failed provider lookup preserves an unknown send and keeps deliberate renewal blocked',async t=>{
  const f=await providerFixture(t);await f.addJob('offer-mail','offer','unknown');
  t.mock.method(globalThis,'fetch',async()=>new Response('{}',{status:429}));
  await assert.rejects(providerOperations.action(f.env,f.order,'reconcile',{}),e=>e.status===502);
  const stored=await f.env.DB.prepare('SELECT * FROM jobs WHERE id=?').bind('offer-mail').first();
  assert.equal(stored.state,'unknown');assert.equal(stored.provider_id,'provider-offer-mail');assert.equal(stored.detail,null);
  assert.equal((await f.action('renewOfferLink')).status,409);
});
