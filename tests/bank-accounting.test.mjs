import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {protect,setting} from '../src/worker.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',iban='DE89370400440532013000';
async function fixture(t){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(){},async get(){return null;},async delete(){}},ASSETS:{fetch:async()=>new Response('asset')}};
  t.after(()=>env.DB.close());const app=await createApplication(env),org=randomUUID();
  for(const [key,value] of Object.entries({qontoLogin:'test-login',qontoKey:await protect(env,'test-secret'),qontoVerified:true,qontoOrganizationId:org,qontoAccounts:[{iban,name:'Hauptkonto',main:true}]}))await setting(env,key,value);
  const session=async email=>{const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();return '__Host-wg-session='+raw;};
  const cookies={owner:await session(owner),customer:await session('customer@example.invalid')};
  const call=(path,role,body)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:cookies[role],...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  return {env,call,org};
}

test('Qonto bank sync is read-only, revisioned and manually classified by direction',async t=>{
  const f=await fixture(t),creditId=randomUUID(),debitId=randomUUID();
  const rows=[{id:creditId,side:'credit',status:'completed',amount_cents:10000,currency:'EUR',label:'Privatkunde',reference:'WG-4711',settled_at:'2026-10-17T11:00:00.000Z',updated_at:'2026-10-17T11:00:00.000Z'},
    {id:debitId,side:'debit',status:'completed',amount_cents:2500,currency:'EUR',label:'Reiniger',reference:'',settled_at:'2026-10-17T12:00:00.000Z',updated_at:'2026-10-17T12:00:00.000Z'}];
  const realFetch=globalThis.fetch,requests=[];globalThis.fetch=async(url,options)=>{const target=new URL(url);assert.equal(target.pathname,'/v2/transactions');assert.equal(target.searchParams.get('iban'),iban);assert.equal(options.method??'GET','GET');requests.push(target.href);return Response.json({transactions:rows,meta:{current_page:1,total_pages:1,total_count:rows.length,per_page:100}});};t.after(()=>{globalThis.fetch=realFetch;});
  assert.equal((await f.call('/api/accounting/bank/sync','customer',{})).status,403);
  const first=await (await f.call('/api/accounting/bank/sync','owner',{})).json();assert.equal(first.imported,2);assert.equal(first.checked,2);
  const again=await (await f.call('/api/accounting/bank/sync','owner',{})).json();assert.equal(again.imported,0);
  let data=await (await f.call('/api/accounting/bank','owner')).json();assert.equal(data.items.length,2);
  const credit=data.items.find(item=>item.providerId===creditId),debit=data.items.find(item=>item.providerId===debitId);
  assert.equal((await f.call('/api/accounting/bank/classify','owner',{revisionId:credit.revisionId,category:'PRIVATE_WITHDRAWAL'})).status,400);
  assert.equal((await f.call('/api/accounting/bank/classify','owner',{revisionId:credit.revisionId,version:0,category:'SERVICE_B2C',note:'Privatkunde, Dienstleistung'})).status,200);
  assert.equal((await f.call('/api/accounting/bank/classify','owner',{revisionId:debit.revisionId,version:0,category:'OPERATING_EXPENSE',note:'Qonto-Karte'})).status,200);
  assert.equal((await f.call('/api/accounting/bank/classify','owner',{revisionId:credit.revisionId,version:0,category:'SERVICE_B2B'})).status,409);
  rows[0]={...rows[0],status:'reversed',updated_at:'2026-10-18T11:00:00.000Z'};
  const changed=await (await f.call('/api/accounting/bank/sync','owner',{})).json();assert.equal(changed.imported,1);
  data=await (await f.call('/api/accounting/bank','owner')).json();assert.equal(data.items.find(item=>item.providerId===creditId).status,'reversed');
  assert.equal((await f.call('/api/accounting/bank/classify','owner',{revisionId:credit.revisionId,version:1,category:'SERVICE_B2C'})).status,409,'old bank revision cannot be classified');
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_bank_revisions').first()).n,3);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_bank_events').first()).n,5);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);assert.ok(requests.every(url=>url.startsWith('https://thirdparty.qonto.com/v2/transactions?')));
  await assert.rejects(()=>f.env.DB.prepare('DELETE FROM accounting_bank_revisions').run(),/nicht gelöscht/);
});

test('incomplete Qonto pagination leaves the local bank inbox untouched',async t=>{
  const f=await fixture(t),realFetch=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({transactions:[],meta:{current_page:1,total_pages:2,total_count:1,per_page:100}});t.after(()=>{globalThis.fetch=realFetch;});
  const response=await f.call('/api/accounting/bank/sync','owner',{});assert.equal(response.status,502);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_bank_revisions').first()).n,0);
});

test('one failed account prevents a partial multi-account bank import',async t=>{
  const f=await fixture(t),secondIban='DE44500105175407324931',realFetch=globalThis.fetch;
  await setting(f.env,'qontoAccounts',[{iban,name:'Hauptkonto'},{iban:secondIban,name:'Rücklagenkonto'}]);
  globalThis.fetch=async url=>{const account=new URL(url).searchParams.get('iban');return Response.json(account===iban?{transactions:[{id:randomUUID(),side:'credit',status:'completed',amount_cents:11900,currency:'EUR',label:'Kunde',reference:'',settled_at:'2026-10-17T11:00:00.000Z',updated_at:'2026-10-17T11:00:00.000Z'}],meta:{current_page:1,total_pages:1,total_count:1,per_page:100}}:{transactions:[],meta:{current_page:1,total_pages:1,total_count:1,per_page:100}});};t.after(()=>{globalThis.fetch=realFetch;});
  assert.equal((await f.call('/api/accounting/bank/sync','owner',{})).status,502);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_bank_revisions').first()).n,0);
});
