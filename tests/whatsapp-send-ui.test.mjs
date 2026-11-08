import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWhatsAppSettings} from '../public/whatsapp.js';

const verified={configured:true,phoneNumberId:'123456789012345',graphVersion:'v99.1',verifiedAt:'2026-11-08T00:00:00.000Z',verifiedName:'Test <b>Number</b>',displayPhoneNumber:'+1 555 0000000'};
async function fixture(t,{settings={...verified},synthetic=false,send,check}={}){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://panel.example.invalid'}),w=dom.window,calls=[];
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const previous=new Map();
  for(const [name,value] of Object.entries({window:w,document:w.document,location:w.location,FormData:w.FormData,fetch:async(url,options={})=>{
    calls.push({url,payload:options.body?JSON.parse(options.body):undefined});
    if(url==='/api/whatsapp/check')return check?check(settings):Response.json({ok:true});
    if(url.startsWith('/api/whatsapp/test-send'))return send?send(calls.at(-1)):Response.json({accepted:true,providerMessageId:'wamid.synthetic.ui'});
    return Response.json({settings});
  }})){previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});}
  t.after(()=>{dom.window.close();for(const [name,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  const root=w.document.querySelector('#root'),settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,1));};
  mountWhatsAppSettings(root,{synthetic});await settle();
  return {w,root,calls,settle,$:selector=>w.document.querySelector(selector),click:async selector=>{const element=w.document.querySelector(selector);assert.ok(element,'Element fehlt: '+selector);element.click();await settle();}};
}

test('manual test send remains unavailable without verification and in the synthetic workspace',async t=>{
  for(const options of [{settings:{...verified,verifiedAt:null}},{synthetic:true}])await t.test(JSON.stringify(options),async t=>{
    const f=await fixture(t,options),button=f.$('[data-whatsapp-test-prepare]');assert.ok(button);assert.equal(button.disabled,true);
    button.dispatchEvent(new f.w.MouseEvent('click',{bubbles:true}));await f.settle();
    assert.equal(f.$('.whatsapp-test-send'),null);assert.equal(f.calls.some(call=>call.url.includes('/test-send')),false);
  });
});

test('manual test dialog names the sender and fixed template, requires confirmation and sends only once',async t=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});const f=await fixture(t,{send:()=>pending});
  await f.click('[data-whatsapp-test-prepare]');const dialog=f.$('.whatsapp-test-send'),form=dialog.querySelector('form');
  assert.match(dialog.textContent,/Test <b>Number<\/b>/);assert.equal(dialog.querySelector('b'),null);
  assert.match(dialog.textContent,/123456789012345/);assert.match(dialog.textContent,/hello_world/);assert.match(dialog.textContent,/en_US/);
  form.elements.recipient.value='+491700000000';form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await f.settle();
  assert.equal(f.calls.filter(call=>call.url.includes('/test-send')).length,0);
  form.elements.confirmed.checked=true;form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));
  form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await f.settle();
  const sent=f.calls.filter(call=>call.url.includes('/test-send'));assert.equal(sent.length,1);
  assert.deepEqual({...sent[0].payload,requestId:'uuid'},{requestId:'uuid',phoneNumberId:verified.phoneNumberId,recipient:'+491700000000',confirmed:true});
  assert.match(sent[0].payload.requestId,/^[0-9a-f-]{36}$/);
  assert.equal(form.querySelector('[type=submit]').disabled,true);
  finish(Response.json({accepted:true,providerMessageId:'wamid.synthetic.ui'}));await f.settle();
  assert.match(dialog.textContent,/von Meta angenommen/);assert.match(dialog.textContent,/Empfang/);
  form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await f.settle();
  assert.equal(f.calls.filter(call=>call.url.includes('/test-send')).length,1);
});

test('lost send response cannot trigger a retry from the same dialog',async t=>{
  const f=await fixture(t,{send:async()=>{throw Error('Antwort verloren');}});await f.click('[data-whatsapp-test-prepare]');
  const form=f.$('.whatsapp-test-send form');form.elements.recipient.value='+491700000000';form.elements.confirmed.checked=true;form.requestSubmit();await f.settle();
  assert.match(f.$('.whatsapp-test-send').textContent,/Empfang/);assert.equal(form.querySelector('[type=submit]').disabled,true);
  form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await f.settle();assert.equal(f.calls.filter(call=>call.url.includes('/test-send')).length,1);
});

test('failed connection check clears the stale verified badge and disables test sending',async t=>{
  const f=await fixture(t,{check:settings=>{settings.verifiedAt=null;return Response.json({error:'WhatsApp-Verbindung fehlgeschlagen: HTTP 401'},{status:502});}});
  assert.match(f.root.querySelector('.badge').textContent,/Verbindung geprüft/);await f.click('[data-whatsapp-check]');
  assert.equal(f.root.querySelector('.badge').textContent,'Nicht geprüft');assert.equal(f.$('[data-whatsapp-test-prepare]').disabled,true);
  assert.match(f.$('[data-whatsapp-message]').textContent,/HTTP 401/);
});

