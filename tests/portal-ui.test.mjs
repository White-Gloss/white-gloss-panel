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

const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='kundin@example.invalid';
let loads=0;
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
  return {env,app,order:data,ownerCookie:await session(owner),customerCookie:await session(customer)};
}
async function boot(t,{app,path,cookie}){
  const html=readFileSync(new URL('../dist/client/kunde.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{url:origin+path,pretendToBeVisual:true});const w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};w.matchMedia??=()=>({matches:false});
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

test('owner preview shows the customer view with all actions disabled',async t=>{
  const f=await setup(t);
  const ui=await boot(t,{app:f.app,path:'/kunde?vorschau='+f.order.id,cookie:f.ownerCookie});
  assert.match(ui.$('.portal-preview').textContent,/Betreibervorschau/);
  assert.ok(ui.$('[data-act="chat"]').disabled);assert.ok(ui.$('[data-form="extras"] [type=submit]').disabled);
  assert.match(ui.$('.portal-hero h2').textContent,/verbindlich/);
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
