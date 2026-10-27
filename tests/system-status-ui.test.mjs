// Systemstatus: gebaute Oberfläche und echte Anwendung, ohne Server oder echten Versand.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid';
const owner='owner@example.invalid';
const customer='kunde@example.invalid';
let loads=0;

function memoryBucket(){
  const files=new Map();
  return {
    async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options?.httpMetadata??{}});},
    async get(id){return files.get(id)??null;},
    async delete(id){files.delete(id);}
  };
}

async function setup(t,{withEvidence=false}={}){
  const env={
    PANEL_ORIGIN:origin,
    OWNER_EMAIL_SHA256:digest(owner),
    CONFIG_KEY:Buffer.alloc(32,3).toString('base64'),
    DB:new PanelDatabase(':memory:'),
    BUCKET:memoryBucket(),
    ASSETS:{fetch:async request=>{
      const name=new URL(request.url).pathname;
      const file=name==='/'?'index.html':name.slice(1);
      try{return new Response(readFileSync(new URL('../dist/client/'+file,import.meta.url)),{headers:{'Content-Type':'text/html'}});}
      catch{return new Response('Nicht gefunden',{status:404});}
    }}
  };
  t.after(()=>env.DB.close());
  const app=await createApplication(env);
  const session=async email=>{
    const raw=randomBytes(32).toString('hex');
    await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();
    return '__Host-wg-session='+raw;
  };
  const ownerCookie=await session(owner),customerCookie=await session(customer);
  if(withEvidence){
    const at=new Date().toISOString(),id=randomUUID();
    const order={id,wg:'WG-004321',version:1,status:'Preise prüfen',synthetic:false,source:{id:'431',name:'Erika Muster',vehicle:'VW Golf'},notes:[],payments:[],createdAt:at,updatedAt:at};
    await env.DB.prepare('INSERT INTO orders(id,wg,website_id,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?,0)').bind(id,order.wg,'431',order.status,JSON.stringify(order),at,'test','fixture').run();
    await env.DB.prepare('INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at,detail) VALUES(?,?,?,?,?,?,?)').bind(randomUUID(),id,'offer','sent',at,at,'Provider-ID vorhanden').run();
  }
  return {env,app,ownerCookie,customerCookie};
}

async function call(app,cookie,path,init={}){
  const headers=new Headers(init.headers);
  headers.set('origin',origin);
  if(cookie)headers.set('cookie',cookie);
  return app.fetch(new Request(origin+path,{...init,headers}));
}

async function boot(t,{app,cookie,websiteResponse}){
  const html=readFileSync(new URL('../dist/client/index.html',import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{url:origin+'/',pretendToBeVisual:true});
  const w=dom.window;
  w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close??=function(){this.removeAttribute('open');};
  w.Element.prototype.scrollIntoView=()=>{};
  let pending=0;
  const errors=[],websiteRequests=[];
  const fetchImpl=async(url,options={})=>{
    const target=new URL(url,origin);
    if(target.origin==='https://white-gloss.de'){
      websiteRequests.push({url:target.href,options});
      pending++;
      try{return typeof websiteResponse==='function'?await websiteResponse():websiteResponse;}
      finally{pending--;}
    }
    pending++;
    try{
      const headers=new Headers(options.headers);
      headers.set('origin',origin);
      headers.set('cookie',cookie);
      const {signal:_signal,...rest}=options;
      return await app.fetch(new Request(target,{...rest,headers}));
    }finally{pending--;}
  };
  const globals={window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,fetch:fetchImpl};
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});
  w.addEventListener('error',event=>errors.push(event.error??event.message));
  const settle=async()=>{
    for(let i=0;i<400;i++){
      await new Promise(resolve=>setTimeout(resolve,3));
      if(pending===0){await new Promise(resolve=>setTimeout(resolve,12));if(pending===0)return;}
    }
    throw Error('UI blieb beschäftigt.');
  };
  await import(new URL('../dist/client/app.js?load='+(++loads),import.meta.url).href);
  await settle();
  const $=selector=>w.document.querySelector(selector);
  const click=async target=>{
    const element=typeof target==='string'?$(target):target;
    assert.ok(element,'Element fehlt: '+target+'\nSeite: '+w.document.body.textContent);
    element.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
    await settle();
  };
  return {w,$,click,settle,errors,websiteRequests,text:()=>w.document.body.textContent};
}

test('system status separates live probes, website bookings and provider acceptance',async t=>{
  const fixture=await setup(t,{withEvidence:true});
  const ui=await boot(t,{...fixture,cookie:fixture.ownerCookie,websiteResponse:()=>new Response('Website',{status:200})});
  await ui.click('[data-view="system"]');
  assert.match(ui.text(),/System & Status/);
  assert.match(ui.text(),/Website → Backend → Panel/);
  assert.match(ui.text(),/Letzte E-Mail-Vorgänge/);
  assert.equal(ui.$('[data-probe="hosting"] .system-state').textContent,'Verbunden');
  assert.equal(ui.$('[data-probe="website"] .system-state').textContent,'Verbunden');
  assert.match(ui.$('[data-probe="website"]').textContent,/HTTP 200/);
  assert.equal(ui.websiteRequests.length,1);
  assert.equal(ui.websiteRequests[0].options.redirect,'manual');
  assert.match(ui.text(),/WG-004321 · Erika Muster/);
  assert.match(ui.text(),/Website-ID 431/);
  assert.match(ui.text(),/An Versanddienst übergeben/);
  assert.doesNotMatch(ui.text(),/Zugestellt/);
  assert.equal(ui.$('.system-test [data-click="create"]'),null);
  assert.equal(ui.$('.system-test [data-click="test"]').textContent,'Testbereich aktivieren');
  await ui.click('.system-test [data-click="test"]');
  assert.ok(ui.$('.system-test [data-click="create"]'));
  assert.equal(ui.$('.system-test [data-click="test"]').textContent,'Testbereich verlassen');
  assert.deepEqual(ui.errors,[]);
});

test('system status shows website failures instead of inventing success',async t=>{
  const fixture=await setup(t);
  const ui=await boot(t,{...fixture,cookie:fixture.ownerCookie,websiteResponse:()=>new Response('Störung',{status:503})});
  await ui.click('[data-view="system"]');
  assert.equal(ui.$('[data-probe="website"] .system-state').textContent,'Fehlgeschlagen');
  assert.match(ui.$('[data-probe="website"]').textContent,/HTTP 503/);
  assert.equal(ui.$('[data-probe="hosting"] .system-state').textContent,'Verbunden');
  assert.equal(ui.$('[data-system-check="website"]').closest('.system-item').querySelector('.system-state').textContent,'Ausstehend');
  const customer=[...ui.w.document.querySelectorAll('.system-item')].find(item=>item.querySelector('h3').textContent==='Kundenportal');
  assert.equal(customer.querySelector('.system-state').textContent,'Verbunden');
  assert.deepEqual(ui.errors,[]);
});

test('website probe is owner-only and returns only technical evidence',async t=>{
  const fixture=await setup(t);
  assert.equal((await call(fixture.app,null,'/api/system/website')).status,401);
  assert.equal((await call(fixture.app,fixture.customerCookie,'/api/system/website')).status,403);
  const previousFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=previousFetch;});
  globalThis.fetch=async()=>new Response(null,{status:200});
  const response=await call(fixture.app,fixture.ownerCookie,'/api/system/website');
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.ok,true);
  assert.equal(data.status,200);
  assert.ok(Number.isFinite(Date.parse(data.checkedAt)));
  assert.deepEqual(Object.keys(data).sort(),['checkedAt','ok','status']);
});
