import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWhatsApp} from '../public/whatsapp.js';

const sourceMessageId='10000000-0000-4000-8000-000000000001';
const recipient='+491700000000';
function outgoing(payload,extra={}){return {id:payload.requestId,requestId:payload.requestId,direction:'outgoing',body:payload.body,sentAt:new Date().toISOString(),messageType:'text',hasMedia:false,sendState:'accepted',deliveryStatus:'accepted',deliveryErrorCode:null,...extra};}
async function fixture(t,{synthetic=false,reviewMode=false,allowed=true,send}={}){
  const dom=new JSDOM('<main id="root"></main>',{url:'https://panel.example.invalid'}),w=dom.window,calls=[];
  const server={messages:{one:[],two:[]},reply:{allowed,reason:allowed?'Antwort innerhalb von 24 Stunden möglich.':'Das 24-Stunden-Antwortfenster ist geschlossen.',windowExpiresAt:new Date(Date.now()+3600000).toISOString(),recipient,sourceMessageId}};
  const conversations=['one','two'].map((key,index)=>({conversationKey:key,profileName:'Kunde '+index,senderPhone:recipient,lastReceivedAt:new Date().toISOString(),lastBody:'Anfrage',matches:[],orderIds:[]}));
  const previous=new Map();
  for(const [name,value] of Object.entries({window:w,document:w.document,location:w.location,FormData:w.FormData,fetch:async(url,options={})=>{
    const payload=options.body?JSON.parse(options.body):undefined;calls.push({url,payload});
    if(url==='/api/whatsapp/reply'){
      if(send)return send(payload,server);
      const message=outgoing(payload);server.messages[payload.conversationKey].push(message);return Response.json({ok:true,accepted:true,duplicate:false,outgoing:message,message:'Von Meta angenommen.'});
    }
    const key=new URL(url,w.location.origin).searchParams.get('conversation');
    return Response.json({settings:{configured:true,verifiedAt:new Date().toISOString(),reviewMode},conversations,messages:key?[{id:sourceMessageId,direction:'incoming',body:'Hallo <img src=x onerror=alert(1)>',sentAt:new Date().toISOString(),messageType:'text',hasMedia:false},...server.messages[key]]:[],suggestions:[],orders:[],reply:server.reply});
  }})){previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});}
  t.after(()=>{dom.window.close();for(const [name,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  let root=w.document.querySelector('#root');
  const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setTimeout(resolve,1));};
  const $=selector=>root.querySelector(selector),click=async selector=>{const element=$(selector);assert.ok(element,'Element fehlt: '+selector);element.click();await settle();};
  const type=body=>{const textarea=$('#whatsapp-reply-form textarea');assert.ok(textarea);textarea.value=body;textarea.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const select=key=>click('[data-wa-conversation="'+key+'"]');
  const remount=async()=>{const next=w.document.createElement('main');root.replaceWith(next);root=next;mountWhatsApp(root,{synthetic});await settle();};
  mountWhatsApp(root,{synthetic});await settle();await select('one');
  return {w,calls,server,$,click,type,select,settle,remount,get root(){return root;},sends:()=>calls.filter(call=>call.url==='/api/whatsapp/reply')};
}

test('reply uses a fixed recipient, plain text, a 4096-character limit and only an explicit send button',async t=>{
  const f=await fixture(t),form=f.$('#whatsapp-reply-form');
  assert.equal(form.querySelector('[data-wa-reply-send]').type,'button');assert.equal(form.elements.body.maxLength,4096);assert.equal(form.querySelector('[name=recipient]'),null);assert.match(form.textContent,/\+491700000000/);
  f.type('Hallo\n<img src=x onerror=alert(1)>');
  form.elements.body.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await f.settle();assert.equal(f.sends().length,0);
  f.type('a'.repeat(4097));assert.equal(f.$('[data-wa-reply-send]').disabled,true);f.$('[data-wa-reply-send]').dispatchEvent(new f.w.MouseEvent('click',{bubbles:true}));await f.settle();assert.equal(f.sends().length,0);
  const prefix='<img src=x onerror=alert(1)>\n',body=prefix+'a'.repeat(4096-prefix.length);assert.equal(body.length,4096);f.type(body);await f.click('[data-wa-reply-send]');
  assert.equal(f.sends().length,1);const payload=f.sends()[0].payload;assert.deepEqual({...payload,requestId:'uuid'},{requestId:'uuid',conversationKey:'one',sourceMessageId,body,confirmed:true});assert.match(payload.requestId,/^[0-9a-f-]{36}$/);
  assert.equal(f.$('.whatsapp-message-outgoing img'),null);assert.equal(f.$('.whatsapp-message-outgoing>div').textContent,body);assert.equal(f.$('[data-wa-delivery]').textContent,'Von Meta angenommen');assert.equal(f.$('#whatsapp-reply-form textarea').value,'');
});

test('drafts survive manual refresh, changing conversations and mounting the view again',async t=>{
  const f=await fixture(t),first='<textarea>Erster Entwurf & Details</textarea>';
  f.type(first);f.server.reply.sourceMessageId='10000000-0000-4000-8000-000000000002';f.server.messages.one.push({id:f.server.reply.sourceMessageId,direction:'incoming',body:'Neue Nachfrage',sentAt:new Date().toISOString(),messageType:'text',hasMedia:false});await f.click('[data-wa-refresh]');assert.equal(f.$('#whatsapp-reply-form textarea').value,first);assert.equal(f.$('#whatsapp-reply-form textarea textarea'),null);assert.match(f.$('.whatsapp-messages').textContent,/Neue Nachfrage/);
  await f.select('two');assert.equal(f.$('#whatsapp-reply-form textarea').value,'');f.type('Zweiter Entwurf');
  await f.select('one');assert.equal(f.$('#whatsapp-reply-form textarea').value,first);
  await f.remount();await f.select('two');assert.equal(f.$('#whatsapp-reply-form textarea').value,'Zweiter Entwurf');await f.select('one');assert.equal(f.$('#whatsapp-reply-form textarea').value,first);assert.equal(f.sends().length,0);
});

test('outgoing delivery states remain distinct and provider content is escaped',async t=>{
  const f=await fixture(t),states=['pending','uncertain','accepted','sent','delivered','read','failed'];
  f.server.messages.one=states.map((state,index)=>outgoing({requestId:String(index),body:'<b>Antwort</b>'},{sendState:['pending','uncertain'].includes(state)?state:'accepted',deliveryStatus:state,deliveryErrorCode:state==='failed'?'<img src=x>':null}));
  await f.click('[data-wa-refresh]');
  assert.equal(f.root.querySelectorAll('.whatsapp-message-outgoing').length,7);assert.equal(f.$('.whatsapp-message-outgoing b'),null);assert.equal(f.$('.whatsapp-delivery-status img'),null);
  const labels={pending:'Versand angefragt',uncertain:'Versand unklar',accepted:'Von Meta angenommen',sent:'Gesendet',delivered:'Zugestellt',read:'Gelesen',failed:'Zustellung fehlgeschlagen'};
  for(const [state,label] of Object.entries(labels))assert.ok(f.$('[data-wa-delivery="'+state+'"]').textContent.startsWith(label));assert.match(f.$('[data-wa-delivery=failed]').textContent,/Fehlercode <img src=x>/);assert.equal(f.sends().length,0);
});

test('pending send is recorded before fetch, disables duplicate clicks and clears only after ledger acceptance',async t=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const f=await fixture(t,{send:async(payload,server)=>{assert.ok(f.w.sessionStorage.getItem('wg-whatsapp-reply:v1:live:one').includes(payload.requestId));await pending;const message=outgoing(payload);server.messages.one.push(message);return Response.json({accepted:true,outgoing:message});}});
  f.type('Genau einmal');await f.click('[data-wa-reply-send]');assert.equal(f.sends().length,1);assert.equal(f.$('#whatsapp-reply-form textarea').readOnly,true);assert.equal(f.$('[data-wa-reply-send]').disabled,true);
  f.$('[data-wa-reply-send]').dispatchEvent(new f.w.MouseEvent('click',{bubbles:true}));f.$('#whatsapp-reply-form').dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await f.settle();assert.equal(f.sends().length,1);
  finish();await f.settle();assert.equal(f.$('#whatsapp-reply-form textarea').value,'');assert.equal(f.$('.whatsapp-reply-pending'),null);assert.equal(f.sends().length,1);
});

for(const failure of ['network','409-without-proof'])test('unknown result stays locked across refresh and navigation without a new UUID: '+failure,async t=>{
  const f=await fixture(t,{send:async()=>{if(failure==='network')throw Error('Antwort verloren');return Response.json({error:'Versandstatus unklar.'},{status:409});}});
  f.type('Text bleibt erhalten');await f.click('[data-wa-reply-send]');const first=f.sends()[0].payload,stored=JSON.parse(f.w.sessionStorage.getItem('wg-whatsapp-reply:v1:live:one'));
  assert.equal(stored.attempt.requestId,first.requestId);assert.equal(stored.attempt.body,first.body);assert.equal(f.$('#whatsapp-reply-form textarea').value,first.body);
  await f.click('[data-wa-refresh]');assert.ok(f.$('.whatsapp-reply-pending'));assert.equal(f.$('[data-wa-reply-send]').disabled,true);
  await f.remount();await f.select('one');assert.equal(f.$('#whatsapp-reply-form textarea').value,first.body);assert.equal(f.$('[data-wa-reply-send]').disabled,true);
  f.$('[data-wa-reply-send]').dispatchEvent(new f.w.MouseEvent('click',{bubbles:true}));await f.settle();assert.equal(f.sends().length,1);
  for(const sendState of ['pending','uncertain']){f.server.messages.one=[outgoing(first,{sendState,deliveryStatus:sendState})];await f.click('[data-wa-refresh]');assert.equal(f.$('[data-wa-reply-send]').disabled,true);}
  f.server.messages.one=[outgoing(first,{deliveryStatus:'failed',deliveryErrorCode:131026})];await f.click('[data-wa-refresh]');assert.equal(f.$('.whatsapp-reply-pending'),null);assert.equal(f.$('#whatsapp-reply-form textarea').value,'');assert.equal(f.sends().length,1);
});

test('a definitive notSent rejection preserves editable text and permits only a new explicit attempt',async t=>{
  let count=0;const f=await fixture(t,{send:async(payload,server)=>{if(++count===1)return Response.json({error:'Quelle wurde geändert.',notSent:true},{status:409});const message=outgoing(payload);server.messages.one.push(message);return Response.json({accepted:true,outgoing:message});}});
  f.type('Noch nicht gesendet');await f.click('[data-wa-reply-send]');assert.equal(f.$('#whatsapp-reply-form textarea').value,'Noch nicht gesendet');assert.equal(f.$('#whatsapp-reply-form textarea').readOnly,false);assert.equal(f.sends().length,1);
  await f.click('[data-wa-refresh]');assert.equal(f.sends().length,1);await f.click('[data-wa-reply-send]');assert.equal(f.sends().length,2);assert.notEqual(f.sends()[0].payload.requestId,f.sends()[1].payload.requestId);
});

test('a delayed response from a removed view cannot overwrite a newer draft after ledger refresh',async t=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});const f=await fixture(t,{send:async payload=>{await pending;return Response.json({accepted:true,outgoing:outgoing(payload)});}});
  f.type('Erste Antwort');await f.click('[data-wa-reply-send]');const first=f.sends()[0].payload;
  await f.remount();f.server.messages.one.push(outgoing(first));await f.select('one');f.type('Neuer Entwurf');finish();await f.settle();
  assert.equal(f.$('#whatsapp-reply-form textarea').value,'Neuer Entwurf');await f.remount();await f.select('one');assert.equal(f.$('#whatsapp-reply-form textarea').value,'Neuer Entwurf');assert.equal(f.sends().length,1);
});

for(const options of [{reviewMode:true},{synthetic:true},{allowed:false}])test('direct reply stays unavailable for '+JSON.stringify(options),async t=>{
  const f=await fixture(t,options);
  if(options.allowed===false){assert.equal(f.$('#whatsapp-reply-form textarea').readOnly,true);assert.equal(f.$('[data-wa-reply-send]').disabled,true);}
  else assert.equal(f.$('#whatsapp-reply-form'),null);
  const forged=f.w.document.createElement('button');forged.dataset.waReplySend='';f.root.append(forged);forged.click();await f.settle();assert.equal(f.sends().length,0);
});

test('unavailable attempt storage prevents sending',async t=>{
  const f=await fixture(t);t.mock.method(f.w.Storage.prototype,'setItem',()=>{throw Error('Storage unavailable');});f.type('Bitte behalten');await f.click('[data-wa-reply-send]');assert.equal(f.sends().length,0);assert.match(f.$('[data-whatsapp-message]').textContent,/Es wurde keine Nachricht gesendet/);assert.equal(f.$('#whatsapp-reply-form textarea').value,'Bitte behalten');
});
