// Postfach-UI mit echter Anwendung in jsdom; kein Website-Server und keine externe Verbindung.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestMessage} from '../server/mailbox.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';let loads=0;
test('operator mailbox opens plain text safely, exposes receipt link and keeps compose separate',async t=>{
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')}};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const pdf=Buffer.from('%PDF-1.7\nsynthetic UI mail receipt\n%%EOF').toString('base64'),boundary='synthetic-ui';
  const mime=Buffer.from(`From: Kunden Service <service@example.invalid>\r\nTo: ${owner}\r\nSubject: Beleg & Rückfrage\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGuten Tag,\n\n<img src=x onerror=alert(1)> bleibt reiner Text.\r\n--${boundary}\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="Beleg.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${pdf}\r\n--${boundary}--\r\n`);
  await ingestMessage(env,mime,{folder:'INBOX',uid:9,uidValidity:'3'});
  const cookie='__Host-wg-session='+raw,call=(path,body)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  const html=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,''),dom=new JSDOM(html,{url:origin,pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close??=function(){this.removeAttribute('open');};
  let pending=0;const errors=[];const fetchImpl=async(url,options={})=>{pending++;try{const headers=new Headers(options.headers);headers.set('origin',origin);headers.set('cookie',cookie);return await app.fetch(new Request(new URL(url,origin),{...options,headers}));}finally{pending--;}};
  for(const [key,value] of Object.entries({window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});w.addEventListener('error',event=>errors.push(event.error??event.message));
  const settle=async()=>{for(let i=0;i<500;i++){await new Promise(resolve=>setTimeout(resolve,3));if(pending===0){await new Promise(resolve=>setTimeout(resolve,15));if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/app.js?mailbox-load='+(++loads),import.meta.url).href);await settle();
  const $=selector=>w.document.querySelector(selector),click=async selector=>{const element=$(selector);assert.ok(element,'Element fehlt: '+selector);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();};
  await click('.sidebar [data-view="mailbox"]');assert.match($('#mailbox-root').textContent,/Beleg & Rückfrage/);assert.ok($('#mailbox-compose'));
  await click('[data-mail-open]');assert.match($('#mailbox-root').textContent,/bleibt reiner Text/);assert.equal($('#mailbox-root img'),null);assert.match($('#mailbox-root').textContent,/Beleg\.pdf/);assert.ok($('[data-mail-reply]'));
  const accounting=await (await call('/api/accounting')).json();assert.equal(accounting.documents[0].source,'EMAIL');assert.deepEqual(errors,[]);
});
