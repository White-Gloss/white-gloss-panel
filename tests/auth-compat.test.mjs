import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {authSchema,digest,issueCustomerAccess,redeemLogin,sessionIdentity,pruneAuth,logout,REMEMBER_DEVICE_MS} from '../server/auth.mjs';

const owner='owner@example.invalid',customer='customer@example.invalid',origin='https://panel.example.invalid';
async function fixture(t){const env={DB:new PanelDatabase(':memory:'),OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),PANEL_ORIGIN:origin};t.after(()=>env.DB.close());await authSchema(env);return env;}
async function credential(env,email=customer,revision='current'){
  await env.DB.prepare('INSERT INTO auth_customer_credentials VALUES(?,?,?,?,?)').bind(email,'a'.repeat(64),'b'.repeat(128),revision,Date.now()).run();
}
async function session(env,email=customer,now=Date.now()){
  const raw=randomBytes(32).toString('hex'),hash=digest(raw);
  await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(hash,email,now+600000,now-1000).run();
  return {hash,request:new Request(origin,{headers:{cookie:'__Host-wg-session='+raw}})};
}
test('migrated customer credential revisions reject stale and unbound sessions without refreshing them',async t=>{
  const env=await fixture(t),now=Date.now();await credential(env);
  const {hash,request}=await session(env,customer,now);await env.DB.prepare('INSERT INTO auth_customer_sessions VALUES(?,?)').bind(hash,'previous').run();
  assert.equal(await sessionIdentity(env,request,now),null);
  assert.equal((await env.DB.prepare('SELECT last_at FROM auth_sessions WHERE hash=?').bind(hash).first()).last_at,now-1000);
  await env.DB.prepare('UPDATE auth_customer_sessions SET revision=? WHERE session_hash=?').bind('current',hash).run();
  assert.equal(await sessionIdentity(env,request,now),customer);
  await env.DB.prepare('DELETE FROM auth_customer_sessions WHERE session_hash=?').bind(hash).run();
  assert.equal(await sessionIdentity(env,request,now),null);
});
test('owner and customers without a persistent credential retain their existing session access',async t=>{
  const env=await fixture(t);await credential(env,owner);
  assert.equal(await sessionIdentity(env,(await session(env,owner)).request),owner);
  assert.equal(await sessionIdentity(env,(await session(env)).request),customer);
});
test('a verified one-time customer PIN binds its session to the existing credential revision',async t=>{
  const env=await fixture(t);await credential(env);
  const id=randomUUID(),token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+86400000).toISOString(),order={id,wg:'WG-TEST',source:{email:customer},synthetic:false};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(id,order.wg,'Angebot offen',JSON.stringify(order),new Date().toISOString(),'test','synthetic fixture').run();
  await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(token),id,expiresAt).run();
  const access=await issueCustomerAccess(env,customer,'/angebot/'+token),loginToken=new URL(access.url).searchParams.get('token');
  const response=await redeemLogin(env,new Request(origin+'/auth/redeem',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({token:loginToken,pin:access.pin,remember:true})}));
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=86400/);const cookie=response.headers.get('set-cookie').split(';')[0],hash=digest(cookie.split('=')[1]),request=new Request(origin,{headers:{cookie}});
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM auth_session_preferences').first()).n,0);
  assert.equal((await env.DB.prepare('SELECT revision FROM auth_customer_sessions WHERE session_hash=?').bind(hash).first()).revision,'current');
  assert.equal(await sessionIdentity(env,request),customer);
  await env.DB.prepare('UPDATE auth_customer_credentials SET revision=? WHERE email=?').bind('replacement',customer).run();
  assert.equal(await sessionIdentity(env,request),null);
});
test('pruning removes revision proofs for expired sessions and preserves active proofs',async t=>{
  const env=await fixture(t),now=Date.now(),active=await session(env,customer,now),expired=await session(env,customer,now-86400000);
  for(const record of [active,expired])await env.DB.prepare('INSERT INTO auth_customer_sessions VALUES(?,?)').bind(record.hash,'current').run();
  await pruneAuth(env,now);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM auth_customer_sessions').first()).n,1);
  assert.ok(await env.DB.prepare('SELECT 1 FROM auth_customer_sessions WHERE session_hash=?').bind(active.hash).first());
});
async function rememberedOwner(env,now){
  const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_tokens(hash,email,return_to,expires_at) VALUES(?,?,?,?)').bind(digest(raw),owner,'/vor-ort',now+600000).run();
  const response=await redeemLogin(env,new Request(origin+'/auth/redeem',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({token:raw,remember:true})}),now);
  assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];return {response,cookie,hash:digest(cookie.split('=')[1]),request:new Request(origin,{headers:{cookie}})};
}
test('explicit owner device login survives the normal idle limit but expires after thirty days and logout',async t=>{
  const env=await fixture(t),now=Date.now(),login=await rememberedOwner(env,now);
  assert.match(login.response.headers.get('set-cookie'),/Max-Age=2592000/);
  assert.equal(await sessionIdentity(env,login.request,now+4*3600000+1),owner);
  assert.equal(await sessionIdentity(env,login.request,now+REMEMBER_DEVICE_MS+1),null);
  const second=await rememberedOwner(env,now),logoutResponse=await logout(env,new Request(origin+'/auth/logout',{method:'POST',headers:{origin,cookie:second.cookie}}));
  assert.equal(logoutResponse.status,200);assert.match(logoutResponse.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal(await sessionIdentity(env,second.request,now),null);
});
test('normal sessions stay short and pruning respects only the remembered owner lifetime',async t=>{
  const env=await fixture(t),now=Date.now(),normal=await session(env,owner,now),remembered=await rememberedOwner(env,now);
  assert.equal(await sessionIdentity(env,normal.request,now+4*3600000+1),null);
  await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind('normal-prune',owner,now+86400000,now).run();
  await pruneAuth(env,now+4*3600000+1);
  assert.equal(await env.DB.prepare("SELECT 1 FROM auth_sessions WHERE hash='normal-prune'").first(),null);
  assert.ok(await env.DB.prepare('SELECT 1 FROM auth_sessions WHERE hash=?').bind(remembered.hash).first());
  await pruneAuth(env,now+REMEMBER_DEVICE_MS+1);
  assert.equal(await env.DB.prepare('SELECT 1 FROM auth_sessions WHERE hash=?').bind(remembered.hash).first(),null);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM auth_session_preferences').first()).n,0);
});
