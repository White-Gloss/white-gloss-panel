// Kanzleioberfläche ohne lokalen Webserver: echte Anwendung und echte Sitzung in jsdom.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
let loads=0;
async function boot(t,path){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,3).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async get(){return null;}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());const app=await createApplication(env);
  const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const id=randomUUID(),bytes=Buffer.from('%PDF-1.7\nSynthetic receipt only\n%%EOF');await env.DB.prepare('INSERT INTO accounting_documents VALUES(?,?,?,?,?,?,?,?)').bind(id,0,'Beleg.pdf','application/pdf',digest(bytes),bytes.length,'2026-10-18T10:00:00.000Z','PANEL').run();
  const html=readFileSync(new URL('../dist/client/advisor.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,''),dom=new JSDOM(html,{url:origin+path,pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};
  const fetchImpl=async(url,options={})=>{const headers=new Headers(options.headers);headers.set('cookie','__Host-wg-session='+raw);headers.set('origin',origin);return app.fetch(new Request(new URL(url,origin),{...options,headers}));};
  const globals={window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl};
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});
  await import(new URL('../dist/client/advisor.js?load='+(++loads),import.meta.url).href);
  for(let i=0;i<100&&!w.document.querySelector('[data-form="export"],[data-form="account"]');i++)await new Promise(resolve=>setTimeout(resolve,10));
  return w.document;
}

test('owner advisor preview is read-only and offers real XLSX export',async t=>{
  const document=await boot(t,'/kanzlei?ansicht=kanzlei');
  assert.match(document.body.textContent,/Lesende Steuerberateransicht/);assert.match(document.body.textContent,/Beleg\.pdf/);
  assert.equal(document.querySelector('[data-tab="documents"]').getAttribute('aria-pressed'),'true');assert.equal(document.querySelector('[data-tab="accounts"]'),null);
  assert.equal(document.querySelector('[data-form="proposal"]'),null);assert.equal(document.querySelector('[data-form="comment"]'),null);assert.equal(document.querySelector('[data-decision]'),null);
  assert.ok(document.querySelector('[data-form="export"] select[name="format"] option[value="xlsx"]'));
});

test('normal owner advisor route keeps account administration',async t=>{
  const document=await boot(t,'/kanzlei');assert.ok(document.querySelector('[data-tab="accounts"]'));assert.ok(document.querySelector('[data-form="account"]'));
});
