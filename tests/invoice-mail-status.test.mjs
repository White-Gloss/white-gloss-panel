import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {invoiceMailSchema} from '../server/invoice-mail.mjs';
import {digest} from '../server/auth.mjs';

const owner='owner@example.invalid',origin='https://panel.example.invalid';
async function fixture(t){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('Synthetic shell')}};
  t.after(()=>env.DB.close());const app=await createApplication(env);await invoiceMailSchema(env);
  const cookies={};for(const [role,email] of Object.entries({owner,customer:'customer@example.invalid'})){
    const raw=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');cookies[role]='__Host-wg-session='+raw;
    await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+600000,Date.now()).run();
  }
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Status reads must not contact a provider');});
  const request=(path,role='owner',headers={})=>app.fetch(new Request(origin+path,{headers:{cookie:cookies[role]??'',...headers}}));
  async function order(invoiceMail){
    const value={id:randomUUID(),wg:'TEST-STATUS-'+randomUUID(),version:1,status:'Bezahlt',synthetic:false,source:{name:'Synthetic customer',email:'customer@example.invalid',vehicle:'Synthetic vehicle'},...(invoiceMail?{invoiceMail}:{})};
    await env.DB.prepare('INSERT INTO orders VALUES(?,?,NULL,?,?,?,?,?,?,0)').bind(value.id,value.wg,1,value.status,JSON.stringify(value),'2026-10-01T12:00:00Z','test','Synthetic status fixture').run();return value;
  }
  async function delivery(value,state,{leaseUntil=0}={}){
    const id=randomUUID(),version=digest('SYNTHETIC version '+id),at='2026-10-07T12:00:00Z';
    await env.DB.prepare('INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at,detail) VALUES(?,?,\'invoice-cash-mail\',?,?,?,?)').bind(id,value.id,state,at,at,state==='failed'?'SYNTHETIC canonical pre-contact failure':null).run();
    await env.DB.prepare('INSERT INTO invoice_mail_deliveries VALUES(?,?,?,?,?,?,?, ?,?)').bind(id,value.id,randomUUID(),version,'customer@example.invalid','{}',digest('{}'),leaseUntil,leaseUntil?'SYNTHETIC lease':'').run();
    return {id,version};
  }
  return {env,request,order,delivery,providerCalls:()=>calls};
}

test('owner state and order DTO use canonical sent/unknown/pending/failed delivery outcomes without rewriting orders',async t=>{
  const f=await fixture(t),expected=new Map();
  for(const state of ['sent','unknown','pending','failed']){
    const value=await f.order({state:'failed',message:'SYNTHETIC obsolete cached result'}),record=await f.delivery(value,state,{leaseUntil:state==='pending'?Date.now()+120000:0});expected.set(value.id,{state,version:record.version});
  }
  const before=(await f.env.DB.prepare('SELECT id,version,data FROM orders ORDER BY id').all()).results,auditBefore=(await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n;
  const response=await f.request('/api/state');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const state=await response.json();for(const value of state.orders){assert.equal(value.invoiceMail.state,expected.get(value.id).state);assert.equal(value.invoiceMail.version,expected.get(value.id).version);assert.ok(!value.invoiceMail.message.includes('obsolete'));}
  for(const [id,outcome] of expected){const one=await f.request('/api/order?id='+id);assert.equal(one.status,200);assert.equal((await one.json()).invoiceMail.state,outcome.state);}
  assert.deepEqual((await f.env.DB.prepare('SELECT id,version,data FROM orders ORDER BY id').all()).results,before);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n,auditBefore);assert.equal(f.providerCalls(),0);
});

test('expired interrupted delivery is shown as unknown even when cached order state says pending',async t=>{
  const f=await fixture(t),value=await f.order({state:'pending',message:'SYNTHETIC stale pending'}),record=await f.delivery(value,'pending',{leaseUntil:Date.now()-1});
  const response=await f.request('/api/order?id='+value.id),status=(await response.json()).invoiceMail;
  assert.equal(response.status,200);assert.equal(status.state,'unknown');assert.match(status.message,/Keine Wiederholung/);assert.equal(status.version,record.version);
  assert.equal((await f.env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(record.id).first()).state,'unknown');
  assert.equal(JSON.parse((await f.env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(value.id).first()).data).invoiceMail.state,'pending');
  assert.equal((await(await f.request('/api/state')).json()).orders[0].invoiceMail.state,'unknown');assert.equal(f.providerCalls(),0);
});

test('orders without a joined delivery retain pre-queue failures and do not gain a meaningless not-requested status',async t=>{
  const f=await fixture(t),legacy=await f.order(),failed=await f.order({state:'failed',message:'Rechnung fehlt. SYNTHETIC pre-queue proof'}),orphan=await f.order({state:'failed',message:'SYNTHETIC missing joined record'});
  const at='2026-10-07T12:00:00Z';await f.env.DB.prepare('INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at) VALUES(?,?,\'invoice-cash-mail\',\'unknown\',?,?)').bind(randomUUID(),orphan.id,at,at).run();
  const rows=(await(await f.request('/api/state')).json()).orders;
  assert.ok(!Object.hasOwn(rows.find(value=>value.id===legacy.id),'invoiceMail'));
  assert.deepEqual(rows.find(value=>value.id===failed.id).invoiceMail,failed.invoiceMail);assert.deepEqual(rows.find(value=>value.id===orphan.id).invoiceMail,orphan.invoiceMail);
  assert.deepEqual((await(await f.request('/api/order?id='+failed.id)).json()).invoiceMail,failed.invoiceMail);assert.equal(f.providerCalls(),0);
});

test('status projection remains owner-only and cannot be reached by anonymous or forged customer requests',async t=>{
  const f=await fixture(t),value=await f.order({state:'failed',message:'SYNTHETIC obsolete'}),record=await f.delivery(value,'pending',{leaseUntil:Date.now()-1});
  for(const path of ['/api/state','/api/order?id='+value.id]){
    assert.equal((await f.request(path,'')).status,401);
    assert.equal((await f.request(path,'customer',{'oai-authenticated-user-email':owner})).status,403);
  }
  assert.equal((await f.env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(record.id).first()).state,'pending');assert.equal(f.providerCalls(),0);
});
