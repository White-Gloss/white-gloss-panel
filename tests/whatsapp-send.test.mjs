import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {mkdtemp,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
const settings={phoneNumberId:'123456789012345',graphVersion:'v99.1',accessToken:'synthetic-test-token',appSecret:'synthetic-secret',verifyToken:'synthetic-verify'};
const input=()=>({requestId:randomUUID(),phoneNumberId:settings.phoneNumberId,recipient:'+491700000000',confirmed:true});
async function fixture(t,{send,filename=':memory:'}={}){
  const sends=[],env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(filename),BUCKET:{async put(){},async get(){return null;},async delete(){}},ASSETS:{fetch:async()=>new Response('asset')},WHATSAPP_ADAPTERS:{async check(){return {id:settings.phoneNumberId,verified_name:'Test Number',display_phone_number:'+1 555 0000000'};},async sendTest(config,payload){sends.push({config,payload});return send?send(config,payload):{messages:[{id:'wamid.synthetic.review'}]};}}};
  t.after(()=>env.DB.close());let app=await createApplication(env);const raw=randomBytes(32).toString('hex'),other=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(other),'customer@example.invalid',Date.now()+3600000,Date.now()).run();
  const call=(path,body,authenticated=true,requestOrigin=origin)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin:requestOrigin,...(authenticated?{cookie:'__Host-wg-session='+(authenticated==='customer'?other:raw)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  assert.equal((await call('/api/whatsapp/settings',settings)).status,200);
  return {env,call,sends,async restart(){env.DB.close();env.DB=new PanelDatabase(filename);app=await createApplication(env);}};
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
  assert.equal((await f.call('/api/whatsapp/test-send',body,'customer')).status,403);
  assert.equal((await f.call('/api/whatsapp/test-send',body,true,'https://other.example.invalid')).status,403);
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);
  await f.call('/api/whatsapp/check',{});
  assert.equal((await f.call('/api/whatsapp/test-send',{...body,confirmed:false})).status,400);
  assert.equal((await f.call('/api/whatsapp/test-send',{...body,recipient:'01700000000'})).status,400);
  assert.equal((await f.call('/api/whatsapp/test-send',{...body,phoneNumberId:'999999999'})).status,409);
  assert.equal((await f.call('/api/whatsapp/test-send?test=true',body)).status,409);
  assert.equal(f.sends.length,0);
});

test('test send rejects malformed or coerced confirmations and recipients without invoking Meta',async t=>{
  const f=await fixture(t);await f.call('/api/whatsapp/check',{});
  for(const patch of [{confirmed:undefined},{confirmed:'true'},{confirmed:1},{requestId:'bad'},{requestId:[]},{requestId:randomUUID()+'\n'},{recipient:' +491700000000'},{recipient:'+491700000000 '},{recipient:'+491700000000\n'},{recipient:'+0123456789'},{recipient:'+491234567890123456'},{recipient:491700000000},{recipient:['+491700000000']}]){
    assert.equal((await f.call('/api/whatsapp/test-send',{...input(),...patch})).status,400,JSON.stringify(patch));
  }
  assert.equal(f.sends.length,0);
});

for(const fails of [false,true])test('a connection check cannot verify or invalidate replacement credentials: failure='+fails,async t=>{
  const f=await fixture(t);let release,started;const begun=new Promise(resolve=>{started=resolve;});const gate=new Promise(resolve=>{release=resolve;});
  f.env.WHATSAPP_ADAPTERS.check=async()=>{started();await gate;if(fails)throw Error('old-token error');return {id:settings.phoneNumberId};};
  const pending=f.call('/api/whatsapp/check',{});await begun;
  assert.equal((await f.call('/api/whatsapp/settings',{...settings,phoneNumberId:'999999999',accessToken:'replacement-synthetic'})).status,200);
  release();assert.equal((await pending).status,409);
  const row=await f.env.DB.prepare('SELECT * FROM whatsapp_settings WHERE id=1').first();assert.equal(row.phone_number_id,'999999999');assert.equal(row.verified_at,null);assert.equal(row.last_error,null);
  assert.equal((await f.call('/api/whatsapp/test-send',{...input(),phoneNumberId:'999999999'})).status,409);assert.equal(f.sends.length,0);
});

test('simultaneous distinct requests reserve only one send',async t=>{
  const f=await fixture(t);await f.call('/api/whatsapp/check',{});
  const results=await Promise.all([f.call('/api/whatsapp/test-send',input()),f.call('/api/whatsapp/test-send',input())]);
  assert.deepEqual(results.map(result=>result.status).sort(),[200,429]);assert.equal(f.sends.length,1);
});

test('the production fetch boundary uses only the fixed Meta endpoint and bearer header',async t=>{
  const f=await fixture(t);await f.call('/api/whatsapp/check',{});delete f.env.WHATSAPP_ADAPTERS.sendTest;let actual;
  t.mock.method(globalThis,'fetch',async(url,options)=>{actual={url,options};return Response.json({messages:[{id:'wamid.synthetic.http'}]});});
  const body=input(),response=await f.call('/api/whatsapp/test-send',body);assert.equal(response.status,200);
  assert.equal(actual.url,'https://graph.facebook.com/v99.1/123456789012345/messages');assert.equal(actual.options.method,'POST');assert.equal(actual.options.redirect,'manual');assert.equal(actual.options.headers.Authorization,'Bearer '+settings.accessToken);assert.ok(actual.options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(actual.options.body),{messaging_product:'whatsapp',to:body.recipient,type:'template',template:{name:'hello_world',language:{code:'en_US'}}});assert.equal(actual.options.body.includes(settings.accessToken),false);
});

for(const kind of ['invalid-json','missing-id','redirect','timeout'])test('uncertain Meta response is sanitized and cannot be resent: '+kind,async t=>{
  const f=await fixture(t);await f.call('/api/whatsapp/check',{});delete f.env.WHATSAPP_ADAPTERS.sendTest;let count=0;
  t.mock.method(globalThis,'fetch',async()=>{count++;if(kind==='timeout')throw Error(settings.accessToken);if(kind==='redirect')return new Response(null,{status:302,headers:{location:'https://other.example.invalid'}});if(kind==='invalid-json')return new Response(settings.accessToken);return Response.json({messages:[{}]});});
  const body=input(),response=await f.call('/api/whatsapp/test-send',body);assert.equal(response.status,502);assert.equal((await response.text()).includes(settings.accessToken),false);assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);assert.equal(count,1);
});

test('a database failure after provider acceptance does not allow a resend',async t=>{
  const f=await fixture(t);await f.call('/api/whatsapp/check',{});
  await f.env.DB.prepare("CREATE TRIGGER simulate_send_write_failure BEFORE UPDATE ON whatsapp_test_sends BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END").run();
  const body=input(),response=await f.call('/api/whatsapp/test-send',body);assert.equal(response.status,502);assert.equal((await response.text()).includes('synthetic storage failure'),false);
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);assert.equal(f.sends.length,1);
});

test('uncertain reservations and cooldown remain after reopening persistent storage',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'wg-wa-send-')),filename=join(directory,'panel.sqlite');
  const f=await fixture(t,{filename,send:async()=>{throw Error('synthetic uncertainty');}});await f.call('/api/whatsapp/check',{});const body=input();
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,502);await f.restart();
  assert.equal((await f.call('/api/whatsapp/test-send',body)).status,409);assert.equal((await f.call('/api/whatsapp/test-send',input())).status,429);assert.equal(f.sends.length,1);
  t.after(async()=>{for(const suffix of ['', '-wal','-shm'])await rm(filename+suffix,{force:true});await rmdir(directory);});
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
