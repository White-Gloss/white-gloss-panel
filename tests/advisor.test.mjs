import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {csvCell} from '../server/advisor-finance.mjs';

const origin='https://panel.example.invalid',password='Ein langer Testsatz mit 24 Zeichen!',email='berater@example.invalid';
async function fixture(t){
  const files=new Map(),owner='owner@example.invalid',env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,3).toString('base64'),DB:new PanelDatabase(':memory:'),
    BUCKET:{async put(id,body){files.set(id,{body:new Uint8Array(body)});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());t.mock.method(globalThis,'fetch',async()=>{throw Error('No provider calls allowed');});
  const app=await createApplication(env),cookies={owner:'',customer:'',advisor:'',anonymous:''};
  for(const [role,address] of [['owner',owner],['customer','customer@example.invalid']]){const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),address,Date.now()+3600000,Date.now()).run();cookies[role]='__Host-wg-session='+raw;}
  const call=(path,role='advisor',body=undefined,extra={})=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:cookies[role],...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)}));
  const create=async()=>{const r=await call('/api/advisor/accounts','owner',{action:'create',company:'Testkanzlei',email});assert.equal(r.status,200,await r.clone().text());return r.json();};
  const enroll=async link=>{const token=new URLSearchParams(new URL(link.activationUrl).hash.slice(1)).get('einrichten');const r=await call('/api/advisor/enroll','anonymous',{email,token,password,confirmation:password});assert.equal(r.status,200,await r.clone().text());cookies.advisor=r.headers.get('set-cookie').split(';')[0];return token;};
  const grant=await create();await enroll(grant);
  const doc=async({synthetic=0,name='Rechnung.pdf'}={})=>{const id=randomUUID(),bytes=Buffer.from('%PDF-1.7\nSynthetic receipt only\n%%EOF');files.set(id,{body:bytes});await env.DB.prepare('INSERT INTO accounting_documents VALUES(?,?,?,?,?,?,?,?)').bind(id,synthetic,name,'application/pdf',digest(bytes),bytes.length,'2026-10-18T10:00:00.000Z','PANEL').run();return id;};
  const bank=async(provider=randomUUID())=>{await env.DB.prepare(`INSERT INTO accounting_bank_revisions(organization_id,account_iban,provider_id,sha256,status,side,amount_minor,currency,label,reference,settled_at,provider_updated_at,raw_json,received_at) VALUES('org','DE-test',?,?,'completed','credit',11900,'EUR','Test','WG-test','2026-10-18T10:00:00.000Z','2026-10-18T10:00:00.000Z','{}','2026-10-18T10:00:00.000Z')`).bind(provider,randomUUID()).run();return (await env.DB.prepare('SELECT MAX(revision_id) id FROM accounting_bank_revisions').first()).id;};
  return {env,files,app,cookies,call,create,enroll,grant,doc,bank};
}
const documentProposal=id=>({kind:'document',targetId:id,version:0,category:'RENT',paymentPath:'QONTO_TRANSFER',amountMinor:11900,documentDate:'2026-10-18',partner:'Testlieferant',note:'Bitte prüfen'});

test('manual owner account setup is isolated, hashed, revocable, replay-safe and never sends mail',async t=>{
  const f=await fixture(t),row=await f.env.DB.prepare('SELECT * FROM advisor_accounts').first();
  assert.equal(row.activation_hash,null);assert.equal(row.activation_expires,null);assert.notEqual(row.derived,password);assert.equal(row.derived.length,128);
  assert.equal((await f.call('/api/advisor/session')).status,200);
  for(const role of ['anonymous','customer'])for(const path of ['/api/advisor/documents','/api/advisor/bank','/api/advisor/invoices','/api/advisor/accounts'])assert.equal((await f.call(path,role)).status,401);
  assert.equal((await f.call('/api/advisor/accounts')).status,403);
  assert.equal((await f.call('/api/advisor/accounts','advisor',{action:'create',company:'Hack',email:'hack@example.invalid'})).status,403);
  for(const path of ['/api/orders','/api/settings','/api/accounting','/api/accounting/bank','/api/portal-admin/overview','/api/chats'])assert.equal((await f.call(path)).status,401,path);
  for(const path of ['/api/accounting/bank/sync','/api/accounting/classify','/api/action','/api/check'])assert.equal((await f.call(path,'advisor',{})).status,401,path);
  assert.equal((await f.call('/api/advisor/accounts','advisor',undefined,{'oai-authenticated-user-email':'owner@example.invalid'})).status,403);
  assert.equal((await f.call('/api/advisor/accounts','owner',{action:'create',company:'Test',email:'owner@example.invalid'})).status,400);
  assert.equal((await f.call('/api/advisor/accounts','owner',{action:'create',company:'Test',email})).status,409);
  assert.equal((await f.call('/api/advisor/accounts','owner',{action:'revoke',id:f.grant.id},{origin:'https://evil.invalid'})).status,403);
  const oldCookie=f.cookies.advisor;
  assert.equal((await f.call('/api/advisor/accounts','owner',{action:'revoke',id:f.grant.id})).status,200);
  assert.equal((await f.call('/api/advisor/session')).status,401);
  assert.equal((await f.call('/api/advisor/login','anonymous',{email,password})).status,401);
  const reset=await (await f.call('/api/advisor/accounts','owner',{action:'reset',id:f.grant.id})).json();
  const token=await f.enroll(reset);assert.notEqual(f.cookies.advisor,oldCookie);
  assert.equal((await f.call('/api/advisor/enroll','anonymous',{email,token,password,confirmation:password})).status,401);
  assert.equal((await f.call('/api/advisor/session','anonymous',undefined,{cookie:oldCookie})).status,401);
  assert.equal((await f.call('/api/advisor/login','anonymous',{email,password})).status,200);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);
});

test('comments and proposals are immutable; only owner accepts once with optimistic version check',async t=>{
  const f=await fixture(t),id=await f.doc();
  assert.equal((await f.call('/api/advisor/comments','advisor',{kind:'document',targetId:id,body:'Bitte Beleg prüfen <script>alert(1)</script>'})).status,200);
  assert.equal((await f.call('/api/advisor/comments?kind=document&targetId='+id)).status,200);
  assert.equal((await f.call('/api/advisor/comments','advisor',{kind:'document',targetId:id,body:'CSRF'},{origin:'https://evil.invalid'})).status,403);
  const proposal=await (await f.call('/api/advisor/proposals','advisor',documentProposal(id))).json();assert.ok(proposal.id);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_classifications').first()).n,0);
  assert.equal((await f.call('/api/advisor/decision','advisor',{id:proposal.id,decision:'accepted'})).status,403);
  const accepted=await f.call('/api/advisor/decision','owner',{id:proposal.id,decision:'accepted'});assert.equal(accepted.status,200,await accepted.text());
  assert.equal((await f.env.DB.prepare('SELECT version FROM accounting_classifications').first()).version,1);
  assert.equal((await f.call('/api/advisor/decision','owner',{id:proposal.id,decision:'accepted'})).status,409);
  assert.equal((await f.call('/api/advisor/proposals','advisor',documentProposal(id))).status,409);
  const p2=await (await f.call('/api/advisor/proposals','advisor',{...documentProposal(id),version:1})).json();
  assert.equal((await f.call('/api/accounting/classify','owner',{...documentProposal(id),documentId:id,version:1})).status,200);
  assert.equal((await f.call('/api/advisor/decision','owner',{id:p2.id,decision:'accepted'})).status,409);
  assert.equal((await f.call('/api/advisor/decision','owner',{id:p2.id,decision:'rejected'})).status,200);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_classifications').first()).n,2);
  for(const table of ['advisor_comments','advisor_proposals','advisor_decisions','advisor_audit'])await assert.rejects(()=>f.env.DB.prepare('DELETE FROM '+table).run(),/nicht gelöscht/);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);
});

test('bank proposals link real receipts, reject stale provider revisions and atomically record acceptance',async t=>{
  const f=await fixture(t),id=await f.doc(),synthetic=await f.doc({synthetic:1}),provider=randomUUID(),revision=await f.bank(provider);
  const proposal={kind:'bank',targetId:String(revision),version:0,category:'SERVICE_B2C',documentId:id,note:'Prüfen'};
  assert.equal((await f.call('/api/advisor/proposals','advisor',{...proposal,category:'PRIVATE_WITHDRAWAL'})).status,400);
  assert.equal((await f.call('/api/advisor/proposals','advisor',{...proposal,documentId:synthetic})).status,404);
  const saved=await (await f.call('/api/advisor/proposals','advisor',proposal)).json();
  const ok=await f.call('/api/advisor/decision','owner',{id:saved.id,decision:'accepted'});assert.equal(ok.status,200,await ok.text());
  assert.equal((await f.env.DB.prepare('SELECT document_id FROM accounting_bank_classifications').first()).document_id,id);
  const stale=await (await f.call('/api/advisor/proposals','advisor',{...proposal,version:1})).json();await f.bank(provider);
  assert.equal((await f.call('/api/advisor/decision','owner',{id:stale.id,decision:'accepted'})).status,409);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_bank_classifications').first()).n,1);
});

test('bank discussion follows provider transaction identity across revisions, while stale writes stay blocked',async t=>{
  const f=await fixture(t),provider=randomUUID(),old=await f.bank(provider),other=await f.bank();
  assert.equal((await f.call('/api/advisor/comments','advisor',{kind:'bank',targetId:'00'+old,body:'Vor dem Anbieterupdate'})).status,200);
  await f.call('/api/advisor/comments','advisor',{kind:'bank',targetId:String(other),body:'Andere Transaktion'});
  const current=await f.bank(provider);
  for(const id of [old,current]){const r=await f.call('/api/advisor/comments?kind=bank&targetId='+id);assert.equal(r.status,200);const data=await r.json();assert.deepEqual(data.items.map(x=>x.body),['Vor dem Anbieterupdate']);}
  assert.equal((await f.call('/api/advisor/comments','advisor',{kind:'bank',targetId:String(old),body:'Veralteter Stand'})).status,409);
  assert.equal((await f.call('/api/advisor/comments','advisor',{kind:'bank',targetId:String(current),body:'Nach dem Update'})).status,200);
  assert.equal((await (await f.call('/api/advisor/comments?kind=bank&targetId='+current)).json()).items.length,2);
});

test('receipt and bank pagination has no 200-row cap; exports are complete for the selected period',async t=>{
  const f=await fixture(t);for(let i=0;i<207;i++){await f.doc({name:i===0?'=DANGEROUS.pdf':'Beleg-'+i+'.pdf'});await f.bank();}const synthetic=await f.doc({synthetic:1});
  for(const kind of ['documents','bank']){
    let cursor=null,seen=[];do{const r=await f.call('/api/advisor/'+kind+(cursor?'?cursor='+cursor:'')),page=await r.json();assert.equal(r.status,200);seen.push(...page.items.map(x=>x.id));cursor=page.nextCursor;}while(cursor);
    assert.equal(seen.length,207);assert.equal(new Set(seen).size,207);assert.ok(!seen.includes(synthetic));
    const csv=await f.call('/api/advisor/export?kind='+kind+'&from=2026-10-01&to=2026-10-31');assert.equal(csv.status,200);assert.equal((await csv.text()).trim().split('\r\n').length,208);
  }
  assert.equal((await f.call('/api/advisor/document/'+synthetic)).status,404);
  const id=await f.doc();assert.equal((await f.call('/api/advisor/document/'+id)).status,200);f.files.get(id).body[8]=0;assert.equal((await f.call('/api/advisor/document/'+id)).status,503);
  assert.equal((await f.call('/api/advisor/export?kind=documents&from=2026-02-30&to=2026-10-31')).status,400);
  assert.equal((await f.call('/api/advisor/bank?cursor=NaN')).status,400);
});

test('invoice scope includes history but redacts customer tokens and reads only archived originals',async t=>{
  const f=await fixture(t),order=randomUUID(),invoice=randomUUID(),old=randomUUID(),asset=randomUUID(),at='2026-10-18T10:00:00.000Z';
  const data={source:{name:'Testkunde',email:'private@example.invalid',raw:{secret:'source-secret'}},invoice:{id:invoice,number:'INV-2',provider:'qonto',issueDate:'2026-10-18',status:'unpaid',totalCents:11900,portalToken:'private-token'},invoiceHistory:[{id:old,number:'INV-1',provider:'qonto',issueDate:'2026-10-01',status:'canceled',totalCents:10000}],notes:['private-note'],offerToken:'offer-secret'};
  await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(order,'WG-test','Erledigt',JSON.stringify(data),at,'test','test').run();
  const r=await f.call('/api/advisor/invoices'),body=await r.text();assert.equal(r.status,200,body);const list=JSON.parse(body);
  assert.equal(list.items.length,2);assert.equal(list.items.filter(x=>x.historical).length,1);for(const secret of ['private-token','private-note','offer-secret','source-secret','private@example.invalid'])assert.ok(!body.includes(secret));
  const path='/api/advisor/invoice-pdf?orderId='+order+'&invoiceId='+invoice;
  assert.equal((await f.call(path)).status,404);
  const bytes=Buffer.from('%PDF-1.7\nSynthetic invoice only\n%%EOF');f.files.set(asset,{body:bytes});
  await f.env.DB.prepare("INSERT INTO assets(id,order_id,kind,mime,hash,size,created_at) VALUES(?,?,'invoice','application/pdf',?,?,?)").bind(asset,order,digest(bytes),bytes.length,at).run();
  await f.env.DB.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?)').bind(order,invoice,asset,at).run();
  assert.equal((await f.call(path)).status,200);assert.equal((await f.call(path,'customer')).status,401);
  await f.env.DB.prepare('DELETE FROM invoice_documents WHERE order_id=?').bind(order).run();
  assert.equal((await f.call(path)).status,200,'archive mapping remains after current mapping is removed for reissue');
  const refreshed=await (await f.call('/api/advisor/invoices')).json();assert.equal(refreshed.items.find(x=>x.id===invoice).pdf_available,1);
  await assert.rejects(()=>f.env.DB.prepare('DELETE FROM invoice_document_history').run(),/nicht gelöscht/);
  assert.equal((await f.call('/api/advisor/export?kind=invoices&from=2026-10-01&to=2026-10-31')).status,200);
});

test('expired setup links, idle sessions and concurrent revocation fail closed',async t=>{
  const f=await fixture(t),reset=await (await f.call('/api/advisor/accounts','owner',{action:'reset',id:f.grant.id})).json();
  const token=new URLSearchParams(new URL(reset.activationUrl).hash.slice(1)).get('einrichten');await f.env.DB.prepare('UPDATE advisor_accounts SET activation_expires=0').run();
  assert.equal((await f.call('/api/advisor/enroll','anonymous',{email,token,password,confirmation:password})).status,401);
  const fresh=await (await f.call('/api/advisor/accounts','owner',{action:'reset',id:f.grant.id})).json();await f.enroll(fresh);
  await f.env.DB.prepare('UPDATE advisor_sessions SET last_at=?').bind(Date.now()-1800001).run();assert.equal((await f.call('/api/advisor/session')).status,401);
  const login=await f.call('/api/advisor/login','anonymous',{email,password});assert.equal(login.status,200);f.cookies.advisor=login.headers.get('set-cookie').split(';')[0];
  const id=await f.doc();const get=f.env.BUCKET.get;f.env.BUCKET.get=async key=>{await f.call('/api/advisor/accounts','owner',{action:'revoke',id:f.grant.id});return get(key);};
  assert.equal((await f.call('/api/advisor/document/'+id)).status,401,'revocation during async file load must not return bytes');
  assert.equal((await f.call('/api/advisor/comments','advisor',{kind:'document',targetId:id,body:'Late'})).status,401);
});

test('CSV escapes formulas without converting negative numeric values to text',()=>{
  for(const v of ['=HYPERLINK("x")',' +1','\t@SUM(1)','-1+2','\nvalue'])assert.ok(csvCell(v).startsWith('"\''));
  assert.equal(csvCell(-1200),'-1200');assert.equal(csvCell('a"b'),'"a""b"');
});
