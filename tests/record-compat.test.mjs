import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {getOrder,setting,protect,background} from '../src/worker.mjs';
import {providerOperations} from '../server/providers.mjs';
import {lexwareInvoice} from '../server/lexware.mjs';
import {assertCurrentRecordOperation} from '../src/record-compat.mjs';

const owner='owner@example.invalid',customer='customer@example.invalid',origin='https://panel.example.invalid';
async function fixture(t,extra={}){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('synthetic shell')}};t.after(()=>env.DB.close());
  const app=await createApplication(env),raw=randomBytes(32).toString('hex'),cookie='__Host-wg-session='+raw,expiresAt=new Date(Date.now()+86400000).toISOString(),token=randomBytes(32).toString('hex');
  await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+600000,Date.now()).run();
  const order={id:randomUUID(),wg:'WG-TEST',version:1,status:'Angebot offen',synthetic:false,source:{name:'TEST',email:customer,vehicle:'TEST'},offer:{services:'TEST',totalCents:1000,expiresAt},offerToken:token,...extra};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','synthetic fixture').run();
  await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(token),order.id,expiresAt).run();
  await setting(env,'resendKey',await protect(env,'synthetic-key'));await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);await setting(env,'sender','test@example.invalid');
  const post=(path,input,identityCookie=cookie)=>app.fetch(new Request(origin+path,{method:'POST',headers:{origin,cookie:identityCookie,'Content-Type':'application/json'},body:JSON.stringify(input)}));
  return {env,app,order,cookie,post};
}
test('blocked and anonymized legacy records remain readable but reject operational writes and provider calls',async t=>{
  for(const status of ['blocked','anonymized']){
    const f=await fixture(t,{recordsRestriction:{status}});t.mock.method(globalThis,'fetch',()=>{throw Error('No provider calls for restricted records');});
    assert.equal((await f.app.fetch(new Request(origin+'/api/order/'+f.order.id,{headers:{cookie:f.cookie}}))).status,200);
    for(const action of ['price','payment','onsiteAccept','sendOffer','invoice'])assert.equal((await f.post('/api/action',{id:f.order.id,version:1,action,input:{}})).status,409,action);
    await assert.rejects(lexwareInvoice(f.env,f.order,{}),/Kundenakte ist gesperrt/);
    const note=await f.post('/api/action',{id:f.order.id,version:1,action:'note',input:{note:'TEST · interne Aktennotiz'}});assert.equal(note.status,200);
    assert.equal((await getOrder(f.env,f.order.id)).recordsRestriction.status,status);
    t.mock.restoreAll();
  }
});
test('a legacy document cancellation preserves the original and blocks new signatures and financial actions',async t=>{
  const cancellation={documentKey:'intake',scope:'document-only',at:'2026-10-01T10:00:00Z',reason:'TEST'},f=await fixture(t,{documentCancellations:[cancellation]});
  assert.equal((await f.app.fetch(new Request(origin+'/api/order/'+f.order.id,{headers:{cookie:f.cookie}}))).status,200);
  for(const action of ['price','onsiteAccept','intake','return','payment','invoice'])assert.equal((await f.post('/api/action',{id:f.order.id,version:1,action,input:{}})).status,409,action);
  const raw=randomBytes(32).toString('hex');await f.env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),customer,Date.now()+600000,Date.now()).run();
  assert.equal((await f.post('/api/offer/'+f.order.offerToken,{},'__Host-wg-session='+raw)).status,409);
  assert.deepEqual((await getOrder(f.env,f.order.id)).documentCancellations,[cancellation]);
});
test('background reminders and reviews do not resume for restricted records',async t=>{
  const f=await fixture(t,{status:'Termin verbindlich',recordsRestriction:{status:'blocked'},acceptance:{at:new Date().toISOString()},appointment:{start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+90000000).toISOString(),delivery:'Kunde bringt'}});
  await setting(f.env,'backgroundApproved',true);let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('Restricted mail must not be sent');});
  await background(f.env);assert.equal(calls,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);
});
test('a block applied after login-link creation wins before the offer email is requested',async t=>{
  const f=await fixture(t),batch=f.env.DB.batch.bind(f.env.DB);let blocked=false,calls=0;
  t.mock.method(f.env.DB,'batch',async statements=>{
    const result=await batch(statements);
    if(!blocked&&(await f.env.DB.prepare('SELECT COUNT(*) n FROM auth_tokens').first()).n){blocked=true;await f.env.DB.prepare("UPDATE orders SET data=json_set(data,'$.recordsRestriction.status','blocked'),version=version+1 WHERE id=?").bind(f.order.id).run();}
    return result;
  });
  t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('Blocked offer must not be sent');});
  await assert.rejects(providerOperations.action(f.env,f.order,'sendOffer',{}),/verändert|gesperrt/);
  assert.equal(blocked,true);assert.equal(calls,0);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='offer'").first()).state,'failed');
});
test('the immediate provider guard reads current restrictions while allowing retained original reads',async t=>{
  const f=await fixture(t);await f.env.DB.prepare("UPDATE orders SET data=json_set(data,'$.recordsRestriction.status','anonymized'),version=version+1 WHERE id=?").bind(f.order.id).run();
  assert.throws(()=>assertCurrentRecordOperation(f.env,f.order,'send'),/Kundenakte ist gesperrt/);
  assert.doesNotThrow(()=>assertCurrentRecordOperation(f.env,f.order,'read-original'));
});
