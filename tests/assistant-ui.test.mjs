// KI-Vorschläge im echten UI-Build: Freigabe, Anzeige und manuelle Übernahme ohne externe Verbindung.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
const result=(kind,payload)=>{
  const values=kind==='receipt'?{category:'CLEANING_SUPPLIES',paymentPath:'QONTO_CARD',amountMinor:11900,documentDate:'2026-10-17',partner:'Synthetischer Lieferant',note:'Betrag aus dem Testbeleg.',confidence:0.9,warnings:['Zahlungsweg manuell prüfen']}:kind==='text'?{correctedText:'Guten Tag, bitte schicken Sie uns Fotos.',changes:['Rechtschreibung korrigiert'],note:'Nur Sprache angepasst.'}:{conditionSummary:'Leichte oberflächliche Spuren sichtbar.',findings:[{area:'Tür',observation:'Feine Spuren im reflektierten Licht',severity:'leicht',calculationHint:'Vor Ort Lack und Tiefe prüfen'}],uncertainties:['Nur ein Bildausschnitt sichtbar'],calculationNote:'Kein Festpreis aus dem Foto ableiten.'};
  return {id:'resp_ui_test',status:'completed',model:'synthetic-vision',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(values)}]}]};
};
test('receipt, text and vehicle suggestions require confirmation and only change fields after apply',async t=>{
  const files=new Map(),calls=[],env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,10).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')},ASSISTANT_ADAPTERS:{async check(){},async analyze(_config,payload){calls.push(payload);const prompt=payload.input[0].content.at(-1).text;return result(prompt.startsWith('Lies nur')?'receipt':prompt.startsWith('Korrigiere')?'text':'vehicle',payload);}}};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex'),cookie='__Host-wg-session='+raw;
  await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const call=(path,body,mime='application/json')=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie,...(body===undefined?{}:{'Content-Type':mime})},body:body===undefined?undefined:mime==='application/json'?JSON.stringify(body):body}));
  assert.equal((await call('/api/assistant/settings',{apiKey:'synthetic-ui-key',model:'synthetic-vision',dataApproved:true})).status,200);assert.equal((await call('/api/assistant/check',{})).status,200);
  const pdf=Buffer.from('%PDF-1.7\nsynthetic UI assistant\n%%EOF'),upload=await call('/api/accounting/document?name=Testbeleg.pdf',pdf,'application/pdf');assert.equal(upload.status,200);
  const orderId=randomUUID(),assetId=randomUUID(),at=new Date().toISOString(),order={id:orderId,wg:'WG-KI-UI',version:1,status:'Preise prüfen',synthetic:false,source:{name:'Synthetischer Kunde',vehicle:'Testfahrzeug',note:''},notes:[],payments:[],createdAt:at,updatedAt:at};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(orderId,order.wg,order.status,JSON.stringify(order),at,'test','fixture').run();
  const image=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(100,1),Buffer.from([0xff,0xd9])]);await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(assetId,orderId,'booking','image/jpeg',createHash('sha256').update(image).digest('hex'),image.length,at).run();files.set(assetId,{body:image,httpMetadata:{contentType:'image/jpeg'}});
  const html=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,''),dom=new JSDOM(html,{url:origin,pretendToBeVisual:true}),w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close??=function(){this.removeAttribute('open');};
  let pending=0;const errors=[],fetchImpl=async(url,options={})=>{pending++;try{const headers=new Headers(options.headers);headers.set('origin',origin);headers.set('cookie',cookie);return await app.fetch(new Request(new URL(url,origin),{...options,headers}));}finally{pending--;}};
  for(const [key,value] of Object.entries({window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});w.addEventListener('error',event=>errors.push(event.error??event.message));
  const settle=async()=>{for(let i=0;i<500;i++){await new Promise(resolve=>setTimeout(resolve,3));if(pending===0){await new Promise(resolve=>setTimeout(resolve,15));if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/app.js?assistant-ui-test',import.meta.url).href);await settle();
  const $=selector=>w.document.querySelector(selector),click=async target=>{const element=typeof target==='string'?$(target):target;assert.ok(element,'Element fehlt: '+target);element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();},confirm=async()=>{const form=$('.assistant-confirm form');assert.ok(form);form.elements.confirmed.checked=true;form.requestSubmit();await settle();assert.equal($('.assistant-confirm'),null);};
  await click('.sidebar [data-view="finance-receipts"]');await click('[data-assistant-receipt] [data-assistant-start]');assert.equal(calls.length,0,'no provider call before confirmation');await confirm();
  assert.match($('[data-assistant-receipt]').textContent,/119,00/);assert.equal($('[data-accounting-classify]').elements.partner.value,'','suggestion does not prefill without apply');await click('[data-assistant-receipt] [data-assistant-apply]');
  assert.equal($('[data-accounting-classify]').elements.partner.value,'Synthetischer Lieferant');assert.equal($('[data-accounting-classify]').elements.amount.value,'119,00');assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM accounting_classifications').first()).n,0);
  await click('.sidebar [data-view="orders"]');await click(w.document.querySelector('[data-order]'));const textarea=$('#sourceform textarea[name="note"]');assert.ok(textarea);textarea.value='Guten Tag bite schicken sie uns Fotos.';await click('#sourceform .assistant-inline [data-assistant-start]');await confirm();assert.equal(textarea.value,'Guten Tag bite schicken sie uns Fotos.');await click('#sourceform [data-assistant-apply]');assert.equal(textarea.value,'Guten Tag, bitte schicken Sie uns Fotos.');
  assert.deepEqual(JSON.parse((await env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(orderId).first()).data),order,'text apply does not save the order');
  await click('[data-tab="price"]');assert.ok($('[data-assistant-vehicle]'));await click('[data-assistant-vehicle] [data-assistant-start]');await confirm();assert.match($('[data-assistant-vehicle]').textContent,/INTERNE FOTOAUSWERTUNG/);assert.match($('[data-assistant-vehicle]').textContent,/Kein Festpreis/);assert.equal(calls.length,3);
  await click('.sidebar [data-view="settings"]');assert.ok($('#assistant-settings-form'));assert.equal($('#settingsform #assistant-settings-form'),null,'settings forms must not be nested');assert.equal(w.document.body.textContent.includes('synthetic-ui-key'),false);assert.deepEqual(errors,[]);
});
