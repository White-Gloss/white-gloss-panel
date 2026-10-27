import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import webPush from 'web-push';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {notifyOwner,prunePush} from '../server/push.mjs';
import {portalNotice,chatNotificationsSettled} from '../server/chat.mjs';
import {unprotect} from '../src/worker.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='customer@example.invalid';
const endpoint='https://push.example.invalid/synthetic-device';
const subscription={endpoint,expirationTime:null,keys:{p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};
async function fixture(t){
  const sends=[],keys=webPush.generateVAPIDKeys();
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(){},async get(){return null;},async delete(){}},ASSETS:{fetch:async()=>new Response('shell')},PUSH_ADAPTERS:{generateVAPIDKeys:async()=>keys,send:async input=>{sends.push(input);}}};
  t.after(async()=>{await chatNotificationsSettled();env.DB.close();});
  const app=await createApplication(env);
  const session=async email=>{const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();return '__Host-wg-session='+raw;};
  const ownerCookie=await session(owner),customerCookie=await session(customer);
  const call=(path,body,role='owner',extra={})=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:role==='owner'?ownerCookie:role==='customer'?customerCookie:'',...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)}));
  return {env,app,call,ownerCookie,sends,keys};
}
async function register(f){
  const setup=await f.call('/api/push/setup',{});assert.equal(setup.status,200,await setup.text());
  const response=await f.call('/api/push/subscription',subscription);assert.equal(response.status,200,await response.text());
}

test('only an owner session can manage push; secrets and endpoints stay encrypted and logout revokes the device',async t=>{
  const f=await fixture(t);
  assert.equal((await f.call('/api/push',undefined,'anonymous')).status,401);
  assert.equal((await f.call('/api/push',undefined,'customer')).status,403);
  assert.equal((await f.call('/api/push/setup',{},'owner',{origin:'https://evil.example.invalid'})).status,403);
  const initial=await (await f.call('/api/push')).json();assert.deepEqual(initial,{configured:false,devices:0,thisDevice:false,lastUsedAt:null,lastStatus:null,lastError:null});
  assert.equal((await f.call('/api/push/subscription',subscription)).status,409);
  await register(f);
  const settings=await f.env.DB.prepare('SELECT * FROM push_settings WHERE id=1').first();
  assert.equal(settings.public_key,f.keys.publicKey);assert.equal(JSON.stringify(settings).includes(f.keys.privateKey),false);assert.equal(await unprotect(f.env,settings.private_key),f.keys.privateKey);
  const stored=await f.env.DB.prepare('SELECT * FROM push_subscriptions').first(),serialized=JSON.stringify(stored);
  for(const secret of [endpoint,subscription.keys.p256dh,subscription.keys.auth])assert.equal(serialized.includes(secret),false);
  assert.deepEqual(JSON.parse(await unprotect(f.env,stored.subscription_sealed)),subscription);
  const view=await (await f.call('/api/push')).json(),exposed=JSON.stringify(view);
  assert.equal(view.configured,true);assert.equal(view.devices,1);assert.equal(view.thisDevice,true);
  for(const secret of [endpoint,f.keys.privateKey,subscription.keys.p256dh,subscription.keys.auth])assert.equal(exposed.includes(secret),false);
  await f.env.DB.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,NULL,NULL,NULL)').bind('orphan','synthetic-sealed','f'.repeat(64),new Date().toISOString()).run();
  await prunePush(f.env);assert.equal(await f.env.DB.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint_hash='orphan'").first(),null);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions').first()).n,1);
  const logout=await f.app.fetch(new Request(origin+'/auth/logout',{method:'POST',headers:{origin,cookie:f.ownerCookie}}));assert.equal(logout.status,200);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions').first()).n,0);
});

test('provider acceptance is recorded without claiming delivery; expired devices are removed and transient failures retained',async t=>{
  const f=await fixture(t);await register(f);
  assert.deepEqual(await notifyOwner(f.env,'website'),{sent:1,failed:0,removed:0});assert.equal(f.sends.length,1);
  const sent=f.sends[0];assert.deepEqual(JSON.parse(sent.payload),{title:'White Gloss',body:'Neue Website-Anfrage im Panel.',url:'/#requests',tag:'wg-website'});
  assert.equal(sent.privateKey,f.keys.privateKey);assert.deepEqual(sent.subscription,subscription);
  assert.equal((await f.env.DB.prepare('SELECT last_status FROM push_subscriptions').first()).last_status,'sent');
  assert.equal((await (await f.call('/api/push')).json()).lastStatus,'sent');
  assert.deepEqual(await notifyOwner(f.env,'unbekannt'),{sent:0,failed:0,removed:0});assert.equal(f.sends.length,1);
  f.env.PUSH_ADAPTERS.send=async()=>{throw Object.assign(Error('synthetic gone'),{statusCode:410});};
  assert.deepEqual(await notifyOwner(f.env,'chat'),{sent:0,failed:0,removed:1});assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions').first()).n,0);
  await register(f);f.env.PUSH_ADAPTERS.send=async()=>{throw Object.assign(Error('synthetic outage'),{statusCode:500});};
  assert.deepEqual(await notifyOwner(f.env,'whatsapp'),{sent:0,failed:1,removed:0});
  const failed=await f.env.DB.prepare('SELECT last_status,last_error FROM push_subscriptions').first();assert.equal(failed.last_status,'failed');assert.equal(failed.last_error,'Push-Dienst: HTTP 500');
  const status=await (await f.call('/api/push')).json();assert.equal(status.thisDevice,true);assert.equal(status.lastError,'Push-Dienst: HTTP 500');assert.equal(JSON.stringify(status).includes('synthetic outage'),false);
});

test('malformed endpoints, keys, generated VAPID values and oversized input are rejected clearly',async t=>{
  const f=await fixture(t);
  f.env.PUSH_ADAPTERS.generateVAPIDKeys=async()=>({publicKey:'invalid',privateKey:'invalid'});
  const badSetup=await f.call('/api/push/setup',{});assert.equal(badSetup.status,502);assert.match((await badSetup.json()).error,/Schlüssel/);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM push_settings').first()).n,0);
  f.env.PUSH_ADAPTERS.generateVAPIDKeys=async()=>f.keys;await register(f);
  const invalid=[{...subscription,endpoint:'not-a-url'},{...subscription,endpoint:'http://push.example.invalid/device'},{...subscription,expirationTime:-1},{...subscription,keys:{...subscription.keys,p256dh:'abc'}},{...subscription,keys:{...subscription.keys,auth:Buffer.alloc(15).toString('base64url')}}];
  for(const value of invalid){const response=await f.call('/api/push/subscription',value);assert.equal(response.status,400,await response.text());}
  const oversized=await f.app.fetch(new Request(origin+'/api/push/subscription',{method:'POST',headers:{origin,cookie:f.ownerCookie,'Content-Type':'application/json'},body:'{"value":"'+('x'.repeat(10000))+'"}'}));assert.equal(oversized.status,413);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM push_subscriptions').first()).n,1);
});

test('portal notices send only generic chat hints and synthetic orders never trigger the provider',async t=>{
  const f=await fixture(t);await register(f);
  const add=async(synthetic)=>{const id=randomUUID(),wg=synthetic?'TEST-PUSH':'WG-PUSH',order={id,wg,version:1,status:'Angenommen',synthetic,source:{name:'Synthetische Kundin',email:customer},notes:[],payments:[],createdAt:new Date().toISOString()};await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(id,wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture',synthetic?1:0).run();return id;};
  const real=await add(false),synthetic=await add(true);
  assert.equal(await portalNotice(f.env,real,'Bitte den Termin verschieben.'),true);await chatNotificationsSettled();assert.equal(f.sends.length,1);
  assert.deepEqual(JSON.parse(f.sends[0].payload),{title:'White Gloss',body:'Neue Kundennachricht im Panel.',url:'/#chat',tag:'wg-chat'});
  assert.equal(f.sends[0].payload.includes('Termin'),false);assert.equal(f.sends[0].payload.includes('Kundin'),false);
  assert.equal(await portalNotice(f.env,synthetic,'TEST · synthetischer Hinweis'),true);assert.equal(f.sends.length,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM chat_messages').first()).n,2);
  await chatNotificationsSettled();
});
