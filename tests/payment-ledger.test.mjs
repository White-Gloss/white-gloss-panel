import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {PanelDatabase} from '../server/storage.mjs';
import {init,getOrder} from '../src/worker.mjs';
import {recordPayment,paymentSchema,paymentRecord} from '../server/payment-ledger.mjs';
import {registerTemplate,paymentDocument,requestPaymentDocument} from '../server/document-template.mjs';
import {digest} from '../server/auth.mjs';
import {syntheticSignature} from './fixtures/signature.mjs';

async function fixture(t,{synthetic=true}={}){
  const files=new Map(),env={DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes){files.set(id,{body:bytes});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}}};t.after(()=>env.DB.close());await init(env);await paymentSchema(env);
  const order={id:randomUUID(),wg:'TEST-PAYMENT',version:1,status:'Erledigt',synthetic,source:{name:'Synthetischer Kunde'},offer:{totalCents:11900,services:'Synthetische Leistung'},acceptance:{at:'2026-10-01T10:00:00Z'},return:{at:'2026-10-01T11:00:00Z'},completedAt:'2026-10-01T11:00:00Z',payments:[]};
  await env.DB.prepare('INSERT INTO orders VALUES(?,?,NULL,?,?,?,?,?,?,?)').bind(order.id,order.wg,1,order.status,JSON.stringify(order),'2026-10-01T11:00:00Z','test','fixture',synthetic?1:0).run();return {env,order,files};
}
const cash=()=>({idempotencyKey:randomUUID(),amountCents:11900,method:'Bar',reference:'TEST-KASSE-0001',cashSource:'SYNTHETISCHE SEPARATE KASSE 1',externalCashRecordedConfirmed:true,at:'2026-10-01T12:00:00Z',cashConfirmed:true,receivedConfirmed:true});
async function importedCash(env,order,files,overrides={}){
  const input={...cash(),...overrides,receipt:overrides.receipt??randomUUID()},doc=await PDFDocument.create();doc.addPage().drawText('SYNTHETISCHER EXTERNER BON '+input.receipt);const bytes=await doc.save();
  await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(input.receipt,order.id,'payment','application/pdf',digest(bytes),bytes.length,input.at).run();files.set(input.receipt,{body:bytes});return input;
}
test('repeated and concurrent identical payment saves exactly one payment and keeps invoice independent',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files);const [a,b]=await Promise.all([recordPayment(env,order,input),recordPayment(env,order,input)]);assert.equal(a.status,'Bezahlt');assert.equal(b.status,'Bezahlt');
  const saved=await recordPayment(env,await getOrder(env,order.id),input,'owner',1);assert.equal(saved.payments.length,1);assert.equal(saved.version,2);assert.equal(saved.invoice,undefined);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,1);
  assert.equal((await paymentRecord(env,order.id,input.idempotencyKey)).documentType,'Quittung');
});
test('same payment reference cannot be booked twice under another key and altered retries fail',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files);await recordPayment(env,order,input);
  await assert.rejects(recordPayment(env,await getOrder(env,order.id),{...input,idempotencyKey:randomUUID()}),/anderen Angaben/);
  await assert.rejects(recordPayment(env,await getOrder(env,order.id),{...input,amountCents:100}),/anderen Angaben/);
  assert.equal((await getOrder(env,order.id)).payments.length,1);
});
test('partial payment remains unpaid; overpayment and stale view roll back',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files,{amountCents:5000});const saved=await recordPayment(env,order,input);assert.equal(saved.status,'Erledigt');
  const original=await paymentRecord(env,order.id,input.idempotencyKey);assert.equal(original.amountCents,5000);assert.equal(original.agreedTotalCents,11900);assert.equal(original.paidTotalCents,5000);assert.equal(original.remainingCents,6900);
  await assert.rejects(recordPayment(env,saved,await importedCash(env,order,files,{reference:'TEST-OTHER',amountCents:10000})),/überschreitet/);
  await assert.rejects(recordPayment(env,saved,await importedCash(env,order,files,{reference:'TEST-OTHER',amountCents:6900}),'owner',1),/veraltet/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,1);
  const finalPayment=await importedCash(env,order,files,{reference:'TEST-FINAL',amountCents:6900,at:'2026-10-01T11:30:00Z'}),paid=await recordPayment(env,saved,finalPayment);assert.equal(paid.status,'Bezahlt');const final=await paymentRecord(env,order.id,finalPayment.idempotencyKey);assert.equal(final.amountCents,6900);assert.equal(final.at,'2026-10-01T11:30:00.000Z');assert.equal(final.paidTotalCents,11900);assert.equal(final.remainingCents,0);assert.deepEqual(await paymentRecord(env,order.id,input.idempotencyKey),original);
});

test('an invoice or completed order without a recorded incoming payment cannot create a receipt',async t=>{
  const {env,order,files}=await fixture(t);order.invoice={number:'TEST-INVOICE',status:'paid'};
  await env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(order),order.id).run();
  await assert.rejects(paymentDocument(env,order.id,randomUUID()),/nicht gefunden/);assert.equal(files.size,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_documents').first()).n,0);assert.equal((await getOrder(env,order.id)).status,'Erledigt');
});
for(const method of ['Bar','Karte','Überweisung'])test(method+' requires the operator to explicitly confirm receiving the payment',async t=>{
  const {env,order,files}=await fixture(t),receipt=randomUUID(),bytes=new Uint8Array(Buffer.from(syntheticSignature.split(',')[1],'base64')),input=method==='Bar'?await importedCash(env,order,files):{...cash(),method,receipt};
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
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files),paid=await recordPayment(env,order,input),request={id:order.id,payment:input.idempotencyKey,version:paid.version,confirmed:true};
  await assert.rejects(paymentDocument(env,order.id,input.idempotencyKey),/ausdrücklichen Auftrag/);assert.equal(files.size,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_documents').first()).n,0);
  await assert.rejects(requestPaymentDocument(env,{...request,confirmed:false}),/ausdrücklich/);await assert.rejects(requestPaymentDocument(env,request,'customer'),/ausschließlich/);await assert.rejects(requestPaymentDocument(env,request,'agent:synthetic'),/ausschließlich/);await assert.rejects(requestPaymentDocument(env,{...request,version:1}),/veraltet/);
  const [one,two]=await Promise.all([requestPaymentDocument(env,request),requestPaymentDocument(env,request)]);assert.equal(one.version,3);assert.equal(two.version,3);assert.equal(one.receiptRequests[input.idempotencyKey].requestedBy,'owner');assert.equal((await requestPaymentDocument(env,request)).version,3);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM audit WHERE order_id=? AND action=?').bind(order.id,'Separate Quittung auf ausdrücklichen Betreiberauftrag freigegeben').first()).n,1);assert.equal(files.size,1);
});
test('real cash imports its actual existing external receipt and source without inventing a fallback or issuing another document',async t=>{
  const {env,order,files}=await fixture(t,{synthetic:false}),input=await importedCash(env,order,files);
  for(const cashConfirmed of [undefined,false,1,'true'])await assert.rejects(recordPayment(env,order,{...input,cashConfirmed}),/ausdrücklich/);
  const saved=await recordPayment(env,order,input);assert.equal(saved.status,'Bezahlt');assert.equal(saved.payments[0].reference,input.reference);assert.equal(saved.payments[0].receipt,input.receipt);assert.equal(saved.payments[0].cashSource,input.cashSource);assert.equal(saved.payments[0].receiptHash,digest(files.get(input.receipt).body));assert.equal(files.size,1);assert.equal(saved.receiptRequests,undefined);await assert.rejects(paymentDocument(env,order.id,input.idempotencyKey),/ausdrücklichen Auftrag/);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_documents').first()).n,0);
  assert.equal((await recordPayment(env,saved,{...input,reference:saved.payments[0].reference})).payments.length,1);
  await assert.rejects(recordPayment(env,saved,{...input,idempotencyKey:randomUUID()}),/anderen Angaben/);assert.equal((await getOrder(env,order.id)).payments.length,1);
});
test('external partial-payment retries keep the original receipt and reject stale or premature assignment',async t=>{
  const {env,order,files}=await fixture(t,{synthetic:false}),input=await importedCash(env,order,files,{amountCents:5000});await assert.rejects(recordPayment(env,{...order,status:'In Arbeit'},input),/nach Abschluss/);
  const partial=await recordPayment(env,order,input);assert.equal(partial.status,'Erledigt');assert.equal((await recordPayment(env,partial,input)).version,partial.version);
  await assert.rejects(recordPayment(env,partial,await importedCash(env,order,files,{reference:'TEST-NEXT',amountCents:6900}),'owner',1),/veraltet/);await assert.rejects(recordPayment(env,partial,{...input,amountCents:5001}),/anderen Angaben/);assert.equal((await getOrder(env,order.id)).payments.length,1);
});
test('card payment needs an own existing terminal receipt and a reference; generated approval is never invented',async t=>{
  const {env,order,files}=await fixture(t),id=randomUUID(),input={...cash(),method:'Karte',reference:'TEST-TERMINAL-0001',receipt:id},original=new Uint8Array(Buffer.from(syntheticSignature.split(',')[1],'base64'));
  await assert.rejects(recordPayment(env,order,input),/anderen Auftrag/);await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(id,order.id,'photo','image/png',digest(original),original.length,'2026-10-01T12:00:00Z').run();files.set(id,{body:original});
  assert.equal((await recordPayment(env,order,input)).status,'Bezahlt');assert.equal((await paymentRecord(env,order.id,input.idempotencyKey)).documentType,'Zahlungsnachweis');
});
test('document waits for real approved letterhead; once generated it is immutable and isolated by order',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files),paid=await recordPayment(env,order,input);await assert.rejects(paymentDocument(env,order.id,input.idempotencyKey),/ausdrücklichen Auftrag/);await requestPaymentDocument(env,{id:order.id,payment:input.idempotencyKey,version:paid.version,confirmed:true});await assert.rejects(paymentDocument(env,order.id,input.idempotencyKey),/Briefpapier/);
  const {PDFDocument}=await import('../dist/pdf/library.mjs');const template=await PDFDocument.create();template.addPage([595.28,841.89]).drawText('SYNTHETISCHES TESTBRIEFPAPIER',{x:42,y:800,size:10});const bytes=await template.save();
  const settings={pdfBase64:Buffer.from(bytes).toString('base64'),approved:true,blankLetterheadConfirmed:true,evidence:'SYNTHETISCHE TESTVORLAGE; kein echtes Briefpapier',contentBox:{left:42,right:42,top:150,bottom:100},company:{name:'TESTBETRIEB',street:'Testweg 1',city:'00000 Teststadt',email:'test@example.invalid'}};
  await assert.rejects(registerTemplate(env,{...settings,approved:false}),/bestätigt/);await registerTemplate(env,settings);
  const one=await paymentDocument(env,order.id,input.idempotencyKey),two=await paymentDocument(env,order.id,input.idempotencyKey);assert.deepEqual(one.bytes,two.bytes);assert.equal((await PDFDocument.load(one.bytes)).getPageCount(),1);
  const historical=await paymentRecord(env,order.id,input.idempotencyKey);delete historical.receivedConfirmed;delete historical.receivedConfirmedBy;delete historical.receivedConfirmedAt;await env.DB.prepare('UPDATE payment_records SET data=? WHERE id=?').bind(JSON.stringify(historical),input.idempotencyKey).run();assert.deepEqual((await paymentDocument(env,order.id,input.idempotencyKey)).bytes,one.bytes);
  await assert.rejects(paymentDocument(env,randomUUID(),input.idempotencyKey),/nicht gefunden/);assert.equal(files.size,3);
});

async function otherOrder(env,original){
  const order={...original,id:randomUUID(),wg:'TEST-PAYMENT-'+randomUUID(),version:1,status:'Erledigt',payments:[]};
  await env.DB.prepare('INSERT INTO orders VALUES(?,?,NULL,?,?,?,?,?,?,?)').bind(order.id,order.wg,1,order.status,JSON.stringify(order),'2026-10-01T11:00:00Z','test','Other synthetic fixture',order.synthetic?1:0).run();return order;
}

test('cash requires actual external source, original receipt, external reference and separate personal import confirmation',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files);
  for(const patch of [
    {externalCashRecordedConfirmed:undefined},{externalCashRecordedConfirmed:false},{externalCashRecordedConfirmed:'true'},
    {cashSource:undefined},{cashSource:''},{cashSource:'  '},{cashSource:'x'.repeat(161)},{cashSource:'Kasse\n1'},
    {reference:undefined},{reference:null},{reference:''},{reference:'  '},{reference:'x'.repeat(181)},
    {receipt:undefined},{receipt:null},{receipt:''}
  ])await assert.rejects(recordPayment(env,order,{...input,...patch}));
  assert.equal((await getOrder(env,order.id)).version,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM cash_receipt_links').first()).n,0);
  const saved=await recordPayment(env,order,{...input,cashSource:'K'.repeat(160),reference:'R'.repeat(180)}),record=await paymentRecord(env,order.id,input.idempotencyKey);
  assert.equal(saved.payments[0].cashSource.length,160);assert.equal(record.reference.length,180);assert.equal(record.externalCashRecordedConfirmed,true);assert.equal(record.externalCashRecordedConfirmedBy,'owner');assert.equal(record.importType,'external-cash-receipt');assert.equal(record.receiptHash,digest(files.get(input.receipt).body));assert.equal(record.at,'2026-10-01T12:00:00.000Z');assert.notEqual(record.recordedAt,record.at);
});

test('cash cannot use photos, signatures, booking assets, foreign or unsupported payment files as its original receipt',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files);
  for(const kind of ['photo','signature','booking','protocol']){
    await env.DB.prepare('UPDATE assets SET kind=? WHERE id=?').bind(kind,input.receipt).run();await assert.rejects(recordPayment(env,order,input),/kein Zahlungsbeleg-Upload/);
  }
  await env.DB.prepare("UPDATE assets SET kind='payment',order_id=? WHERE id=?").bind(randomUUID(),input.receipt).run();await assert.rejects(recordPayment(env,order,input),/anderen Auftrag/);
  await env.DB.prepare("UPDATE assets SET order_id=?,mime='text/plain' WHERE id=?").bind(order.id,input.receipt).run();await assert.rejects(recordPayment(env,order,input),/kein Zahlungsbeleg-Upload/);
  assert.equal((await getOrder(env,order.id)).version,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,0);
});

test('missing, altered or truncated originals block cash imports and no incomplete link remains',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files),original=files.get(input.receipt);
  files.delete(input.receipt);await assert.rejects(recordPayment(env,order,input),/fehlt oder wurde verändert/);
  files.set(input.receipt,{body:new Uint8Array([1,2,3])});await assert.rejects(recordPayment(env,order,input),/fehlt oder wurde verändert/);
  files.set(input.receipt,original);await env.DB.prepare('UPDATE assets SET size=size+1 WHERE id=?').bind(input.receipt).run();await assert.rejects(recordPayment(env,order,input),/fehlt oder wurde verändert/);
  assert.equal((await getOrder(env,order.id)).version,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM cash_receipt_links').first()).n,0);
});

test('even an identical retry rechecks the immutable original hash and changed source/hash cannot overwrite its snapshot',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files),saved=await recordPayment(env,order,input),before=await paymentRecord(env,order.id,input.idempotencyKey),original=files.get(input.receipt);
  files.set(input.receipt,{body:new Uint8Array([1,2,3])});await assert.rejects(recordPayment(env,saved,input),/verändert/);files.set(input.receipt,original);
  await assert.rejects(recordPayment(env,saved,{...input,cashSource:'OTHER SYNTHETIC CASH REGISTER'}),/anderen Angaben/);
  const replacement=Buffer.from('%PDF-1.7\nSYNTHETIC altered original');files.set(input.receipt,{body:replacement});await env.DB.prepare('UPDATE assets SET hash=?,size=? WHERE id=?').bind(digest(replacement),replacement.length,input.receipt).run();
  await assert.rejects(recordPayment(env,saved,input),/anderen Angaben/);assert.deepEqual(await paymentRecord(env,order.id,input.idempotencyKey),before);assert.equal((await getOrder(env,order.id)).payments.length,1);
});

test('the same external register/reference is unique across orders despite source case and whitespace variations',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files),other=await otherOrder(env,order),second=await importedCash(env,other,files,{cashSource:'  synthetische   separate kasse 1  ',reference:input.reference});
  await recordPayment(env,order,input);await assert.rejects(recordPayment(env,other,second),error=>error.status===409&&/bereits einer Zahlung/.test(error.message));
  assert.equal((await getOrder(env,other.id)).version,1);assert.deepEqual((await getOrder(env,other.id)).payments,[]);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM cash_receipt_links').first()).n,1);
});

test('the same original bytes cannot become another cash payment through a changed source/reference and another upload',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files),other=await otherOrder(env,order),second=await importedCash(env,other,files,{cashSource:'OTHER SYNTHETIC REGISTER',reference:'TEST-DIFFERENT-REF'}),bytes=files.get(input.receipt).body;
  files.set(second.receipt,{body:bytes});await env.DB.prepare('UPDATE assets SET hash=?,size=? WHERE id=?').bind(digest(bytes),bytes.byteLength,second.receipt).run();
  await recordPayment(env,order,input);await assert.rejects(recordPayment(env,other,second),/bereits einer Zahlung/);assert.equal((await getOrder(env,other.id)).version,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM cash_receipt_links').first()).n,1);
});

test('concurrent assignments of one external register/reference roll back the losing order and ledger atomically',async t=>{
  const {env,order,files}=await fixture(t),other=await otherOrder(env,order),one=await importedCash(env,order,files),two=await importedCash(env,other,files,{reference:one.reference});
  const results=await Promise.allSettled([recordPayment(env,order,one),recordPayment(env,other,two)]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1);const rejected=results.find(value=>value.status==='rejected');assert.equal(rejected.reason.status,409);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM cash_receipt_links').first()).n,1);const states=await Promise.all([getOrder(env,order.id),getOrder(env,other.id)]);assert.deepEqual(states.map(value=>value.version).sort(),[1,2]);assert.equal(states.reduce((sum,value)=>sum+value.payments.length,0),1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM audit WHERE version=2').first()).n,1);
});

test('concurrent identical receipt hashes remain unique even under different register/reference identifiers',async t=>{
  const {env,order,files}=await fixture(t),other=await otherOrder(env,order),one=await importedCash(env,order,files),two=await importedCash(env,other,files,{cashSource:'OTHER CASH REGISTER',reference:'OTHER-REF'}),bytes=files.get(one.receipt).body;
  files.set(two.receipt,{body:bytes});await env.DB.prepare('UPDATE assets SET hash=?,size=? WHERE id=?').bind(digest(bytes),bytes.byteLength,two.receipt).run();
  const results=await Promise.allSettled([recordPayment(env,order,one),recordPayment(env,other,two)]);assert.equal(results.filter(value=>value.status==='fulfilled').length,1);assert.equal(results.find(value=>value.status==='rejected').reason.status,409);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM cash_receipt_links').first()).n,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM audit WHERE version=2').first()).n,1);
});

test('legacy cash entries cannot gain a new original/source by retrying their old key or become a second payment',async t=>{
  const {env,order,files}=await fixture(t),input=await importedCash(env,order,files),legacy={id:input.idempotencyKey,amountCents:11900,method:'Bar',reference:input.reference,at:input.at,receipt:null,cashConfirmed:true,receivedConfirmed:true},before=JSON.stringify(legacy);
  await env.DB.prepare('INSERT INTO payment_records VALUES(?,?,?,?,?,?)').bind(input.idempotencyKey,order.id,input.reference,digest(before),before,input.at).run();
  await assert.rejects(recordPayment(env,order,input),/anderen Angaben/);assert.equal((await env.DB.prepare('SELECT data FROM payment_records WHERE id=?').bind(input.idempotencyKey).first()).data,before);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM cash_receipt_links').first()).n,0);assert.equal((await getOrder(env,order.id)).version,1);
});

test('bank/card legacy photo receipts and reference scope remain compatible across different orders',async t=>{
  const {env,order,files}=await fixture(t),other=await otherOrder(env,order),bytes=new Uint8Array(Buffer.from(syntheticSignature.split(',')[1],'base64'));
  for(const [index,value] of [order,other].entries()){
    const receipt=randomUUID(),input={...cash(),method:index?'Karte':'Überweisung',reference:'SAME BANK REFERENCE',receipt};await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(receipt,value.id,'photo','image/png',digest(bytes),bytes.length,input.at).run();files.set(receipt,{body:bytes});assert.equal((await recordPayment(env,value,input)).status,'Bezahlt');
  }
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,2);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM cash_receipt_links').first()).n,0);
});
