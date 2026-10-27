// End-to-end tests of the panel and the Vor-Ort app without any web server:
// jsdom renders the built pages and every request is passed in-process to the worker with an in-memory database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import worker,{getOrder,saveOrder} from '../src/worker.mjs';
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
  assert.match(ui.$('.overview-shell > .heading h1').textContent,/^Übersicht$/);
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
  await ui.click('[data-tab="price"]');await ui.click('[data-click="appointmentNow"]');current=await getOrder(ui.env,o.id);assert.equal(current.status,'Angenommen','proposed until confirmed');
  assert.match(ui.text(),/Termin vorgeschlagen – noch nicht bestätigt/);
  // The customer confirms the appointment on the operator's device.
  await ui.click('[data-click="confirmAppointmentSign"]');await ui.submit('#signform');assert.match(ui.$('#modal-error').textContent,/ankreuzen/);
  ui.draw(ui.$('#customerSign'));ui.fill(ui.$('#signform'),{confirmed:true});await ui.submit('#signform');
  current=await getOrder(ui.env,o.id);assert.equal(current.status,'Termin verbindlich');assert.equal(current.appointment.confirmation.mode,'vor Ort');assert.ok(current.appointment.confirmation.signature);
  // Moving the appointment needs a new confirmation; the owner can release it with a reason.
  ui.fill(ui.$('#appointmentform'),{start:'2030-01-03T10:00'});await ui.submit('#appointmentform');current=await getOrder(ui.env,o.id);assert.equal(current.status,'Angenommen');
  await ui.click('[data-click="confirmAppointmentRelease"]');ui.fill(ui.$('#appointmentreleaseform'),{releaseReason:'telefonisch bestätigt'});await ui.submit('#appointmentreleaseform');
  current=await getOrder(ui.env,o.id);assert.equal(current.status,'Termin verbindlich');assert.equal(current.appointment.confirmation.release.reason,'telefonisch bestätigt');
  // Intake without required fields including a paint reading and a damage from the sketch.
  await ui.click('[data-tab="intake"]');const form=ui.$('#protocolform');assert.ok(form.querySelector('[data-zone="Motorhaube"]'));
  await ui.click(form.querySelector('[data-zone="Motorhaube"]'));form.querySelector('[data-damage-kind]').value='Kratzer';
  await ui.click(form.querySelector('[data-paint-add]'));const row=form.querySelector('[data-paint-row]');row.querySelector('[data-paint-panel]').value='Dach';row.querySelectorAll('[data-paint-value]')[0].value='110';row.querySelectorAll('[data-paint-value]')[1].value='260';
  ui.fill(form,{mileage:'45000'});await ui.submit(form,'[data-submit="save"]');
  current=await getOrder(ui.env,o.id);assert.equal(current.status,'In Arbeit');assert.deepEqual(current.intake.paint.readings,[{panel:'Dach',values:[110,260]}]);assert.equal(current.intake.damages[0].area,'Motorhaube');assert.equal(current.intake.mileage,45000);
  // After work started the appointment changes only with a release; removal is gone.
  await ui.click('[data-tab="price"]');assert.ok(!ui.$('[data-click="removeAppointment"]'));
  ui.fill(ui.$('#appointmentform'),{start:'2030-01-04T10:00'});await ui.submit('#appointmentform');assert.match(ui.$('#appointmentform .error').textContent,/Freigabe/);
  ui.fill(ui.$('#appointmentform'),{start:'2030-01-04T10:00',release:true,releaseReason:'länger gebraucht'});await ui.submit('#appointmentform');
  current=await getOrder(ui.env,o.id);assert.equal(current.status,'In Arbeit');assert.equal(current.appointment.confirmation.release.reason,'länger gebraucht');await ui.click('[data-tab="intake"]');
  // Sign the protocol with both pads.
  await ui.submit(ui.$('#protocolform'),'[data-submit="sign"]');assert.ok(ui.$('#signatureform'));ui.draw(ui.$('#customerSign'));ui.draw(ui.$('#operatorSign'));ui.fill(ui.$('#signatureform'),{confirmed:true});await ui.submit('#signatureform');
  current=await getOrder(ui.env,o.id);assert.ok(current.intake.customerSignature);assert.notEqual(current.intake.customerAbsent,true);assert.equal(current.pending?.intake,undefined);assert.match(ui.text(),/Unterschriebenes Annahmeprotokoll/);
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
  await ui.click('[data-payment-cancel="0"]');current=await getOrder(ui.env,o.id);assert.ok(current.payments[0].cancelledAt);
  await ui.click('[data-payment-reactivate="0"]');current=await getOrder(ui.env,o.id);assert.equal(current.payments[0].cancelledAt,undefined);
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
  for(const view of ['overview','orders','customers','calendar','protocols','finance','care','dilution','settings']){await ui.click(`[data-view="${view}"]`);await ui.settle();assert.ok(ui.$('#content').textContent.length>50,view);}
  assert.ok(ui.$('#settingsform [name="withdrawalText"]'));
  await ui.click('[data-view="orders"]');await ui.click(ui.$('tr[data-order]'));
  for(const tab of ['source','price','intake','return','payment','notes']){await ui.click(`[data-tab="${tab}"]`);assert.ok(ui.$('.detail').textContent.length>20,tab);}
  await ui.click('[data-tab="intake"]');assert.match(ui.text(),/wartet auf Kundenunterschrift/);assert.match(ui.text(),/Persönlicher Link für den Kunden/);
  await ui.click('[data-tab="notes"]');await ui.click('[data-click="audit"]');assert.match(ui.$('#modal').textContent,/Änderungsprotokoll/);
  assert.deepEqual(ui.errors,[]);
});

test('Vor-Ort app: an invalid surcharge is shown and blocks the next step',async t=>{
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',storage:{'wg-vo-test':'1'}});
  await ui.go('#buchung');await ui.submit('#c-new');await ui.settle();await ui.submit('#v-new');await ui.settle();
  const form=ui.$('#s-form');form.elements.surcharge.value='12,345';form.dispatchEvent(new ui.w.Event('input',{bubbles:true}));
  assert.match(ui.$('#s-total').textContent,/höchstens zwei Nachkommastellen/);await ui.submit(form);await ui.settle();assert.ok(ui.$('#s-form'),'bleibt bei den Leistungen');
  form.elements.surcharge.value='12,50';form.dispatchEvent(new ui.w.Event('input',{bubbles:true}));await ui.submit(form);await ui.settle();assert.ok(ui.$('#a-form'));
  assert.deepEqual(ui.errors,[]);
});

test('panel: a new order for a customer takes the vehicle class from the chosen vehicle',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});await ui.click('[data-click="test"]');await ui.click('[data-view="customers"]');
  await ui.click('[data-click="newCustomer"]');ui.fill(ui.$('#customerform'),{name:'Klasse Kunde'});await ui.submit('#customerform');
  const vehicleForm=ui.$('.vehicleform[data-customer]');ui.fill(vehicleForm,{plate:'TR-1',label:'Sprinter',classId:'transporter'});await ui.submit(vehicleForm);
  await ui.click(ui.$('#modal [data-new-order]'));const create=ui.$('#createform');assert.equal(create.elements.classId.value,'transporter');assert.match(ui.$('#manual-quote').textContent,/230,95/);
  assert.deepEqual(ui.errors,[]);
});

test('consent texts: immediate start is never pre-ticked, names the lapse of the withdrawal right and the withdrawal text keeps its paragraphs',async t=>{
  const env=environment();await worker.fetch(new Request(origin+'/api/settings',{method:'POST',headers:{'oai-authenticated-user-email':owner,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({withdrawalText:'Widerrufsbelehrung\n\nWiderrufsrecht'})}),env);
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',storage:{'wg-vo-test':'1'},env});
  await ui.go('#buchung');await ui.submit('#c-new');await ui.settle();await ui.submit('#v-new');await ui.settle();await ui.submit('#s-form');await ui.settle();
  const form=ui.$('#a-form');assert.equal(form.elements.immediateStart.checked,false);assert.match(form.elements.immediateStart.closest('label').textContent,/Widerrufsrecht bei vollständiger Vertragserfüllung erlischt/);
  assert.ok(ui.$('.withdrawal-text'));assert.equal(ui.$('.withdrawal-text').textContent,'Widerrufsbelehrung\n\nWiderrufsrecht');
  ui.draw(ui.$('#a-sign'));ui.fill(form,{paymentObligation:true,immediateStart:true,withdrawalNotice:true});await ui.submit(form);await ui.settle();
  const row=await env.DB.prepare('SELECT id FROM orders').first();const o=await getOrder(env,row.id);assert.equal(o.acceptance.immediateStart,true);assert.equal(o.acceptance.withdrawalNotice,true);assert.equal(o.acceptance.withdrawalText,'Widerrufsbelehrung\n\nWiderrufsrecht');
  await ui.go('#auftrag='+row.id);assert.ok(ui.$('[data-share="acceptance"]'));
  assert.deepEqual(ui.errors,[]);
});


test('panel: absent customer protocol and recoverable order deletion preserve documents',async t=>{
  const env=environment();env.STANDALONE_AUTH='true';const ui=await boot(t,{page:'index.html',script:'app.js',env});
  await ui.click('[data-click="test"]');await ui.click('[data-click="create"]');
  ui.fill(ui.$('#createform'),{name:'Remote Test',vehicle:'Testauto'});await ui.submit('#createform');
  const row=await ui.env.DB.prepare('SELECT * FROM orders').first();
  await ui.click('[data-tab="intake"]');ui.fill(ui.$('#protocolform'),{mileage:'54321',notes:'Schlüssel im Briefkasten'});await ui.submit('#protocolform','[data-submit="save"]');assert.ok(ui.$('[data-click="sharePdf"]'));
  await ui.submit('#protocolform','[data-submit="remote"]');
  assert.ok(ui.$('#operatorSign'));assert.equal(ui.$('#customerSign'),null);assert.equal(ui.$('#signatureform').elements.confirmed.checked,false);
  assert.equal((await getOrder(ui.env,row.id)).pending?.intake,undefined);
  await ui.submit('#signatureform');assert.match(ui.$('#modal-error').textContent,/bestätigen/);
  ui.fill(ui.$('#signatureform'),{confirmed:true});await ui.submit('#signatureform');assert.match(ui.$('#modal-error').textContent,/Betrieb unterschreiben/);
  ui.draw(ui.$('#operatorSign'));await ui.submit('#signatureform');
  let current=await getOrder(ui.env,row.id);assert.equal(current.pending.intake.content.mileage,54321);assert.equal(current.pending.intake.replaces,null);assert.equal(current.pending.intake.content.customerSignature,null);assert.ok(current.pending.intake.content.operatorSignature);assert.equal(current.pending.intake.content.customerAbsent,true);
  assert.equal(ui.$('#protocolform'),null);assert.equal(ui.$('[data-click="sharePdf"]'),null);assert.match(ui.text(),/Vom Betrieb unterschrieben – Kundenunterschrift ausstehend/);
  assert.match(ui.text(),/persönlichen Zugang/);assert.ok(ui.$('[data-click="documentLink"]'));
  const request=structuredClone(current.pending.intake);
  await ui.click('[data-click="deleteOrder"]');ui.fill(ui.$('#deleteorderform'),{reason:'Doppelte Anfrage'});await ui.submit('#deleteorderform');
  current=await getOrder(ui.env,row.id);assert.ok(current.trash.deletedAt);assert.deepEqual(current.pending.intake.content,request.content);
  assert.equal((await ui.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,1);
  await ui.click('[data-view="trash"]');assert.match(ui.text(),/Remote Test/);await ui.click('[data-order]');
  assert.ok(ui.$('[data-click="restoreOrder"]'));assert.equal(ui.$('#sourceform'),null);
  await ui.click('[data-click="restoreOrder"]');current=await getOrder(ui.env,row.id);assert.ok(!current.trash?.deletedAt);
  assert.ok(ui.$('#sourceform'));assert.equal(current.source.name,'TEST · Remote Test');
});


test('Vor-Ort app retains an absent customer draft and shows extra work in the open payment',async t=>{
  const e=environment();const create=await worker.fetch(new Request(origin+'/api/create',{method:'POST',headers:{origin,'oai-authenticated-user-email':owner,'Content-Type':'application/json'},body:JSON.stringify({synthetic:true,source:{name:'Mobile Mehrarbeit',vehicle:'Testauto'}})}),e);
  assert.equal(create.status,200);const original=await create.json();const updated=structuredClone(original);
  updated.status='Erledigt';updated.offer={totalCents:10000,services:'Paket'};updated.completedAt='2026-10-13T09:00:00Z';updated.invoiceDraft={totalCents:15000};updated.payments=[{id:'test-payment',amountCents:4000}];updated.pending={intake:{content:{mileage:54321,notes:'Schlüssel im Briefkasten',photos:[]},createdAt:'2026-10-13T09:00:00Z'}};
  await saveOrder(e,updated,original.version,'Isolierter Testzustand');
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',hash:'#auftrag='+original.id+'/zahlung',env:e,storage:{'wg-vo-test':'1'}});
  assert.equal(ui.$('#pay-form').elements.amount.value,'110,00');
  await ui.go('#auftrag='+original.id+'/annahme');assert.equal(ui.$('#p-form').elements.mileage.value,'54321');assert.equal(ui.$('#p-form').elements.notes.value,'Schlüssel im Briefkasten');
  const destinations=[];Object.defineProperty(globalThis,'location',{value:{get hash(){return ui.w.location.hash;},set hash(value){ui.w.location.hash=value;},assign(value){destinations.push(value);}},configurable:true});
  ui.fill(ui.$('#p-form'),{notes:'Abholung dokumentiert'});await ui.submit('#p-form','[data-submit="remote"]');
  assert.equal(ui.$('#sig-customer'),null);assert.ok(ui.$('#sig-operator'));assert.equal(ui.$('#sig-form').elements.confirmed.checked,false);assert.deepEqual(destinations,[]);
  ui.draw(ui.$('#sig-operator'));ui.fill(ui.$('#sig-form'),{confirmed:true});await ui.submit('#sig-form');
  assert.deepEqual(destinations,['/#auftrag='+encodeURIComponent(original.id)]);
  assert.equal((await getOrder(e,original.id)).pending.intake.content.notes,'Abholung dokumentiert');
  assert.ok((await getOrder(e,original.id)).pending.intake.content.operatorSignature);
});


test('panel: an operator release shows its reason and time without claiming a customer signature',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});await ui.click('[data-click="test"]');await ui.click('[data-click="create"]');
  ui.fill(ui.$('#createform'),{name:'Freigabe Test'});await ui.submit('#createform');await ui.click('[data-tab="price"]');await ui.submit('#priceform');
  await ui.click('[data-click="onsiteAccept"]');ui.fill(ui.$('#signform'),{release:true,releaseReason:'Telefonisch bestätigt <intern>'});await ui.submit('#signform');
  const id=(await ui.env.DB.prepare('SELECT id FROM orders').first()).id,current=await getOrder(ui.env,id);
  assert.equal(current.acceptance.signature,null);assert.equal(current.acceptance.release.reason,'Telefonisch bestätigt <intern>');
  const acceptedAt=new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'}).format(new Date(current.acceptance.release.at));
  assert.match(ui.$('.detail').textContent,/Ohne Unterschrift freigegeben \(durch den Betrieb\)/);assert.ok(ui.$('.detail').textContent.includes('am '+acceptedAt));
  assert.match(ui.$('.detail').textContent,/Grund: Telefonisch bestätigt <intern>/);assert.equal(ui.$('.detail intern'),null);assert.doesNotMatch(ui.$('.detail').textContent,/Online unterschrieben/);
  // Editing an unsigned offer keeps the archived acceptance honest as well.
  await ui.submit('#priceform');assert.ok(ui.$('.detail details.sectiongap'));assert.doesNotMatch(ui.$('.detail details.sectiongap').textContent,/unterschrieben/i);
  assert.match(ui.$('.detail details.sectiongap').textContent,/Grund: Telefonisch bestätigt <intern>/);assert.deepEqual(ui.errors,[]);
});

test('panel: Google sync is available only after the proposed appointment becomes binding',async t=>{
  const env=environment();env.STANDALONE_AUTH='true';
  const call=async(path,body)=>{const response=await worker.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{origin,'oai-authenticated-user-email':owner,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  await call('settings',{numberAudit:true,lastNumber:0,numberEvidence:'Isolierter Oberflächentest'});
  const initial=await call('create',{source:{name:'Kalender Test',email:'kalender@example.invalid'}});
  const proposed={...initial,status:'Angenommen',calendar:{eventId:'isolated-calendar-event'},offer:{lines:[],totalCents:0,services:''},acceptance:{at:'2030-01-01T08:00:00Z'},appointment:{start:'2030-01-03T09:00:00.000Z',end:'2030-01-03T11:00:00.000Z',duration:120,delivery:'Kunde bringt',location:''}};
  await saveOrder(env,proposed,initial.version,'Isolierter Terminvorschlag');
  const ui=await boot(t,{page:'index.html',script:'app.js',env,hash:'#auftrag='+initial.id});await ui.click('[data-tab="price"]');
  assert.match(ui.text(),/Termin vorgeschlagen/);assert.equal(ui.$('[data-click="calendarSync"]'),null);
  await ui.click('[data-click="confirmAppointmentRelease"]');ui.fill(ui.$('#appointmentreleaseform'),{releaseReason:'Termin telefonisch bestätigt'});await ui.submit('#appointmentreleaseform');
  assert.equal((await getOrder(env,initial.id)).status,'Termin verbindlich');assert.ok(ui.$('[data-click="calendarSync"]'));assert.doesNotMatch(ui.text(),/Der bisherige Google-Termin bleibt/);
  ui.fill(ui.$('#appointmentform'),{start:'2030-01-04T10:00'});await ui.submit('#appointmentform');
  assert.equal((await getOrder(env,initial.id)).status,'Angenommen');assert.equal(ui.$('[data-click="calendarSync"]'),null);assert.match(ui.text(),/Der bisherige Google-Termin bleibt bis zur erneuten Bestätigung reserviert/);assert.deepEqual(ui.errors,[]);
});

test('Vor-Ort app: an unsigned release never promises a signature in the shared confirmation',async t=>{
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',storage:{'wg-vo-test':'1'}});
  await ui.go('#buchung');await ui.submit('#c-new');await ui.settle();await ui.submit('#v-new');await ui.settle();await ui.submit('#s-form');await ui.settle();
  ui.fill(ui.$('#a-form'),{release:true,releaseReason:'Kunde kann heute nicht unterschreiben'});await ui.submit('#a-form');await ui.settle();
  const id=(await ui.env.DB.prepare('SELECT id FROM orders').first()).id;assert.equal((await getOrder(ui.env,id)).acceptance.signature,null);
  await ui.go('#auftrag='+id);assert.match(ui.$('[data-share="acceptance"]').textContent,/Freigabe ohne Kundenunterschrift/);assert.doesNotMatch(ui.$('[data-share="acceptance"]').textContent,/, Unterschrift/);assert.deepEqual(ui.errors,[]);
});

test('panel: offer and appointment share one tab and one customer signature',async t=>{
  const env=environment();
  const call=async(path,body)=>{const response=await worker.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{origin,'oai-authenticated-user-email':owner,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
  let order=await call('create',{synthetic:true,source:{name:'Gemeinsame Bestätigung',vehicle:'VW Golf'}});
  order=await call('action',{id:order.id,version:order.version,action:'price',input:{services:'Innenreinigung',totalCents:15000}});
  order=await call('action',{id:order.id,version:order.version,action:'appointment',input:{start:'2030-01-03T10:00',duration:120,delivery:'Kunde bringt',location:'Horb'}});
  const ui=await boot(t,{page:'index.html',script:'app.js',env,hash:'#auftrag='+order.id});
  await ui.click('[data-tab="price"]');
  assert.match(ui.$('[data-tab="price"]').textContent,/Angebot & Termin/);
  assert.equal(ui.$('[data-tab="appointment"]'),null);
  assert.ok(ui.$('#priceform'));assert.ok(ui.$('#appointmentform'));
  await ui.click('[data-click="onsiteAccept"]');
  assert.match(ui.$('#modal').textContent,/Ihr Termin/);assert.match(ui.$('#modal').textContent,/Horb/);
  ui.draw(ui.$('#customerSign'));ui.fill(ui.$('#signform'),{paymentObligation:true});await ui.submit('#signform');
  assert.match(ui.$('#modal-error').textContent,/gemeinsam bestätigen/);
  assert.equal((await getOrder(env,order.id)).acceptance,undefined);
  ui.fill(ui.$('#signform'),{confirmAppointment:true});await ui.submit('#signform');
  const accepted=await getOrder(env,order.id);
  assert.equal(accepted.status,'Termin verbindlich');
  assert.equal(accepted.acceptance.signature,accepted.appointment.confirmation.signature);
  assert.equal(accepted.acceptance.snapshot.appointment.start,order.appointment.start);
  ui.fill(ui.$('#appointmentform'),{start:'2030-01-04T10:00'});await ui.submit('#appointmentform');
  const moved=await getOrder(env,order.id);assert.equal(moved.status,'Angenommen');assert.equal(moved.appointment.confirmation,undefined);
  assert.equal(moved.acceptance.snapshot.appointment.start,order.appointment.start,'signed appointment stays in the original confirmation');
  assert.deepEqual(ui.errors,[]);
});

test('panel: mobile navigation separates enquiries, running work and finance while preserving the mixer',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});
  await ui.click('.mobile-dock [data-click="menu"]');
  await ui.click('.sidebar [data-view="dilution"]');
  assert.equal(ui.$('[data-dilution-concentrate]').textContent,'90,91 ml');
  const amount=ui.$('[data-dilution-field="total"]');amount.value='0,5';amount.dispatchEvent(new ui.w.Event('input',{bubbles:true}));
  assert.equal(ui.$('[data-dilution-concentrate]').textContent,'45,45 ml');
  await ui.click('.mobile-dock [data-click="menu"]');
  assert.ok(ui.$('.sidebar.open'));assert.equal(ui.$('.sidebar-backdrop').hidden,false);
  assert.equal(ui.$('.mobile-dock [data-click="menu"]').getAttribute('aria-expanded'),'true');
  ui.w.document.dispatchEvent(new ui.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(ui.$('.sidebar.open'),null);assert.equal(ui.$('.sidebar-backdrop').hidden,true);
  await ui.click('.mobile-dock [data-view="requests"]');assert.match(ui.$('h1').textContent,/Kundenanfragen/);
  await ui.click('.mobile-dock [data-view="active"]');assert.match(ui.$('h1').textContent,/Laufende Aufträge/);
  await ui.click('.mobile-dock [data-view="finance"]');assert.match(ui.$('h1').textContent,/Finanzen/);
  await ui.click('.mobile-dock [data-click="menu"]');await ui.click('.sidebar [data-view="orders"]');assert.match(ui.$('h1').textContent,/Alle Aufträge/);
  assert.equal((await ui.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);
  assert.deepEqual(ui.errors,[]);
});

test('panel: grouped navigation and care queue use real order follow-ups',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});
  assert.equal(ui.w.document.querySelectorAll('.sidebar .navgroup').length,3);
  assert.match(ui.$('.sidebar').textContent,/TAGESGESCHÄFT/);assert.match(ui.$('.sidebar').textContent,/KUNDEN & DOKUMENTE/);
  await ui.click('.sidebar [data-view="care"]');assert.match(ui.$('.care-queue').textContent,/Keine Wiedervorlagen geplant/);
  await ui.click('[data-click="test"]');await ui.click('.sidebar [data-view="overview"]');await ui.click('[data-click="create"]');ui.fill(ui.$('#createform'),{name:'Betreuung Test',vehicle:'BMW M4'});await ui.submit('#createform');
  await ui.click('[data-tab="notes"]');const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  ui.fill(ui.$('#noteform'),{kind:'Telefonat',followUp:yesterday,note:'Pflegekontrolle telefonisch abstimmen'});await ui.submit('#noteform');
  await ui.click('[data-click="back"]');await ui.click('.sidebar [data-view="care"]');
  assert.equal(ui.$('.care-summary .attention strong').textContent,'1');assert.match(ui.$('.care-queue-item').textContent,/Überfällig/);assert.match(ui.$('.care-queue-item').textContent,/Pflegekontrolle telefonisch abstimmen/);
  await ui.click('.care-queue-item');assert.match(ui.$('.detail-header').textContent,/Betreuung Test/);
  assert.deepEqual(ui.errors,[]);
});

test('Vor-Ort app: the mixer is directly available with the existing app navigation',async t=>{
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',hash:'#mischrechner'});
  assert.equal(ui.$('[data-dilution-concentrate]').textContent,'90,91 ml');
  assert.equal(ui.$('.vo-dock [aria-current="page"]').getAttribute('href'),'#mischrechner');
  await ui.click('[data-dilution-preset="20"]');assert.equal(ui.$('[data-dilution-water]').textContent,'952,38 ml');
  await ui.go('#');assert.match(ui.$('.vo-intro').textContent,/Alles für deinen Auftrag/);
  assert.ok(ui.$('[href="#buchung"]'));assert.ok(ui.$('[href="#mischrechner"]'));
  assert.deepEqual(ui.errors,[]);
});

test('panel: saving prices or appointment preserves the other form and blocks signing unsaved terms',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});
  await ui.click('[data-click="test"]');await ui.click('[data-click="create"]');await ui.submit('#createform');await ui.click('[data-tab="price"]');
  await ui.click('[data-price-add-custom]');
  const price=ui.$('[data-kind="custom"] [data-line-price]');price.value='123,45';price.dispatchEvent(new ui.w.Event('input',{bubbles:true}));
  ui.fill(ui.$('#appointmentform'),{start:'2030-02-01T10:00',duration:'120'});await ui.submit('#appointmentform');
  assert.equal(ui.$('[data-kind="custom"] [data-line-price]').value,'123,45');
  await ui.click('[data-click="onsiteAccept"]');assert.match(ui.$('#priceform .error').textContent,/Preise zuerst speichern/);assert.equal(ui.$('#modal').open,false);
  await ui.submit('#priceform');
  ui.fill(ui.$('#appointmentform'),{start:'2030-02-02T11:00',duration:'90'});
  const updatedPrice=ui.$('[data-kind="custom"] [data-line-price]');updatedPrice.value='150,00';updatedPrice.dispatchEvent(new ui.w.Event('input',{bubbles:true}));
  await ui.submit('#priceform');
  assert.equal(ui.$('#appointmentform').elements.start.value,'2030-02-02T11:00');assert.equal(ui.$('#appointmentform').elements.duration.value,'90');
  await ui.click('[data-click="confirm"]');assert.equal(ui.$('#modal').open,false);assert.match(ui.$('#appointmentform .error').textContent,/Termin zuerst speichern/);
  await ui.click('[data-click="onsiteAccept"]');assert.match(ui.$('#appointmentform .error').textContent,/Termin zuerst speichern/);
  await ui.submit('#appointmentform');await ui.click('[data-click="onsiteAccept"]');assert.equal(ui.$('#modal').open,true);
  assert.deepEqual(ui.errors,[]);
});

test('Vor-Ort app: new navigation does not interrupt a booking or its customer signature',async t=>{
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',storage:{'wg-vo-test':'1'}});
  assert.equal(ui.$('.vo-dock').hidden,false);
  await ui.go('#buchung');assert.equal(ui.$('.vo-dock').hidden,true);
  await ui.submit('#c-new');await ui.submit('#v-new');await ui.submit('#s-form');
  assert.ok(ui.$('#a-form'));assert.equal(ui.$('.vo-dock').hidden,true);
  ui.draw(ui.$('#a-sign'));ui.fill(ui.$('#a-form'),{paymentObligation:true,immediateStart:true});await ui.submit('#a-form');
  assert.equal(ui.$('.vo-dock').hidden,true,'protocol form keeps focus on the active task');
  const id=(await ui.env.DB.prepare('SELECT id FROM orders').first()).id;await ui.go('#auftrag='+id);
  assert.equal(ui.$('.vo-dock').hidden,false);
  assert.ok((await getOrder(ui.env,id)).acceptance.signature);
  assert.deepEqual(ui.errors,[]);
});

test('Vor-Ort app: the concrete displayed appointment is visible before signing and remains identical in the signed snapshot',async t=>{
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',storage:{'wg-vo-test':'1'}});
  await ui.go('#buchung');ui.fill(ui.$('#c-new'),{name:'Terminprüfung',address:'Teststraße 1, 72160 Horb'});await ui.submit('#c-new');
  await ui.submit('#v-new');await ui.submit('#s-form');
  const review=ui.$('[data-onsite-appointment-review]'),canvas=ui.$('#a-sign');
  assert.ok(review.compareDocumentPosition(canvas)&ui.w.Node.DOCUMENT_POSITION_FOLLOWING,'all appointment details precede the signature canvas');
  const displayed={start:ui.$('[data-onsite-appointment-start]').getAttribute('datetime'),end:ui.$('[data-onsite-appointment-end]').getAttribute('datetime'),duration:Number(ui.$('[data-onsite-appointment-duration]').textContent.split(' ')[0]),delivery:ui.$('[data-onsite-appointment-delivery]').textContent,location:ui.$('[data-onsite-appointment-location]').textContent};
  assert.equal(displayed.duration,180);assert.equal(Date.parse(displayed.end)-Date.parse(displayed.start),180*60000);
  assert.equal(displayed.delivery,'Kunde bringt');assert.equal(displayed.location,'Teststraße 1, 72160 Horb');
  assert.match(review.textContent,/Europe\/Berlin/);
  ui.draw(canvas);ui.fill(ui.$('#a-form'),{paymentObligation:true,immediateStart:true});await ui.submit('#a-form');
  const id=(await ui.env.DB.prepare('SELECT id FROM orders').first()).id,saved=await getOrder(ui.env,id);
  assert.ok(saved.acceptance.signature);assert.equal(saved.appointment.confirmation.signature,saved.acceptance.signature);
  for(const key of ['start','end','duration','delivery','location']){
    assert.equal(saved.appointment[key],displayed[key],key+' stored exactly as shown');
    assert.equal(saved.acceptance.snapshot.appointment[key],displayed[key],key+' belongs to the signed acceptance');
  }
  assert.deepEqual(ui.errors,[]);
});

test('Vor-Ort app: changing workstart clears the old signature and confirmation without changing the frozen appointment',async t=>{
  const ui=await boot(t,{page:'vor-ort.html',script:'vor-ort.js',storage:{'wg-vo-test':'1'}});
  await ui.go('#buchung');await ui.submit('#c-new');await ui.submit('#v-new');await ui.submit('#s-form');
  const form=ui.$('#a-form'),start=ui.$('[data-onsite-appointment-start]').getAttribute('datetime');
  assert.equal(ui.$('[data-onsite-appointment-location]').textContent,'Nicht angegeben');
  ui.draw(ui.$('#a-sign'));ui.fill(form,{paymentObligation:true});
  form.elements.startNow.click();
  assert.equal(form.elements.paymentObligation.checked,false);assert.equal(ui.$('[data-onsite-appointment-start]'),null);
  assert.match(ui.$('[data-onsite-appointment-review]').textContent,/Noch kein verbindlicher Termin/);
  await ui.submit(form);assert.match(ui.$('#a-error').textContent,/unterschreiben lassen/);
  assert.equal((await ui.env.DB.prepare('SELECT COUNT(*) count FROM orders').first()).count,0);
  ui.draw(ui.$('#a-sign'));ui.fill(form,{paymentObligation:true});form.elements.startNow.click();
  assert.equal(form.elements.paymentObligation.checked,false);assert.equal(ui.$('[data-onsite-appointment-start]').getAttribute('datetime'),start);
  await ui.submit(form);assert.match(ui.$('#a-error').textContent,/unterschreiben lassen/);
  assert.equal((await ui.env.DB.prepare('SELECT COUNT(*) count FROM orders').first()).count,0);
  ui.draw(ui.$('#a-sign'));ui.fill(form,{paymentObligation:true,immediateStart:true});await ui.submit(form);
  const id=(await ui.env.DB.prepare('SELECT id FROM orders').first()).id;
  assert.equal((await getOrder(ui.env,id)).acceptance.snapshot.appointment.start,start);
  assert.deepEqual(ui.errors,[]);
});

for(const kind of ['intake','return'])test(`panel: absent ${kind} needs a fresh operator signature for each revised version`,async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});
  await ui.click('[data-click="test"]');await ui.click('[data-click="create"]');ui.fill(ui.$('#createform'),{name:'Fassungen Test'});await ui.submit('#createform');
  const {id}=await ui.env.DB.prepare('SELECT id FROM orders').first();await ui.click('[data-tab="'+kind+'"]');
  // Opening and cancelling the absent-customer dialog must not change the order.
  await ui.submit('#protocolform','[data-submit="remote"]');await ui.click('#modal [data-click="close"]');assert.equal((await getOrder(ui.env,id)).pending?.[kind],undefined);
  await ui.submit('#protocolform','[data-submit="sign"]');assert.ok(ui.$('#customerSign'));assert.ok(ui.$('#operatorSign'));await ui.click('#modal [data-click="close"]');
  await ui.submit('#protocolform','[data-submit="remote"]');ui.draw(ui.$('#operatorSign'));ui.fill(ui.$('#signatureform'),{confirmed:true});await ui.submit('#signatureform');
  const original=structuredClone((await getOrder(ui.env,id)).pending[kind]);await ui.click('[data-click="documentLink"]');assert.ok((await getOrder(ui.env,id)).pending[kind].token);
  await ui.click('[data-click="replaceProtocol"][data-kind="'+kind+'"]');assert.equal(ui.$('#protocolform [data-submit="save"]'),null);ui.fill(ui.$('#protocolform'),{notes:'Neue überprüfte Fassung'});await ui.submit('#protocolform','[data-submit="remote"]');
  assert.equal(ui.$('#signatureform').elements.confirmed.checked,false);ui.fill(ui.$('#signatureform'),{confirmed:true});await ui.submit('#signatureform');assert.match(ui.$('#modal-error').textContent,/Betrieb unterschreiben/);
  assert.equal((await getOrder(ui.env,id)).pending[kind].content.operatorSignature,original.content.operatorSignature);
  ui.draw(ui.$('#operatorSign'));await ui.submit('#signatureform');const current=await getOrder(ui.env,id);
  assert.equal(current.pending[kind].content.notes,'Neue überprüfte Fassung');assert.notEqual(current.pending[kind].content.operatorSignature,original.content.operatorSignature);assert.equal(current.pending[kind].token,undefined);
  assert.equal(current.pendingHistory.at(-1).content.operatorSignature,original.content.operatorSignature);assert.match(ui.text(),/Frühere Fassungen/);assert.equal(ui.$('#protocolform'),null);assert.deepEqual(ui.errors,[]);
});

for(const kind of ['intake','return'])test(`customer page: absent ${kind} displays operator signature before the customer signs`,async t=>{
  const env=environment();env.CUSTOMER_ACCESS_APPROVED='true';
  const call=async(path,body)=>{const r=await worker.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{origin,'oai-authenticated-user-email':owner,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);const result=await r.json();assert.equal(r.status,200,JSON.stringify(result));return result;};
  let o=await call('create',{synthetic:true,source:{name:'Abwesend Kunde',vehicle:'Testfahrzeug'}});
  const draft=await call('protocol/prepare',{id:o.id,version:o.version,kind,protocol:{customerAbsent:true,customerName:'Abwesend Kunde',operatorName:'Betrieb Test',notes:'Vorab geprüft'}});
  const response=await worker.fetch(new Request(origin+'/api/upload/'+o.id+'?kind=signature&draft='+draft.id+'&hash='+draft.hash,{method:'POST',headers:{origin,'oai-authenticated-user-email':owner,'Content-Type':'image/png'},body:png}),env);assert.equal(response.status,200);const operator=(await response.json()).id;
  o=await call('action',{id:o.id,version:o.version,action:'protocolRequest',input:{kind,customerAbsent:true,draftId:draft.id,snapshotHash:draft.hash,operatorSignature:operator,signaturesConfirmed:true}});
  o=await call('action',{id:o.id,version:o.version,action:'documentLink',input:{kind}});
  const ui=await boot(t,{page:'index.html',script:'app.js',path:'/dokument/'+o.pending[kind].token,env,identity:'synthetisch@example.invalid'});
  assert.match(ui.text(),/Betrieb Test/);assert.match(ui.text(),/Kundenunterschrift ausstehend/);const operatorImage=ui.$('img[alt="Unterschrift Betrieb"]');assert.ok(operatorImage);assert.ok(operatorImage.src.endsWith('/asset/'+operator));assert.equal(ui.$('#documentConfirmed').checked,false);
  ui.draw(ui.$('#documentSignature'));ui.$('#documentConfirmed').checked=true;await ui.submit('#documentForm');assert.match(ui.text(),/Vielen Dank/);
  const signed=(await getOrder(env,o.id))[kind];assert.equal(signed.operatorSignature,operator);assert.equal(signed.snapshotHash,draft.hash);assert.ok(signed.customerSignature);assert.notEqual(signed.customerSignature,operator);assert.deepEqual(ui.errors,[]);
});

test('panel: operational agenda links existing appointments, follow-ups and unpaid invoice deadlines',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});await ui.click('[data-click="test"]');await ui.click('[data-click="create"]');
  ui.fill(ui.$('#createform'),{name:'Agenda Kunde',vehicle:'BMW M4',plate:'HOR-AG 7'});await ui.submit('#createform');
  const row=await ui.env.DB.prepare('SELECT id FROM orders').first(),current=await getOrder(ui.env,row.id);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  current.status='Termin verbindlich';current.appointment={start:today+'T12:00:00.000Z',end:today+'T14:00:00.000Z',duration:120,delivery:'Kunde bringt',confirmation:{at:new Date().toISOString(),mode:'Test'}};
  current.notes=[{at:new Date().toISOString(),kind:'Wiedervorlage',note:'Lackzustand telefonisch besprechen',followUp:today}];
  current.invoice={provider:'qonto',status:'unpaid',number:'RE-TEST',dueDate:yesterday,totalCents:34900};
  await saveOrder(ui.env,current,current.version,'Synthetischer Agenda-Test');await ui.click('[data-click="back"]');await ui.click('[data-click="refresh"]');
  assert.match(ui.$('.operations-panel.compact').textContent,/Jetzt & als Nächstes/);assert.match(ui.$('.operations-panel.compact').textContent,/Lackzustand telefonisch besprechen/);
  await ui.click('.sidebar [data-view="calendar"]');assert.match(ui.text(),/Deine nächsten 7 Tage/);assert.match(ui.text(),/349,00\s*€/);assert.match(ui.text(),/Rechnungssummen, kein Kontostand/);assert.match(ui.text(),/Keine Kapazitätsaussage/);
  assert.ok(ui.$('.agenda-item.appointment[data-order]'));assert.ok(ui.$('.agenda-item.followup[data-order]'));assert.ok(ui.$('.calendar-month[open]'));assert.ok(ui.$('.calendar-item[data-order]'));
  await ui.click('.agenda-item.invoice');assert.match(ui.text(),/Agenda Kunde/);assert.match(ui.text(),/Kunde & Anfrage/);assert.deepEqual(ui.errors,[]);
});

test('panel: overview has one clear work queue and hash navigation updates the visible screen',async t=>{
  const ui=await boot(t,{page:'index.html',script:'app.js'});
  assert.equal(ui.w.document.querySelectorAll('.overview-shell').length,1);
  assert.equal(ui.w.document.querySelectorAll('.operations-panel').length,1);
  assert.equal(ui.w.document.querySelectorAll('.overview-orders').length,1);
  assert.equal(ui.w.document.querySelectorAll('.premium-hero,.premium-modules,.integration-grid').length,0);
  assert.equal(ui.w.document.querySelectorAll('script[src="/premium.js"],link[href="/premium.css"],link[href="/agency.css"]').length,0);
  await ui.go('#system');assert.ok(ui.$('.system-page'));assert.equal(ui.$('.sidebar [data-view="system"]').getAttribute('aria-current'),'page');
  await ui.go('#overview');assert.equal(ui.$('.overview-shell > .heading h1').textContent,'Übersicht');assert.equal(ui.$('.sidebar [data-view="overview"]').getAttribute('aria-current'),'page');
  await ui.click('[data-click="test"]');await ui.click('[data-click="create"]');ui.fill(ui.$('#createform'),{name:'Navigation Test',vehicle:'BMW M4'});await ui.submit('#createform');
  const id=(await ui.env.DB.prepare('SELECT id FROM orders').first()).id;
  await ui.go('#overview');assert.ok(ui.$('.overview-orders'));assert.equal(ui.w.document.querySelectorAll('.overview-shell [data-click="create"]').length,1);
  await ui.go('#auftrag='+id);assert.match(ui.$('.detail-header').textContent,/Navigation Test/);
  await ui.go('#finance');assert.equal(ui.$('.detail-header'),null);assert.match(ui.$('.content > .heading h1').textContent,/Finanzen/);assert.deepEqual(ui.errors,[]);
});
