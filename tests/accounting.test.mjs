import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid';
async function fixture(t){
  const files=new Map(),owner='owner@example.invalid',env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,3).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body){files.set(id,{body:new Uint8Array(body)});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')}};
  t.after(()=>env.DB.close());const app=await createApplication(env);
  const session=async email=>{const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();return '__Host-wg-session='+raw;};
  const cookies={owner:await session(owner),customer:await session('customer@example.invalid')};
  const call=(path,role,body,mime='application/json')=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:cookies[role],...(body===undefined?{}:{'Content-Type':mime})},body:body===undefined?undefined:mime==='application/json'?JSON.stringify(body):body}));
  return {env,call,files};
}

test('accounting profile is declared, while official Ist evidence and tax reserve stay pending/off',async t=>{
  const f=await fixture(t),result=await f.call('/api/accounting','owner'),data=await result.json();
  assert.equal(result.status,200);assert.equal(data.profile.profitMethod,'EUR');assert.equal(data.profile.vatTiming,'IST');
  assert.equal(data.profile.vatTimingEvidence,'USER_CONFIRMED_OFFICIAL_EVIDENCE_PENDING');assert.equal(data.profile.reserveMode,'OFF');
  assert.equal(data.profile.datevTarget,'DATEV');assert.equal((await f.call('/api/accounting','customer')).status,403);
});

test('original receipt is private and immutable; manual classification is versioned without posting',async t=>{
  const f=await fixture(t),pdf=Buffer.from('%PDF-1.7\nsynthetic receipt\n%%EOF');
  assert.equal((await f.call('/api/accounting/document?name=Rechnung.pdf','customer',pdf,'application/pdf')).status,403);
  assert.equal((await f.call('/api/accounting/document','owner',Buffer.from('not a PDF but sufficiently long'), 'application/pdf')).status,415);
  const uploaded=await f.call('/api/accounting/document?name=Rechnung.pdf','owner',pdf,'application/pdf');assert.equal(uploaded.status,200);const {id}=await uploaded.json();
  const document=await f.call('/api/accounting/document/'+id,'owner');assert.equal(document.status,200);assert.deepEqual(Buffer.from(await document.arrayBuffer()),pdf);
  assert.equal((await f.call('/api/accounting/document/'+id,'customer')).status,403);
  const first=await f.call('/api/accounting/classify','owner',{documentId:id,version:0,category:'CLEANING_SUPPLIES',paymentPath:'QONTO_CARD',amountMinor:11900,documentDate:'2026-10-17',partner:'Testlieferant',note:'Manuell geprüft'});
  assert.equal(first.status,200,await first.text());
  const stale=await f.call('/api/accounting/classify','owner',{documentId:id,version:0,category:'RENT',paymentPath:'CASH'});assert.equal(stale.status,409);
  const second=await f.call('/api/accounting/classify','owner',{documentId:id,version:1,category:'OTHER_EXPENSE',paymentPath:'PRIVATE',amountMinor:11900,note:'Korrigierter Entwurf'});assert.equal(second.status,200);
  const view=await (await f.call('/api/accounting','owner')).json();assert.equal(view.documents[0].classification.version,2);assert.equal(view.documents[0].classification.paymentPath,'PRIVATE');
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_classifications').first()).n,2);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_events').first()).n,3);
  await assert.rejects(()=>f.env.DB.prepare('DELETE FROM accounting_documents').run(),/nicht gelöscht/);
  await assert.rejects(()=>f.env.DB.prepare("UPDATE accounting_classifications SET category='RENT'").run(),/unveränderlich/);
  f.files.get(id).body[8]=0;assert.equal((await f.call('/api/accounting/document/'+id,'owner')).status,503,'altered bytes fail integrity check');
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0,'classification must not trigger payment, invoice or posting');
});

test('duplicate receipt keeps both receipt events and marks the duplicate for review',async t=>{
  const f=await fixture(t),pdf=Buffer.from('%PDF-1.7\nsynthetic duplicate receipt\n%%EOF');
  const a=await (await f.call('/api/accounting/document?name=a.pdf','owner',pdf,'application/pdf')).json();
  const b=await (await f.call('/api/accounting/document?name=b.pdf','owner',pdf,'application/pdf')).json();
  assert.notEqual(a.id,b.id);const list=await (await f.call('/api/accounting','owner')).json();
  assert.equal(list.documents.length,2);assert.ok(list.documents.every(x=>x.duplicateCount===2));
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_events').first()).n,2);
});
