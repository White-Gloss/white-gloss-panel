import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
const settings={phoneNumberId:'123456789012345',graphVersion:'v99.1',accessToken:'synthetic-test-token',appSecret:'synthetic-secret',verifyToken:'synthetic-verify'};
const input=()=>({requestId:randomUUID(),phoneNumberId:settings.phoneNumberId,recipient:'+491700000000',confirmed:true});
async function fixture(t,{send}={}){
  const sends=[],env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(){},async get(){return null;},async delete(){}},ASSETS:{fetch:async()=>new Response('asset')},WHATSAPP_ADAPTERS:{async check(){return {id:settings.phoneNumberId,verified_name:'Test Number',display_phone_number:'+1 555 0000000'};},async sendTest(config,payload){sends.push({config,payload});return send?send(config,payload):{messages:[{id:'wamid.synthetic.review'}]};}}};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const call=(path,body,authenticated=true,requestOrigin=origin)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin:requestOrigin,...(authenticated?{cookie:'__Host-wg-session='+raw}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  assert.equal((await call('/api/whatsapp/settings',settings)).status,200);
  return {env,call,sends};
}

test('confirmed test send uses only the fixed Meta template and a repeated request cannot send twice',async t=>{
  const f=await fixture(t);await f.call('/api/whatsapp/check',{});const body=input();
  const first=await f.call('/api/whatsapp/test-send',body),result=await first.json();
  assert.equal(first.status,200,JSON.stringify(result));assert.equal(result.providerMessageId,'wamid.synthetic.review');assert.equal(result.accepted,true);
  assert.equal(f.sends.length,1);assert.deepEqual(f.sends[0].payload,{messaging_product:'whatsapp',to:body.recipient,type:'template',template:{name:'hello_world',language:{code:'en_US'}}});
  assert.equal(f.sends[0].config.accessToken,settings.accessToken);
  const duplicate=await f.call('/api/whatsapp/test-send',body);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);assert.equal(f.sends.length,1);
  assert.equal((await f.call('/api/whatsapp/test-send',{...body,recipient:'+491700000001'})).status,409);assert.equal(f.sends.length,1);
  const stored=JSON.stringify((await f.env.DB.prepare('SELECT * FROM whatsapp_test_sends').all()).results);
  assert.equal(stored.includes(settings.accessToken),false);assert.equal(stored.includes(body.recipient),false);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);
});

test('test send requires owner session, same origin, current verified sender and explicit recipient confirmation',async t=>{
  const f=await fixture(t),body=input();
  assert.equal((await f.call('/api/whatsapp/test-send',body,false)).status,401);
  assert.equal((await f.call('/api/whatsapp/test-send',body,true,'https://other.example.invalid')).status,403);
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);
  await f.call('/api/whatsapp/check',{});
  assert.equal((await f.call('/api/whatsapp/test-send',{...body,confirmed:false})).status,400);
  assert.equal((await f.call('/api/whatsapp/test-send',{...body,recipient:'01700000000'})).status,400);
  assert.equal((await f.call('/api/whatsapp/test-send',{...body,phoneNumberId:'999999999'})).status,409);
  assert.equal((await f.call('/api/whatsapp/test-send?test=true',body)).status,409);
  assert.equal(f.sends.length,0);
});

test('uncertain send outcome is never automatically retried and provider secrets are not disclosed',async t=>{
  const f=await fixture(t,{send:async()=>{throw Error('provider leaked '+settings.accessToken);}});await f.call('/api/whatsapp/check',{});const body=input();
  const first=await f.call('/api/whatsapp/test-send',body);assert.equal(first.status,502);assert.equal((await first.text()).includes(settings.accessToken),false);
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);assert.equal(f.sends.length,1);
  assert.equal((await f.call('/api/whatsapp/test-send',input())).status,429);assert.equal(f.sends.length,1);
});

test('concurrent test sends reserve only one external send and block another request during the cooldown',async t=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});const f=await fixture(t,{send:async()=>{await wait;return {messages:[{id:'wamid.synthetic.concurrent'}]};}});await f.call('/api/whatsapp/check',{});const body=input(),first=f.call('/api/whatsapp/test-send',body);
  for(let i=0;i<100&&!f.sends.length;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(f.sends.length,1);
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);
  assert.equal((await f.call('/api/whatsapp/test-send',input())).status,429);
  release();assert.equal((await first).status,200);assert.equal(f.sends.length,1);
});

