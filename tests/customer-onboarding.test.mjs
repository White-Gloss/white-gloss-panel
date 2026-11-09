import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {deliverCustomerCodes} from '../server/customer-auth.mjs';
import {saveCustomer} from '../src/customers.mjs';
import {createOrder,importWebsite,protect,setting} from '../src/worker.mjs';

const email='customer@example.invalid';

async function fixture(t){
 const env={DB:new PanelDatabase(':memory:'),PANEL_ORIGIN:'https://panel.example.invalid',OWNER_EMAIL_SHA256:digest('owner@example.invalid'),CONFIG_KEY:Buffer.alloc(32,8).toString('base64'),ASSETS:{fetch:async()=>new Response('asset')},BUCKET:{get:async()=>null}};
 t.after(()=>env.DB.close());
 await createApplication(env);
 await setting(env,'numberAudit',true);
 await setting(env,'resendKey',await protect(env,'synthetic-provider-key'));
 await setting(env,'emailVerified',true);
 await setting(env,'sendApproved',true);
 await setting(env,'sender','test@example.invalid');
 return env;
}

test('creating a customer keeps setup available without automatically emailing a code',async t=>{
 const env=await fixture(t),sent=[];
 t.mock.method(globalThis,'fetch',async(_url,options)=>{sent.push(JSON.parse(options.body));return Response.json({id:'synthetic-message'});});
 const customer=await saveCustomer(env,{synthetic:false,customer:{name:'Synthetic customer',email}});
 assert.equal(customer.email,email);
 await deliverCustomerCodes(env);
 assert.equal(sent.length,0);
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM auth_customer_codes').first()).n,0);
});

test('creating an order does not add an automatic account email to its correspondence',async t=>{
 const env=await fixture(t),sent=[];
 t.mock.method(globalThis,'fetch',async(_url,options)=>{sent.push(JSON.parse(options.body));return Response.json({id:'synthetic-message'});});
 const order=await createOrder(env,{name:'Synthetic customer',email,vehicle:'Test car'});
 assert.equal(order.source.email,email);
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM orders').first()).n,1);
 await deliverCustomerCodes(env);
 assert.equal(sent.length,0);
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM auth_customer_codes').first()).n,0);
});

test('website import and repeat import save one order without an automatic account email',async t=>{
 const env=await fixture(t),sent=[];
 await setting(env,'hubKey',await protect(env,'synthetic-hub-key'));
 await setting(env,'hubVerified',true);
 await setting(env,'websiteBaseline',{maxId:0});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(url==='https://white-gloss.de/api/hub')return Response.json({inquiries:[{id:68,phone:'0700000000',package_id:'premium',customer_name:'Synthetic customer',email,vehicle:'Test car',total_cents:10000,pickup_cents:0}]});
  assert.equal(url,'https://api.resend.com/emails');
  sent.push(JSON.parse(options.body));return Response.json({id:'synthetic-message'});
 });
 assert.equal((await importWebsite(env)).created,1);
 assert.equal((await importWebsite(env)).created,0);
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM orders').first()).n,1);
 await deliverCustomerCodes(env);
 assert.equal(sent.length,0);
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM auth_customer_codes').first()).n,0);
});
