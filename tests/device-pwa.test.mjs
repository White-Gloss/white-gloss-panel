import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const origin='https://panel.example.invalid';
const endpoint='https://push.example.invalid/synthetic-device';
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.alloc(64,7)]).toString('base64url');
const subscription={endpoint,expirationTime:null,keys:{p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};
let loads=0;
async function boot(t,{notification=false,fetchImpl,registration}={}){
  const dom=new JSDOM('<main id="device"></main>',{url:origin+'/vor-ort',pretendToBeVisual:true}),w=dom.window;
  w.matchMedia=()=>({matches:false});
  const saved=new Map();for(const key of ['window','document','navigator','fetch'])saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
  t.after(()=>{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}dom.window.close();});
  const nav={userAgent:'Synthetic Mobile',...(registration?{serviceWorker:{getRegistration:async()=>registration,ready:Promise.resolve(registration)}}:{})};let permissionRequests=0;
  if(notification){
    w.PushManager=function SyntheticPushManager(){};
    w.Notification={permission:'default',requestPermission:async()=>{permissionRequests++;w.Notification.permission='granted';return 'granted';}};
  }
  Object.defineProperty(globalThis,'window',{value:w,configurable:true,writable:true});Object.defineProperty(globalThis,'document',{value:w.document,configurable:true,writable:true});Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true,writable:true});Object.defineProperty(globalThis,'fetch',{value:fetchImpl??(async()=>{throw Error('Unerwarteter Zugriff');}),configurable:true,writable:true});
  const {mountDeviceCenter}=await import(new URL('../public/device.js?test='+(++loads),import.meta.url).href);
  mountDeviceCenter(w.document.querySelector('#device'));
  const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setTimeout(resolve,5));};
  await settle();return {w,nav,settle,permissionRequests:()=>permissionRequests};
}

test('installation requires a browser event, preserves accepted state and confirms only appinstalled as installed',async t=>{
  const ui=await boot(t),install=ui.w.document.querySelector('#device-install'),hint=ui.w.document.querySelector('#device-install-hint');
  assert.equal(install.hidden,true);assert.match(ui.w.document.querySelector('#device-push-status').textContent,/nicht unterstützt/);
  const event=new ui.w.Event('beforeinstallprompt');let prompts=0;event.prompt=async()=>{prompts++;};event.userChoice=Promise.resolve({outcome:'accepted'});ui.w.dispatchEvent(event);
  assert.equal(install.hidden,false);install.click();await ui.settle();assert.equal(prompts,1);assert.match(hint.textContent,/bestätigt/);assert.doesNotMatch(hint.textContent,/Browser-Menü/);
  ui.w.dispatchEvent(new ui.w.Event('appinstalled'));assert.match(hint.textContent,/installiert/);assert.equal(install.hidden,true);
});

test('push permission is requested only on click; registration and removal use the mocked device subscription',async t=>{
  const calls=[];let subscribed=0,unsubscribed=0,getStatus=0,current=null;
  const device={endpoint,toJSON:()=>subscription,unsubscribe:async()=>{unsubscribed++;current=null;return true;}};
  const pushManager={getSubscription:async()=>current,subscribe:async options=>{subscribed++;assert.equal(options.userVisibleOnly,true);assert.equal(options.applicationServerKey.length,65);current=device;return device;}};
  const registration={pushManager};
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    if(url==='/api/push'){getStatus++;return Response.json(getStatus===1?{configured:false,thisDevice:false,lastError:null}:{configured:true,thisDevice:true,lastStatus:'sent',lastError:null});}
    if(url==='/api/push/setup')return Response.json({publicKey});
    if(url==='/api/push/subscription')return Response.json({ok:true});
    if(url==='/api/push/subscription/delete')return Response.json({ok:true});
    throw Error('Unerwarteter Pfad');
  };
  const ui=await boot(t,{notification:true,fetchImpl,registration});
  assert.equal(ui.permissionRequests(),0);assert.match(ui.w.document.querySelector('#device-push-status').textContent,/noch nicht eingerichtet/);
  ui.w.document.querySelector('#device-push-enable').click();await ui.settle();
  assert.equal(ui.permissionRequests(),1);assert.equal(subscribed,1,'a new browser subscription is created after permission');
  const posted=calls.find(call=>call.url==='/api/push/subscription');assert.deepEqual(JSON.parse(posted.options.body),subscription);
  const status=ui.w.document.querySelector('#device-push-status').textContent;assert.match(status,/registriert/);assert.match(status,/nicht garantiert/);assert.doesNotMatch(status,/erfolgreich zugestellt/);
  ui.w.document.querySelector('#device-push-disable').click();await ui.settle();assert.equal(unsubscribed,1);assert.match(ui.w.document.querySelector('#device-push-status').textContent,/abgemeldet/);
  assert.equal(JSON.parse(calls.find(call=>call.url==='/api/push/subscription/delete').options.body).endpoint,endpoint);
});

test('manifest and offline shell contain the installable app assets without customer data endpoints',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.start_url,'/vor-ort');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons)assert.equal(existsSync(new URL('../public'+icon.src,import.meta.url)),true,icon.src);
  const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),literal=/const SHELL=(\[[^;]+\]);/.exec(source)[1],shell=vm.runInNewContext(literal);
  for(const path of ['/vor-ort','/device.js','/vor-ort.js','/style.css','/brand.css','/manifest.webmanifest','/icon-192.png'])assert.ok(shell.includes(path),path);
  assert.equal(shell.some(path=>path.startsWith('/api/')||path.startsWith('/auth/')),false);
});

test('service worker displays only generic allowed messages and navigates clicks to an internal panel route',async()=>{
  const listeners=new Map(),shown=[],opened=[];
  const client={url:origin+'/vor-ort',focused:0,navigated:'',async focus(){this.focused++;},async navigate(url){this.navigated=url;}};
  const self={location:{origin},registration:{showNotification:async(...args)=>{shown.push(args);}},clients:{matchAll:async()=>[client],openWindow:async url=>{opened.push(url);},claim:async()=>{}},addEventListener:(type,handler)=>listeners.set(type,handler)};
  vm.runInNewContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL,Response,console,caches:{}});
  const push=async data=>{let waiting;listeners.get('push')({data:{json:()=>data},waitUntil:promise=>{waiting=promise;}});await waiting;};
  await push({title:'White Gloss',body:'Neue Kundennachricht im Panel.',url:'/#chat',tag:'wg-chat'});
  await push({title:'White Gloss',body:'Kundin Erika: vertraulicher Text',url:'/#chat',tag:'wg-chat'});
  await push({title:'White Gloss',body:'Neue Website-Anfrage im Panel.',url:'https://evil.example.invalid',tag:'wg-website'});
  assert.equal(shown.length,1);assert.equal(shown[0][1].body,'Neue Kundennachricht im Panel.');assert.equal(shown[0][1].data.url,'/#chat');
  let waiting,closed=0;listeners.get('notificationclick')({notification:{data:{url:'/#chat'},close:()=>{closed++;}},waitUntil:promise=>{waiting=promise;}});await waiting;
  assert.equal(closed,1);assert.equal(client.focused,1);assert.equal(client.navigated,origin+'/#chat');assert.deepEqual(opened,[]);
});
