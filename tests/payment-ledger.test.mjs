import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {init,getOrder,setting} from '../src/worker.mjs';
import {recordPayment,paymentSchema,paymentRecord} from '../server/payment-ledger.mjs';
import {registerTemplate,paymentDocument,requestPaymentDocument} from '../server/document-template.mjs';
import {digest} from '../server/auth.mjs';
import {syntheticSignature} from './fixtures/signature.mjs';

async function fixture(t,{synthetic=true}={}){
  const files=new Map(),env={DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes){files.set(id,{body:bytes});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}}};t.after(()=>env.DB.close());await init(env);await paymentSchema(env);
  const order={id:randomUUID(),wg:'TEST-PAYMENT',version:1,status:'Erledigt',synthetic,source:{name:'Synthetischer Kunde'},offer:{totalCents:11900,services:'Synthetische Leistung'},acceptance:{at:'2026-10-01T10:00:00Z'},return:{at:'2026-10-01T11:00:00Z'},completedAt:'2026-10-01T11:00:00Z',payments:[]};
  await env.DB.prepare('INSERT INTO orders VALUES(?,?,NULL,?,?,?,?,?,?,?)').bind(order.id,order.wg,1,order.status,JSON.stringify(order),'2026-10-01T11:00:00Z','test','fixture',synthetic?1:0).run();return {env,order,files};
}
const cash=()=>({idempotencyKey:randomUUID(),amountCents:11900,method:'Bar',reference:'TEST-KASSE-0001',at:'2026-10-01T12:00:00Z',cashConfirmed:true,receivedConfirmed:true});
test('repeated and concurrent identical payment saves exactly one payment and keeps invoice independent',async t=>{
  const {env,order}=await fixture(t),input=cash();const [a,b]=await Promise.all([recordPayment(env,order,input),recordPayment(env,order,input)]);assert.equal(a.status,'Bezahlt');assert.equal(b.status,'Bezahlt');
  const saved=await recordPayment(env,await getOrder(env,order.id),input,'owner',1);assert.equal(saved.payments.length,1);assert.equal(saved.version,2);assert.equal(saved.invoice,undefined);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,1);
  assert.equal((await paymentRecord(env,order.id,input.idempotencyKey)).documentType,'Quittung');
});
test('same payment reference cannot be booked twice under another key and altered retries fail',async t=>{
  const {env,order}=await fixture(t),input=cash();await recordPayment(env,order,input);
  await assert.rejects(recordPayment(env,await getOrder(env,order.id),{...input,idempotencyKey:randomUUID()}),/anderen Angaben/);
  await assert.rejects(recordPayment(env,await getOrder(env,order.id),{...input,amountCents:100}),/anderen Angaben/);
  assert.equal((await getOrder(env,order.id)).payments.length,1);
});
test('partial payment remains unpaid; overpayment and stale view roll back',async t=>{
  const {env,order}=await fixture(t),input={...cash(),amountCents:5000};const saved=await recordPayment(env,order,input);assert.equal(saved.status,'Erledigt');
  const original=await paymentRecord(env,order.id,input.idempotencyKey);assert.equal(original.amountCents,5000);assert.equal(original.agreedTotalCents,11900);assert.equal(original.paidTotalCents,5000);assert.equal(original.remainingCents,6900);
  await assert.rejects(recordPayment(env,saved,{...cash(),reference:'TEST-OTHER',amountCents:10000}),/überschreitet/);
  await assert.rejects(recordPayment(env,saved,{...cash(),reference:'TEST-OTHER',amountCents:6900},'owner',1),/veraltet/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,1);
  const finalPayment={...cash(),reference:'TEST-FINAL',amountCents:6900,at:'2026-10-01T11:30:00Z'},paid=await recordPayment(env,saved,finalPayment);assert.equal(paid.status,'Bezahlt');const final=await paymentRecord(env,order.id,finalPayment.idempotencyKey);assert.equal(final.amountCents,6900);assert.equal(final.at,'2026-10-01T11:30:00.000Z');assert.equal(final.paidTotalCents,11900);assert.equal(final.remainingCents,0);assert.deepEqual(await paymentRecord(env,order.id,input.idempotencyKey),original);
});

test('an invoice or completed order without a recorded incoming payment cannot create a receipt',async t=>{
  const {env,order,files}=await fixture(t);order.invoice={number:'TEST-INVOICE',status:'paid'};
  await env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(order),order.id).run();
  await assert.rejects(paymentDocument(env,order.id,randomUUID()),/nicht gefunden/);assert.equal(files.size,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_documents').first()).n,0);assert.equal((await getOrder(env,order.id)).status,'Erledigt');
});
for(const method of ['Bar','Karte','Überweisung'])test(method+' requires the operator to explicitly confirm receiving the payment',async t=>{
  const {env,order,files}=await fixture(t),receipt=randomUUID(),bytes=new Uint8Array(Buffer.from(syntheticSignature.split(',')[1],'base64')),input={...cash(),method,receipt};
  if(method!=='Bar'){await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(receipt,order.id,'photo','image/png',digest(bytes),bytes.length,input.at).run();files.set(receipt,{body:bytes});}
  for(const value of [undefined,false,'true',1])await assert.rejects(recordPayment(env,order,{...input,receivedConfirmed:value}),/persönlich bestätigen/);
  const unchanged=await getOrder(env,order.id);assert.equal(unchanged.version,1);assert.equal(unchanged.status,'Erledigt');assert.deepEqual(unchanged.payments,[]);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,0);
  const saved=await recordPayment(env,order,input);assert.equal(saved.status,'Bezahlt');const record=await paymentRecord(env,order.id,input.idempotencyKey);assert.equal(record.receivedConfirmed,true);assert.equal(record.receivedConfirmedBy,'owner');assert.equal(record.receivedConfirmedAt,record.recordedAt);
});
test('a customer or agent cannot confirm the operator receiving a payment',async t=>{
  const {env,order}=await fixture(t);for(const actor of ['customer','agent:synthetic','provider'])await assert.rejects(recordPayment(env,order,cash(),actor),/ausschließlich/);
  assert.equal((await getOrder(env,order.id)).version,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,0);
});
test('a legacy payment without explicit operator confirmation cannot generate a new receipt',async t=>{
  const {env,order,files}=await fixture(t),input=cash(),snapshot={...input,orderId:order.id,wg:order.wg,customer:order.source.name,documentType:'Quittung',recordedAt:input.at};delete snapshot.receivedConfirmed;
  await env.DB.prepare('INSERT INTO payment_records VALUES(?,?,?,?,?,?)').bind(input.idempotencyKey,order.id,input.reference,'SYNTHETIC-LEGACY',JSON.stringify(snapshot),input.at).run();
  await assert.rejects(paymentDocument(env,order.id,input.idempotencyKey),/persönlicher Betreiberbestätigung/);assert.equal(files.size,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_documents').first()).n,0);
});
test('receipt issuance is a separate audited owner request; received payment alone does not authorize it',async t=>{
  const {env,order,files}=await fixture(t),input=cash(),paid=await recordPayment(env,order,input),request={id:order.id,payment:input.idempotencyKey,version:paid.version,confirmed:true};
  await assert.rejects(paymentDocument(env,order.id,input.idempotencyKey),/ausdrücklichen Auftrag/);assert.equal(files.size,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_documents').first()).n,0);
  await assert.rejects(requestPaymentDocument(env,{...request,confirmed:false}),/ausdrücklich/);await assert.rejects(requestPaymentDocument(env,request,'customer'),/ausschließlich/);await assert.rejects(requestPaymentDocument(env,request,'agent:synthetic'),/ausschließlich/);await assert.rejects(requestPaymentDocument(env,{...request,version:1}),/veraltet/);
  const [one,two]=await Promise.all([requestPaymentDocument(env,request),requestPaymentDocument(env,request)]);assert.equal(one.version,3);assert.equal(two.version,3);assert.equal(one.receiptRequests[input.idempotencyKey].requestedBy,'owner');assert.equal((await requestPaymentDocument(env,request)).version,3);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM audit WHERE order_id=? AND action=?').bind(order.id,'Separate Quittung auf ausdrücklichen Betreiberauftrag freigegeben').first()).n,1);assert.equal(files.size,0);
});
test('real cash recording requires verified cash-system path and actual confirmation',async t=>{
  const {env,order}=await fixture(t,{synthetic:false});await assert.rejects(recordPayment(env,order,cash()),/Kassensystem/);
  await setting(env,'cashRecordingApproved',true);await setting(env,'cashSystemEvidence','Synthetischer freigegebener Kassensystem-Nachweis');
  await assert.rejects(recordPayment(env,order,{...cash(),cashConfirmed:false}),/ausdrücklich/);
  assert.equal((await recordPayment(env,order,cash())).status,'Bezahlt');
});
test('card payment needs an own existing terminal receipt and a reference; generated approval is never invented',async t=>{
  const {env,order,files}=await fixture(t),id=randomUUID(),input={...cash(),method:'Karte',reference:'TEST-TERMINAL-0001',receipt:id},original=new Uint8Array(Buffer.from(syntheticSignature.split(',')[1],'base64'));
  await assert.rejects(recordPayment(env,order,input),/anderen Auftrag/);await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(id,order.id,'photo','image/png',digest(original),original.length,'2026-10-01T12:00:00Z').run();files.set(id,{body:original});
  assert.equal((await recordPayment(env,order,input)).status,'Bezahlt');assert.equal((await paymentRecord(env,order.id,input.idempotencyKey)).documentType,'Zahlungsnachweis');
});
test('document waits for real approved letterhead; once generated it is immutable and isolated by order',async t=>{
  const {env,order,files}=await fixture(t),input=cash(),paid=await recordPayment(env,order,input);await assert.rejects(paymentDocument(env,order.id,input.idempotencyKey),/ausdrücklichen Auftrag/);await requestPaymentDocument(env,{id:order.id,payment:input.idempotencyKey,version:paid.version,confirmed:true});await assert.rejects(paymentDocument(env,order.id,input.idempotencyKey),/Briefpapier/);
  const {PDFDocument}=await import('../dist/pdf/library.mjs');const template=await PDFDocument.create();template.addPage([595.28,841.89]).drawText('SYNTHETISCHES TESTBRIEFPAPIER',{x:42,y:800,size:10});const bytes=await template.save();
  const settings={pdfBase64:Buffer.from(bytes).toString('base64'),approved:true,blankLetterheadConfirmed:true,evidence:'SYNTHETISCHE TESTVORLAGE; kein echtes Briefpapier',contentBox:{left:42,right:42,top:150,bottom:100},company:{name:'TESTBETRIEB',street:'Testweg 1',city:'00000 Teststadt',email:'test@example.invalid'}};
  await assert.rejects(registerTemplate(env,{...settings,approved:false}),/bestätigt/);await registerTemplate(env,settings);
  const one=await paymentDocument(env,order.id,input.idempotencyKey),two=await paymentDocument(env,order.id,input.idempotencyKey);assert.deepEqual(one.bytes,two.bytes);assert.equal((await PDFDocument.load(one.bytes)).getPageCount(),1);
  const historical=await paymentRecord(env,order.id,input.idempotencyKey);delete historical.receivedConfirmed;delete historical.receivedConfirmedBy;delete historical.receivedConfirmedAt;await env.DB.prepare('UPDATE payment_records SET data=? WHERE id=?').bind(JSON.stringify(historical),input.idempotencyKey).run();assert.deepEqual((await paymentDocument(env,order.id,input.idempotencyKey)).bytes,one.bytes);
  await assert.rejects(paymentDocument(env,randomUUID(),input.idempotencyKey),/nicht gefunden/);assert.equal(files.size,2);
});
