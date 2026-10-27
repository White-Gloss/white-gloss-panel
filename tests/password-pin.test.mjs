import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest,issueCustomerAccess,redeemLogin,requestLogin,sessionIdentity} from '../server/auth.mjs';
import {protect,setting} from '../src/worker.mjs';
import {providerOperations} from '../server/providers.mjs';
const owner='owner@example.invalid',customer='customer@example.invalid',origin='https://panel.example.invalid',password='Synthetic password for tests only';
const post=(path,data,cookie,extra={})=>new Request(origin+path,{method:'POST',headers:{origin,'Content-Type':'application/json',...(cookie?{cookie}:{}),...extra},body:JSON.stringify(data)});
async function fixture(t){const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('shell')}};t.after(()=>env.DB.close());return {env,app:await createApplication(env)};}
async function login(env,email=owner,returnTo='/auth/password',now=Date.now()){
  const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_tokens(hash,email,return_to,expires_at) VALUES(?,?,?,?)').bind(digest(raw),email,returnTo,now+600000).run();
  const response=await redeemLogin(env,post('/auth/redeem',{token:raw}),now);assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
}
async function offer(env,synthetic=false){const raw=randomBytes(32).toString('hex'),id=randomBytes(16).toString('hex'),expiresAt=new Date(Date.now()+86400000).toISOString();const order={id,wg:'WG-'+id,version:1,status:'Angebot offen',synthetic,source:{name:'Synthetic customer',email:customer},offer:{totalCents:10000,expiresAt},offerToken:raw};await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture',Number(synthetic)).run();await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(raw),id,expiresAt).run();return order;}
async function configured(t){const f=await fixture(t),cookie=await login(f.env);const response=await f.app.fetch(post('/auth/password',{password,confirmation:password},cookie));assert.equal(response.status,200);return {...f,cookie:response.headers.get('set-cookie').split(';')[0]};}
test('first owner password needs fresh email proof; customer and forged origins cannot set it',async t=>{
  const {env,app}=await fixture(t),raw=randomBytes(32).toString('hex'),cookie='__Host-wg-session='+raw;
  await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+600000,Date.now()).run();
  assert.equal((await app.fetch(post('/auth/password',{password,confirmation:password},cookie))).status,409);
  const verified=await login(env);assert.equal((await app.fetch(post('/auth/password',{password,confirmation:password},verified,{origin:'https://evil.example.invalid'}))).status,403);
  assert.equal((await app.fetch(post('/auth/password',{password:'short',confirmation:'short'},verified))).status,400);
  assert.equal((await app.fetch(post('/auth/password',{password,confirmation:'different'},verified))).status,400);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM auth_passwords').first()).n,0);
  await env.DB.prepare('UPDATE auth_sessions SET email=? WHERE hash=?').bind(customer,digest(raw)).run();
  assert.equal((await app.fetch(post('/auth/password',{password,confirmation:password},cookie))).status,403);
});
test('owner login stores only salted slow hashes and does not expose them in panel state',async t=>{
  const {env,app,cookie}=await configured(t),row=await env.DB.prepare('SELECT * FROM auth_passwords').first();
  assert.match(row.salt,/^[a-f0-9]{64}$/);assert.match(row.derived,/^[a-f0-9]{128}$/);assert.ok(!JSON.stringify(row).includes(password));
  const state=await (await app.fetch(new Request(origin+'/api/state',{headers:{cookie}}))).text();assert.ok(!state.includes(row.salt)&&!state.includes(row.derived));
  assert.equal((await app.fetch(post('/auth/password/login',{email:owner,password:'incorrect'}))).status,401);
  assert.equal((await app.fetch(post('/auth/password/login',{email:customer,password}))).status,401);
  const result=await app.fetch(post('/auth/password/login',{email:owner.toUpperCase(),password,remember:true}));assert.equal(result.status,200);assert.match(result.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);assert.match(result.headers.get('set-cookie'),/Max-Age=2592000/);
  const sessionCookie=result.headers.get('set-cookie').split(';')[0];assert.equal((await env.DB.prepare('SELECT remember FROM auth_session_preferences WHERE session_hash=?').bind(digest(sessionCookie.split('=')[1])).first()).remember,1);
  assert.equal(await sessionIdentity(env,new Request(origin,{headers:{cookie:sessionCookie}})),owner);
});
test('password changes require current password or email reauthentication and revoke prior sessions and links',async t=>{
  const {env,app,cookie}=await configured(t);assert.equal((await app.fetch(post('/auth/password',{password,confirmation:password},cookie))).status,409);
  const unused='f'.repeat(64);await env.DB.prepare('INSERT INTO auth_tokens(hash,email,return_to,expires_at) VALUES(?,?,?,?)').bind(digest(unused),owner,'/',Date.now()+600000).run();
  const next='Another synthetic password for tests';const result=await app.fetch(post('/auth/password',{password:next,confirmation:next,currentPassword:password},cookie));assert.equal(result.status,200);
  assert.equal(await sessionIdentity(env,new Request(origin,{headers:{cookie}})),null);
  assert.equal((await redeemLogin(env,post('/auth/redeem',{token:unused}))).status,409);
  assert.equal((await app.fetch(post('/auth/password/login',{email:owner,password}))).status,401);
  assert.equal((await app.fetch(post('/auth/password/login',{email:owner,password:next}))).status,200);
});
test('concurrent first password setup has exactly one winner and one surviving owner session',async t=>{
  const {env,app}=await fixture(t),cookie=await login(env);
  const results=await Promise.all([app.fetch(post('/auth/password',{password,confirmation:password},cookie)),app.fetch(post('/auth/password',{password,confirmation:password},cookie))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM auth_passwords').first()).n,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM auth_sessions').first()).n,1);
});
test('expired email reauthentication cannot set a password; login retry limits persist in SQLite',async t=>{
  const {env,app}=await fixture(t),cookie=await login(env,owner,'/auth/password',Date.now()-601000);
  assert.equal((await app.fetch(post('/auth/password',{password,confirmation:password},cookie))).status,409);
  const bucket=Math.floor(Date.now()/3600000);await env.DB.prepare('INSERT INTO auth_rates VALUES(?,?,?) ON CONFLICT(subject,bucket) DO UPDATE SET count=excluded.count').bind(digest('password-email:'+owner),bucket,10).run();
  assert.equal((await app.fetch(post('/auth/password/login',{email:owner,password}))).status,429);
  assert.equal((await app.fetch(post('/auth/password/login',{email:owner,password},null,{origin:'https://evil.example.invalid'}))).status,403);
  assert.equal((await app.fetch(post('/auth/password/login',{email:owner,password:'x'.repeat(5000)}))).status,413);
});
test('email-confirmed recovery replaces a forgotten password without knowing the old one',async t=>{
  const {env,app}=await configured(t),cookie=await login(env),next='Recovered synthetic password for tests';
  assert.equal((await app.fetch(post('/auth/password',{password:next,confirmation:next},cookie))).status,200);
  assert.equal((await app.fetch(post('/auth/password/login',{email:owner,password:next}))).status,200);
});
test('customer needs both link and PIN; no plaintext PIN or token is stored and duplicate redemption fails',async t=>{
  const {env,app}=await fixture(t),order=await offer(env),access=await issueCustomerAccess(env,customer,'/angebot/'+order.offerToken),raw=new URL(access.url).searchParams.get('token');
  assert.match(access.pin,/^\d{6}$/);assert.ok(!access.url.includes(access.pin));
  const stored=await env.DB.prepare('SELECT * FROM auth_customer_pins').first();assert.notEqual(stored.pin_digest,access.pin);assert.equal(stored.login_hash,digest(raw));
  assert.equal((await app.fetch(post('/auth/redeem',{token:raw}))).status,400);
  const results=await Promise.all([app.fetch(post('/auth/redeem',{token:raw,pin:access.pin})),app.fetch(post('/auth/redeem',{token:raw,pin:access.pin}))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const result=results.find(r=>r.status===200),cookie=result.headers.get('set-cookie').split(';')[0];assert.equal((await result.json()).returnTo,'/angebot/'+order.offerToken);
  assert.equal((await app.fetch(new Request(origin+'/api/state',{headers:{cookie}}))).status,403);assert.equal((await app.fetch(new Request(origin+'/auth/password',{headers:{cookie}}))).status,403);
});
test('five incorrect PINs permanently close that one-use login and expired links fail',async t=>{
  const {env,app}=await fixture(t),order=await offer(env),access=await issueCustomerAccess(env,customer,'/angebot/'+order.offerToken),raw=new URL(access.url).searchParams.get('token'),wrong=access.pin==='000000'?'000001':'000000';
  for(let n=0;n<5;n++)assert.equal((await app.fetch(post('/auth/redeem',{token:raw,pin:wrong}))).status,401);
  assert.equal((await app.fetch(post('/auth/redeem',{token:raw,pin:access.pin}))).status,409);
  const expired=await issueCustomerAccess(env,customer,'/angebot/'+order.offerToken,Date.now(),Date.now()-1);assert.equal((await app.fetch(post('/auth/redeem',{token:new URL(expired.url).searchParams.get('token'),pin:expired.pin}))).status,409);
});
test('customer access refuses foreign, synthetic and revoked offers',async t=>{
  const {env}=await fixture(t),order=await offer(env),synthetic=await offer(env,true);
  await assert.rejects(issueCustomerAccess(env,'stranger@example.invalid','/angebot/'+order.offerToken));await assert.rejects(issueCustomerAccess(env,customer,'/angebot/'+synthetic.offerToken));
  await env.DB.prepare('UPDATE offer_tokens SET revoked=1 WHERE order_id=?').bind(order.id).run();await assert.rejects(issueCustomerAccess(env,customer,'/angebot/'+order.offerToken));
});
test('offer email includes the personal link and its distinct PIN in one email and is not resent',async t=>{
  const {env}=await fixture(t),order=await offer(env),messages=[];
  await setting(env,'resendKey',await protect(env,'synthetic-api-key'));await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);await setting(env,'sender','test@example.invalid');
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');messages.push(JSON.parse(options.body));return new Response(JSON.stringify({id:'synthetic-message'}));});
  await providerOperations.action(env,order,'sendOffer',{});assert.equal(messages.length,1);assert.deepEqual(messages[0].to,[customer]);assert.match(messages[0].text,/PIN: \d{6}/);
  const url=new URL(/https:\/\/\S+/.exec(messages[0].text)[0]),pin=/PIN: (\d{6})/.exec(messages[0].text)[1];assert.equal(url.origin,origin);assert.equal(url.searchParams.get('pin'),'required');
  assert.equal((await redeemLogin(env,post('/auth/redeem',{token:url.searchParams.get('token'),pin}))).status,200);
  await assert.rejects(providerOperations.action(env,order,'sendOffer',{}));assert.equal(messages.length,1);
});
test('customer requesting a replacement receives link and PIN together, owner recovery stays email-only',async t=>{
  const {env}=await fixture(t),order=await offer(env),messages=[];
  await setting(env,'resendKey',await protect(env,'synthetic-api-key'));await setting(env,'emailVerified',true);await setting(env,'sender','test@example.invalid');
  t.mock.method(globalThis,'fetch',async(url,options)=>{messages.push(JSON.parse(options.body));return new Response(JSON.stringify({id:'synthetic-message'}));});
  await requestLogin(env,post('/auth/request',{email:customer,returnTo:'/angebot/'+order.offerToken}));assert.match(messages[0].text,/PIN: \d{6}/);
  await requestLogin(env,post('/auth/request',{email:owner,returnTo:'/auth/password'}));assert.ok(!messages[1].text.includes('PIN:'));
  const url=new URL(/https:\/\/\S+/.exec(messages[1].text)[0]);const result=await redeemLogin(env,post('/auth/redeem',{token:url.searchParams.get('token')}));assert.equal((await result.json()).returnTo,'/auth/password');
});
