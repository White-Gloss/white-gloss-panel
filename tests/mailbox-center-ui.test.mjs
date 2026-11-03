// Communication Center in jsdom mit echter Anwendung; kein Website-Server, keine externe Verbindung.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {ingestMessage} from '../server/mailbox.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('communication center covers start view, mail workflow, CRM context, calendar, orders, notes and editable AI replies',async t=>{
  const files=new Map(),analyses=[];const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,12).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')},ASSISTANT_ADAPTERS:{async check(){},async analyze(config,payload){analyses.push(payload);return {id:'ui-reply',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({correctedText:'Guten Tag, vielen Dank für Ihre Anfrage. Wir melden uns mit einem Terminvorschlag.',changes:[],note:'Entwurf'})}]}]};}}};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const mime=Buffer.from(`From: Erika Beispiel <erika@example.invalid>\r\nTo: ${owner}\r\nCc: partner@example.invalid\r\nSubject: Fahrzeugpflege am Freitag\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGuten Tag, ich bitte um einen Termin.`);await ingestMessage(env,mime,{folder:'INBOX',uid:11,uidValidity:'ui-center'});
  const second=Buffer.from(`From: Lieferant <lieferant@example.invalid>\r\nTo: ${owner}\r\nSubject: Politur nachbestellt\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Fri, 16 Oct 2026 09:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nDie Ware kommt am Montag.`);await ingestMessage(env,second,{folder:'INBOX',uid:12,uidValidity:'ui-center'});
  const at=new Date().toISOString(),start=new Date(Date.now()+26*3600000);start.setUTCMinutes(0,0,0);const orderId=randomUUID();
  const order={id:orderId,wg:'WG-CC-1',version:1,synthetic:false,status:'In Arbeit',source:{name:'Erika Beispiel',email:'erika@example.invalid',vehicle:'VW Golf',plate:'FDS-WG 1',phone:''},appointment:{start:start.toISOString(),end:new Date(start.getTime()+2*3600000).toISOString(),duration:120},notes:[],payments:[]};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(orderId,order.wg,order.status,JSON.stringify(order),at,'test','fixture').run();
  const cookie='__Host-wg-session='+raw,call=(path,body)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  await call('/api/assistant/settings',{apiKey:'synthetic-ui-key',model:'synthetic-ui-model',dataApproved:true});assert.equal((await call('/api/assistant/check',{})).status,200);
  await call('/api/mailbox/settings',{email:owner,imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true,username:owner,password:'synthetic-secret'});
  const html=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,''),dom=new JSDOM(html,{url:origin,pretendToBeVisual:true}),w=dom.window;
  assert.match(html,/communication\.css/,'stylesheet is linked');
  w.Element.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close??=function(){this.removeAttribute('open');};
  let pending=0;const errors=[],fetchImpl=async(url,options={})=>{pending++;try{const headers=new Headers(options.headers);headers.set('origin',origin);headers.set('cookie',cookie);return await app.fetch(new Request(new URL(url,origin),{...options,headers}));}finally{pending--;}};
  for(const [key,value] of Object.entries({window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl,crypto:globalThis.crypto}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});w.addEventListener('error',event=>errors.push(event.error??event.message));
  const settle=async()=>{for(let i=0;i<500;i++){await pause(3);if(pending===0){await pause(15);if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/app.js?mailbox-center-ui='+randomUUID(),import.meta.url).href);await settle();
  const $=selector=>w.document.querySelector(selector),text=()=>$('#mailbox-root').textContent;
  const click=async selector=>{const element=typeof selector==='string'?$(selector):selector;assert.ok(element,'Element fehlt: '+selector);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();};
  const submit=async selector=>{const form=$(selector);assert.ok(form,'Formular fehlt: '+selector);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await settle();};
  const type=async(selector,value)=>{const input=$(selector);assert.ok(input,'Feld fehlt: '+selector);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));await pause(320);await settle();};

  // Startseite des Communication Centers
  assert.ok([...w.document.querySelectorAll('.sidebar [data-view="mailbox"]')].some(item=>/Communication Center/.test(item.textContent)));
  await click('.sidebar [data-view="mailbox"]');assert.match(text(),/COMMUNICATION CENTER/);assert.match(text(),/Ungelesene E-Mails/);assert.match(text(),/Fahrzeugpflege am Freitag/);
  assert.match($('.cc-kpi').textContent,/Ungelesen\s*2/);assert.ok($('.cc-rail [data-cc-section="orders"]'),'Laufende Aufträge in der linken Navigation');assert.ok($('.cc-rail [data-cc-section="calendar"]'));assert.ok($('.cc-rail [data-mail-notes]'));
  assert.match($('.cc-rail [data-cc-section="orders"]').textContent,/Laufende Aufträge\s*1/);

  // Posteingang, Suche, Filter
  await click('.cc-rail [data-mail-folder="INBOX"]');assert.equal(w.document.querySelectorAll('.cc-row[data-mail-open]').length,2);assert.equal(w.document.querySelectorAll('.cc-row.unread').length,2);
  assert.match($('.cc-rail [data-mail-folder="INBOX"]').textContent,/Posteingang\s*2/);
  const erikaRow=[...w.document.querySelectorAll('.cc-row[data-mail-open]')].find(row=>/Fahrzeugpflege/.test(row.textContent));assert.match(erikaRow.textContent,/WG-CC-1/,'CRM-Bezug in der Liste');
  await type('[data-mail-search]','kein-treffer');assert.match(text(),/Keine E-Mails gefunden/);
  await type('[data-mail-search]','politur');assert.equal(w.document.querySelectorAll('.cc-row[data-mail-open]').length,1);assert.match(text(),/Politur nachbestellt/);
  await type('[data-mail-search]','');assert.equal(w.document.querySelectorAll('.cc-row[data-mail-open]').length,2);
  await click('[data-mail-filter="crm"]');assert.equal(w.document.querySelectorAll('.cc-row[data-mail-open]').length,1);await click('[data-mail-filter="all"]');

  // Lesen, CRM-Kontext, Lesestatus
  await click([...w.document.querySelectorAll('.cc-row[data-mail-open]')].find(row=>/Fahrzeugpflege/.test(row.textContent)));
  assert.match($('.cc-reader').textContent,/Ich bitte um einen Termin|ich bitte um einen Termin/);assert.match($('.cc-crm').textContent,/WG-CC-1/);assert.match($('.cc-recipients').textContent,/partner@example\.invalid/);
  assert.equal(w.document.querySelectorAll('.cc-row.unread').length,1);assert.match($('.cc-rail [data-mail-folder="INBOX"]').textContent,/Posteingang\s*1/);
  await click('[data-mail-filter="unread"]');assert.equal(w.document.querySelectorAll('.cc-row[data-mail-open]').length,1);assert.match($('.cc-items').textContent,/Politur/);await click('[data-mail-filter="all"]');

  // Allen antworten übernimmt Cc ohne eigene Adresse und zitiert das Original
  await click('[data-mail-reply-all]');let form=$('#mailbox-compose');assert.equal(form.elements.to.value,'erika@example.invalid');assert.equal(form.elements.cc.value,'partner@example.invalid');assert.match(form.elements.subject.value,/^Re: Fahrzeugpflege/);assert.ok($('[data-compose-editor] blockquote'),'Original wird zitiert');
  await click('[data-mail-compose-close]');assert.equal($('#mailbox-compose'),null,'ungeänderte Antwort schließt sofort');

  // Neue E-Mail als Entwurf mit Cc und formatiertem Text
  await click('.cc-rail [data-mail-compose]');form=$('#mailbox-compose');form.elements.to.value='erika@example.invalid';form.elements.subject.value='Ihr Termin';$('[data-compose-editor]').innerHTML='<p><b>Erster</b> UI-Entwurf</p>';$('[data-compose-editor]').dispatchEvent(new w.Event('input',{bubbles:true}));
  await click('[data-compose-show="cc"]');form=$('#mailbox-compose');assert.equal(form.elements.to.value,'erika@example.invalid','Empfänger bleibt beim Einblenden von Cc erhalten');assert.match($('[data-compose-editor]').innerHTML,/<b>Erster<\/b>/);form.elements.cc.value='kollege@example.invalid';
  await click('[data-mail-compose-close]');assert.ok($('[data-compose-discard]'),'Schließen mit Änderungen fragt nach');await click('[data-mail-save-draft]');
  assert.match(text(),/Erster UI-Entwurf/);await click('[data-mail-draft]');form=$('#mailbox-compose');assert.equal(form.elements.subject.value,'Ihr Termin');assert.equal(form.elements.cc.value,'kollege@example.invalid');assert.match($('[data-compose-editor]').innerHTML,/<b>Erster<\/b>/);
  $('[data-compose-editor]').innerHTML='<p>Überarbeiteter UI-Entwurf</p>';$('[data-compose-editor]').dispatchEvent(new w.Event('input',{bubbles:true}));await click('[data-mail-save-draft]');assert.match(text(),/Überarbeiteter UI-Entwurf/);
  const drafts=(await (await call('/api/mailbox')).json()).drafts;assert.equal(drafts.length,1);assert.equal(drafts[0].cc,'kollege@example.invalid');assert.match(drafts[0].html,/Überarbeiteter/);

  // Notizen: schnell erfassen, anheften, suchen
  await click('.cc-rail [data-mail-notes]');form=$('#mail-note-form');form.elements.body.value='Kunde wünscht Rückruf vor Terminbestätigung.';form.elements.orderId.value=orderId;await submit('#mail-note-form');assert.match(text(),/Kunde wünscht Rückruf/);assert.match($('.cc-note').textContent,/WG-CC-1/);
  await click('[data-cc-note-pin]');assert.ok($('.cc-note.pinned'));await type('[data-cc-note-search]','nichts');assert.match(text(),/Keine passende Notiz/);await type('[data-cc-note-search]','rückruf');assert.ok($('.cc-note'));

  // Laufende Aufträge und Kalender innerhalb des Communication Centers
  await click('.cc-rail [data-cc-section="orders"]');assert.match($('.cc-order-card').textContent,/WG-CC-1/);assert.match($('.cc-order-card').textContent,/VW Golf/);assert.ok($('.cc-order-card [data-order]'));
  await click('.cc-order-card [data-cc-mail-search]');assert.equal(w.document.querySelectorAll('.cc-row[data-mail-open]').length,1,'E-Mails zum Auftrag');assert.match($('.cc-items').textContent,/Fahrzeugpflege/);
  await click('.cc-rail [data-cc-section="calendar"]');assert.match($('.cc-agenda').textContent,/Erika Beispiel/);assert.ok($('.cc-day.busy'));

  // Sammelaktion: archivieren
  await click('.cc-rail [data-mail-folder="INBOX"]');await click('[data-mail-select-mode]');const box=[...w.document.querySelectorAll('[data-mail-select]')].find(input=>/Politur/.test(input.closest('.cc-row').textContent));box.checked=true;box.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match($('[data-region="bulk"]').textContent,/1 ausgewählt/);await click('[data-mail-bulk="archive"]');assert.equal(w.document.querySelectorAll('.cc-row[data-mail-open]').length,1);
  await click('.cc-rail [data-mail-folder="Archive"]');assert.match($('.cc-items').textContent,/Politur nachbestellt/);

  // KI-Antwort öffnet bearbeitbaren Entwurf, sendet nichts
  await click('.cc-rail [data-mail-folder="INBOX"]');await click('.cc-row[data-mail-open]');await click('[data-mail-ai="professional"]');
  assert.match($('[data-compose-editor]').textContent,/vielen Dank für Ihre Anfrage/);assert.equal($('#mailbox-compose').elements.to.value,'erika@example.invalid');assert.equal(analyses.length,1);
  const view=await (await call('/api/mailbox')).json();assert.equal(view.deliveries.length,0);assert.equal(view.notes.length,1);assert.equal(view.notes[0].pinned,true);assert.deepEqual(errors,[]);
});
