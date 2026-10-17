// Built operator UI with the real application in-process; no website server is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';let loads=0;
async function setup(t){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,8).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')}};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const cookie='__Host-wg-session='+raw;
  const call=(path,body,mime='application/json')=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie,...(body===undefined?{}:{'Content-Type':mime})},body:body===undefined?undefined:mime==='application/json'?JSON.stringify(body):body}));
  const html=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,'');const dom=new JSDOM(html,{url:origin,pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close??=function(){this.removeAttribute('open');};
  let pending=0;const errors=[];const fetchImpl=async(url,options={})=>{pending++;try{const headers=new Headers(options.headers);headers.set('origin',origin);headers.set('cookie',cookie);return await app.fetch(new Request(new URL(url,origin),{...options,headers}));}finally{pending--;}};
  for(const [key,value] of Object.entries({window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});w.addEventListener('error',event=>errors.push(event.error??event.message));
  const settle=async()=>{for(let i=0;i<500;i++){await new Promise(resolve=>setTimeout(resolve,3));if(pending===0){await new Promise(resolve=>setTimeout(resolve,15));if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/app.js?load='+(++loads),import.meta.url).href);await settle();
  const $=selector=>w.document.querySelector(selector),click=async selector=>{const element=$(selector);assert.ok(element,'Element fehlt: '+selector);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();};
  return {env,call,w,$,click,settle,errors};
}

test('operator B2B section publishes net vehicle card without touching the existing order flow',async t=>{
  const ui=await setup(t),id=randomUUID(),at=new Date().toISOString();
  await ui.env.DB.prepare('INSERT INTO customers(id,data,search,synthetic,version,created_at,updated_at) VALUES(?,?,?,0,1,?,?)').bind(id,JSON.stringify({name:'Test Kontakt',company:'Fuhrpark GmbH',email:'fleet@example.invalid'}),'fuhrpark',at,at).run();
  await ui.click('.sidebar [data-view="business"]');assert.match(ui.$('#business-root').textContent,/Fuhrpark GmbH/);
  await ui.click('[data-business-action="access"]');assert.match(ui.$('#business-root').textContent,/Portal aktiv/);
  const form=ui.$('#business-vehicle-form');form.elements.title.value='VW Transporter';form.elements.plate.value='FDS-WG 8';form.elements.completedOn.value='2026-10-17';form.elements.netPrice.value='250,00';form.requestSubmit();await ui.settle();
  assert.match(ui.$('.business-vehicle').textContent,/250,00\s*€ netto/);await ui.click('[data-business-action="publish"]');assert.match(ui.$('.business-vehicle').textContent,/Für Kunden sichtbar/);
  assert.equal((await ui.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);assert.deepEqual(ui.errors,[]);
});

test('operator finance section reviews an uploaded receipt and saves a manual draft',async t=>{
  const ui=await setup(t),pdf=Buffer.from('%PDF-1.7\nsynthetic UI receipt\n%%EOF');const uploaded=await (await ui.call('/api/accounting/document?name=Reiniger.pdf',pdf,'application/pdf')).json();
  await ui.click('.sidebar [data-view="finance"]');assert.match(ui.$('#accounting-root').textContent,/Reiniger.pdf/);
  const form=ui.$('[data-accounting-classify]');assert.ok(form);form.elements.category.value='CLEANING_SUPPLIES';form.elements.paymentPath.value='QONTO_CARD';form.elements.amount.value='119,00';form.elements.partner.value='Testlieferant';form.requestSubmit();await ui.settle();
  assert.equal((await ui.env.DB.prepare('SELECT category FROM accounting_classifications WHERE document_id=?').bind(uploaded.id).first()).category,'CLEANING_SUPPLIES');
  assert.match(ui.$('#accounting-root').textContent,/Zuordnungsentwurf/);assert.deepEqual(ui.errors,[]);
});

test('operator finance section distinguishes a customer receipt from an owner private contribution',async t=>{
  const ui=await setup(t),id=randomUUID(),org=randomUUID();
  await ui.env.DB.prepare(`INSERT INTO accounting_bank_revisions(organization_id,account_iban,provider_id,sha256,status,side,amount_minor,currency,label,reference,settled_at,provider_updated_at,raw_json,received_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(org,'DE89370400440532013000',id,'a'.repeat(64),'completed','credit',10000,'EUR','Privatkunde Muster','WG-4711','2026-10-17T11:00:00.000Z','2026-10-17T11:00:00.000Z','{}','2026-10-17T11:00:00.000Z').run();
  await ui.click('.sidebar [data-view="finance"]');const form=ui.$('[data-bank-classify]');assert.ok(form);assert.match(ui.$('.accounting-bank-row').textContent,/100,00\s*€/);
  assert.match(form.elements.category.textContent,/Dienstleistung · Privatkunde/);assert.match(form.elements.category.textContent,/Privateinlage des Inhabers/);
  form.elements.category.value='SERVICE_B2C';form.elements.note.value='Kundenleistung';form.requestSubmit();await ui.settle();
  assert.match(ui.$('.accounting-bank-row summary').textContent,/Dienstleistung · Privatkunde/);
  assert.equal((await ui.env.DB.prepare('SELECT category FROM accounting_bank_classifications').first()).category,'SERVICE_B2C');assert.deepEqual(ui.errors,[]);
});
