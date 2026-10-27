// Kundenchat-Oberfläche: Kundenseite und Panel-Posteingang werden aus dem Build in jsdom geladen.
// Anfragen gehen im Prozess an die echte Anwendung; es wird kein Server gestartet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PanelDatabase,createStorage} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {backupData} from '../server/backup.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='kunde@example.invalid';
const png=Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64'),Buffer.alloc(200)]);
let loads=0;
const jpeg=Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(200,1)]);

function memoryBucket(){const files=new Map();return {async put(id,bytes,o){files.set(id,{body:new Uint8Array(bytes),httpMetadata:o?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}};}
async function setup(t,storage=null){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,3).toString('base64'),...(storage??{DB:new PanelDatabase(':memory:'),BUCKET:memoryBucket()}),ASSETS:{fetch:async request=>{const name=new URL(request.url).pathname;const file=name.startsWith('/chat/')?'chat.html':name==='/'?'index.html':name.slice(1);try{return new Response(readFileSync(new URL('../dist/client/'+file,import.meta.url)),{headers:{'Content-Type':'text/html'}});}catch{return new Response('Nicht gefunden',{status:404});}}}};
  t.after(()=>env.DB.close());
  const app=await createApplication(env);
  const session=async email=>{const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();return '__Host-wg-session='+raw;};
  const id=randomUUID(),wg='WG-4711',data={id,wg,version:1,status:'Angenommen',synthetic:false,source:{name:'Erika Muster',email:customer,phone:'0151 2345678',vehicle:'VW Golf',plate:'FDS-WG 1'},notes:[],payments:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(id,wg,data.status,JSON.stringify(data),new Date().toISOString(),'test','fixture').run();
  return {env,app,order:data,ownerCookie:await session(owner),customerCookie:await session(customer)};
}
async function call(app,cookie,path,init={}){const headers=new Headers(init.headers);headers.set('origin',origin);headers.set('cookie',cookie);return app.fetch(new Request(origin+path,{...init,headers}));}

async function boot(t,{app,page,script,path,cookie}){
  const html=readFileSync(new URL('../dist/client/'+page,import.meta.url),'utf8').replace(/<script[^>]*><\/script>/g,'');
  const dom=new JSDOM(html,{url:origin+path,pretendToBeVisual:true});const w=dom.window;
  w.Element.prototype.scrollIntoView=()=>{};
  // jsdom cannot decode images: a stand-in canvas returns a small JPEG, like the browser re-encoding would.
  const ctx=new Proxy({},{get:(_target,key)=>key==='canvas'?null:()=>{},set:()=>true});
  w.HTMLCanvasElement.prototype.getContext=()=>ctx;w.HTMLCanvasElement.prototype.toDataURL=()=>'data:image/jpeg;base64,/9j/';w.HTMLCanvasElement.prototype.toBlob=callback=>callback(new Blob([jpeg],{type:'image/jpeg'}));
  globalThis.createImageBitmap=async()=>({width:3000,height:2000,close(){}});w.HTMLDialogElement.prototype.showModal??=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close??=function(){this.removeAttribute('open');};
  let pending=0;const errors=[];
  // Waiting live requests are not counted as "busy"; they return as soon as something changes.
  const fetchImpl=async(url,options={})=>{const target=new URL(url,origin),live=Number(target.searchParams.get('wait')??0)>0;if(!live)pending++;try{const headers=new Headers(options.headers);headers.set('origin',origin);headers.set('cookie',cookie);if(options.body&&typeof options.body!=='string'&&!headers.has('content-length'))headers.set('content-length',String(options.body.size));const {signal:_signal,...rest}=options;return await app.fetch(new Request(target,{...rest,headers}));}finally{if(!live)pending--;}};
  for(const [key,value] of Object.entries({window:w,document:w.document,location:w.location,history:w.history,localStorage:w.localStorage,FormData:w.FormData,HTMLElement:w.HTMLElement,Event:w.Event,AbortController:w.AbortController,fetch:fetchImpl}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true,writable:true});
  w.addEventListener('error',e=>errors.push(e.error??e.message));
  const settle=async()=>{for(let i=0;i<500;i++){await new Promise(r=>setTimeout(r,3));if(pending===0){await new Promise(r=>setTimeout(r,15));if(pending===0)return;}}throw Error('UI blieb beschäftigt.');};
  await import(new URL('../dist/client/'+script+'?load='+(++loads),import.meta.url).href);await settle();
  const $=s=>w.document.querySelector(s);
  const click=async target=>{const el=typeof target==='string'?$(target):target;assert.ok(el,'Element fehlt: '+target);el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));await settle();};
  const send=async text=>{const area=$('.chat textarea');area.value=text;$('.chat-composer').requestSubmit();await settle();};
  return {w,$,click,send,settle,errors,text:()=>w.document.body.textContent};
}

test('customer page: sees the order, writes, attaches a photo and gets read receipts',async t=>{
  const f=await setup(t);
  const opened=await (await call(f.app,f.ownerCookie,'/api/chats/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:f.order.id})})).json();
  const link=(await (await call(f.app,f.ownerCookie,'/api/chats/t/'+opened.id+'/link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create'})})).json()).link,token=link.url.split('/').pop();
  await call(f.app,f.ownerCookie,'/api/chats/t/'+opened.id+'/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Guten Tag! Schicken Sie uns gern Fotos: https://white-gloss.de'})});
  const shell=await call(f.app,f.customerCookie,'/chat/'+token);assert.equal(shell.status,200);assert.match(await shell.text(),/kunde-chat\.js/);
  const ui=await boot(t,{app:f.app,page:'chat.html',script:'kunde-chat.js',path:'/chat/'+token,cookie:f.customerCookie});
  assert.match(ui.$('.chat-head').textContent,/Auftrag WG-4711 · VW Golf · FDS-WG 1/);
  assert.equal(ui.$('[data-chat-call]').getAttribute('href'),'tel:+4915233540284');
  const theirs=ui.$('.chat-msg.theirs');assert.ok(theirs);assert.equal(theirs.querySelector('a').getAttribute('href'),'https://white-gloss.de');assert.equal(theirs.querySelector('a').rel,'noopener noreferrer');
  assert.ok(ui.$('.chat-day').textContent.includes('Heute'));
  await ui.send('<b>Hallo</b> – geht auch Samstag?');
  const mine=ui.$('.chat-msg.mine .chat-text');assert.equal(mine.textContent,'<b>Hallo</b> – geht auch Samstag?','text stays text, no HTML injection');assert.equal(ui.$('.chat-msg.mine b'),null);
  const input=ui.$('.chat input[type=file]');Object.defineProperty(input,'files',{value:[new File([png],'tuer.png',{type:'image/png'})],configurable:true});input.dispatchEvent(new ui.w.Event('change'));await ui.settle();
  assert.match(ui.$('.chat-pending').textContent,/tuer\.jpg/,'photos are re-encoded as JPEG before upload');
  await ui.send('Foto von der Tür');
  const last=[...ui.w.document.querySelectorAll('.chat-msg.mine')].at(-1);
  assert.ok(last.querySelector('.chat-image img').getAttribute('src').startsWith('/api/kundenchat/'+token+'/file/'));assert.equal(ui.$('.chat-pending').hidden,true);
  assert.equal((await f.env.DB.prepare("SELECT mime FROM assets WHERE kind='chat'").first()).mime,'image/jpeg');
  // An image the browser cannot decode is refused instead of sending the original with its metadata.
  globalThis.createImageBitmap=async()=>{throw Error('nicht lesbar');};
  Object.defineProperty(input,'files',{value:[new File([png],'kaputt.heic',{type:'image/heic'})],configurable:true});input.dispatchEvent(new ui.w.Event('change'));await ui.settle();
  assert.match(ui.$('.chat-error').textContent,/konnte nicht verarbeitet werden/);assert.equal(ui.$('.chat-pending').hidden,true);
  const rows=(await f.env.DB.prepare("SELECT sender,body FROM chat_messages ORDER BY id").all()).results;
  assert.deepEqual(rows.map(r=>[r.sender,r.body]),[['owner','Guten Tag! Schicken Sie uns gern Fotos: https://white-gloss.de'],['customer','<b>Hallo</b> – geht auch Samstag?'],['customer','Foto von der Tür']]);
  assert.equal(last.classList.contains('read'),false);
  await call(f.app,f.ownerCookie,'/api/chats/t/'+opened.id+'?after=999999');// Betreiber bestätigt den Empfang
  for(let i=0;i<50&&!last.classList.contains('read');i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(last.classList.contains('read'),true,'read receipt arrives live');
  assert.deepEqual(ui.errors,[]);
});

test('panel inbox: unread badge, open the chat from an order and reply',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'wg-chat-'));
  const storage=await createStorage(join(dir,'data'),join(dir,'assets'));
  const f=await setup(t,storage);
  // Die Aufräum-Hooks laufen in Reihenfolge ihrer Registrierung: Erst setup() schließt die
  // SQLite-Datei, danach darf Windows das temporäre Verzeichnis entfernen.
  t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50}));
  const ui=await boot(t,{app:f.app,page:'index.html',script:'app.js',path:'/',cookie:f.ownerCookie});
  await ui.click('[data-view="orders"]');await ui.click(ui.$('tr[data-order]')??ui.$('[data-order]'));
  await ui.click('[data-click="orderChat"]');
  assert.match(ui.w.location.hash,/^#chat=[0-9a-f-]{36}$/);const id=ui.w.location.hash.slice(6);
  assert.match(ui.$('.chat-head').textContent,/Erika Muster/);assert.match(ui.$('.chat-head').textContent,/WG-4711/);
  // Customer access: create the link from the menu.
  await ui.click('[data-chat-do="create"]');
  assert.match(ui.$('[data-head-menu]').textContent,/Kundenlink kopieren/);assert.ok(ui.$('[data-head-menu] a[href^="https://wa.me/491512345678?text="]'));
  const token=(await (await call(f.app,f.ownerCookie,'/api/chats/t/'+id)).json()).link.url.split('/').pop();
  // A customer message arrives while the owner looks elsewhere.
  await ui.click('[data-view="overview"]');
  await call(f.app,f.customerCookie,'/api/kundenchat/'+token+'/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Kann ich den Wagen schon um 8 bringen?'})});
  await ui.click('[data-view="chat"]');
  const badge=ui.$('[data-chat-count]');assert.equal(badge.hidden,false);assert.equal(badge.textContent,'1');
  assert.match(ui.$('.inbox-item.unread').textContent,/Kann ich den Wagen schon um 8 bringen\?/);
  await ui.click('.inbox-item');
  assert.match(ui.$('.chat-msg.theirs').textContent,/um 8 bringen/);
  await ui.send('Ja, 8 Uhr passt.');
  assert.match([...ui.w.document.querySelectorAll('.chat-msg.mine')].at(-1).textContent,/8 Uhr passt/);
  assert.equal((await (await call(f.app,f.ownerCookie,'/api/chats/summary')).json()).unread,0);
  // Chat files are listed as assets and therefore part of the daily backup.
  const uploaded=await (await call(f.app,f.customerCookie,'/api/kundenchat/'+token+'/file?name=foto.png',{method:'POST',headers:{'Content-Type':'image/png','content-length':String(png.length)},body:png})).json();
  await call(f.app,f.customerCookie,'/api/kundenchat/'+token+'/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:[uploaded.id]})});
  const draft=await (await call(f.app,f.customerCookie,'/api/kundenchat/'+token+'/file?name=entwurf.png',{method:'POST',headers:{'Content-Type':'image/png','content-length':String(png.length)},body:png})).json();
  const backup=await backupData(join(dir,'data'),join(dir,'backups'));
  assert.ok(readdirSync(join(backup.path,'uploads')).includes(uploaded.id),'chat photo is in the backup');
  assert.ok(!readdirSync(join(backup.path,'uploads')).includes(draft.id),'unsent drafts stay out of the backup');
  const part=await call(f.app,f.customerCookie,'/api/kundenchat/'+token+'/file/'+uploaded.id,{headers:{range:'bytes=1-3'}});
  assert.equal(part.status,206);assert.deepEqual(Buffer.from(await part.arrayBuffer()),png.subarray(1,4),'byte range streamed from disk');
  const whole=await call(f.app,f.customerCookie,'/api/kundenchat/'+token+'/file/'+uploaded.id);
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()),png);assert.equal(whole.headers.get('content-length'),String(png.length));
  assert.deepEqual(ui.errors,[]);
});
