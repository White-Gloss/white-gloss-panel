import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceTotals,invoiceReview,invoiceForm,invoiceResultHTML,mountInvoiceForm,invoiceInput} from '../public/invoice-ui.js';

const orderFixture=()=>({id:'synthetic-order',version:5,wg:'TEST-0001',source:{name:'Testkunde',email:'test@example.invalid'},offer:{totalCents:11900,lines:[{title:'Paket',description:'Vereinbarte Leistungen',amountCents:10900},{title:'Abholung',description:'Abholung und Rückbringung',amountCents:1000}]}});
const inventoryFixture=()=>({clients:[{id:'11111111-1111-1111-1111-111111111111',name:'Testkunde',email:'test@example.invalid',reviewHash:'a'.repeat(64),billing_address:{street_address:'Teststraße 1',zip_code:'00000',city:'Testort',country_code:'DE'}}]});
const inputFixture=()=>({clientId:inventoryFixture().clients[0].id,vatBasisPoints:1900,dueDate:'2099-10-20',billing:{}});

function formFixture(t,values={}){
  const review={innerHTML:''},submit={disabled:true},handlers=new Map();
  const form={
    values:{clientId:inventoryFixture().clients[0].id,vatPercent:'19',vatExemptionReason:'',dueDate:'2099-10-20',...values},
    elements:{reviewed:{checked:false,disabled:true}},
    querySelector(selector){return selector==='[data-invoice-review]'?review:submit;},
    addEventListener(kind,handler){handlers.set(kind,handler);}
  };
  const OriginalFormData=globalThis.FormData;
  globalThis.FormData=class{constructor(value){this.form=value;}[Symbol.iterator](){return Object.entries(this.form.values)[Symbol.iterator]();}};
  t.after(()=>{globalThis.FormData=OriginalFormData;});
  return {form,review,submit,change(name,value,event='input'){form.values[name]=value;handlers.get(event)({target:{name}});}};
}

test('Lexware preview requires frozen gross line totals and includes package and pickup unchanged',()=>{
  const order=orderFixture(),html=invoiceReview(order,inputFixture(),inventoryFixture());
  assert.match(html,/Paket/);assert.match(html,/Abholung und Rückbringung/);assert.match(html,/109,00/);assert.match(html,/10,00/);assert.match(html,/119,00/);
  for(const offer of [
    {...order.offer,totalCents:11901},
    {...order.offer,lines:[]},
    {...order.offer,lines:[{title:'Paket',amountCents:11900.1}]},
    {...order.offer,lines:[{title:'Paket',amountCents:-1},{title:'Extra',amountCents:11901}]}
  ]){
    assert.throws(()=>invoiceTotals({...order,offer},1900),/Festpreis/);
    assert.throws(()=>invoiceForm({...order,offer},inventoryFixture()),/Festpreis/);
  }
});

test('Lexware tax preview rounds fractional tax cents and preserves net plus tax equals gross',()=>{
  const cases=[
    [11900,1900,{grossCents:11900,netCents:10000,taxCents:1900}],
    [4,1900,{grossCents:4,netCents:3,taxCents:1}],
    [1,1900,{grossCents:1,netCents:1,taxCents:0}],
    [50000,700,{grossCents:50000,netCents:46729,taxCents:3271}],
    [100000000,1900,{grossCents:100000000,netCents:84033613,taxCents:15966387}],
    [11900,0,{grossCents:11900,netCents:11900,taxCents:0}]
  ];
  for(const [amountCents,rate,expected] of cases){
    const order={...orderFixture(),offer:{totalCents:amountCents,lines:[{title:'Testleistung',amountCents}]}};
    const actual=invoiceTotals(order,rate);assert.deepEqual(actual,expected);assert.equal(actual.netCents+actual.taxCents,actual.grossCents);
  }
  for(const rate of [-1,1900.1,2000,1000,3001])assert.throws(()=>invoiceTotals(orderFixture(),rate),/Umsatzsteuersatz.*0 %.*7 %.*19 %/);
});

test('invoice previews escape source text, customer addresses and line descriptions',()=>{
  const order=orderFixture(),inventory=inventoryFixture();
  order.wg='<script>order</script>';order.offer.lines[0].title='<img src=x onerror=alert(1)>';order.offer.lines[0].description='" onclick="alert(1)';
  inventory.clients[0].name='<script>customer</script>';inventory.clients[0].billing_address.street_address='<svg onload=alert(1)>';
  const html=invoiceReview(order,inputFixture(),inventory);
  assert.doesNotMatch(html,/<script|<img|<svg/);
  assert.match(html,/&lt;script&gt;order&lt;\/script&gt;/);
  assert.match(html,/&lt;script&gt;customer&lt;\/script&gt;/);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html,/&quot; onclick=&quot;alert\(1\)/);
  assert.match(html,/&lt;svg onload=alert\(1\)&gt;/);
});

test('Lexware invoice links pin the official origin and historical invoices reject unsafe schemes',()=>{
  const order=orderFixture(),id='22222222-2222-2222-2222-222222222222';
  const html=invoiceResultHTML({...order,invoice:{provider:'lexware',id,number:'RE-1',status:'open',url:'https://untrusted.example.invalid/invoice',remotePayment:{status:'paid'}}});
  assert.match(html,new RegExp('https://app\\.lexware\\.de/permalink/invoices/view/'+id));
  assert.match(html,/\/api\/lexware\/pdf\?id=synthetic-order/);
  assert.match(html,/Lexware-Zahlstatus: Bezahlt/);assert.doesNotMatch(html,/untrusted\.example/);
  const invalid=invoiceResultHTML({...order,invoice:{provider:'lexware',id:'" onclick="alert(1)',number:'<script>RE</script>',status:'open',url:'https://untrusted.example.invalid'}});
  assert.doesNotMatch(invalid,/permalink\/invoices\/view|untrusted\.example|<script>/);assert.match(invalid,/&lt;script&gt;RE&lt;\/script&gt;/);
  for(const url of ['javascript:alert(1)','data:text/html,unsafe','http://untrusted.example.invalid','not-a-url']){
    const historical=invoiceResultHTML({...order,invoice:{number:'ALT-1',status:'unpaid',url}});
    assert.match(historical,/Bestehende Rechnung/);assert.doesNotMatch(historical,/href=|Lexware-Schlussrechnung/);
  }
});

test('invoice form requires current explicit review and sends no client-controlled amount or bank account',t=>{
  const order=orderFixture(),{form,submit,review}=formFixture(t,{totalCents:'1',amountCents:'1',iban:'untrusted',lines:'[]',clientReviewHash:'b'.repeat(64)});
  mountInvoiceForm(form,order,inventoryFixture());
  assert.equal(submit.disabled,false);assert.equal(form.elements.reviewed.checked,false);assert.match(review.innerHTML,/119,00/);
  assert.throws(()=>invoiceInput(form,order),/freigeben/);
  form.elements.reviewed.checked=true;
  const payload=invoiceInput(form,order);assert.equal(payload.provider,'lexware');assert.equal(payload.reviewed,true);assert.equal(payload.vatBasisPoints,1900);assert.equal(payload.clientReviewHash,'a'.repeat(64));
  for(const key of ['amountCents','totalCents','lines','iban'])assert.equal(Object.hasOwn(payload,key),false);
  assert.equal(order.offer.totalCents,11900);
});

test('editing a reviewed invoice resets approval and undispatched field tampering remains blocked',t=>{
  const order=orderFixture(),{form,change}=formFixture(t);
  mountInvoiceForm(form,order,inventoryFixture());form.elements.reviewed.checked=true;
  change('vatPercent','7');assert.equal(form.elements.reviewed.checked,false);assert.throws(()=>invoiceInput(form,order),/freigeben/);
  form.elements.reviewed.checked=true;assert.equal(invoiceInput(form,order).vatBasisPoints,700);
  form.values.vatPercent='19';assert.throws(()=>invoiceInput(form,order),/aktuelle Rechnungsvorschau/);
  change('dueDate','2099-10-21','change');assert.equal(form.elements.reviewed.checked,false);
  form.elements.reviewed.checked=true;assert.equal(invoiceInput(form,order).dueDate,'2099-10-21');
});

test('invoice review rejects a switched order ID, stale revision and missing mounted context',t=>{
  const order=orderFixture(),{form}=formFixture(t);
  mountInvoiceForm(form,order,inventoryFixture());form.elements.reviewed.checked=true;
  for(const current of [{...order,id:'another-order'},{...order,version:6},null])assert.throws(()=>invoiceInput(form,current),/Auftrag.*geändert/);
  const unmounted={...form};assert.throws(()=>invoiceInput(unmounted,order),/Auftrag.*geändert/);
});

test('review retains its frozen price snapshot and rejects foreign or incomplete billing customers',t=>{
  const order=orderFixture(),inventory=inventoryFixture(),{form,review,submit,change}=formFixture(t);
  mountInvoiceForm(form,order,inventory);
  order.offer.totalCents=1;order.offer.lines[0].amountCents=1;
  inventory.clients[0].name='Changed after preview';
  change('vatPercent','7');assert.match(review.innerHTML,/119,00/);assert.doesNotMatch(review.innerHTML,/Changed after preview/);
  change('clientId','foreign','change');assert.equal(submit.disabled,true);assert.equal(form.elements.reviewed.disabled,true);
  assert.match(review.innerHTML,/auswählen/);
  const incomplete=inventoryFixture();delete incomplete.clients[0].billing_address.street_address;
  assert.throws(()=>invoiceReview(orderFixture(),inputFixture(),incomplete),/unvollständig/);
});

test('existing client review hash comes from the immutable inventory snapshot',t=>{
  const order=orderFixture(),inventory=inventoryFixture(),{form,change}=formFixture(t,{clientReviewHash:'b'.repeat(64)});
  mountInvoiceForm(form,order,inventory);
  inventory.clients[0].reviewHash='c'.repeat(64);
  change('vatPercent','7');form.elements.reviewed.checked=true;
  assert.equal(invoiceInput(form,order).clientReviewHash,'a'.repeat(64));
});

test('new billing customer sends no existing-client review hash',t=>{
  const order=orderFixture(),{form}=formFixture(t,{clientId:'',clientReviewHash:'b'.repeat(64),billingKind:'individual',billingFirstName:'Test',billingLastName:'Kunde',billingStreet:'Teststraße 1',billingZip:'00000',billingCity:'Testort',billingCountry:'DE'});
  mountInvoiceForm(form,order,{clients:[]});form.elements.reviewed.checked=true;
  const input=invoiceInput(form,order);assert.equal(input.clientReviewHash,null);assert.equal(input.billing.firstName,'Test');assert.equal(input.clientId,'');
});

test('existing billing customer without a valid review hash cannot be submitted',t=>{
  const order=orderFixture(),inventory=inventoryFixture(),{form}=formFixture(t);
  delete inventory.clients[0].reviewHash;
  mountInvoiceForm(form,order,inventory);form.elements.reviewed.checked=true;
  assert.throws(()=>invoiceInput(form,order),/Kundenabgleich fehlt/);
});

test('voided invoice and balanced provider account show cancellation and settlement without booking a payment',()=>{
  const order={...orderFixture(),status:'Erledigt',payments:[],invoice:{provider:'lexware',id:'22222222-2222-2222-2222-222222222222',number:'RE-1',status:'voided',remotePayment:{status:'balanced',openCents:0,paid:true}}},before=structuredClone(order);
  const html=invoiceResultHTML(order);assert.match(html,/Storniert/);assert.match(html,/Lexware-Zahlstatus: Ausgeglichen/);assert.doesNotMatch(html,/Bezahlt/);
  assert.deepEqual(order,before);assert.equal(order.status,'Erledigt');assert.equal(order.payments.length,0);
  const open=invoiceResultHTML({...order,invoice:{...order.invoice,status:'open',remotePayment:{status:'openRevenue'}}});assert.match(open,/Lexware-Zahlstatus: Offen/);
  for(const status of ['<script>unknown</script>','constructor','__proto__']){
    const unknown=invoiceResultHTML({...order,invoice:{...order.invoice,status,remotePayment:{status}}});assert.match(unknown,/Unbekannter Anbieterstatus/);assert.doesNotMatch(unknown,/<script>|function Object|\[object Object\]/);
  }
});

test('20 percent VAT is rejected before review and only supported Lexware tax rates can be approved',t=>{
  const order=orderFixture(),{form,submit,review,change}=formFixture(t,{vatPercent:'20'});
  mountInvoiceForm(form,order,inventoryFixture());
  assert.equal(submit.disabled,true);assert.equal(form.elements.reviewed.disabled,true);assert.match(review.innerHTML,/0 %.*7 %.*19 %/);
  form.elements.reviewed.checked=true;assert.throws(()=>invoiceInput(form,order),/Umsatzsteuersatz.*0 %.*7 %.*19 %/);
  change('vatPercent','7');assert.equal(submit.disabled,false);assert.equal(form.elements.reviewed.checked,false);
  form.elements.reviewed.checked=true;assert.equal(invoiceInput(form,order).vatBasisPoints,700);
});
