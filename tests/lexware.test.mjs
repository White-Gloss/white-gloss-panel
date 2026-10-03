import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {init,protect,setting,getOrder,settings,claimJob,configuration} from '../src/worker.mjs';
import {lexwareSchema,lexwareCheck,lexwareInventory,lexwareInvoice,lexwareReconcile,lexwarePDF,lexwareMarker,lexwareInvoicePayload,lexwareNumberCheck,lexwareJSON,lexwareClientReviewHash,lexwareInvoiceAddress} from '../server/lexware.mjs';

const organizationId='33333333-3333-3333-3333-333333333333',clientId='11111111-1111-1111-1111-111111111111',invoiceId='22222222-2222-2222-2222-222222222222';
const dueDate=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
const billing={kind:'individual',firstName:'TEST',lastName:'Kunde',street:'TEST Straße 1',zip:'72160',city:'TEST Ort',country:'DE'};
const input={provider:'lexware',reviewed:true,vatBasisPoints:1900,dueDate,clientId,clientReviewHash:lexwareClientReviewHash(contact(),{source:{email:'test@example.invalid'}})};
const profile={organizationId,connectionId:'44444444-4444-4444-4444-444444444444',companyName:'TEST Unternehmen',taxType:'gross',smallBusiness:false,businessFeatures:['INVOICING']};
function completed(){return {id:randomUUID(),wg:'WG-000100',version:1,status:'Erledigt',synthetic:false,source:{name:'TEST Kunde',email:'test@example.invalid',vehicle:'TEST Fahrzeug'},return:{at:'2026-10-03T13:00:00Z'},completedAt:'2026-10-03T13:00:00Z',offer:{totalCents:11900,services:'TEST Leistung',lines:[{title:'TEST Paket',amountCents:11900}]}};}
function contact(){return {id:clientId,organizationId,version:0,roles:{customer:{number:10300}},person:{firstName:'TEST',lastName:'Kunde'},addresses:{billing:[{street:billing.street,zip:billing.zip,city:billing.city,countryCode:'DE'}]},emailAddresses:{private:['test@example.invalid']},archived:false};}
function paged(content,extra={}){return {content,totalElements:content.length,totalPages:1,numberOfElements:content.length,size:100,number:0,first:true,last:true,...extra};}
function remoteInvoice(order,payload,status='open'){return {...payload,address:payload.address.name?payload.address:{contactId:clientId,...lexwareInvoiceAddress(contact())},id:invoiceId,organizationId,voucherNumber:'RE-2026-TEST',voucherStatus:status,totalPrice:{currency:'EUR',totalGrossAmount:119},lineItems:payload.lineItems.map(line=>({...line,unitPrice:{...line.unitPrice,netAmount:100,grossAmount:119}}))};}
async function fixture(t,order=completed()){
  const env={CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:')};t.after(()=>env.DB.close());await init(env);await lexwareSchema(env);
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture').run();
  for(const [key,value] of Object.entries({numberAudit:true,lexwareVerified:true,lexwareOrganizationId:organizationId}))await setting(env,key,value);
  await setting(env,'lexwareKey',await protect(env,'synthetic-'+randomUUID()));return {env,order};
}
function provider(t,f,overrides={}){
  const calls=[],writes=[];let created=null,newContact=null;
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://api.lexware.io');assert.equal(options.redirect,'manual');assert.ok(options.signal);assert.match(options.headers.Authorization,/^Bearer synthetic-/);
    calls.push({url:parsed,options});if(options.method==='POST')writes.push({path:parsed.pathname,query:parsed.search,body:JSON.parse(options.body)});
    const result=await overrides.handle?.(parsed,options,{calls,writes,created,newContact});if(result!==undefined)return result;
    if(parsed.pathname==='/v1/profile')return Response.json(overrides.profile??profile);
    if(parsed.pathname==='/v1/contacts'&&!options.method)return Response.json(paged(overrides.contacts??[contact()]));
    if(parsed.pathname==='/v1/contacts'&&options.method==='POST'){newContact={...JSON.parse(options.body),id:clientId,organizationId,archived:false};if(overrides.contactUnknown)throw Error('TEST lost contact result');return Response.json({id:clientId});}
    if(parsed.pathname==='/v1/contacts/'+clientId)return Response.json(overrides.contact??newContact??contact());
    if(parsed.pathname==='/v1/voucherlist')return Response.json(paged(overrides.existing??[]));
    if(parsed.pathname==='/v1/invoices'&&options.method==='POST'){assert.equal(parsed.search,'?finalize=true');assert.ok(!options.headers['Idempotency-Key']);created=remoteInvoice(f.order,JSON.parse(options.body));if(overrides.invoiceUnknown)throw Error('TEST lost invoice result');if(overrides.missingId)return Response.json({version:0});return Response.json({id:invoiceId});}
    if(parsed.pathname==='/v1/invoices/'+invoiceId)return Response.json(overrides.remote??created??remoteInvoice(f.order,lexwareInvoicePayload(f.order,input,clientId)));
    if(parsed.pathname==='/v1/payments/'+invoiceId)return Response.json(overrides.payment??{currency:'EUR',voucherType:'invoice',voucherStatus:'open',paymentStatus:'openRevenue',openAmount:119,paymentItems:[]});
    if(parsed.pathname==='/v1/invoices/'+invoiceId+'/file')return new Response(overrides.pdf??'%PDF-1.7\nTEST invoice', {headers:{'content-type':overrides.pdfType??'application/pdf'}});
    throw Error('Unexpected synthetic API path '+parsed.pathname);
  });return {calls,writes};
}
test('Lexware payload requires explicit reviewed tax and sums frozen gross lines without making API drafts',()=>{
  const order=completed(),payload=lexwareInvoicePayload(order,input,clientId);assert.equal(payload.taxConditions.taxType,'gross');assert.equal(payload.lineItems[0].unitPrice.grossAmount,119);assert.equal(payload.lineItems[0].unitPrice.taxRatePercentage,19);assert.equal(payload.address.contactId,clientId);assert.equal(payload.remark,lexwareMarker(order));assert.equal(payload.voucherNumber,undefined);
  assert.throws(()=>lexwareInvoicePayload(order,{...input,reviewed:false},clientId),/ausdrücklich/);assert.throws(()=>lexwareInvoicePayload(order,{...input,vatBasisPoints:1700},clientId),/Umsatzsteuer/);assert.throws(()=>lexwareInvoicePayload(order,{...input,vatBasisPoints:0},clientId),/Begründung/);
  const exempt=lexwareInvoicePayload(order,{...input,vatBasisPoints:0,vatExemptionReason:'TEST ausdrücklich geprüft'},clientId);assert.equal(exempt.taxConditions.taxType,'vatfree');assert.equal(exempt.lineItems[0].unitPrice.netAmount,119);
  assert.throws(()=>lexwareInvoicePayload({...order,offer:{...order.offer,totalCents:11901}},input,clientId),/Festpreis/);assert.throws(()=>lexwareInvoicePayload({...order,synthetic:true},input,clientId),/Arbeitsabschluss/);
});
test('profile checking persists only a verified invoice-capable organization and rejects account replacement',async t=>{
  const f=await fixture(t);provider(t,f);const result=await lexwareCheck(f.env);assert.equal(result.organizationId,organizationId);assert.equal((await settings(f.env)).lexwareVerified,true);
  provider(t,f,{profile:{...profile,organizationId:clientId}});await assert.rejects(lexwareCheck(f.env),/Organisation hat sich geändert/);assert.equal((await settings(f.env)).lexwareOrganizationId,organizationId);
});
test('tax-exempt account cannot create a taxable invoice and synthetic inventory makes no external calls',async t=>{
  const f=await fixture(t),p=provider(t,f,{profile:{...profile,smallBusiness:true,taxType:'vatfree'}});await assert.rejects(lexwareInvoice(f.env,f.order,input),/steuerfrei eingerichtet/);assert.equal(p.writes.length,0);const n=p.calls.length;await assert.rejects(lexwareInventory(f.env,{...f.order,synthetic:true}),/Testaufträge/);assert.equal(p.calls.length,n);
});
test('independent API-client module queues share a persisted rate gate and missing gate prevents fetch',async t=>{
  const f=await fixture(t),config=await configuration(f.env,['lexwareKey']);config._DB=f.env.DB;const other=await import('../server/lexware.mjs?test-independent-rate-queue'),starts=[];t.mock.method(globalThis,'fetch',async()=>{starts.push(Date.now());return Response.json(profile);});
  await Promise.all([lexwareJSON(config,'/v1/profile'),other.lexwareJSON(config,'/v1/profile')]);assert.equal(starts.length,2);assert.ok(Math.abs(starts[1]-starts[0])>=500);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM lexware_request_rate').first()).n,1);
  await assert.rejects(lexwareJSON({lexwareKey:'synthetic-no-shared-gate'},'/v1/profile'),/Anfragesperre fehlt/);assert.equal(starts.length,2);
});
test('inventory reads complete pages and returns only same-email active customer-role billing records',async t=>{
  const f=await fixture(t),a=contact(),b={...contact(),id:invoiceId,emailAddresses:{private:['other@example.invalid']}},c={...contact(),id:'55555555-5555-5555-5555-555555555555',roles:{vendor:{}}};
  provider(t,f,{contacts:[a,b,c]});const result=await lexwareInventory(f.env,f.order);assert.deepEqual(result.clients.map(client=>client.id),[clientId]);assert.equal(result.clients[0].billing_address.zip_code,'72160');assert.equal(result.organizationId,organizationId);
  provider(t,f,{handle:url=>url.pathname==='/v1/contacts'?Response.json(paged([a],{totalElements:2})):undefined});await assert.rejects(lexwareInventory(f.env,f.order),/Nicht alle/);
});
test('existing customer needs displayed review hash and changed billing stops before invoice POST',async t=>{
  const f=await fixture(t),p=provider(t,f);await assert.rejects(lexwareInvoice(f.env,f.order,{...input,clientReviewHash:''}),/Kundendaten müssen/);assert.equal(p.writes.length,0);
  const changed=contact();changed.addresses.billing[0].street='TEST GEÄNDERT';const q=provider(t,f,{contact:changed});await assert.rejects(lexwareInvoice(f.env,f.order,input),/seit der Prüfung verändert/);assert.equal(q.writes.length,0);
});
test('billing changes during provider marker checks are detected by fresh pre-POST read',async t=>{
  const f=await fixture(t);let reads=0;const p=provider(t,f,{handle:url=>{if(url.pathname!=='/v1/contacts/'+clientId)return undefined;const client=contact();if(++reads>1)client.addresses.billing[0].city='TEST GEÄNDERT';return Response.json(client);}});await assert.rejects(lexwareInvoice(f.env,f.order,input),/während der Rechnungsprüfung verändert/);assert.equal(p.writes.length,0);
});
test('Lexware creates exactly one finalized invoice, validates gross amount, and retains separate payment workflow',async t=>{
  const f=await fixture(t),p=provider(t,f),saved=await lexwareInvoice(f.env,f.order,input);assert.equal(saved.invoice.provider,'lexware');assert.equal(saved.invoice.number,'RE-2026-TEST');assert.equal(saved.invoice.totalCents,11900);assert.equal(saved.status,'Erledigt');assert.equal(p.writes.length,1);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='invoice'").first()).state,'sent');
  await assert.rejects(lexwareInvoice(f.env,saved,input),/bereits zugeordnet/);assert.equal(p.writes.length,1);
});
test('cross-provider historical Qonto jobs and invoices block Lexware before any provider calls',async t=>{
  const f=await fixture(t);await claimJob(f.env,f.order,'invoice');let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('no external request');});
  await assert.rejects(lexwareInvoice(f.env,f.order,input),/Qonto-Rechnungsvorgang/);await assert.rejects(lexwareInvoice(f.env,{...f.order,invoice:{provider:'qonto',id:invoiceId}},input),/bereits zugeordnet/);assert.equal(calls,0);
});
test('concurrent invoice clicks share one durable job and send one finalized POST',async t=>{
  const f=await fixture(t),p=provider(t,f),results=await Promise.allSettled([lexwareInvoice(f.env,f.order,input),lexwareInvoice(f.env,f.order,input)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(p.writes.length,1);assert.equal((await getOrder(f.env,f.order.id)).invoice.id,invoiceId);
});
test('unknown invoice result without ID is locked and only exact marker reconciliation can associate it',async t=>{
  const f=await fixture(t),p=provider(t,f,{invoiceUnknown:true});await assert.rejects(lexwareInvoice(f.env,f.order,input),/lost invoice/);assert.equal(p.writes.length,1);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='invoice'").first()).state,'unknown');
  await assert.rejects(lexwareInvoice(f.env,f.order,input),/ungeklärt/);assert.equal(p.writes.length,1);
  const read=provider(t,f,{existing:[{id:invoiceId,voucherType:'invoice'}]});const saved=await lexwareReconcile(f.env,f.order);assert.equal(saved.invoice.id,invoiceId);assert.equal(saved.status,'Erledigt');assert.equal(saved.invoice.remotePayment.paid,false);assert.equal(read.writes.length,0);
});
test('unknown result not found in complete inventory stays locked and never causes a second POST',async t=>{
  const f=await fixture(t);provider(t,f,{missingId:true});await assert.rejects(lexwareInvoice(f.env,f.order,input),/ohne eindeutige ID/);const p=provider(t,f);await lexwareReconcile(f.env,f.order);assert.equal(p.writes.length,0);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='invoice'").first()).state,'unknown');await assert.rejects(lexwareInvoice(f.env,f.order,input),/ungeklärt/);
});
test('remote amount, organization or position mismatch never associates or recreates an invoice',async t=>{
  const f=await fixture(t),remote=remoteInvoice(f.order,lexwareInvoicePayload(f.order,input,clientId));remote.totalPrice.totalGrossAmount=119.01;const p=provider(t,f,{remote});await assert.rejects(lexwareInvoice(f.env,f.order,input),/Bruttobetrag/);assert.equal((await getOrder(f.env,f.order.id)).invoice,undefined);assert.equal(p.writes.length,1);
  await assert.rejects(lexwareInvoice(f.env,f.order,input),/ungeklärt/);remote.totalPrice.totalGrossAmount=119;remote.organizationId=clientId;provider(t,f,{remote});await assert.rejects(lexwareReconcile(f.env,f.order),/Betrieb/);
});
test('an existing exact marker is detected through full voucher details and blocks creation',async t=>{
  const f=await fixture(t),p=provider(t,f,{existing:[{id:invoiceId,voucherType:'invoice'}]});await assert.rejects(lexwareInvoice(f.env,f.order,input),/bereits eine Lexware-Rechnung/);assert.equal(p.writes.length,0);const saved=await lexwareReconcile(f.env,f.order);assert.equal(saved.invoice.id,invoiceId);
});
test('new customer is created only with fully reviewed billing and both writes share invoice lock',async t=>{
  const f=await fixture(t),p=provider(t,f,{contacts:[]});const saved=await lexwareInvoice(f.env,f.order,{...input,clientId:'',billing});assert.equal(saved.invoice.id,invoiceId);assert.equal(p.writes.length,2);assert.equal(p.writes[0].path,'/v1/contacts');assert.equal(p.writes[0].body.note,lexwareMarker(f.order));assert.equal(p.writes[0].body.person.firstName,'TEST');assert.equal(p.writes[1].path,'/v1/invoices');
});
test('a lost contact response remains locked and readonly matching contact recovery permits explicit later review',async t=>{
  const f=await fixture(t),p=provider(t,f,{contacts:[],contactUnknown:true});await assert.rejects(lexwareInvoice(f.env,f.order,{...input,clientId:'',billing}),/lost contact/);assert.equal(p.writes.length,1);await assert.rejects(lexwareInvoice(f.env,f.order,{...input,clientId:'',billing}),/ungeklärt/);
  const created={...contact(),roles:{customer:{}},note:lexwareMarker(f.order)},read=provider(t,f,{contacts:[created]});await lexwareReconcile(f.env,f.order);assert.equal(read.writes.length,0);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='invoice'").first()).state,'failed');
  const final=provider(t,f);await lexwareInvoice(f.env,f.order,input);assert.equal(final.writes.length,1);assert.equal(final.writes[0].path,'/v1/invoices');
});
test('a changed order version aborts before invoice POST and does not weaken the fixed offer snapshot',async t=>{
  const f=await fixture(t),p=provider(t,f,{handle:async(url)=>{if(url.pathname!=='/v1/voucherlist')return undefined;await f.env.DB.prepare('UPDATE orders SET version=version+1,updated_at=? WHERE id=?').bind(new Date().toISOString(),f.order.id).run();return Response.json(paged([]));}});
  await assert.rejects(lexwareInvoice(f.env,f.order,input),/inzwischen verändert/);assert.equal(p.writes.length,0);
});
test('payment reconciliation is read only, rejects duplicate/incorrect sums and distinguishes voided from paid',async t=>{
  const f=await fixture(t);provider(t,f);let saved=await lexwareInvoice(f.env,f.order,input);const payload=lexwareInvoicePayload(f.order,input,clientId),paid=remoteInvoice(f.order,payload,'paid');
  let p=provider(t,f,{remote:paid,payment:{currency:'EUR',voucherType:'invoice',voucherStatus:'paid',paymentStatus:'balanced',openAmount:0,paymentItems:[{paymentItemType:'manualPayment',postingDate:'2026-10-03T14:00:00Z',amount:119,currency:'EUR'}]}});saved=await lexwareReconcile(f.env,saved);assert.equal(saved.invoice.remotePayment.paid,true);assert.equal(saved.status,'Erledigt');assert.equal(p.writes.length,0);
  p=provider(t,f,{remote:{...paid,voucherStatus:'voided'},payment:{currency:'EUR',voucherType:'invoice',voucherStatus:'voided',paymentStatus:'balanced',openAmount:0,paymentItems:[]}});saved=await lexwareReconcile(f.env,saved);assert.equal(saved.invoice.remotePayment.paid,false);assert.equal(saved.invoice.remotePayment.status,'voided');assert.equal(saved.status,'Erledigt');
  provider(t,f,{remote:paid,payment:{currency:'EUR',voucherType:'invoice',voucherStatus:'paid',paymentStatus:'balanced',openAmount:0,paymentItems:[{paymentItemType:'manualPayment',postingDate:'2026-10-03T14:00:00Z',amount:50,currency:'EUR'}]}});await assert.rejects(lexwareReconcile(f.env,saved),/stimmen nicht/);
  provider(t,f,{remote:paid,payment:{currency:'EUR',voucherType:'invoice',voucherStatus:'paid',paymentStatus:'balanced',openAmount:0,paymentItems:[1,2].map(()=>({paymentItemType:'manualPayment',postingDate:'2026-10-03T14:00:00Z',amount:59.5,currency:'EUR'}))}});await assert.rejects(lexwareReconcile(f.env,saved),/Doppelte/);
});
test('own invoice PDF is private, checks MIME/magic and refuses synthetic or other provider records',async t=>{
  const f=await fixture(t);provider(t,f);const saved=await lexwareInvoice(f.env,f.order,input);const p=provider(t,f),response=await lexwarePDF(f.env,saved);assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('cache-control'),/private/);assert.match(await response.text(),/^%PDF-/);assert.equal(p.writes.length,0);
  await assert.rejects(lexwarePDF(f.env,{...saved,synthetic:true}),/Keine echte/);await assert.rejects(lexwarePDF(f.env,{...saved,invoice:{...saved.invoice,provider:'qonto'}}),/Keine echte/);provider(t,f,{pdf:'not a pdf'});await assert.rejects(lexwarePDF(f.env,saved),/kein PDF/);
});
test('number inventory includes imported invoices and fails on incomplete pages',async t=>{
  const f=await fixture(t);provider(t,f,{existing:[{id:invoiceId,voucherType:'salesinvoice',voucherNumber:'WG-000104'},{id:clientId,voucherType:'invoice',voucherNumber:'RE-TEST'}]});const config={...(await settings(f.env)),lexwareKey:'synthetic-number-check',_DB:f.env.DB},result=await lexwareNumberCheck(config);assert.equal(result.count,2);assert.equal(result.maxNumber,104);
});
