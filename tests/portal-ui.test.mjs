// Kundenportal-Oberfläche: /kunde wird aus dem Build in jsdom geladen; Anfragen gehen im Prozess
// an die echte Anwendung. Es wird kein Server gestartet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {chatNotificationsSettled} from '../server/chat.mjs';
import {setting} from '../src/worker.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='kundin@example.invalid';
let loads=0;
const signatureURL='data:image/png;base64,'+Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64'),Buffer.alloc(300)]).toString('base64');
async function setup(t){
  const files=new Map();
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,3).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,o){files.set(id,{body:new Uint8Array(bytes),httpMetadata:o?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},
    ASSETS:{fetch:async request=>{const name=new URL(request.url).pathname;const file=name==='/kunde'?'kunde.html':name.slice(1);try{return new Response(readFileSync(new URL('../dist/client/'+file,import.meta.url)),{headers:{'Content-Type':'text/html'}});}catch{return new Response('Nicht gefunden',{status:404});}}}};
  t.after(async()=>{await chatNotificationsSettled();env.DB.close();});
  const app=await createApplication(env);
  const session=async email=>{const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();return '__Host-wg-session='+raw;};
  const id=randomUUID(),line={id:'package',kind:'package',catalogId:'premium',title:'Reinigung & Politur',description:'',amountCents:43625};
  const data={id,wg:'WG-4711',status:'Termin verbindlich',synthetic:false,source:{name:'Erika Muster',email:customer,vehicle:'VW Golf',plate:'FDS-WG 1',packageId:'premium',classId:'suv'},assessment:{lines:[line],condition:'',totalCents:43625,pickupCents:0,pricesReviewed:true,services:''},offer:{lines:[line],totalCents:43625,pickupCents:0,services:''},acceptance:{at:new Date().toISOString()},appointment:{start:'2030-10-14T07:00:00.000Z',end:'2030-10-14T13:00:00.000Z',delivery:'Kunde bringt',location:''},notes:[],payments:[],createdAt:new Date().toISOString()};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(id,data.wg,data.status,JSON.stringify(data),new Date().toISOString(),'test','fixture').run();
  return {env,app,files,order:data,ownerCookie:await session(owner),customerCookie:await session(customer)};
}
async function boot(t,{app,path,cookie}){
  const html=readFileSync(new URL('../dist/client/kunde.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{url:origin+path,pretendToBeVisual:true});const w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};w.matchMedia??=()=>({matches:false});
  const ctx=new Proxy({},{get:(_target,key)=>key==='canvas'?null:()=>{},set:()=>true});w.HTMLCanvasElement.prototype.getContext=()=>ctx;w.HTMLCanvasElement.prototype.toDataURL=()=>signatureURL;w.Element.prototype.setPointerCapture=()=>{};
  let pending=0;const errors=[];
  const fetchImpl=async(url,options={})=>{const target=new URL(url,origin),live=Number(target.searchParams.get('wait')??0)>0;if(!live)pending++;try{const headers=new Headers(options.headers);headers.set('origin',origin);headers.set('cookie',cookie);const {signal:_signal,...rest}=options;return await app.fetch(new Request(target,{...rest,headers}));}finally{if(!live)pending--;}};
  for(const [key,value] of Object.entries({window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,AbortController:w.AbortController,matchMedia:w.matchMedia,fetch:fetchImpl}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});
  w.addEventListener('error',e=>errors.push(e.error??e.message));
  const settle=async()=>{for(let i=0;i<500;i++){await new Promise(r=>setTimeout(r,3));if(pending===0){await new Promise(r=>setTimeout(r,15));if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/kunde.js?load='+(++loads),import.meta.url).href);await settle();
  const $=s=>w.document.querySelector(s);
  const click=async target=>{const el=typeof target==='string'?$(target):target;assert.ok(el,'Element fehlt: '+target);el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();};
  return {w,$,click,settle,errors,text:()=>w.document.body.textContent};
}

test('customer portal shows status, appointment, services and books extras as a request',async t=>{
  const f=await setup(t);
  const shell=await f.app.fetch(new Request(origin+'/kunde',{headers:{cookie:f.customerCookie}}));assert.equal(shell.status,200);assert.match(await shell.text(),/kunde\.js/);
  const ui=await boot(t,{app:f.app,path:'/kunde',cookie:f.customerCookie});
  assert.equal(ui.$('.portal-hello').textContent,'Hallo Erika');
  assert.match(ui.$('.portal-hero h2').textContent,/verbindlich eingeplant/);
  assert.equal(ui.$('.portal-rail [aria-current="step"]').textContent.trim(),'Termin','current step is named, not only coloured');
  assert.match(ui.$('.portal-when').textContent,/14\. Oktober/);
  assert.match(ui.$('.portal-lines tfoot').textContent,/436,25/);
  assert.equal(ui.w.document.querySelectorAll('[style]').length,0,'no inline styles (CSP)');
  const extras=ui.$('[data-form="extras"]');assert.ok(extras);
  extras.querySelector('input[value="tierhaar"]').checked=true;extras.elements.note.value='Hund';
  extras.requestSubmit();await ui.settle();
  assert.match(ui.$('#toast').textContent,/ergänztes Angebot/);
  assert.match(ui.$('.portal-requests').textContent,/Tierhaarentfernung.*Angefragt/);
  const termin=ui.$('[data-form="termin"]');termin.elements.wish.value='Lieber vormittags';termin.requestSubmit();await ui.settle();
  assert.match(ui.text(),/Ihr Terminwunsch vom .* liegt uns vor/);
  await ui.click('[data-act="chat"]');
  assert.ok(ui.$('#portal-chat .chat'),'chat mounted inside the portal');
  assert.match(ui.$('#portal-chat').textContent,/Zusatzleistungen über das Kundenportal angefragt/);
  assert.deepEqual(ui.errors,[]);
});

test('customer sees the original inquiry and sends a traceable correction request',async t=>{
  const f=await setup(t);
  const ui=await boot(t,{app:f.app,path:'/kunde',cookie:f.customerCookie});
  assert.match(ui.$('.portal-inquiry').textContent,/Ihre Anfrage und Angaben/);
  assert.match(ui.$('.portal-inquiry').textContent,/FDS-WG 1/);
  assert.match(ui.$('.portal-inquiry').textContent,/VW Golf/);
  const form=ui.$('[data-form="angaben"]');assert.ok(form);
  form.elements.wish.value='Kennzeichen FDS-WG 2 statt FDS-WG 1';form.requestSubmit();await ui.settle();
  assert.match(ui.$('#toast').textContent,/Änderungswunsch/);
  assert.match(ui.$('.portal-inquiry .portal-requests').textContent,/Kennzeichen FDS-WG 2.*Angefragt/);
  assert.match(ui.$('.portal-inquiry').textContent,/FDS-WG 1/,'the displayed order data stays unchanged until operator review');
  await ui.click('[data-act="chat"]');
  assert.match(ui.$('#portal-chat').textContent,/Korrektur der Anfragedaten/);
  assert.deepEqual(ui.errors,[]);
});

test('owner preview shows the customer view with all actions disabled',async t=>{
  const f=await setup(t);
  const ui=await boot(t,{app:f.app,path:'/kunde?vorschau='+f.order.id,cookie:f.ownerCookie});
  assert.match(ui.$('.portal-preview').textContent,/Betreibervorschau/);
  assert.ok(ui.$('[data-act="chat"]').disabled);assert.ok(ui.$('[data-form="extras"] [type=submit]').disabled);
  assert.match(ui.$('.portal-hero h2').textContent,/verbindlich/);
});

test('business customer sees published net vehicle cards and can send a counted fleet enquiry',async t=>{
  const f=await setup(t),id=randomUUID(),vehicleId=randomUUID(),at=new Date().toISOString();
  await f.env.DB.prepare('INSERT INTO customers(id,data,search,synthetic,version,created_at,updated_at) VALUES(?,?,?,0,1,?,?)').bind(id,JSON.stringify({name:'Erika Muster',company:'Muster Fuhrpark',email:customer}),customer,at,at).run();
  await f.env.DB.prepare('INSERT INTO business_portal_access(customer_id,email,active,created_at,updated_at) VALUES(?,?,1,?,?)').bind(id,customer,at,at).run();
  await f.env.DB.prepare('INSERT INTO business_completed_vehicles(id,customer_id,title,plate,completed_on,net_price_minor,note,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?)').bind(vehicleId,id,'VW Transporter','FDS-WG 8','2026-10-17',25000,'Innen gereinigt',at,at).run();
  const ui=await boot(t,{app:f.app,path:'/kunde',cookie:f.customerCookie});
  await ui.click('[data-portal-section="business"]');
  assert.match(ui.$('.business-fleet-card').textContent,/250,00\s*€ netto/);
  assert.match(ui.$('.business-fleet-card').textContent,/VW Transporter/);
  const form=ui.$('[data-form="business-request"]');form.elements.count.value='4';form.elements.note.value='Transporter';form.requestSubmit();await ui.settle();
  assert.match(ui.$('.portal-requests').textContent,/4 Fahrzeuge/);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM business_vehicle_requests WHERE customer_id=?').bind(id).first()).n,1);
  assert.deepEqual(ui.errors,[]);
});

test('business-only customer lands in the firm area without an order',async t=>{
  const f=await setup(t),id=randomUUID(),at=new Date().toISOString();
  await f.env.DB.prepare("UPDATE orders SET version=version+1,data=json_set(data,'$.source.email','anderer@example.invalid') WHERE id=?").bind(f.order.id).run();
  await f.env.DB.prepare('INSERT INTO customers(id,data,search,synthetic,version,created_at,updated_at) VALUES(?,?,?,0,1,?,?)').bind(id,JSON.stringify({name:'Erika Muster',company:'Muster Fuhrpark',email:customer}),customer,at,at).run();
  await f.env.DB.prepare('INSERT INTO business_portal_access(customer_id,email,active,created_at,updated_at) VALUES(?,?,1,?,?)').bind(id,customer,at,at).run();
  const ui=await boot(t,{app:f.app,path:'/kunde',cookie:f.customerCookie});
  assert.ok(ui.$('.business-portal'),'firm area opens when there is no order');
  assert.equal(ui.$('[data-portal-section="business"]').getAttribute('aria-current'),'page');
  assert.match(ui.text(),/Fahrzeuge zur Reinigung melden/);assert.deepEqual(ui.errors,[]);
});

test('a foreign signed-in visitor gets an empty portal, an expired session is sent to the login',async t=>{
  const f=await setup(t);
  const raw=randomBytes(32).toString('hex');await f.env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),'fremd@example.invalid',Date.now()+3600000,Date.now()).run();
  const ui=await boot(t,{app:f.app,path:'/kunde',cookie:'__Host-wg-session='+raw});
  assert.match(ui.text(),/keinen aktiven Auftrag/);
  assert.ok(!ui.text().includes('Erika'));
});

test('free-text desired dates render and the preview opens the clicked order',async t=>{
  const f=await setup(t);
  const id=randomUUID(),data={id,wg:'WG-4712',status:'Preise prüfen',synthetic:false,source:{name:'Erika Muster',email:customer,vehicle:'Audi A4',desiredDate:'KW 42, vormittags'},notes:[],payments:[],createdAt:new Date(Date.now()-86400000).toISOString()};
  await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(id,data.wg,data.status,JSON.stringify(data),new Date(Date.now()-86400000).toISOString(),'test','fixture').run();
  const ui=await boot(t,{app:f.app,path:'/kunde?vorschau='+id,cookie:f.ownerCookie});
  assert.match(ui.$('.portal-hero').textContent,/Audi A4/,'preview opens the order it was started from');
  assert.match(ui.text(),/Ihr Wunschtermin: KW 42, vormittags/);
  assert.deepEqual(ui.errors,[]);
});

test('portal: proposed appointment is confirmed with a drawn signature',async t=>{
  const f=await setup(t);
  await f.env.DB.prepare("UPDATE orders SET status='Angenommen',version=version+1,data=json_set(data,'$.status','Angenommen') WHERE id=?").bind(f.order.id).run();
  const ui=await boot(t,{app:f.app,path:'/kunde',cookie:f.customerCookie});
  assert.match(ui.$('.portal-pending').textContent,/noch nicht bestätigt/);
  assert.ok(ui.$('.portal-todo a[href^="#termin-"]'),'todo links to the confirmation');
  const form=ui.$('[data-form="confirm"]');form.requestSubmit();await ui.settle();assert.match(form.querySelector('.error').textContent,/bestätigen/);
  form.elements.confirmed.checked=true;form.requestSubmit();await ui.settle();assert.match(ui.$('[data-form="confirm"] .error').textContent,/unterschreiben/);
  const canvas=ui.$('[data-form="confirm"] canvas');for(const type of ['pointerdown','pointermove','pointerup'])canvas.dispatchEvent(new ui.w.Event(type,{bubbles:true}));
  ui.$('[data-form="confirm"]').elements.confirmed.checked=true;ui.$('[data-form="confirm"]').requestSubmit();await ui.settle();
  assert.match(ui.$('#toast').textContent,/verbindlich bestätigt/);assert.match(ui.$('.portal-confirmed').textContent,/Verbindlich bestätigt/);
  assert.deepEqual(ui.errors,[]);
});

for(const failed of [false,true])test('a '+(failed?'failed':'late')+' chat response for the previous order cannot capture the newly selected order',async t=>{
  const f=await setup(t),secondId=randomUUID(),second={...structuredClone(f.order),id:secondId,wg:'WG-4712',source:{...f.order.source,vehicle:'Audi A4'},createdAt:new Date(Date.now()-86400000).toISOString()};
  await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(secondId,second.wg,second.status,JSON.stringify(second),second.createdAt,'test','fixture').run();
  const ui=await boot(t,{app:f.app,path:'/kunde#'+f.order.id,cookie:f.customerCookie}),fetchBefore=globalThis.fetch;
  let release;const gate=new Promise(resolve=>{release=resolve;});let firstCalls=0,secondCalls=0;
  globalThis.fetch=async(url,options={})=>{const path=new URL(url,origin).pathname;if(path==='/api/portal/o/'+f.order.id+'/chat'&&options.method==='POST'){firstCalls++;await gate;if(failed)return Response.json({error:'TEST · verspäteter Fehler zum vorherigen Auftrag'},{status:502});}if(path==='/api/portal/o/'+secondId+'/chat'&&options.method==='POST')secondCalls++;return fetchBefore(url,options);};
  t.after(()=>{globalThis.fetch=fetchBefore;});
  await ui.click('[data-act="chat"]');assert.equal(firstCalls,1);await ui.click('[data-order="'+secondId+'"]');assert.match(ui.$('.portal-hero').textContent,/Audi A4/);release();await ui.settle();
  assert.equal(ui.$('[data-act="chat"]').textContent,'Chat öffnen','the previous order cannot change the current chat button');assert.ok(!ui.$('#portal-chat .chat'),'no detached order conversation is reused');assert.ok(!ui.$('#toast').textContent.includes('vorherigen Auftrag'),'stale errors are not shown on another order');
  await ui.click('[data-act="chat"]');assert.equal(firstCalls,1);assert.equal(secondCalls,1,'current order opens exactly its own conversation');assert.ok(ui.$('#portal-chat .chat'));assert.equal(ui.$('#portal-chat').hidden,false);assert.deepEqual(ui.errors,[]);
  await ui.click('[data-order="'+f.order.id+'"]');
});

test('repeated taps while the customer chat opens send one request and mount one conversation',async t=>{
  const f=await setup(t),ui=await boot(t,{app:f.app,path:'/kunde',cookie:f.customerCookie}),fetchBefore=globalThis.fetch;
  let release;const gate=new Promise(resolve=>{release=resolve;});let calls=0;
  globalThis.fetch=async(url,options={})=>{if(new URL(url,origin).pathname==='/api/portal/o/'+f.order.id+'/chat'&&options.method==='POST'){calls++;await gate;}return fetchBefore(url,options);};t.after(()=>{globalThis.fetch=fetchBefore;});
  await ui.click('[data-act="chat"]');await ui.click('[data-act="chat"]');release();await ui.settle();assert.equal(calls,1,'a pending chat opening is shared instead of requested twice');assert.equal(ui.w.document.querySelectorAll('#portal-chat .chat').length,1);assert.deepEqual(ui.errors,[]);
});

test('a stale appointment form displays the conflict without confirming the newly changed date',async t=>{
  const f=await setup(t);await f.env.DB.prepare("UPDATE orders SET status='Angenommen',version=version+1,data=json_set(data,'$.status','Angenommen') WHERE id=?").bind(f.order.id).run();
  const ui=await boot(t,{app:f.app,path:'/kunde',cookie:f.customerCookie}),form=ui.$('[data-form="confirm"]'),canvas=form.querySelector('canvas');
  for(const type of ['pointerdown','pointermove','pointerup'])canvas.dispatchEvent(new ui.w.Event(type,{bubbles:true}));form.elements.confirmed.checked=true;
  await f.env.DB.prepare("UPDATE orders SET version=version+1,data=json_set(data,'$.appointment.start','2030-10-15T07:00:00.000Z','$.appointment.end','2030-10-15T13:00:00.000Z') WHERE id=?").bind(f.order.id).run();
  form.requestSubmit();await ui.settle();assert.match(form.querySelector('.error').textContent,/inzwischen geändert/);assert.equal(form.querySelector('[type=submit]').disabled,false);assert.equal(f.files.size,0);assert.equal((await f.env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(f.order.id).first()).status,'Angenommen');assert.deepEqual(ui.errors,[]);
});

test('customer portal renders issued invoice amounts, own PDF downloads and the completed review link',async t=>{
  const f=await setup(t),at=new Date().toISOString(),invoiceId=randomUUID(),assetId=randomUUID(),bytes=Buffer.from('%PDF-1.7\nTEST · cached customer invoice');
  const invoice={provider:'qonto',id:invoiceId,number:'WG-4711',status:'unpaid',issueDate:'2030-10-01',dueDate:'2030-10-08',totalCents:45625,vatBasisPoints:1900,mode:'invoice',lines:[{title:'Reinigung und vereinbarte Mehrarbeit',amountCents:45625}],payment:{beneficiary:'TEST · White Gloss',iban:'DE89370400440532013000'},url:'https://pay.qonto.com/invoices/synthetic'};
  const order={...f.order,status:'Erledigt',completedAt:at,invoice};await f.env.DB.prepare("UPDATE orders SET status='Erledigt',version=version+1,data=? WHERE id=?").bind(JSON.stringify(order),order.id).run();
  await f.env.BUCKET.put(assetId,bytes,{httpMetadata:{contentType:'application/pdf'}});await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(assetId,order.id,'invoice','application/pdf',digest(bytes),bytes.length,at).run();await f.env.DB.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?)').bind(order.id,invoiceId,assetId,at).run();await setting(f.env,'reviewUrl','https://g.page/r/white-gloss-test/review');
  const ui=await boot(t,{app:f.app,path:'/kunde',cookie:f.customerCookie});assert.match(ui.$('.portal-invoice').textContent,/456,25/);assert.match(ui.$('.portal-invoice').textContent,/Offen/);assert.match(ui.$('.portal-invoice').textContent,/DE89370400440532013000/);
  const pay=ui.$('.portal-invoice a[target="_blank"]');assert.equal(pay.href,invoice.url);assert.match(pay.rel,/noopener/);assert.match(pay.rel,/noreferrer/);
  const pdf=ui.$('.portal-invoice a[download]'),response=await f.app.fetch(new Request(new URL(pdf.getAttribute('href'),origin),{headers:{cookie:f.customerCookie}}));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const doc=ui.$('.portal-docs a');assert.ok(doc.hasAttribute('download'));assert.match(doc.textContent,/ohne Kundenunterschrift/);const confirmation=await f.app.fetch(new Request(new URL(doc.getAttribute('href'),origin),{headers:{cookie:f.customerCookie}}));assert.equal(confirmation.status,200);assert.equal(Buffer.from(await confirmation.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
  assert.equal(ui.$('.portal-review a').href,'https://g.page/r/white-gloss-test/review');assert.deepEqual(ui.errors,[]);
});
