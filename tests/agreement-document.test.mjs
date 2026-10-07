import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {setting} from '../src/worker.mjs';
import {agreementDocument} from '../server/agreement-document.mjs';
import {createTestLetterhead} from './fixtures/letterhead.mjs';
import {syntheticSignature} from './fixtures/signature.mjs';

async function fixture(t){
  const files=new Map(),origin='https://panel.example.invalid',email='synthetic@example.invalid',env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest('owner@example.invalid'),CONFIG_KEY:Buffer.alloc(32,2).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body){files.set(id,{body});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{async fetch(){return new Response('shell');}}};
  t.after(()=>env.DB.close());const app=await createApplication(env),snapshot={customer:'Original synthetic customer',vehicle:'Original synthetic vehicle',offer:{services:'Original synthetic service',totalCents:10000,cancellationPolicy:{version:'synthetic-original',terms:'Original accepted synthetic cancellation terms.'}}},proof={at:'2026-10-03T12:00:00Z',snapshotHash:digest(JSON.stringify(snapshot)),snapshot,signature:syntheticSignature,paymentObligation:true};
  const order={id:randomUUID(),wg:'TEST-AGREEMENT',version:1,status:'Bezahlt',synthetic:true,source:{name:'Later customer entry',email,vehicle:'Later vehicle entry'},offer:{services:'Later offer entry',totalCents:99999},acceptance:proof};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,1)').bind(order.id,order.wg,order.status,JSON.stringify(order),proof.at,'test','fixture').run();
  const cookies={};for(const [role,identity] of [['customer',email],['foreign','foreign@example.invalid'],['owner','owner@example.invalid']]){const raw=digest(role);cookies[role]='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),identity,Date.now()+600000,Date.now()).run();}
  const req=(query,role='customer')=>app.fetch(new Request(origin+'/api/customer-portal/agreement?id='+order.id+query,{headers:{...(cookies[role]?{cookie:cookies[role]}:{})}}));
  return {env,files,order,req};
}

test('own signed agreement PDF is blocked without letterhead and protects foreign and anonymous access',async t=>{
  const f=await fixture(t);assert.equal((await f.req('&format=pdf')).status,409);assert.equal((await f.req('&format=pdf','foreign')).status,404);assert.equal((await f.req('&format=pdf','anonymous')).status,401);assert.equal((await f.req('&format=pdf','owner')).ok,false);
  const original=await f.req('');assert.equal(original.status,200);assert.ok((await original.text()).includes('PDF auf Briefpapier herunterladen'));
  await createTestLetterhead(f.env);const pdf=await f.req('&format=pdf');assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.match(pdf.headers.get('content-disposition'),/TEST-AGREEMENT-Vereinbarung\.pdf/);
});

test('first agreement PDF is immutable across new templates, current offers and settings, and concurrent requests',async t=>{
  const f=await fixture(t);await createTestLetterhead(f.env);await setting(f.env,'cancellationPolicy',{version:'synthetic-later',terms:'Later current terms '.repeat(10000)});
  const source=structuredClone(f.order.acceptance),[first,second]=await Promise.all([agreementDocument(f.env,f.order),agreementDocument(f.env,f.order)]);assert.deepEqual(first.bytes,second.bytes);assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM agreement_documents').first()).n,1);
  const {PDFDocument}=await import('../dist/pdf/library.mjs');assert.equal((await PDFDocument.load(first.bytes)).getPageCount(),1);
  await createTestLetterhead(f.env,{marker:'TEST later template'});f.order.offer.services='Changed current offer';f.order.source.name='Changed source after issue';const saved=await agreementDocument(f.env,f.order);assert.deepEqual(saved.bytes,first.bytes);assert.deepEqual(f.order.acceptance,source);
});

test('accepted amendment creates its own immutable PDF while the original agreement remains intact',async t=>{
  const f=await fixture(t);await createTestLetterhead(f.env);const initial=await agreementDocument(f.env,f.order),id=randomUUID(),snapshot={customer:'Original amendment customer',vehicle:'Original amendment vehicle',amendment:{id,services:'Synthetic extra work',reason:'Synthetic reviewed addition',totalCents:13000,amountCents:3000}};
  f.order.amendments=[{id,state:'accepted',acceptance:{at:'2026-10-03T13:00:00Z',snapshotHash:digest(JSON.stringify(snapshot)),snapshot,signature:syntheticSignature}}];
  const amendment=await agreementDocument(f.env,f.order,id);assert.notDeepEqual(amendment.bytes,initial.bytes);assert.deepEqual((await agreementDocument(f.env,f.order)).bytes,initial.bytes);assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM agreement_documents').first()).n,2);
  await assert.rejects(agreementDocument(f.env,f.order,randomUUID()),/nicht gefunden/);
});

test('corrupt stored agreement, altered signatures and missing historic snapshots never produce replacement originals',async t=>{
  const f=await fixture(t);await createTestLetterhead(f.env);await agreementDocument(f.env,f.order);const row=await f.env.DB.prepare('SELECT * FROM agreement_documents').first();f.files.get(row.asset_id).body=new Uint8Array([1,2,3]);await assert.rejects(agreementDocument(f.env,f.order),/verändert/);
  const changed=structuredClone(f.order);changed.acceptance.snapshot.offer.services='Altered original';await assert.rejects(agreementDocument(f.env,changed),/Unterschriftsstand/);
  delete changed.acceptance.snapshot;await assert.rejects(agreementDocument(f.env,changed),/ursprüngliche/);assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM agreement_documents').first()).n,1);
});

test('long accepted terms remain readable across multiple letterhead pages',async t=>{
  const f=await fixture(t);await createTestLetterhead(f.env,{contentBox:{left:63,right:50,top:210,bottom:94}});f.order.acceptance.snapshot.offer.cancellationPolicy.terms='Synthetic accepted condition for the original document. '.repeat(300);
  const pdf=await agreementDocument(f.env,f.order),{PDFDocument}=await import('../dist/pdf/library.mjs'),doc=await PDFDocument.load(pdf.bytes);assert.ok(doc.getPageCount()>3);for(const page of doc.getPages()){assert.equal(page.getWidth(),595.28);assert.equal(page.getHeight(),841.89);}
});
