import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {getOrder,protect,setting,settings} from '../src/worker.mjs';
import {lexwareSchema} from '../server/lexware.mjs';
import {LEXWARE_WEBHOOK_KEY_SHA256,LEXWARE_WEBHOOK_PUBLIC_KEY,lexwareSubscriptions,lexwareWebhook,lexwareWebhookSchema,pendingLexwareEvents,verifyLexwareSignature} from '../server/lexware-webhooks.mjs';

const origin='https://panel.white-gloss.de';
const organizationId='aa93e8a8-2aa3-470b-b914-caad8a255dd8';
const invoiceId='e9066f04-8cc7-4616-93f8-ac9ecc8479c8';
const clientId='66196c43-baf3-4335-bfee-d610367059db';
const callbackUrl=origin+'/api/lexware/webhook';
const fakeSignature=Buffer.alloc(512,1).toString('base64');
const event=(change={})=>({organizationId,eventType:'payment.changed',resourceId:invoiceId,eventDate:'2026-10-03T17:00:00.000+02:00',...change});
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function fixture(t,options={}){
  const env={PANEL_ORIGIN:origin,CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:')};t.after(()=>env.DB.close());await lexwareWebhookSchema(env);await lexwareSchema(env);
  await setting(env,'lexwareOrganizationId',organizationId);await setting(env,'lexwareVerified',true);await setting(env,'lexwareWebhookReady',true);await setting(env,'lexwareKey',await protect(env,'synthetic-key-'+crypto.randomUUID()));
  const payload={taxConditions:{taxType:'gross'},lineItems:[{type:'custom',name:'TEST · Fahrzeugpflege',description:'',quantity:1,unitName:'Leistung',unitPrice:{currency:'EUR',grossAmount:100,taxRatePercentage:19}}]};
  const order={id:crypto.randomUUID(),wg:'WG-WEBHOOK-TEST',version:1,status:'Erledigt',synthetic:options.synthetic??false,source:{name:'TEST · Kunde',email:'customer@example.invalid',vehicle:'TEST'},offer:{totalCents:10000},payments:[],invoice:{provider:options.provider??'lexware',id:invoiceId,number:'RE-TEST',totalCents:10000,status:'open'}};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture',Number(order.synthetic)).run();
  const marker='TEST · signed webhook fixture';
  await env.DB.prepare("INSERT INTO invoice_claims(order_id,provider,marker,org_id,client_id,payload,payload_hash,provider_id,stage,created_at) VALUES(?,'lexware',?,?,?,?,?,?,'confirmed',?)").bind(order.id,marker,organizationId,clientId,JSON.stringify(payload),hash(payload),invoiceId,new Date().toISOString()).run();
  const remote={...payload,id:invoiceId,organizationId,remark:marker,address:{contactId:clientId},totalPrice:{currency:'EUR',totalGrossAmount:100},voucherNumber:'RE-TEST',voucherStatus:'paid'};
  const payment={currency:'EUR',voucherType:'invoice',openAmount:0,paymentStatus:'balanced',voucherStatus:'paid',paymentItems:[{paymentItemType:'partPaymentFinancialTransaction',postingDate:'2026-10-03T16:00:00Z',amount:100,currency:'EUR'}]};
  const profile={organizationId,companyName:'TEST · White Gloss',businessFeatures:['INVOICING'],taxType:'gross',smallBusiness:false};
  const request=(value=event(),options={})=>new Request(callbackUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Lxo-Signature':fakeSignature,...options.headers},body:typeof value==='string'?value:JSON.stringify(value)});
  const api=(url,options={})=>{assert.equal(options.method??'GET','GET');assert.equal(new URL(url).origin,'https://api.lexware.io');const path=new URL(url).pathname;if(path==='/v1/profile')return response(profile);if(path==='/v1/invoices/'+invoiceId)return response(remote);if(path==='/v1/payments/'+invoiceId)return response(payment);throw Error('Unexpected provider request '+path);};
  return {env,order,request,api,remote,payment};
}

test('the official key is pinned and real RSA-SHA512 verification preserves whitespace inside values',()=>{
  assert.equal(crypto.createHash('sha256').update(LEXWARE_WEBHOOK_PUBLIC_KEY).digest('hex'),LEXWARE_WEBHOOK_KEY_SHA256);
  const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),value=event(),signature=crypto.sign('RSA-SHA512',Buffer.from(JSON.stringify(value)),privateKey).toString('base64');
  assert.equal(verifyLexwareSignature(value,signature,publicKey),true);assert.equal(verifyLexwareSignature({...value,eventType:'invoice.changed'},signature,publicKey),false);assert.equal(verifyLexwareSignature(value,signature),false);
  assert.equal(verifyLexwareSignature(value,signature+'\n',publicKey),false);assert.equal(verifyLexwareSignature(value,'bogus',publicKey),false);
  const text={example:'value with spaces and\nline break'},signed=crypto.sign('RSA-SHA512',Buffer.from(JSON.stringify(text)),privateKey).toString('base64');assert.equal(verifyLexwareSignature(text,signed,publicKey),true);
});

test('the HTTP entry point rejects unsigned, unrelated-key and invalid signatures without provider access',async t=>{
  const f=await fixture(t);t.mock.method(globalThis,'fetch',()=>{throw Error('Webhook must not fetch providers');});
  assert.equal((await lexwareWebhook(f.request(),f.env)).status,401);
  const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:4096}),signature=crypto.sign('RSA-SHA512',Buffer.from(JSON.stringify(event())),privateKey).toString('base64');f.env.LEXWARE_WEBHOOK_PUBLIC_KEY=publicKey;
  assert.equal((await lexwareWebhook(f.request(event(),{headers:{'X-Lxo-Signature':signature}}),f.env)).status,401);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM lexware_events').first()).n,0);
});

test('method, content type, encoding, endpoint and streaming byte limits are enforced',async t=>{
  const f=await fixture(t);assert.equal((await lexwareWebhook(new Request(callbackUrl),f.env)).status,405);assert.equal((await lexwareWebhook(new Request(callbackUrl,{method:'HEAD'}),f.env)).status,204);
  assert.equal((await lexwareWebhook(f.request(event(),{headers:{'Content-Type':'text/plain'}}),f.env)).status,415);
  assert.equal((await lexwareWebhook(f.request(event(),{headers:{'Content-Encoding':'gzip'}}),f.env)).status,415);
  assert.equal((await lexwareWebhook(new Request(callbackUrl+'?secret=ignored',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),f.env)).status,400);
  assert.equal((await lexwareWebhook(f.request(event(),{headers:{'Content-Length':'262145'}}),f.env)).status,413);
  assert.equal((await lexwareWebhook(f.request('{invalid'),f.env)).status,400);
  let cancelled=false;const body=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(262145));},cancel(){cancelled=true;}});
  const oversized=new Request(callbackUrl,{method:'POST',duplex:'half',headers:{'Content-Type':'application/json'},body});assert.equal((await lexwareWebhook(oversized,f.env)).status,413);assert.equal(cancelled,true);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM lexware_events').first()).n,0);
});

test('verified events queue once; foreign organisations, unsupported fields and unknown resources cannot trigger reads',async t=>{
  const f=await fixture(t);t.mock.method(crypto,'verify',()=>true);t.mock.method(globalThis,'fetch',()=>{throw Error('HTTP reception only queues events');});
  const first=await lexwareWebhook(f.request(),f.env);assert.equal(first.status,202);assert.equal((await first.json()).queued,true);
  assert.equal((await (await lexwareWebhook(f.request(),f.env)).json()).queued,false);
  assert.equal((await lexwareWebhook(f.request(event({organizationId:crypto.randomUUID()})),f.env)).status,403);
  assert.equal((await lexwareWebhook(f.request(event({eventType:'invoice.created'})),f.env)).status,400);
  assert.equal((await lexwareWebhook(f.request(event({voucherStatus:'paid'})),f.env)).status,400);
  assert.equal((await (await lexwareWebhook(f.request(event({resourceId:crypto.randomUUID()})),f.env)).json()).ignored,true);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM lexware_events').first()).n,1);assert.equal((await getOrder(f.env,f.order.id)).status,'Erledigt');
});

test('synthetic and historical Qonto invoices are ignored even when a genuine Lexware signature is assumed',async t=>{
  t.mock.method(crypto,'verify',()=>true);t.mock.method(globalThis,'fetch',()=>{throw Error('No external test action');});
  for(const options of [{synthetic:true},{provider:'qonto'}]){const f=await fixture(t,options),result=await lexwareWebhook(f.request(),f.env);assert.equal(result.status,202);assert.equal((await result.json()).ignored,true);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM lexware_events').first()).n,0);}
});

test('a verified queue storage failure returns a retriable error without changing readiness',async t=>{
  const f=await fixture(t);t.mock.method(crypto,'verify',()=>true);await f.env.DB.prepare("CREATE TRIGGER reject_lexware_queue BEFORE INSERT ON lexware_events BEGIN SELECT RAISE(ABORT,'synthetic queue failure'); END").run();
  assert.equal((await lexwareWebhook(f.request(),f.env)).status,500);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM lexware_events').first()).n,0);
  const revoked=event({eventType:'token.revoked',resourceId:crypto.randomUUID()});assert.equal((await lexwareWebhook(f.request(revoked),f.env)).status,500);assert.equal((await settings(f.env)).lexwareVerified,true);assert.equal((await settings(f.env)).lexwareWebhookReady,true);
});

test('a verified own-connection revocation disables readiness; foreign or replayed revocations cannot change it',async t=>{
  const f=await fixture(t),connectionId=crypto.randomUUID();await setting(f.env,'lexwareConnectionId',connectionId);t.mock.method(crypto,'verify',()=>true);
  const other=event({eventType:'token.revoked',resourceId:crypto.randomUUID()});assert.equal((await (await lexwareWebhook(f.request(other),f.env)).json()).ignored,true);assert.equal((await settings(f.env)).lexwareVerified,true);
  const revoked=event({eventType:'token.revoked',resourceId:connectionId});assert.equal((await lexwareWebhook(f.request(revoked),f.env)).status,202);assert.equal((await settings(f.env)).lexwareVerified,false);assert.equal((await settings(f.env)).lexwareWebhookReady,false);
  await setting(f.env,'lexwareVerified',true);await lexwareWebhook(f.request(revoked),f.env);assert.equal((await settings(f.env)).lexwareVerified,true);assert.deepEqual(await pendingLexwareEvents(f.env),[]);
});

test('parallel queue workers read one known invoice once and leave local payment records untouched',async t=>{
  const f=await fixture(t);t.mock.method(crypto,'verify',()=>true);await lexwareWebhook(f.request(),f.env);let calls=0;t.mock.method(globalThis,'fetch',(url,options)=>{calls++;return f.api(url,options);});
  const results=await Promise.all([pendingLexwareEvents(f.env),pendingLexwareEvents(f.env)]);assert.deepEqual(results,[[],[]]);assert.equal(calls,3);
  const order=await getOrder(f.env,f.order.id);assert.equal(order.invoice.remotePayment.paid,true);assert.deepEqual(order.payments,[]);assert.equal(order.status,'Erledigt');assert.equal((await f.env.DB.prepare('SELECT state FROM lexware_events').first()).state,'done');
  await lexwareWebhook(f.request(),f.env);await pendingLexwareEvents(f.env);assert.equal(calls,3);
});

test('stale resource mappings are discarded without any provider read',async t=>{
  const f=await fixture(t);t.mock.method(crypto,'verify',()=>true);await lexwareWebhook(f.request(),f.env);const changed={...f.order,invoice:{...f.order.invoice,id:crypto.randomUUID()}};await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(changed),f.order.id).run();t.mock.method(globalThis,'fetch',()=>{throw Error('Stale event must not read an arbitrary invoice');});
  assert.deepEqual(await pendingLexwareEvents(f.env),[]);assert.equal((await f.env.DB.prepare('SELECT state FROM lexware_events').first()).state,'ignored');
});

test('a safe read failure persists a delayed queue retry and a crashed lease can be reclaimed',async t=>{
  const f=await fixture(t);t.mock.method(crypto,'verify',()=>true);await lexwareWebhook(f.request(),f.env);let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;return new Response('{}',{status:503});});
  assert.equal((await pendingLexwareEvents(f.env)).length,1);assert.equal(calls,1);const failed=await f.env.DB.prepare('SELECT * FROM lexware_events').first();assert.equal(failed.state,'failed');assert.ok(failed.next_attempt>Date.now());await pendingLexwareEvents(f.env);assert.equal(calls,1);
  await f.env.DB.prepare("UPDATE lexware_events SET state='processing',lease_until=?,lease_owner='crashed' WHERE id=?").bind(Date.now()-1,failed.id).run();t.mock.method(globalThis,'fetch',f.api);assert.deepEqual(await pendingLexwareEvents(f.env),[]);assert.equal((await f.env.DB.prepare('SELECT state FROM lexware_events').first()).state,'done');
});

test('subscription preview cannot perform API writes and requires the approved production origin',async t=>{
  const f=await fixture(t);t.mock.method(globalThis,'fetch',()=>{throw Error('Preview is local only');});const preview=await lexwareSubscriptions(f.env);assert.equal(preview.reviewRequired,true);assert.equal(preview.callbackUrl,callbackUrl);assert.deepEqual(preview.eventTypes,['invoice.changed','invoice.status.changed','payment.changed']);assert.equal((await settings(f.env)).lexwareWebhookReady,true);
  await assert.rejects(()=>lexwareSubscriptions({...f.env,PANEL_ORIGIN:'https://example.invalid'},{reviewed:true}),/freigegebene Paneladresse/);
});

test('explicit subscription setup creates only missing own subscriptions and confirms all three by a final read',async t=>{
  const f=await fixture(t),items=[{subscriptionId:crypto.randomUUID(),organizationId,eventType:'invoice.changed',callbackUrl}],calls=[];
  t.mock.method(globalThis,'fetch',(url,options)=>{assert.equal(new URL(url).pathname,'/v1/event-subscriptions');calls.push(options.method??'GET');if(options.method==='POST'){const value=JSON.parse(options.body),id=crypto.randomUUID();assert.equal(value.callbackUrl,callbackUrl);items.push({subscriptionId:id,organizationId,...value});return response({id});}return response({content:items});});
  const result=await lexwareSubscriptions(f.env,{reviewed:true});assert.equal(result.ok,true);assert.deepEqual(calls,['GET','POST','POST','GET']);const config=await settings(f.env);assert.equal(config.lexwareWebhookReady,true);assert.equal(config.lexwareWebhookSubscriptions.subscriptionIds.length,3);
  calls.length=0;await lexwareSubscriptions(f.env,{reviewed:true});assert.deepEqual(calls,['GET','GET']);
});

test('an uncertain subscription POST is never automatically repeated; the next explicit setup reconciles existing subscriptions',async t=>{
  const f=await fixture(t),items=[],calls=[];let timeout=true;
  t.mock.method(globalThis,'fetch',(url,options)=>{calls.push(options.method??'GET');if(options.method==='POST'){const id=crypto.randomUUID();items.push({subscriptionId:id,organizationId,...JSON.parse(options.body)});if(timeout){timeout=false;throw Error('synthetic timeout after provider acceptance');}return response({id});}return response({content:items});});
  await assert.rejects(()=>lexwareSubscriptions(f.env,{reviewed:true}),/synthetic timeout/);assert.deepEqual(calls,['GET','POST']);assert.equal((await settings(f.env)).lexwareWebhookReady,false);
  calls.length=0;await lexwareSubscriptions(f.env,{reviewed:true});assert.deepEqual(calls,['GET','POST','POST','GET']);assert.equal(items.length,3);
});

test('duplicate subscriptions, concurrent setup and a changed key prevent a false readiness claim',async t=>{
  const f=await fixture(t),items=['invoice.changed','invoice.status.changed','payment.changed'].map(eventType=>({subscriptionId:crypto.randomUUID(),organizationId,eventType,callbackUrl}));
  t.mock.method(globalThis,'fetch',()=>response({content:[...items,items[0]]}));await assert.rejects(()=>lexwareSubscriptions(f.env,{reviewed:true}),/unvollständig/);assert.equal((await settings(f.env)).lexwareWebhookReady,false);
  await f.env.DB.prepare("UPDATE lexware_subscription_lock SET lease_until=?,lease_owner='other'").bind(Date.now()+60000).run();await assert.rejects(()=>lexwareSubscriptions(f.env,{reviewed:true}),/läuft bereits/);await f.env.DB.prepare('UPDATE lexware_subscription_lock SET lease_until=0').run();
  let reads=0;t.mock.method(globalThis,'fetch',async()=>{if(++reads===2)await setting(f.env,'lexwareKey',await protect(f.env,'changed-synthetic-key'));return response({content:items});});await assert.rejects(()=>lexwareSubscriptions(f.env,{reviewed:true}),/während der Einrichtung verändert/);assert.equal((await settings(f.env)).lexwareWebhookReady,false);
});
