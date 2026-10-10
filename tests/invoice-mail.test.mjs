import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {PanelDatabase} from '../server/storage.mjs';
import {init,setting,protect,getOrder,saveOrder} from '../src/worker.mjs';
import {digest} from '../server/auth.mjs';
import {paymentSchema} from '../server/payment-ledger.mjs';
import {invoicePaymentSchema,invoicePaymentState} from '../server/invoice-payment.mjs';
import {invoiceMailSchema,invoiceMailStatus,sendPaidCashInvoice} from '../server/invoice-mail.mjs';

async function fixture(t,{synthetic=false,amount=11900,method='Bar',confirmed=true,owner=true}={}){
  const files=new Map(),env={CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{get:async id=>files.get(id)??null}};
  t.after(()=>env.DB.close());await init(env);await paymentSchema(env);await invoicePaymentSchema(env);await invoiceMailSchema(env);
  const order={id:randomUUID(),wg:'TEST-INVOICE-'+randomUUID(),version:1,status:'Bezahlt',synthetic,source:{name:'Synthetischer Kunde',email:'CUSTOMER@example.invalid',vehicle:'TEST-Fahrzeug'},offer:{totalCents:11900,services:'Synthetische Leistung'},acceptance:{at:'2026-10-01T10:00:00Z'},completedAt:'2026-10-01T11:00:00Z',invoice:{id:randomUUID(),number:null,totalCents:11900,status:'paid'},payments:[]};
  order.invoice.number=order.wg;
  const payment={id:randomUUID(),orderId:order.id,wg:order.wg,agreedTotalCents:11900,amountCents:amount,method,reference:'TEST-'+randomUUID(),at:'2026-10-01T12:00:00Z',cashConfirmed:method==='Bar',receivedConfirmed:confirmed,receivedConfirmedBy:owner?'owner':'agent:synthetic',receivedConfirmedAt:'2026-10-01T12:01:00Z'};
  await env.DB.prepare('INSERT INTO payment_records VALUES(?,?,?,?,?,?)').bind(payment.id,order.id,payment.reference,digest(JSON.stringify(payment)),JSON.stringify(payment),payment.at).run();
  const summary=await invoicePaymentState(env,order),snapshot={invoiceId:order.invoice.id,number:order.invoice.number,originalHash:digest('SYNTHETIC ORIGINAL'),payment:summary};
  const version=digest(JSON.stringify(snapshot)),document=await PDFDocument.create();document.addPage().drawText('SYNTHETIC invoice copy - Bar bezahlt');const bytes=await document.save(),asset=randomUUID();
  files.set(asset,{body:bytes});order.invoice.paymentCopyVersion=version;
  await env.DB.prepare('INSERT INTO invoice_payment_documents VALUES(?,?,?,?,?,?,?)').bind(version,order.invoice.id,order.id,asset,digest(bytes),JSON.stringify(snapshot),payment.at).run();
  await env.DB.prepare('INSERT INTO orders VALUES(?,?,NULL,?,?,?,?,?,?,?)').bind(order.id,order.wg,1,order.status,JSON.stringify(order),payment.at,'test','Synthetic fixture',synthetic?1:0).run();
  await setting(env,'resendKey',await protect(env,'SYNTHETIC API KEY'));
  for(const [key,value] of Object.entries({emailVerified:true,sendApproved:true,sender:'SYNTHETIC <sender@example.invalid>'}))await setting(env,key,value);
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://api.resend.com/emails');assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');calls.push({payload:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return Response.json({id:'SYNTHETIC MAIL ID'});});
  return {env,order,payment,snapshot,version,bytes,asset,files,calls};
}
const job=env=>env.DB.prepare("SELECT * FROM jobs WHERE kind='invoice-cash-mail'").first();

test('owner sends exactly the archived invoice copy and retries never duplicate or alter payment/order data',async t=>{
  const f=await fixture(t),before=await getOrder(f.env,f.order.id),ledger=await f.env.DB.prepare('SELECT * FROM payment_records').first();
  assert.equal((await invoiceMailStatus(f.env,f.order.id)).state,'not-requested');
  assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'sent');
  assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'sent');
  assert.equal(f.calls.length,1);const {payload,key}=f.calls[0];
  assert.deepEqual(payload.to,['customer@example.invalid']);assert.match(payload.subject,/Bar bezahlt/);assert.match(payload.text,/persönlich bestätigte vollständige Bargeldeingang/);
  assert.ok(!JSON.stringify(payload).includes('Quittung'));assert.equal(payload.attachments.length,1);
  assert.deepEqual(Buffer.from(payload.attachments[0].content,'base64'),Buffer.from(f.bytes));assert.match(payload.attachments[0].filename,/-Rechnungskopie-Zahlungsvermerk\.pdf$/);
  assert.equal(key,'wg-invoice-cash-'+(await job(f.env)).id);assert.equal((await job(f.env)).provider_id,'SYNTHETIC MAIL ID');
  assert.deepEqual(await getOrder(f.env,f.order.id),before);assert.deepEqual(await f.env.DB.prepare('SELECT * FROM payment_records').first(),ledger);assert.equal(f.files.size,1);
});

test('concurrent owner clicks reserve one send before contacting Resend',async t=>{
  const f=await fixture(t);let entered,release,calls=0;
  const contacted=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  t.mock.method(globalThis,'fetch',async()=>{calls++;entered();await gate;return Response.json({id:'SYNTHETIC ONE'});});
  const a=sendPaidCashInvoice(f.env,f.order.id,'owner'),b=sendPaidCashInvoice(f.env,f.order.id,'owner');await contacted;
  assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'pending');release();
  const results=await Promise.all([a,b]);assert.ok(results.some(value=>value.state==='sent'));assert.equal(calls,1);
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE kind='invoice-cash-mail'").first()).n,1);
});

test('missing invoice creates no number, PDF, delivery job or provider operation',async t=>{
  const f=await fixture(t),order=await getOrder(f.env,f.order.id);delete order.invoice;await saveOrder(f.env,order,order.version,'Synthetic missing invoice');
  const value=await sendPaidCashInvoice(f.env,f.order.id,'owner');assert.equal(value.state,'failed');assert.match(value.message,/Rechnung fehlt/);
  assert.equal(f.calls.length,0);assert.equal(await job(f.env),null);assert.equal((await getOrder(f.env,f.order.id)).invoice,undefined);assert.equal(f.files.size,1);
});

test('partial cash, card and unconfirmed or non-owner legacy entries cannot claim full cash payment',async t=>{
  for(const options of [{amount:5000},{method:'Karte'},{confirmed:false},{owner:false}]){
    const f=await fixture(t,options),value=await sendPaidCashInvoice(f.env,f.order.id,'owner');assert.equal(value.state,'failed');assert.match(value.message,/keine vollständige Barzahlung/);assert.equal(f.calls.length,0);assert.equal(await job(f.env),null);
  }
});

test('personal owner authorization is mandatory and synthetic orders never send',async t=>{
  const f=await fixture(t);
  for(const actor of [undefined,'customer','agent:synthetic','provider'])await assert.rejects(sendPaidCashInvoice(f.env,f.order.id,actor),error=>error.status===403);
  const order=await getOrder(f.env,f.order.id);order.synthetic=true;await saveOrder(f.env,order,order.version,'Synthetic test flag');
  assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'test');assert.equal(f.calls.length,0);assert.equal(await job(f.env),null);
});

test('unapproved sender is a durable pre-contact failure; a later explicit click retries the same job safely',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);
  assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'failed');assert.equal(f.calls.length,0);const first=await job(f.env);
  assert.equal(first.state,'failed');assert.match((await invoiceMailStatus(f.env,f.order.id)).message,/prüfen.*freigeben/);
  await setting(f.env,'sendApproved',true);assert.equal((await invoiceMailStatus(f.env,f.order.id)).state,'failed');assert.equal(f.calls.length,0);
  assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'sent');assert.equal((await job(f.env)).id,first.id);assert.equal(f.calls.length,1);
});

test('missing verification, sender or Resend credential cannot contact any provider',async t=>{
  for(const [key,value] of [['emailVerified',false],['sender',''],['resendKey','']]){
    const f=await fixture(t);await setting(f.env,key,value);assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'failed');assert.equal(f.calls.length,0);assert.equal((await job(f.env)).state,'failed');
  }
});

test('missing, foreign and corrupted saved invoice copies all stop before provider contact',async t=>{
  for(const kind of ['missing','foreign','corrupt','snapshot']){
    const f=await fixture(t);
    if(kind==='missing')await f.env.DB.prepare('DELETE FROM invoice_payment_documents').run();
    if(kind==='foreign')await f.env.DB.prepare('UPDATE invoice_payment_documents SET order_id=?').bind(randomUUID()).run();
    if(kind==='corrupt')f.files.set(f.asset,{body:new Uint8Array([1,2,3])});
    if(kind==='snapshot')await f.env.DB.prepare('UPDATE invoice_payment_documents SET snapshot=?').bind(JSON.stringify({...f.snapshot,number:'FOREIGN'})).run();
    assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'failed');assert.equal(f.calls.length,0);assert.equal(await job(f.env),null);
  }
});

test('changed customer identity blocks a prepared retry and never redirects the invoice to another address',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);await sendPaidCashInvoice(f.env,f.order.id,'owner');await setting(f.env,'sendApproved',true);
  let order=await getOrder(f.env,f.order.id);order.source.email='foreign@example.invalid';order=await saveOrder(f.env,order,order.version,'Synthetic customer change');
  const failed=await sendPaidCashInvoice(f.env,f.order.id,'owner');assert.equal(failed.state,'failed');assert.match(failed.message,/Kundenadresse/);assert.equal(f.calls.length,0);
  order.source.email='customer@example.invalid';await saveOrder(f.env,order,order.version,'Synthetic restore');assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'sent');assert.deepEqual(f.calls[0].payload.to,['customer@example.invalid']);
});

test('provider timeout is unknown and blocks every later click without an automatic retry',async t=>{
  const f=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('SYNTHETIC timeout');});
  assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'unknown');
  for(let n=0;n<3;n++)assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'unknown');
  assert.equal(calls,1);assert.equal((await job(f.env)).state,'unknown');assert.match((await invoiceMailStatus(f.env,f.order.id)).message,/Keine Wiederholung/);
});

test('unconfirmed HTTP responses are locked even when they look successful or contain a provider ID',async t=>{
  for(const response of [()=>Response.json({}),()=>Response.json({id:''}),()=>new Response('SYNTHETIC invalid JSON'),()=>Response.json({id:'SYNTHETIC ID'},{status:500})]){
    const f=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return response();});
    assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'unknown');assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'unknown');assert.equal(calls,1);
  }
});

test('interrupted persisted provider attempt becomes unknown after lease expiry and never sends again',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);await sendPaidCashInvoice(f.env,f.order.id,'owner');await setting(f.env,'sendApproved',true);
  await f.env.DB.prepare("UPDATE jobs SET state='pending' WHERE kind='invoice-cash-mail'").run();await f.env.DB.prepare('UPDATE invoice_mail_deliveries SET processing_until=?,lease_owner=?').bind(Date.now()-1,'SYNTHETIC interrupted process').run();
  assert.equal((await invoiceMailStatus(f.env,f.order.id)).state,'unknown');assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'unknown');assert.equal(f.calls.length,0);
});

test('failure to persist provider success retains an unknown lock and provider reference',async t=>{
  const f=await fixture(t),prepare=f.env.DB.prepare.bind(f.env.DB);let failOnce=true;
  t.mock.method(f.env.DB,'prepare',sql=>{
    const statement=prepare(sql);
    if(sql.includes("UPDATE jobs SET state='sent'")&&failOnce){failOnce=false;statement.run=async()=>{throw Error('SYNTHETIC database failure');};}
    return statement;
  });
  assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'unknown');assert.equal((await sendPaidCashInvoice(f.env,f.order.id,'owner')).state,'unknown');
  assert.equal(f.calls.length,1);assert.equal((await job(f.env)).provider_id,'SYNTHETIC MAIL ID');
});
