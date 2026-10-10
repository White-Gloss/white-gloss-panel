import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {getOrder,importWebsite,protect,setting} from '../src/worker.mjs';
import {normalizeSource} from '../src/domain.mjs';
import {indexCustomerFiles} from '../server/customer-files.mjs';
import {customerLifecyclePreview,changeCustomerLifecycle} from '../server/records-lifecycle.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
async function fixture(t){
  const env={DB:new PanelDatabase(':memory:'),PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,24).toString('base64'),ASSETS:{fetch:async()=>new Response('TEST shell')},BUCKET:{async get(){return null;}}};
  t.after(()=>env.DB.close());const app=await createApplication(env),raw=digest('TEST-source-race');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  await setting(env,'numberAudit',true);await env.DB.prepare("UPDATE sequences SET value=9 WHERE name='WG'").run();
  const req=input=>app.fetch(new Request(origin+'/api/create',{method:'POST',headers:{origin,'Content-Type':'application/json',cookie:'__Host-wg-session='+raw},body:JSON.stringify(input)}));
  const addCustomer=async(source,synthetic)=>{const id=digest((synthetic?'test:':'live:')+'email:'+source.email);await env.DB.prepare('INSERT INTO customer_files(id,data,synthetic) VALUES(?,?,?)').bind(id,JSON.stringify(source),Number(synthetic)).run();return id;};
  // Complete the real read preflight, then let a real customer restriction transaction win.
  const blockAfterPreflight=id=>{const original=env.assertCustomerSourceActive;let changed=false;env.assertCustomerSourceActive=async(...args)=>{await original(...args);if(!changed){changed=true;const preview=await customerLifecyclePreview(env,id,owner);await changeCustomerLifecycle(env,{...preview,mode:'block',reason:'TEST · Restriction wins race',confirmed:true},owner);}};};
  return {env,req,addCustomer,blockAfterPreflight};
}

for(const synthetic of [true,false])test('createOrder transaction rejects a customer blocked after preflight ('+(synthetic?'synthetic':'isolated live scope')+')',async t=>{
  const f=await fixture(t);t.mock.method(globalThis,'fetch',()=>{throw Error('External requests are forbidden in this test');});
  // Also exercise a preexisting development database with the earlier unnamed CHECK.
  if(synthetic){await f.env.DB.prepare('DROP TABLE customer_files_cas_guard').run();await f.env.DB.prepare('CREATE TABLE customer_files_cas_guard(value INTEGER NOT NULL CHECK(value=1))').run();}
  const source={name:'TEST · Race Customer',email:synthetic?'synthetisch@example.invalid':'race@example.invalid',phone:'+49 111 111111',vehicle:'TEST · Car'},cid=await f.addCustomer(source,synthetic);f.blockAfterPreflight(cid);
  const response=await f.req({source,synthetic});
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);assert.equal((await f.env.DB.prepare("SELECT value FROM sequences WHERE name='WG'").first()).value,9);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n,0);
  assert.equal(JSON.parse((await f.env.DB.prepare('SELECT data FROM customer_files WHERE id=?').bind(cid).first()).data).lifecycle.status,'blocked');
  assert.equal(response.status,409,await response.clone().text());assert.match((await response.json()).error,/gesperrt/);
});

test('existing website import rolls back source and audit when the target identity is blocked after preflight',async t=>{
  const f=await fixture(t),oldSource=normalizeSource({id:'123',name:'TEST · Original Customer',email:'old@example.invalid',vehicle:'TEST · Original Car',amountCents:0}),nextSource={id:'123',name:'TEST · Changed Customer',email:'next@example.invalid',phone:'+49 222 222222',vehicle:'TEST · Changed Car',amountCents:0},id=crypto.randomUUID(),at='2026-10-09T10:00:00.000Z';
  const order={id,wg:'TEST-import-race',source:oldSource,status:'Preise prüfen',synthetic:false,notes:[],payments:[],createdAt:at};
  await f.env.DB.prepare('INSERT INTO orders(id,wg,website_id,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?,0)').bind(id,order.wg,'123',order.status,JSON.stringify(order),at,'test','Synthetic import fixture').run();await indexCustomerFiles(f.env);
  const before=await f.env.DB.prepare('SELECT * FROM order_files WHERE order_id=?').bind(id).first(),cid=await f.addCustomer(nextSource,false);f.blockAfterPreflight(cid);
  await setting(f.env,'hubKey',await protect(f.env,'TEST-only-key'));await setting(f.env,'hubVerified',true);await setting(f.env,'websiteBaseline',{maxId:0,at});
  let requests=0;t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://white-gloss.de/api/hub');assert.equal(options.method,'POST');requests++;return Response.json({inquiries:[nextSource]});});
  const result=await importWebsite(f.env).catch(error=>({error}));assert.equal(requests,1);
  const saved=await getOrder(f.env,id);assert.deepEqual(saved.source,oldSource);assert.equal(saved.version,1);assert.deepEqual(await f.env.DB.prepare('SELECT * FROM order_files WHERE order_id=?').bind(id).first(),before);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM audit WHERE order_id=?').bind(id).first()).n,1);assert.equal((await f.env.DB.prepare("SELECT value FROM sequences WHERE name='WG'").first()).value,9);
  assert.equal(result.error,undefined,'A lost source guard must skip this import instead of failing the complete run');assert.equal(result.updated,0);assert.equal(result.created,0);assert.equal(result.skipped,1);
});
