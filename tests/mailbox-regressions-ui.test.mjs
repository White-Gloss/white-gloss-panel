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

const mail=(index,stamp)=>Buffer.from(`From: Absender ${index} <absender${index}@example.invalid>\r\nTo: ${owner}\r\nSubject: Sammel ${index}\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: ${new Date(stamp+index*60000).toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nText ${index}`);
test('bulk actions above 200 selected messages run in parts and reach every message',async t=>{
  const ui=await mount(t,{seed:async env=>{for(let index=0;index<205;index++)await ingestMessage(env,mail(index,Date.UTC(2026,8,1,8)),{folder:'INBOX',uid:index+1,uidValidity:'bulk'});}});
  await ui.click('.cc-rail [data-mail-folder="INBOX"]');for(let page=0;page<4;page++)await ui.click('[data-mail-more]');assert.equal(ui.$$('.cc-row[data-mail-open]').length,205);
  await ui.click('[data-mail-select-mode]');await ui.click('[data-mail-bulk="all"]');assert.match(ui.$('[data-region="bulk"]').textContent,/205 ausgewählt/);
  await ui.click('[data-mail-bulk="archive"]');assert.equal(ui.$$('.cc-row[data-mail-open]').length,0);
  const view=await (await ui.call('/api/mailbox?folder=Archive&limit=1')).json();assert.equal(view.total,205,'all 205 messages are archived');assert.equal(view.counts.INBOX.total,0);assert.deepEqual(ui.errors,[]);
});

test('moving a message while "all mail" is shown keeps it listed with its new folder',async t=>{
  let first;const ui=await mount(t,{seed:async(env,call)=>{first=(await ingestMessage(env,mail(1,Date.UTC(2026,8,2,8)),{folder:'INBOX',uid:1,uidValidity:'all'})).id;await ingestMessage(env,mail(2,Date.UTC(2026,8,2,8)),{folder:'INBOX',uid:2,uidValidity:'all'});await call('/api/mailbox/note',{body:'Rückruf vereinbart',messageId:first});}});
  await ui.click('.cc-rail [data-mail-notes]');await ui.click('[data-note-mail]');assert.equal(ui.$('[data-cc-title]').textContent,'Alle E-Mails');assert.equal(ui.$$('.cc-row[data-mail-open]').length,2);
  await ui.click('[data-mail-move-to="Archive"]');const rows=ui.$$('.cc-row[data-mail-open]');assert.equal(rows.length,2,'message stays in "all mail"');
  assert.match(rows.find(row=>row.dataset.mailOpen===first).textContent,/Archiv/);assert.ok(ui.$('.cc-reader [data-mail-reply]'),'reader stays open');assert.deepEqual(ui.errors,[]);
});

test('pinning a note keeps unsaved text in the quick note form',async t=>{
  const ui=await mount(t,{seed:async(env,call)=>{await call('/api/mailbox/note',{body:'Vorhandene Notiz'});}});
  await ui.click('.cc-rail [data-mail-notes]');const form=ui.$('#mail-note-form');form.elements.body.value='Noch nicht gespeichert';form.elements.body.dispatchEvent(new ui.w.Event('input',{bubbles:true}));
  await ui.click('[data-cc-note-pin]');assert.ok(ui.$('.cc-note.pinned'));assert.equal(ui.$('#mail-note-form').elements.body.value,'Noch nicht gespeichert');assert.deepEqual(ui.errors,[]);
});

// Browser überdecken Formular-Eigenschaften (id, action, submit …) mit gleichnamigen Feldern; jsdom tut das nicht.
// Ein Feld namens „id“ hat das Speichern von Notizen im echten Browser verhindert.
test('no communication center form has a control that shadows a built-in form property',async t=>{
  const ui=await mount(t,{seed:async(env,call)=>{await call('/api/mailbox/folder',{name:'Eigene'});}}),reserved=new Set(['id','action','method','submit','reset','elements','length','target','enctype','encoding','acceptCharset','noValidate','checkValidity','reportValidity','requestSubmit','matches','getAttribute','querySelector','dataset','className','tagName','nodeName','parentNode','children']);
  const names=new Set();const collect=()=>{for(const control of ui.$$('#mailbox-root form [name]'))names.add(control.getAttribute('name'));};
  collect();await ui.click('.cc-rail [data-mail-notes]');collect();await ui.click('.cc-rail [data-mail-compose]');await ui.click('[data-compose-show="cc"]');await ui.click('[data-compose-show="bcc"]');collect();await ui.click('[data-mail-compose-close]');await ui.click('[data-mail-settings]');collect();
  assert.ok(names.size>=15,'all forms were inspected');assert.deepEqual([...names].filter(name=>reserved.has(name)),[]);assert.deepEqual(ui.errors,[]);
});

test('operator can switch mailboxes and a reply selects the receiving account',async t=>{
  const secondary='admin@example.invalid';
  let accountId;
  const ui=await mount(t,{seed:async(env,call)=>{
    const added=await call('/api/mailbox/settings',{create:true,email:secondary,username:secondary,password:'synthetic-secondary',imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true});
    assert.equal(added.status,200);
    ({accountId}=await added.json());
    await ingestMessage(env,mail(1,Date.UTC(2026,8,2,8)),{uid:1,uidValidity:'multi'});
    await ingestMessage(env,mail(2,Date.UTC(2026,8,2,8)),{uid:1,uidValidity:'multi'},{accountId});
  }});
  await ui.click('.cc-rail [data-mail-folder="INBOX"]');
  assert.equal(ui.$$('.cc-row[data-mail-open]').length,2);
  const picker=ui.$('[data-mail-account]');
  picker.value=String(accountId);
  picker.dispatchEvent(new ui.w.Event('change',{bubbles:true}));
  await ui.settle();
  assert.equal(ui.$$('.cc-row[data-mail-open]').length,1);
  assert.match(ui.$('.cc-row[data-mail-open]').textContent,/Sammel 2/);
  await ui.click('.cc-row[data-mail-open]');
  await ui.click('[data-mail-reply]');
  assert.equal(ui.$('select[aria-label="Absenderpostfach"]').value,String(accountId));
  await ui.click('[data-mail-save-draft]');
  const view=await (await ui.call('/api/mailbox?accountId='+accountId)).json();
  assert.equal(view.drafts[0].accountId,accountId);
  assert.deepEqual(ui.errors,[]);
});
