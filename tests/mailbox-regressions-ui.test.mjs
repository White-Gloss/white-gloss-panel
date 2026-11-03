// Regressionen des Communication Centers in jsdom: Paging in „Ungelesen“, Zitatgrenze in Entwürfen.
// Echte Anwendung im Prozess, synthetische Daten; kein Website-Server, keine externe Verbindung.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestMessage} from '../server/mailbox.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function mount(t,{seed=async()=>{},analyses=[]}={}){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,31).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')},ASSISTANT_ADAPTERS:{async check(){},async analyze(config,payload){analyses.push(payload);return {id:'regression',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({correctedText:'Korrigierte Antwort.',changes:[],note:''})}]}]};}}};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const cookie='__Host-wg-session='+raw,call=(path,body)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  await call('/api/mailbox/settings',{email:owner,imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true,username:owner,password:'synthetic-secret'});
  await seed(env,call);
  const html=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,''),dom=new JSDOM(html,{url:origin,pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close??=function(){this.removeAttribute('open');};
  let pending=0;const errors=[],fetchImpl=async(url,options={})=>{pending++;try{const headers=new Headers(options.headers);headers.set('origin',origin);headers.set('cookie',cookie);return await app.fetch(new Request(new URL(url,origin),{...options,headers}));}finally{pending--;}};
  for(const [key,value] of Object.entries({window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl,crypto:globalThis.crypto}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});w.addEventListener('error',event=>errors.push(event.error??event.message));
  const settle=async()=>{for(let i=0;i<800;i++){await pause(3);if(pending===0){await pause(15);if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/app.js?mailbox-regressions='+randomUUID(),import.meta.url).href);await settle();
  const $=selector=>w.document.querySelector(selector),$$=selector=>[...w.document.querySelectorAll(selector)];
  const click=async selector=>{const element=typeof selector==='string'?$(selector):selector;assert.ok(element,'Element fehlt: '+selector);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();};
  await click('.sidebar [data-view="mailbox"]');return {w,$,$$,click,settle,call,errors};
}

test('reading mail in the unread view never skips unread messages when loading the next page',async t=>{
  const ui=await mount(t,{seed:async env=>{for(let index=0;index<55;index++)await ingestMessage(env,Buffer.from(`From: Kunde ${index} <kunde${index}@example.invalid>\r\nTo: ${owner}\r\nSubject: Anfrage ${index}\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: ${new Date(Date.UTC(2026,9,1,8,index)).toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nText ${index}`),{folder:'INBOX',uid:index+1,uidValidity:'paging'});}});
  await ui.click('.cc-rail [data-mail-folder="Unread"]');assert.equal(ui.$$('.cc-row[data-mail-open]').length,50);
  for(let index=0;index<3;index++)await ui.click(ui.$$('.cc-row[data-mail-open]')[index]);
  assert.equal(ui.$$('.cc-row.unread').length,47,'read mail stays visible until the view is reloaded');
  await ui.click('[data-mail-more]');const ids=ui.$$('.cc-row[data-mail-open]').map(row=>row.dataset.mailOpen);
  assert.equal(ids.length,55,'all 55 messages are reachable');assert.equal(new Set(ids).size,55,'no message appears twice');assert.equal(ui.$('[data-mail-more]'),null);assert.deepEqual(ui.errors,[]);
});

test('a reopened reply draft keeps the quoted original out of the grammar correction',async t=>{
  const analyses=[];let messageId;
  const ui=await mount(t,{analyses,seed:async(env,call)=>{messageId=(await ingestMessage(env,Buffer.from(`From: Erika <erika@example.invalid>\r\nTo: ${owner}\r\nSubject: Termin\r\nMessage-ID: <quote-root@example.invalid>\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOriginaltext der Kundin bleibt unverändert.`),{folder:'INBOX',uid:1,uidValidity:'quote'})).id;await call('/api/assistant/settings',{apiKey:'synthetic-key',model:'synthetic-model',dataApproved:true});assert.equal((await call('/api/assistant/check',{})).status,200);}});
  await ui.click('.cc-rail [data-mail-folder="INBOX"]');await ui.click('.cc-row[data-mail-open]');await ui.click('[data-mail-reply]');
  let editor=ui.$('[data-compose-editor]');editor.firstElementChild.textContent='Gerne bestätige ich den Termn.';editor.dispatchEvent(new ui.w.Event('input',{bubbles:true}));
  await ui.click('[data-mail-save-draft]');const drafts=(await (await ui.call('/api/mailbox')).json()).drafts;assert.equal(drafts.length,1);assert.equal(drafts[0].replyTo,messageId);assert.doesNotMatch(drafts[0].html,/data-cc-quote/,'internal marker is not stored or sent');
  await ui.click('[data-mail-draft]');editor=ui.$('[data-compose-editor]');assert.ok(editor.querySelector('[data-cc-quote] blockquote'),'quote boundary is restored');
  await ui.click('.cc-compose [data-assistant-start]');const dialog=ui.$('dialog.assistant-confirm');assert.ok(dialog,'confirmation dialog');dialog.querySelector('[name="confirmed"]').checked=true;dialog.querySelector('form').dispatchEvent(new ui.w.Event('submit',{bubbles:true,cancelable:true}));await ui.settle();
  assert.equal(analyses.length,1);const sent=analyses[0].input[0].content.map(part=>part.text??'').join('\n');assert.match(sent,/Termn/);assert.doesNotMatch(sent,/Originaltext der Kundin/,'quoted original is not sent for correction');
  await ui.click('.cc-compose [data-assistant-apply]');editor=ui.$('[data-compose-editor]');assert.match(editor.textContent,/Korrigierte Antwort\./);assert.match(editor.querySelector('[data-cc-quote]').textContent,/Originaltext der Kundin bleibt unverändert\./,'quote survives the correction');assert.deepEqual(ui.errors,[]);
});
