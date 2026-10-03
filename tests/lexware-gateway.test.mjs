import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication,configureFromEnvironment} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {settings,setting,unprotect,protect} from '../src/worker.mjs';
import {providerOperations} from '../server/providers.mjs';
const origin='https://panel.example.invalid',owner='owner@example.invalid';
async function fixture(t){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,8).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());const app=await createApplication(env);
  const raw='1'.repeat(64);await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+600000,Date.now()).run();
  return {env,app,cookie:'__Host-wg-session='+raw};
}
const post=(path,input,cookie)=>new Request(origin+path,{method:'POST',headers:{origin,'Content-Type':'application/json',cookie},body:JSON.stringify(input)});
test('new Lexware credential is encrypted, resets checks and stays outside operator state',async t=>{
  const {env,app,cookie}=await fixture(t);await setting(env,'lexwareVerified',true);await setting(env,'lexwareWebhookReady',true);
  await setting(env,'qontoKey',await protect(env,'legacy-qonto-secret'));
  const result=await app.fetch(post('/api/settings',{lexwareKey:'synthetic-lexware-secret'},cookie));assert.equal(result.status,200);
  const saved=await settings(env);assert.equal(await unprotect(env,saved.lexwareKey),'synthetic-lexware-secret');assert.notEqual(saved.lexwareKey,'synthetic-lexware-secret');assert.equal(saved.lexwareVerified,false);assert.equal(saved.lexwareWebhookReady,false);
  const state=await(await app.fetch(new Request(origin+'/api/state',{headers:{cookie}}))).json();
  assert.equal(state.settings.lexwareConfigured,true);assert.equal(state.integrationReady.lexware,false);assert.ok(!JSON.stringify(state).includes('synthetic-lexware-secret'));assert.ok(!JSON.stringify(state).includes('legacy-qonto-secret'));
  assert.equal(state.integrations.qonto,undefined);assert.equal(state.settings.qontoConfigured,undefined);
});
test('retired Qonto routes, environment access and settings cannot restart Qonto integration',async t=>{
  const {env,app,cookie}=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('No live provider');});
  env.QONTO_API_KEY='retired-env-secret';env.QONTO_LOGIN='retired-org';await configureFromEnvironment(env);assert.equal((await settings(env)).qontoKey,undefined);
  for(const path of ['/api/qonto/clients?id=x','/api/qonto/numbers']){
    const request=path.includes('clients')?new Request(origin+path,{headers:{cookie}}):post(path,{},cookie);
    assert.ok((await app.fetch(request)).status>=400);
  }
  assert.equal((await app.fetch(post('/api/check',{kind:'qonto'},cookie))).status,400);
  assert.equal((await app.fetch(post('/api/settings',{qontoKey:'retired-manual-key',qontoLogin:'retired-manual-org'},cookie))).status,200);
  assert.equal((await settings(env)).qontoKey,undefined);assert.equal(calls,0);
});
test('Lexware owner connection checks and credential entry reject customer and foreign origin',async t=>{
  const {env,app,cookie}=await fixture(t);
  t.mock.method(providerOperations,'lexwareCheck',async()=>{await setting(env,'lexwareVerified',true);});
  await setting(env,'lexwareKey',await protect(env,'synthetic-key'));
  assert.equal((await app.fetch(post('/api/check',{kind:'lexware'},cookie))).status,200);assert.equal((await settings(env)).lexwareVerified,true);
  const raw='2'.repeat(64);await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),'customer@example.invalid',Date.now()+600000,Date.now()).run();
  assert.equal((await app.fetch(post('/api/check',{kind:'lexware'},'__Host-wg-session='+raw))).status,403);
  assert.equal((await app.fetch(new Request(origin+'/api/settings',{method:'POST',headers:{origin:'https://evil.example.invalid','Content-Type':'application/json',cookie},body:JSON.stringify({lexwareKey:'foreign'})}))).status,403);
  assert.equal(await unprotect(env,(await settings(env)).lexwareKey),'synthetic-key');
});
test('private Lexware PDF download requires operator session and rejects anonymous/customer use',async t=>{
  const {env,app,cookie}=await fixture(t);
  const order={id:'pdf-order',wg:'WG-1',status:'Erledigt',source:{name:'Test'},synthetic:false,invoice:{provider:'lexware',id:'one'}};
  await env.DB.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)').bind(order.id,order.wg,null,1,order.status,JSON.stringify(order),new Date().toISOString(),'test','Test fixture',0).run();
  t.mock.method(providerOperations,'lexwarePDF',async(e,o)=>{assert.equal(o.id,order.id);return new Response('%PDF-1.7 synthetic',{headers:{'Content-Type':'application/pdf'}});});
  assert.equal((await app.fetch(new Request(origin+'/api/lexware/pdf?id='+order.id))).status,401);
  const raw='3'.repeat(64);await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),'customer@example.invalid',Date.now()+600000,Date.now()).run();
  assert.equal((await app.fetch(new Request(origin+'/api/lexware/pdf?id='+order.id,{headers:{cookie:'__Host-wg-session='+raw}}))).status,403);
  const response=await app.fetch(new Request(origin+'/api/lexware/pdf?id='+order.id,{headers:{cookie}}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-type'),/application\/pdf/);
});

