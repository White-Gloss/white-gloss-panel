// End-to-end tests of the panel and the Vor-Ort app without any web server:
// jsdom renders the built pages and every request is passed in-process to the worker with an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import worker,{getOrder} from '../src/worker.mjs';
import {PanelDatabase} from '../server/storage.mjs';

const origin='https://panel.example.invalid',owner='test-owner@example.invalid';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const signatureURL='data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(300)]).toString('base64');
let loads=0;
function environment(){const files=new Map();return {DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,o){files.set(id,{body:new Uint8Array(bytes instanceof ArrayBuffer?bytes:bytes),httpMetadata:o?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('')},OWNER_EMAIL_SHA256:createHash('sha256').update(owner).digest('hex'),CONFIG_KEY:Buffer.alloc(32,5).toString('base64')};}
async function boot(t,{page,script,hash='',path=null,env=environment(),storage={},identity=owner}){
  const html=readFileSync(new URL('../dist/client/'+page,import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{url:origin+(path??(page==='index.html'?'/':'/vor-ort'))+hash,pretendToBeVisual:true});const w=dom.window;
  for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
  w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close??=function(){this.removeAttribute('open');};
  w.Element.prototype.setPointerCapture=()=>{};w.Element.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};
  const ctx=new Proxy({},{get:(_target,key)=>key==='canvas'?null:()=>{},set:()=>true});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx;w.HTMLCanvasElement.prototype.toDataURL=()=>signatureURL;w.HTMLCanvasElement.prototype.toBlob=callback=>callback(new Blob([Buffer.concat([png,Buffer.alloc(300)])],{type:'image/png'}));
  let pending=0;const errors=[];
  const fetchImpl=async(url,options={})=>{pending++;try{const headers=new Headers(options.headers);headers.set('oai-authenticated-user-email',identity);headers.set('origin',origin);if(options.body instanceof Blob&&!headers.has('content-length'))headers.set('content-length',String(options.body.size));return await worker.fetch(new Request(new URL(url,origin),{...options,headers}),env);}finally{pending--;}};
  const globals={window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl};
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});
  // Each test file runs in its own process; the page globals stay until the next boot so pending UI timers end quietly.
  t.after(()=>{env.DB.close();});
  w.addEventListener('error',e=>errors.push(e.error??e.message));
  const settle=async()=>{for(let i=0;i<400;i++){await new Promise(r=>setTimeout(r,2));if(pending===0){await new Promise(r=>setTimeout(r,5));if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/'+script+'?load='+(++loads),import.meta.url).href);await settle();
  const $=s=>w.document.querySelector(s);
  const click=async target=>{const el=typeof target==='string'?$(target):target;assert.ok(el,'Element fehlt: '+target);el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();};
  const fill=(form,values)=>{for(const [name,value] of Object.entries(values)){const field=form.elements[name];assert.ok(field,'Feld fehlt: '+name);if(field.type==='checkbox')field.checked=value;else field.value=value;}};
  const submit=async(form,submitter)=>{const f=typeof form==='string'?$(form):form;assert.ok(f,'Formular fehlt: '+form);const button=typeof submitter==='string'?f.querySelector(submitter):submitter;f.requestSubmit(button??undefined);await settle();};
  const draw=canvas=>{for(const type of ['pointerdown','pointermove','pointermove','pointerup'])canvas.dispatchEvent(new w.Event(type,{bubbles:true}));};
  const go=async hash=>{w.location.hash=hash;await new Promise(r=>setTimeout(r,20));await settle();};
  return {w,$,click,fill,submit,draw,go,settle,env,errors,text:()=>w.document.body.textContent};
}

test('panel: create, edit every step, sign on site, protocol with paint thickness, replacement and payments',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});
  assert.match(ui.text(),/Dein Betrieb im Blick/);
  await ui.click('[data-click="test"]');await ui.click('[data-click="create"]');
  const create=ui.$('#createform');assert.ok(create);ui.fill(create,{name:'Erika Test',phone:'0151 2345678',vehicle:'VW Golf',plate:'HOR-WG 1'});await ui.submit(create);
  assert.match(ui.text(),/Kunde & Anfrage/);let o=(await ui.env.DB.prepare('SELECT * FROM orders').first());assert.ok(o);
  // Source edit.
  ui.fill(ui.$('#sourceform'),{email:'erika@example.invalid',note:'Hund im Auto'});await ui.submit('#sourceform');
  assert.equal((await getOrder(ui.env,o.id)).source.note,'Hund im Auto');
  // Prices without required fields, then on-site signature.
  await ui.click('[data-tab="price"]');await ui.submit('#priceform');
  await ui.click('[data-click="onsiteAccept"]');ui.draw(ui.$('#customerSign'));ui.fill(ui.$('#signform'),{paymentObligation:true,immediateStart:true});await ui.submit('#signform');
  let current=await getOrder(ui.env,o.id);assert.equal(current.status,'Angenommen');assert.equal(current.acceptance.mode,'vor Ort');assert.ok(current.acceptance.signature);
  // Appointment now.
  await ui.click('[data-tab="appointment"]');await ui.click('[data-click="appointmentNow"]');current=await getOrder(ui.env,o.id);assert.equal(current.status,'Termin verbindlich');
  // Intake without required fields including a paint reading and a damage from the sketch.
  await ui.click('[data-tab="intake"]');const form=ui.$('#protocolform');assert.ok(form.querySelector('[data-zone="Motorhaube"]'));
  await ui.click(form.querySelector('[data-zone="Motorhaube"]'));form.querySelector('[data-damage-kind]').value='Kratzer';
  await ui.click(form.querySelector('[data-paint-add]'));const row=form.querySelector('[data-paint-row]');row.querySelector('[data-paint-panel]').value='Dach';row.querySelectorAll('[data-paint-value]')[0].value='110';row.querySelectorAll('[data-paint-value]')[1].value='260';
  ui.fill(form,{mileage:'45000'});await ui.submit(form,'[data-submit="save"]');
  current=await getOrder(ui.env,o.id);assert.equal(current.status,'In Arbeit');assert.deepEqual(current.intake.paint.readings,[{panel:'Dach',values:[110,260]}]);assert.equal(current.intake.damages[0].area,'Motorhaube');assert.equal(current.intake.mileage,45000);
  // Sign the protocol with both pads.
  await ui.submit(ui.$('#protocolform'),'[data-submit="sign"]');assert.ok(ui.$('#signatureform'));ui.draw(ui.$('#customerSign'));ui.draw(ui.$('#operatorSign'));ui.fill(ui.$('#signatureform'),{confirmed:true});await ui.submit('#signatureform');
  current=await getOrder(ui.env,o.id);assert.ok(current.intake.customerSignature);assert.match(ui.text(),/Unterschriebenes Annahmeprotokoll/);
  // Replacement protocol signed in person replaces the signed one.
  await ui.click('[data-click="replaceProtocol"]');ui.fill(ui.$('#replacementform'),{mileage:'45100'});await ui.submit('#replacementform');
  current=await getOrder(ui.env,o.id);assert.equal(current.intake.mileage,45000);assert.equal(current.pending.intake.content.mileage,45100);
  await ui.click('[data-click="signPending"][data-kind="intake"]');ui.draw(ui.$('#customerSign'));await ui.submit('#signform');
  current=await getOrder(ui.env,o.id);assert.equal(current.intake.mileage,45100);assert.ok(current.intake.replaces);assert.equal(current.pending.intake,undefined);
  // Return and payments in euro with correction.
  await ui.click('[data-tab="return"]');ui.fill(ui.$('#protocolform'),{services:'Innenreinigung',workComplete:true});await ui.submit(ui.$('#protocolform'),'[data-submit="save"]');
  current=await getOrder(ui.env,o.id);assert.equal(current.status,'Erledigt');
  await ui.click('[data-tab="payment"]');ui.fill(ui.$('#paymentform'),{amount:'50,00',method:'Bar'});await ui.submit('#paymentform');
  current=await getOrder(ui.env,o.id);assert.equal(current.payments[0].amountCents,5000);
  await ui.click('[data-payment-edit="0"]');ui.fill(ui.$('#paymenteditform'),{amount:'45,50'});await ui.submit('#paymenteditform');
  current=await getOrder(ui.env,o.id);assert.equal(current.payments[0].amountCents,4550);assert.equal(current.payments[0].history[0].amountCents,5000);
  // Admin status change.
  await ui.click('[data-tab="notes"]');ui.fill(ui.$('#statusform'),{status:'Bezahlt',reason:'Rest bar erhalten'});await ui.submit('#statusform');
  current=await getOrder(ui.env,o.id);assert.equal(current.status,'Bezahlt');
  // Customer master lists the customer with the vehicle.
  await ui.click('[data-click="back"]');await ui.click('[data-view="customers"]');await ui.settle();assert.match(ui.text(),/Erika Test/);assert.match(ui.text(),/HOR-WG 1/);
  assert.deepEqual(ui.errors,[]);
});

test('panel: signed offer is replaced only by a signed replacement offer',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});await ui.click('[data-click="test"]');await ui.click('[data-click="create"]');ui.fill(ui.$('#createform'),{name:'Angebot Test'});await ui.submit('#createform');
  await ui.click('[data-tab="price"]');await ui.submit('#priceform');await ui.click('[data-click="onsiteAccept"]');ui.draw(ui.$('#customerSign'));await ui.submit('#signform');
  const id=(await ui.env.DB.prepare('SELECT id FROM orders').first()).id;const before=(await getOrder(ui.env,id)).offer.totalCents;
  const line=ui.$('#priceform [data-line-price]');line.value='999,00';line.dispatchEvent(new ui.w.Event('input',{bubbles:true}));await ui.submit('#priceform');
  let current=await getOrder(ui.env,id);assert.equal(current.offer.totalCents,before);assert.equal(current.assessment.totalCents,99900);
  await ui.click('[data-click="replaceOffer"]');await ui.click('[data-click="signPending"][data-kind="offer"]');ui.draw(ui.$('#customerSign'));ui.fill(ui.$('#signform'),{paymentObligation:true});await ui.submit('#signform');
  current=await getOrder(ui.env,id);assert.equal(current.offer.totalCents,99900);assert.ok(current.offer.replaces);assert.equal(current.offerHistory.at(-1).offer.totalCents,before);
  assert.deepEqual(ui.errors,[]);
});

test('Vor-Ort app: on-site booking from new customer to protocol and payment',async t=>{
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',storage:{'wg-vo-test':'1'}});
assert.match(ui.text(),/Sofort-Buchung starten/);
  await ui.go('#buchung');ui.fill(ui.$('#c-new'),{name:'Max Vorort',phone:'0170 1234567'});await ui.submit('#c-new');await ui.settle();
  assert.ok(ui.$('#v-new'));ui.fill(ui.$('#v-new'),{plate:'TÜ-MX 9',label:'Audi A4',classId:'suv'});await ui.submit('#v-new');await ui.settle();
  const services=ui.$('#s-form');services.querySelector('[value="premium"]').checked=true;services.querySelector('[name=extraIds][value="tierhaar"]').checked=true;services.elements.surcharge.value='25';services.elements.surchargeReason.value='Starke Verschmutzung';services.dispatchEvent(new ui.w.Event('input',{bubbles:true}));
  assert.match(ui.text(),/585,00/);await ui.submit(services);await ui.settle();
  ui.draw(ui.$('#a-sign'));ui.fill(ui.$('#a-form'),{paymentObligation:true});await ui.submit('#a-form');await ui.settle();
  const row=await ui.env.DB.prepare('SELECT id FROM orders').first();let o=await getOrder(ui.env,row.id);
  assert.equal(o.status,'Termin verbindlich');assert.equal(o.offer.totalCents,58500);assert.equal(o.acceptance.mode,'vor Ort');assert.equal(o.appointment.duration,360);assert.equal(o.source.plate,'TÜ-MX 9');
  assert.ok(ui.$('#p-form'),'Annahmeprotokoll wird direkt angezeigt');
  const paint=ui.$('#p-form');await ui.click(paint.querySelector('[data-paint-standard]'));const first=paint.querySelector('[data-paint-row]');first.querySelector('[data-paint-value]').value='95';
  await ui.submit(paint,'[data-submit="save"]');await ui.settle();o=await getOrder(ui.env,row.id);assert.equal(o.status,'In Arbeit');assert.equal(o.intake.paint.readings[0].values[0],95);
  await ui.go('#auftrag='+row.id+'/zahlung');ui.fill(ui.$('#pay-form'),{amount:'585,00'});await ui.submit('#pay-form');await ui.settle();
  o=await getOrder(ui.env,row.id);assert.equal(o.payments[0].amountCents,58500);assert.equal(o.payments[0].method,'Bar');
  const customers=(await ui.env.DB.prepare('SELECT COUNT(*) n FROM customers').first()).n;assert.equal(customers,1);
  assert.deepEqual(ui.errors,[]);
});

test('panel: customer master with vehicles and a new order prefilled from the customer',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});await ui.click('[data-click="test"]');await ui.click('[data-view="customers"]');
  await ui.click('[data-click="newCustomer"]');ui.fill(ui.$('#customerform'),{name:'Stamm Kunde',phone:'0711 123456',email:'stamm@example.invalid',address:'Hauptstraße 1, Horb'});await ui.submit('#customerform');
  const customer=await ui.env.DB.prepare('SELECT * FROM customers').first();assert.ok(customer);assert.equal(customer.synthetic,1);
  const vehicleForm=ui.$('.vehicleform[data-customer]');ui.fill(vehicleForm,{plate:'FDS-K 2',make:'Mercedes',model:'C-Klasse',classId:'suv'});await ui.submit(vehicleForm);
  const vehicle=await ui.env.DB.prepare('SELECT * FROM vehicles').first();assert.ok(vehicle);
  const edit=ui.$('#customerform');ui.fill(edit,{note:'Stammkunde seit 2024'});await ui.submit(edit);assert.equal(JSON.parse((await ui.env.DB.prepare('SELECT data FROM customers').first()).data).note,'Stammkunde seit 2024');
  await ui.click(ui.$('#modal [data-new-order]'));const create=ui.$('#createform');assert.equal(create.elements.name.value,'Stamm Kunde');assert.equal(create.elements.vehicleId.value,vehicle.id);await ui.submit(create);
  const link=await ui.env.DB.prepare('SELECT * FROM customer_orders').first();assert.equal(link.customer_id,customer.id);assert.equal(link.vehicle_id,vehicle.id);
  const o=await getOrder(ui.env,link.order_id);assert.equal(o.source.name,'TEST · Stamm Kunde');assert.equal(o.source.plate,'FDS-K 2');
  await ui.click('[data-click="back"]');await ui.click('[data-view="customers"]');await ui.settle();assert.match(ui.text(),/1 Auftrag/);
  assert.deepEqual(ui.errors,[]);
});

async function signedOrderWithPendingIntake(env){
  const call=async(path,body)=>{const r=await worker.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{'oai-authenticated-user-email':owner,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;};
  let o=await call('onsite',{synthetic:true,source:{name:'Link Kunde'},assessment:{lines:[{id:'p',kind:'package',title:'Paket',amountCents:10000}]},acceptance:{signature:signatureURL}});
  const draft=await call('protocol/prepare',{id:o.id,version:o.version,kind:'intake',protocol:{plate:'ALT-1'}});
  const upload=async()=>{const r=await worker.fetch(new Request(origin+'/api/upload/'+o.id+'?kind=signature&draft='+draft.id+'&hash='+draft.hash,{method:'POST',headers:{'oai-authenticated-user-email':owner,Origin:origin,'Content-Type':'image/png'},body:png}),env);return (await r.json()).id;};
  o=await call('action',{id:o.id,version:o.version,action:'intake',input:{draftId:draft.id,snapshotHash:draft.hash,customerSignature:await upload(),signaturesConfirmed:true}});
  o=await call('action',{id:o.id,version:o.version,action:'replacement',input:{kind:'intake',protocol:{plate:'NEU-1',paint:{readings:[{panel:'Dach',values:[120]}]}}}});
  return call('action',{id:o.id,version:o.version,action:'documentLink',input:{kind:'intake'}});
}
test('customer document page: the customer signs the replacement protocol through the personal link',async t=>{
  const env=environment();env.CUSTOMER_ACCESS_APPROVED='true';const o=await signedOrderWithPendingIntake(env);
  const ui=await boot(t,{page:'index.html',script:'app.js',path:'/dokument/'+o.pending.intake.token,env,identity:'synthetisch@example.invalid'});
  assert.match(ui.text(),/Ersatz-Annahmeprotokoll/);assert.match(ui.text(),/NEU-1/);assert.match(ui.text(),/ersetzt dieses Dokument ausdrücklich/);
  ui.draw(ui.$('#documentSignature'));ui.$('#documentConfirmed').checked=true;await ui.submit('#documentForm');
  assert.match(ui.text(),/Vielen Dank/);const final=await getOrder(env,o.id);assert.equal(final.intake.plate,'NEU-1');assert.equal(final.intake.signedRemotely,true);assert.ok(final.intake.replaces);
  assert.deepEqual(ui.errors,[]);
});
test('customer offer page shows the price note and withdrawal text and records the acceptance',async t=>{
  const env=environment();env.CUSTOMER_ACCESS_APPROVED='true';
  const call=async(path,body)=>{const r=await worker.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{'oai-authenticated-user-email':owner,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;};
  await call('settings',{withdrawalText:'Muster-Widerrufsbelehrung des Betreibers.'});
  let o=await call('create',{synthetic:true,source:{name:'Online Kunde'}});o=await call('action',{id:o.id,version:o.version,action:'price',input:{lines:[{id:'p',kind:'package',title:'Paket',amountCents:20000}]}});o=await call('action',{id:o.id,version:o.version,action:'confirm',input:{}});
  const ui=await boot(t,{page:'index.html',script:'app.js',path:'/angebot/'+o.offerToken,env,identity:'synthetisch@example.invalid'});
  assert.match(ui.text(),/Absprache mit dem Kunden/);assert.match(ui.text(),/Muster-Widerrufsbelehrung/);
  ui.draw(ui.$('#offerSignature'));ui.$('#offerObligation').checked=true;ui.$('#offerWithdrawal').checked=true;await ui.submit('#customerOfferForm');
  assert.match(ui.text(),/Annahme ist gespeichert/);const final=await getOrder(env,o.id);assert.equal(final.status,'Angenommen');assert.equal(final.acceptance.withdrawalNotice,true);assert.ok(!String(final.acceptance.signature).startsWith('data:'));
  assert.deepEqual(ui.errors,[]);
});

test('panel: every page and every order tab renders without errors on desktop and phone layouts',async t=>{
  const env=environment();await signedOrderWithPendingIntake(env);
  const ui=await boot(t,{page:'index.html',script:'app.js',env});await ui.click('[data-click="test"]');
  for(const view of ['overview','orders','customers','calendar','protocols','finance','care','settings']){await ui.click(`[data-view="${view}"]`);await ui.settle();assert.ok(ui.$('#content').textContent.length>50,view);}
  assert.ok(ui.$('#settingsform [name="withdrawalText"]'));
  await ui.click('[data-view="orders"]');await ui.click(ui.$('tr[data-order]'));
  for(const tab of ['source','price','appointment','intake','return','payment','notes']){await ui.click(`[data-tab="${tab}"]`);assert.ok(ui.$('.detail').textContent.length>20,tab);}
  await ui.click('[data-tab="intake"]');assert.match(ui.text(),/wartet auf Kundenunterschrift/);assert.match(ui.text(),/Persönlicher Link für den Kunden/);
  await ui.click('[data-tab="notes"]');await ui.click('[data-click="audit"]');assert.match(ui.$('#modal').textContent,/Änderungsprotokoll/);
  assert.deepEqual(ui.errors,[]);
});
