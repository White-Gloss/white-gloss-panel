import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFArray,decodePDFRawStream} from 'pdf-lib';
import {invoicePaymentSummary} from '../src/invoice-payment.mjs';
import {invoicePayload,providerOperations} from '../server/providers.mjs';
import {invoicePaymentState,archiveQontoInvoice,invoicePaymentDocument,invoicePaymentVersions,syncInvoicePayment} from '../server/invoice-payment.mjs';
import {recordPayment,paymentSchema} from '../server/payment-ledger.mjs';
import {registerTemplate} from '../server/document-template.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {init,setting,getOrder,protect} from '../src/worker.mjs';
import {digest} from '../server/auth.mjs';

const invoiceId='22222222-2222-2222-2222-222222222222',attachmentId='33333333-3333-3333-3333-333333333333',clientId='11111111-1111-1111-1111-111111111111',iban='DE02120300000000202051';
const invoiceInput={reviewed:true,vatBasisPoints:1900,iban,dueDate:'2099-10-20',clientId};
const completed=()=>({id:crypto.randomUUID(),wg:'TEST-INVOICE',version:1,status:'Erledigt',synthetic:false,source:{name:'Synthetischer Kunde',email:'test@example.invalid'},offer:{totalCents:11900,services:'Synthetische Leistung'},acceptance:{at:'2026-10-01T10:00:00Z'},return:{at:'2026-10-01T11:00:00Z'},completedAt:'2026-10-01T11:00:00Z',payments:[],invoice:{id:invoiceId,number:'TEST-INVOICE',totalCents:11900,status:'unpaid'}});
const cash=amountCents=>({idempotencyKey:crypto.randomUUID(),amountCents,method:'Bar',reference:crypto.randomUUID(),at:'2026-10-01T12:00:00Z',cashConfirmed:true,receivedConfirmed:true});
function snapshot(order,amountCents,method='Bar'){return {id:crypto.randomUUID(),orderId:order.id,wg:order.wg,agreedTotalCents:11900,amountCents,method,reference:crypto.randomUUID(),at:'2026-10-01T12:00:00Z',cashConfirmed:method==='Bar',receivedConfirmed:true,receivedConfirmedBy:'owner',receivedConfirmedAt:'2026-10-01T12:05:00Z'};}
async function fixture(t,order=completed()){
  const files=new Map(),env={DB:new PanelDatabase(':memory:'),CONFIG_KEY:Buffer.alloc(32,3).toString('base64'),QONTO_INVOICE_PDF_HOSTS:'qonto-pdf.example.invalid',BUCKET:{async put(id,bytes){assert.ok(!files.has(id));files.set(id,{body:bytes});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}}};t.after(()=>env.DB.close());await init(env);await paymentSchema(env);
  await env.DB.prepare('INSERT INTO orders VALUES(?,?,NULL,?,?,?,?,?,?,?)').bind(order.id,order.wg,1,order.status,JSON.stringify(order),'2026-10-01T11:00:00Z','test','fixture',0).run();
  for(const [key,value] of Object.entries({cashRecordingApproved:true,cashSystemEvidence:'SYNTHETISCHER Kassentest',numberAudit:true,qontoVerified:true,qontoDocumentLayoutApproved:true,qontoDocumentLayoutEvidence:'SYNTHETISCHER Layouttest',qontoLogin:'synthetic-login'}))await setting(env,key,value);await setting(env,'qontoKey',await protect(env,'synthetic-key'));
  const template=await PDFDocument.create();template.addPage([595.28,841.89]).drawText('SYNTHETISCHES TESTBRIEFPAPIER',{x:42,y:800,size:10});await registerTemplate(env,{pdfBase64:Buffer.from(await template.save()).toString('base64'),approved:true,blankLetterheadConfirmed:true,evidence:'SYNTHETISCHER TEST',contentBox:{left:42,right:42,top:150,bottom:100},company:{name:'TESTBETRIEB',street:'Testweg 1',city:'00000 Teststadt',email:'test@example.invalid'}});
  const original=await PDFDocument.create();original.addPage([595.28,841.89]).drawText('ORIGINAL TEST-INVOICE 119 EUR',{x:42,y:730,size:12});const originalBytes=await original.save();
  return {env,order,files,originalBytes,remote:{id:invoiceId,number:order.wg,currency:'EUR',total_amount_cents:11900,status:'unpaid',attachment_id:attachmentId}};
}
function mockProvider(t,f,{unknown=false,unknownOutcomePaid=true,host='qonto-pdf.example.invalid',mailUnknown=false}={}){
  const writes=[],mails=[];let paid=false,createdHeader=null;t.mock.method(globalThis,'fetch',async(url,options={})=>{
    const u=new URL(url);assert.equal(options.redirect,'manual');
    if(u.origin==='https://api.resend.com'){
      assert.equal(u.pathname,'/emails');assert.equal(options.method,'POST');
      mails.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});
      if(mailUnknown)throw Error('SYNTHETIC missing mail response');
      return Response.json({id:'SYNTHETIC-INVOICE-MAIL'});
    }
    if(u.hostname===host){assert.equal(options.headers,undefined);return new Response(f.originalBytes,{headers:{'Content-Type':'application/pdf'}});}
    assert.equal(u.origin,'https://thirdparty.qonto.com');
    if(u.pathname==='/v2/organization')return Response.json({organization:{id:'synthetic-org',bank_accounts:[{iban}]}});
    if(u.pathname==='/v2/clients')return Response.json({clients:[{id:clientId,email:'test@example.invalid',currency:'EUR'}],meta:{total_pages:1,current_page:1,total_count:1}});
    if(u.pathname==='/v2/attachments/'+attachmentId)return Response.json({attachment:{id:attachmentId,file_content_type:'application/pdf',file_size:String(f.originalBytes.length),url:'https://'+host+'/synthetic.pdf?temporary=never-returned'}});
    if(u.pathname==='/v2/client_invoices'&&!options.method)return Response.json({client_invoices:[],meta:{total_pages:1,current_page:1,total_count:0}});
    if(options.method){writes.push({path:u.pathname,body:JSON.parse(options.body)});if(u.pathname.endsWith('/mark_as_paid')){paid=!unknown||unknownOutcomePaid;if(unknown)throw Error('SYNTHETIC missing response');}else if(u.pathname==='/v2/client_invoices'){createdHeader=JSON.parse(options.body).header??null;return Response.json({client_invoice:{...f.remote,status:'draft',header:createdHeader}});}}
    return Response.json({client_invoice:{...f.remote,status:paid?'paid':'unpaid',paid_at:paid?'2026-10-01':null,header:createdHeader}});
  });
  const providerJSON=async(url,options={})=>(await fetch(url,{...options,redirect:'manual'})).json();return {writes,mails,providerJSON,headers:{Authorization:'synthetic-secret','Content-Type':'application/json'}};
}
async function configureMail(env,approved=true){
  for(const [key,value] of Object.entries({emailVerified:true,sendApproved:approved,sender:'SYNTHETIC <sender@example.invalid>'}))await setting(env,key,value);
  await setting(env,'resendKey',await protect(env,'SYNTHETIC-RESEND-KEY'));
}
async function assertNoReceipt(f,saved){
  assert.equal(saved.receiptRequests,undefined);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM payment_documents').first()).n,0);
}
const cashMailJob=env=>env.DB.prepare("SELECT * FROM jobs WHERE kind='invoice-cash-mail'").first();
async function pageStream(bytes,index=0){const doc=await PDFDocument.load(bytes),contents=doc.getPage(index).node.Contents();const streams=contents instanceof PDFArray?contents.asArray().map(ref=>doc.context.lookup(ref)):[doc.context.lookup(contents)];return streams.map(stream=>Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')).join('\n');}

test('only the personally confirmed canonical ledger can make a full cash invoice header',()=>{
  const order=completed();order.status='Bezahlt';order.invoice.status='paid';order.payments=[{method:'Bar',amountCents:11900,receivedConfirmed:true}];assert.equal(invoicePaymentSummary(order).header,null);assert.equal(invoicePayload(order,invoiceInput,clientId,'2026-10-07T10:00:00Z').header,undefined);
  const record=snapshot(order,11900),payment=invoicePaymentSummary(order,[record]);assert.equal(payment.header,'Bar bezahlt');assert.equal(payment.fullyCashPaid,true);assert.equal(invoicePayload(order,invoiceInput,clientId,'2026-10-07T10:00:00Z',payment).header,'Bar bezahlt');
  assert.equal(invoicePaymentSummary(order,[{...record,receivedConfirmed:false}]).header,null);assert.equal(invoicePaymentSummary(order,[{...record,receivedConfirmedBy:'agent:synthetic'}]).header,null);
});
test('partial and mixed payments never say the invoice is fully cash paid',()=>{
  const order=completed(),partial=snapshot(order,5000),card=snapshot(order,6900,'Karte');const one=invoicePaymentSummary(order,[partial]);assert.equal(one.remainingCents,6900);assert.equal(one.fullyPaid,false);assert.match(one.header,/Barzahlung erhalten.*50,00.*Offen.*69,00/);
  const mixed=invoicePaymentSummary(order,[partial,card]);assert.equal(mixed.fullyPaid,true);assert.equal(mixed.fullyCashPaid,false);assert.match(mixed.header,/Bezahlt.*davon bar.*50,00/);assert.notEqual(mixed.header,'Bar bezahlt');
  assert.throws(()=>invoicePaymentSummary(order,[partial,partial]),/doppelt/);assert.throws(()=>invoicePaymentSummary(order,[{...partial,orderId:'foreign'}]),/gehört nicht/);assert.throws(()=>invoicePaymentSummary(order,[snapshot(order,11901)]),/überschreiten/);
});
test('real invoice creation derives its visible header from payment_records, not UI status',async t=>{
  const order=completed();delete order.invoice;const f=await fixture(t,order);await configureMail(f.env);const mock=mockProvider(t,f),paid=await providerOperations.recordPayment(f.env,order,cash(11900));
  assert.equal(paid.invoice,undefined);assert.equal(paid.invoiceMail.state,'failed');assert.match(paid.invoiceMail.message,/Rechnung fehlt/);assert.equal(mock.mails.length,0);assert.equal(await cashMailJob(f.env),null);
  await assert.rejects(providerOperations.action(f.env,paid,'invoice',{...invoiceInput,reviewed:false}),/prüfen/);assert.equal(mock.writes.length,0);assert.equal(mock.mails.length,0);
  const saved=await providerOperations.action(f.env,paid,'invoice',invoiceInput);
  assert.equal(mock.writes[0].body.header,'Bar bezahlt');assert.equal(saved.invoice.header,'Bar bezahlt');assert.equal(saved.invoice.status,'paid');assert.ok(saved.invoice.paymentCopyVersion);assert.equal(mock.writes.filter(item=>item.path.endsWith('/mark_as_paid')).length,1);
  assert.equal(saved.invoiceMail.state,'sent');assert.equal(mock.mails.length,1);assert.match(mock.mails[0].body.subject,/Bar bezahlt/);
  const copy=await invoicePaymentDocument(f.env,saved.id,saved.invoice.paymentCopyVersion);assert.deepEqual(Buffer.from(mock.mails[0].body.attachments[0].content,'base64'),Buffer.from(copy.bytes));
  await assert.rejects(providerOperations.action(f.env,saved,'invoice',invoiceInput),/bereits zugeordnet/);assert.equal(mock.mails.length,1);await assertNoReceipt(f,saved);
});
test('personally receiving full cash syncs the existing invoice and sends its archived copy once across repeated clicks',async t=>{
  const f=await fixture(t);await configureMail(f.env);const mock=mockProvider(t,f),input=cash(11900),saved=await providerOperations.recordPayment(f.env,f.order,input,'owner');
  assert.equal(saved.status,'Bezahlt');assert.equal(saved.invoice.status,'paid');assert.equal(saved.invoice.paymentCopy.header,'Bar bezahlt');assert.equal(saved.invoiceMail.state,'sent');
  assert.equal(mock.writes.filter(item=>item.path.endsWith('/mark_as_paid')).length,1);assert.equal(mock.mails.length,1);
  const copy=await invoicePaymentDocument(f.env,saved.id,saved.invoice.paymentCopyVersion),before=await f.env.DB.prepare('SELECT * FROM payment_records').first();
  assert.deepEqual(Buffer.from(mock.mails[0].body.attachments[0].content,'base64'),Buffer.from(copy.bytes));assert.deepEqual(mock.mails[0].body.to,['test@example.invalid']);assert.ok(!JSON.stringify(mock.mails[0].body).includes('Quittung'));
  const retried=await providerOperations.recordPayment(f.env,f.order,input,'owner',f.order.version),explicit=await providerOperations.action(f.env,retried,'sendCashInvoice',{});
  assert.equal(explicit.invoiceMail.state,'sent');assert.equal(mock.mails.length,1);assert.equal(mock.writes.filter(item=>item.path.endsWith('/mark_as_paid')).length,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,1);assert.deepEqual(await f.env.DB.prepare('SELECT * FROM payment_records').first(),before);assert.deepEqual((await invoicePaymentDocument(f.env,saved.id,copy.version)).bytes,copy.bytes);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM invoice_payment_documents').first()).n,1);await assertNoReceipt(f,explicit);
});
test('partial cash and a personally confirmed mixed final payment never send a Bar bezahlt invoice mail',async t=>{
  const f=await fixture(t);await configureMail(f.env);const mock=mockProvider(t,f),partial=await providerOperations.recordPayment(f.env,f.order,cash(5000));
  assert.equal(partial.status,'Erledigt');assert.equal(partial.invoiceMail,undefined);assert.equal(mock.mails.length,0);assert.equal(mock.writes.length,0);assert.equal(await cashMailJob(f.env),null);
  const receipt=crypto.randomUUID(),bytes=new Uint8Array([137,80,78,71,1,2,3]),at='2026-10-01T12:00:00Z';
  await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(receipt,f.order.id,'photo','image/png',digest(bytes),bytes.length,at).run();f.files.set(receipt,{body:bytes});
  const mixed=await providerOperations.recordPayment(f.env,partial,{...cash(6900),method:'Karte',cashConfirmed:false,receipt});
  assert.equal(mixed.status,'Bezahlt');assert.match(mixed.invoice.paymentCopy.header,/Bezahlt.*davon bar.*50,00/);assert.equal(mixed.invoiceMail,undefined);assert.equal(mock.mails.length,0);
  const requested=await providerOperations.action(f.env,mixed,'sendCashInvoice',{});assert.equal(requested.invoiceMail,undefined);assert.equal(mock.mails.length,0);assert.equal(await cashMailJob(f.env),null);
  assert.deepEqual(f.files.get(receipt).body,bytes);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM payment_records').first()).n,2);await assertNoReceipt(f,requested);
});
test('a safe pre-send failure keeps received cash and uses one explicit retry after sender approval',async t=>{
  const f=await fixture(t);await configureMail(f.env,false);const mock=mockProvider(t,f),input=cash(11900),saved=await providerOperations.recordPayment(f.env,f.order,input);
  assert.equal(saved.status,'Bezahlt');assert.equal(saved.invoiceMail.state,'failed');assert.match(saved.invoiceMail.message,/Absender.*prüfen.*freigeben/);assert.equal(mock.mails.length,0);const job=await cashMailJob(f.env);assert.equal(job.state,'failed');
  await setting(f.env,'sendApproved',true);assert.equal(mock.mails.length,0);
  const retried=await providerOperations.action(f.env,saved,'sendCashInvoice',{});assert.equal(retried.invoiceMail.state,'sent');assert.equal(mock.mails.length,1);assert.equal((await cashMailJob(f.env)).id,job.id);
  await providerOperations.action(f.env,retried,'sendCashInvoice',{});assert.equal(mock.mails.length,1);assert.equal(mock.writes.filter(item=>item.path.endsWith('/mark_as_paid')).length,1);assert.equal((await getOrder(f.env,saved.id)).payments.length,1);await assertNoReceipt(f,retried);
});
test('an unknown invoice-mail response locks every later payment or send click without duplicating cash or mail',async t=>{
  const f=await fixture(t);await configureMail(f.env);const mock=mockProvider(t,f,{mailUnknown:true}),input=cash(11900),saved=await providerOperations.recordPayment(f.env,f.order,input);
  assert.equal(saved.status,'Bezahlt');assert.equal(saved.invoiceMail.state,'unknown');assert.match(saved.invoiceMail.message,/Keine Wiederholung/);assert.equal(mock.mails.length,1);
  const retry=await providerOperations.recordPayment(f.env,f.order,input),requested=await providerOperations.action(f.env,retry,'sendCashInvoice',{});
  assert.equal(requested.invoiceMail.state,'unknown');assert.equal(mock.mails.length,1);assert.equal((await cashMailJob(f.env)).state,'unknown');assert.equal(mock.writes.filter(item=>item.path.endsWith('/mark_as_paid')).length,1);assert.equal((await getOrder(f.env,saved.id)).payments.length,1);await assertNoReceipt(f,requested);
});
test('invoice status paid alone and an unconfirmed legacy cash record cannot issue a paid copy or mutate Qonto',async t=>{
  const f=await fixture(t);f.order.invoice.status='paid';const legacy={...snapshot(f.order,11900),receivedConfirmed:false};await f.env.DB.prepare('INSERT INTO payment_records VALUES(?,?,?,?,?,?)').bind(legacy.id,f.order.id,legacy.reference,'SYNTHETIC LEGACY',JSON.stringify(legacy),legacy.at).run();const mock=mockProvider(t,f);
  assert.equal((await invoicePaymentState(f.env,f.order)).receivedTotalCents,0);await assert.rejects(syncInvoicePayment(f.env,f.order,mock.providerJSON,mock.headers),/bestätigte Zahlung/);assert.equal(mock.writes.length,0);
});
test('invoice copy preserves original page content and each partial/full copy remains immutable',async t=>{
  const f=await fixture(t),mock=mockProvider(t,f);let saved=await recordPayment(f.env,f.order,cash(5000));saved=await syncInvoicePayment(f.env,saved,mock.providerJSON,mock.headers);const one=await invoicePaymentDocument(f.env,saved.id,saved.invoice.paymentCopyVersion);assert.equal((await PDFDocument.load(one.bytes)).getPageCount(),2);assert.equal(await pageStream(one.bytes),await pageStream(f.originalBytes));assert.equal(mock.writes.length,0);
  const final={...cash(6900),at:'2026-10-01T11:30:00Z'};saved=await recordPayment(f.env,saved,final);saved=await syncInvoicePayment(f.env,saved,mock.providerJSON,mock.headers);const two=await invoicePaymentDocument(f.env,saved.id,saved.invoice.paymentCopyVersion);assert.notEqual(one.version,two.version);assert.equal(saved.invoice.paymentCopy.header,'Bar bezahlt');assert.equal(mock.writes.length,1);assert.deepEqual(mock.writes[0].body,{paid_at:'2026-10-01'});assert.equal(await pageStream(two.bytes),await pageStream(f.originalBytes));assert.deepEqual((await invoicePaymentDocument(f.env,saved.id,one.version)).bytes,one.bytes);assert.equal((await invoicePaymentVersions(f.env,saved.id)).length,2);
  const original=await f.env.DB.prepare('SELECT * FROM invoice_originals').first();assert.deepEqual(f.files.get(original.asset_id).body,f.originalBytes);assert.equal(original.hash,digest(f.originalBytes));assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM payment_documents').first()).n,0);
  const foreign=completed();await f.env.DB.prepare('INSERT INTO orders VALUES(?,?,NULL,?,?,?,?,?,?,?)').bind(foreign.id,'TEST-FOREIGN',1,foreign.status,JSON.stringify(foreign),'2026-10-01T11:00:00Z','test','foreign fixture',0).run();await assert.rejects(invoicePaymentDocument(f.env,foreign.id,one.version),/nicht.*Auftrag/);
});
test('unverified PDF host and missing originals block status writes without rolling back the received cash payment',async t=>{
  const f=await fixture(t),mock=mockProvider(t,f,{host:'unverified.example.invalid'}),saved=await providerOperations.recordPayment(f.env,f.order,cash(11900));assert.equal(saved.status,'Bezahlt');assert.equal(saved.payments.length,1);assert.match(saved.invoicePayment.error,/Downloadhost/);assert.equal(mock.writes.length,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM invoice_payment_documents').first()).n,0);
});
test('unknown mark_as_paid response cannot repeat a status write; a paid provider read recovers safely',async t=>{
  const f=await fixture(t),mock=mockProvider(t,f,{unknown:true}),paid=await recordPayment(f.env,f.order,cash(11900));await assert.rejects(syncInvoicePayment(f.env,paid,mock.providerJSON,mock.headers),/missing response/);assert.equal(mock.writes.length,1);assert.equal((await getOrder(f.env,paid.id)).payments.length,1);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind LIKE 'invoice-paid-%'").first()).state,'unknown');
  const saved=await syncInvoicePayment(f.env,await getOrder(f.env,paid.id),mock.providerJSON,mock.headers);assert.equal(mock.writes.length,1);assert.equal(saved.invoice.status,'paid');assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind LIKE 'invoice-paid-%'").first()).state,'sent');assert.ok(saved.invoice.paymentCopyVersion);
});
test('unknown provider outcome still unpaid stays locked and never repeats mark_as_paid',async t=>{
  const f=await fixture(t),mock=mockProvider(t,f,{unknown:true,unknownOutcomePaid:false}),paid=await recordPayment(f.env,f.order,cash(11900));await assert.rejects(syncInvoicePayment(f.env,paid,mock.providerJSON,mock.headers),/missing response/);await assert.rejects(syncInvoicePayment(f.env,paid,mock.providerJSON,mock.headers),/ungeklärt/);assert.equal(mock.writes.length,1);assert.equal((await getOrder(f.env,paid.id)).payments.length,1);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind LIKE 'invoice-paid-%'").first()).state,'unknown');
});
test('archived original tampering blocks later copies and never changes the recorded payment',async t=>{
  const f=await fixture(t),mock=mockProvider(t,f),paid=await recordPayment(f.env,f.order,cash(11900));await archiveQontoInvoice(f.env,paid,f.remote,mock.providerJSON,mock.headers);const original=await f.env.DB.prepare('SELECT * FROM invoice_originals').first();f.files.set(original.asset_id,{body:new Uint8Array([1,2,3])});await assert.rejects(invoicePaymentDocument(f.env,paid.id),/verändert/);assert.equal((await getOrder(f.env,paid.id)).payments.length,1);assert.equal(mock.writes.length,0);
});
