// E-Mails vollständig anzeigen: Bilder, Fotos, klickbare Links, Neuaufbereitung älterer Nachrichten,
// Communication Center im Menü und in der mobilen Leiste. Synthetische Daten, kein Server, kein echtes Postfach.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestMessage} from '../server/mailbox.mjs';
import {linkify} from '../public/mailbox.js';

const origin='https://panel.example.invalid',owner='owner@example.invalid',pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const JPEG=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(60,7),Buffer.from([0xff,0xd9])]);
const PNG=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(40,3)]);
async function fixture(t,mailbox={}){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,41).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')},MAILBOX_ADAPTERS:mailbox};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const cookie='__Host-wg-session='+raw,call=(path,body)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  return {env,app,call,cookie,files};
}
async function account(f){await f.call('/api/mailbox/settings',{email:owner,imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true,username:owner,password:'synthetic-secret'});assert.equal((await f.call('/api/mailbox/check',{kind:'imap'})).status,200);}
// Nachricht wie vor dem Communication Center gespeichert: Links und externe Bilder wurden beim Empfang entfernt.
async function oldMessage(f,{uid=7,html='<p>Angebot <a>hier</a></p><img>',text='Angebot hier'}={}){
  const id=randomUUID(),at='2026-10-20T10:00:00.000Z';
  await f.env.DB.prepare(`INSERT INTO mail_messages(id,dedupe_key,synthetic,direction,folder,uid,uid_validity,message_id_hash,from_name,from_address,to_json,subject,text_body,html_body,received_at,imported_at)
    VALUES(?,?,0,'INBOUND','INBOX',?,'old',NULL,'Lieferant','lieferant@example.invalid',?,?,?,?,?,?)`).bind(id,'INBOUND:1:INBOX:old:'+uid,uid,JSON.stringify([{name:'',address:owner}]),'Herbstangebot',text,html,at,at).run();
  return id;
}
const original=Buffer.from(`From: Lieferant <lieferant@example.invalid>\r\nTo: ${owner}\r\nCc: kollege@example.invalid\r\nReply-To: angebote@example.invalid\r\nSubject: Herbstangebot\r\nMessage-ID: <herbst-original@example.invalid>\r\nDate: Tue, 20 Oct 2026 12:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Angebot <a href="https://shop.example.invalid/herbst">hier</a></p><img src="https://cdn.example.invalid/produkt.jpg"><script>alert(1)</script>\r\n`);

test('plain text links become clickable without allowing script or unsafe schemes',()=>{
  assert.equal(linkify('Infos: https://white-gloss.example/angebot. Danke'),'Infos: <a href="https://white-gloss.example/angebot" target="_blank" rel="noopener noreferrer">https://white-gloss.example/angebot</a>. Danke');
  assert.match(linkify('Siehe www.example.invalid/x und mail an info@example.invalid'),/href="https:\/\/www\.example\.invalid\/x".*href="mailto:info@example\.invalid"/);
  assert.equal(linkify('<script>alert(1)</script> javascript:alert(1)'),'&lt;script&gt;alert(1)&lt;/script&gt; javascript:alert(1)');
  assert.doesNotMatch(linkify('https://x.example.invalid/"onmouseover=alert(1)'),/"onmouseover/);
});

test('older messages are restored once from the mailbox with links, images, Cc and threading headers',async t=>{
  let fetches=0;const f=await fixture(t,{async verifyImap(){},async fetchSource(config,locator){fetches++;assert.deepEqual(locator,{folder:'INBOX',uid:7,uidValidity:'old'});return original;}});await account(f);
  const id=await oldMessage(f),detail=await (await f.call('/api/mailbox/message/'+id)).json();
  assert.equal(detail.message.restored,true);assert.match(detail.message.htmlBody,/href="https:\/\/shop\.example\.invalid\/herbst"/);assert.doesNotMatch(detail.message.htmlBody,/<script/);
  assert.deepEqual(detail.message.cc.map(item=>item.address),['kollege@example.invalid']);assert.deepEqual(detail.message.replyTo.map(item=>item.address),['angebote@example.invalid']);assert.equal(detail.message.threadable,true);
  const withImages=await (await f.call(`/api/mailbox/message/${id}/view?images=1`)).text();assert.match(withImages,/cdn\.example\.invalid\/produkt\.jpg/);assert.match(withImages,/shop\.example\.invalid\/herbst/);
  await f.call('/api/mailbox/message/'+id);assert.equal(fetches,1,'the mailbox is read only once');
  const stored=await f.env.DB.prepare('SELECT html_body FROM mail_messages WHERE id=?').bind(id).first();assert.equal(stored.html_body,'<p>Angebot <a>hier</a></p><img>','the original evidence stays unchanged');
});

test('a failed restore keeps the stored display, reports the reason and does not retry immediately',async t=>{
  let fetches=0;const f=await fixture(t,{async verifyImap(){},async fetchSource(){fetches++;throw Error('synthetic imap down');}});await account(f);
  const id=await oldMessage(f,{uid:8}),detail=await (await f.call('/api/mailbox/message/'+id)).json();
  assert.equal(detail.message.restored,false);assert.match(detail.message.restoreError,/Error|imap/i);assert.match(detail.message.htmlBody,/Angebot/);
  await f.call('/api/mailbox/message/'+id);assert.equal(fetches,1);
  const fresh=await ingestMessage(f.env,original,{folder:'INBOX',uid:99,uidValidity:'new'});await f.call('/api/mailbox/message/'+fresh.id);assert.equal(fetches,1,'new messages never need a restore');
});

test('photo attachments are listed for the gallery while embedded signature images stay inline',async t=>{
  const f=await fixture(t),boundary='display-boundary',related='display-related';
  const mime=Buffer.from(`From: Kunde <kunde@example.invalid>\r\nTo: ${owner}\r\nSubject: Fotos vom Fahrzeug\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Tue, 20 Oct 2026 12:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: multipart/related; boundary="${related}"\r\n\r\n--${related}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hier die Fotos</p><img src="cid:logo@example.invalid">\r\n--${related}\r\nContent-Type: image/png\r\nContent-ID: <logo@example.invalid>\r\nContent-Disposition: inline; filename="logo.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n${PNG.toString('base64')}\r\n--${related}--\r\n--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Disposition: attachment; filename="Kotfluegel.jpg"\r\nContent-Transfer-Encoding: base64\r\n\r\n${JPEG.toString('base64')}\r\n--${boundary}--\r\n`);
  const message=await ingestMessage(f.env,mime,{folder:'INBOX',uid:3,uidValidity:'photos'});const detail=await (await f.call('/api/mailbox/message/'+message.id)).json();
  const byName=Object.fromEntries(detail.attachments.map(item=>[item.filename,item]));assert.equal(byName['logo.png'].inline,true);assert.equal(byName['Kotfluegel.jpg'].inline,false);assert.equal(byName['Kotfluegel.jpg'].archived,true);
  const photo=await f.call('/api/mailbox/attachment/'+byName['Kotfluegel.jpg'].id);assert.equal(photo.status,200);assert.equal(photo.headers.get('content-type'),'image/jpeg');
  assert.match(detail.message.htmlBody,/data:image\/png;base64,/,'embedded logo is shown inside the message');
  const summary=await (await f.call('/api/mailbox/summary')).json();assert.deepEqual(summary,{unread:1,inboxUnread:1});
});

async function boot(t,f){
  const html=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,''),dom=new JSDOM(html,{url:origin,pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};
  let pending=0;const errors=[],requests=[],fetchImpl=async(url,options={})=>{pending++;try{requests.push(String(url));const headers=new Headers(options.headers);headers.set('origin',origin);headers.set('cookie',f.cookie);return await f.app.fetch(new Request(new URL(url,origin),{...options,headers}));}finally{pending--;}};
  for(const [key,value] of Object.entries({window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl,crypto:globalThis.crypto}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});w.addEventListener('error',event=>errors.push(event.error??event.message));
  const settle=async()=>{for(let i=0;i<500;i++){await pause(3);if(pending===0){await pause(15);if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/app.js?mailbox-display='+randomUUID(),import.meta.url).href);await settle();
  const $=selector=>w.document.querySelector(selector),click=async selector=>{const element=typeof selector==='string'?$(selector):selector;assert.ok(element,'Element fehlt: '+selector);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();};
  return {w,$,click,settle,errors,requests};
}

test('communication center sits alone at the top of the menu and in the mobile bar with an unread count',async t=>{
  const f=await fixture(t);await ingestMessage(f.env,original,{folder:'INBOX',uid:1,uidValidity:'menu'});const ui=await boot(t,f);
  const first=ui.$('.sidebar [data-view]');assert.equal(first.dataset.view,'mailbox');assert.ok(first.closest('.nav-primary'));assert.equal(ui.$('.sidebar .navgroup').compareDocumentPosition(first)&ui.w.Node.DOCUMENT_POSITION_PRECEDING,ui.w.Node.DOCUMENT_POSITION_PRECEDING,'above every group');
  assert.ok(ui.$('.mobile-dock [data-view="mailbox"]'));assert.ok(ui.requests.some(url=>url.includes('/api/mailbox/summary')));
  for(const badge of ui.w.document.querySelectorAll('[data-mail-count]')){assert.equal(badge.hidden,false);assert.equal(badge.textContent,'1');}
  await ui.click('.mobile-dock [data-view="mailbox"]');assert.match(ui.$('#mailbox-root').textContent,/COMMUNICATION CENTER/);assert.equal(ui.$('.mobile-dock [data-view="mailbox"]').getAttribute('aria-current'),'page');
  await ui.click('.cc-rail [data-mail-folder="INBOX"]');await ui.click('.cc-row[data-mail-open]');for(const badge of ui.w.document.querySelectorAll('[data-mail-count]'))assert.equal(badge.hidden,true,'reading clears the count');
  assert.deepEqual(ui.errors,[]);
});

test('mails show images by default, can hide them per message or per device, and plain text links are clickable',async t=>{
  const f=await fixture(t);await ingestMessage(f.env,original,{folder:'INBOX',uid:1,uidValidity:'images'});
  await ingestMessage(f.env,Buffer.from(`From: Kunde <kunde@example.invalid>\r\nTo: ${owner}\r\nSubject: Link zum Termin\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Mon, 19 Oct 2026 12:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBitte hier bestätigen: https://termin.example.invalid/abc`),{folder:'INBOX',uid:2,uidValidity:'images'});
  const ui=await boot(t,f);await ui.click('.sidebar [data-view="mailbox"]');await ui.click('.cc-rail [data-mail-folder="INBOX"]');
  const row=subject=>[...ui.w.document.querySelectorAll('.cc-row[data-mail-open]')].find(item=>item.textContent.includes(subject));
  await ui.click(row('Herbstangebot'));assert.match(ui.$('[data-mail-frame]').getAttribute('src'),/images=1/);assert.equal(ui.$('.cc-images-blocked'),null);
  await ui.click('[data-mail-images-toggle]');assert.match(ui.$('[data-mail-frame]').getAttribute('src'),/images=0/);assert.ok(ui.$('.cc-images-blocked'));
  await ui.click('[data-mail-images]');assert.match(ui.$('[data-mail-frame]').getAttribute('src'),/images=1/);
  await ui.click('[data-mail-settings]');const toggle=ui.$('[data-cc-images-auto]');assert.equal(toggle.checked,true);toggle.checked=false;toggle.dispatchEvent(new ui.w.Event('change',{bubbles:true}));await ui.settle();
  assert.equal(ui.w.localStorage.getItem('wg-cc-images'),'off');assert.match(ui.$('[data-mail-frame]').getAttribute('src'),/images=0/);await ui.click('[data-mail-settings-close]');
  await ui.click(row('Link zum Termin'));const link=ui.$('.cc-plaintext a');assert.equal(link.getAttribute('href'),'https://termin.example.invalid/abc');assert.equal(link.getAttribute('rel'),'noopener noreferrer');assert.equal(link.getAttribute('target'),'_blank');
  assert.deepEqual(ui.errors,[]);
});
