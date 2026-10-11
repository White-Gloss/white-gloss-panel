import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication,maintenance} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {protect,setting,getOrder} from '../src/worker.mjs';
import {COMPANY} from '../src/company.mjs';
import {protocolDocument} from '../server/protocol-document.mjs';
import {deliverProtocol,pendingProtocolMails} from '../server/protocol-mail.mjs';
const origin='https://panel.example.invalid',owner=COMPANY.email;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
async function fixture(t,synthetic=false){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options.httpMetadata});},async get(id){return files.get(id);},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};t.after(()=>env.DB.close());
  const app=await createApplication(env),raw='c'.repeat(64),cookie='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+600000,Date.now()).run();
  const order={id:randomUUID(),wg:'WG-TEST-ONLY',version:1,status:'Termin verbindlich',synthetic,source:{name:'TEST · Kundin Şahin',email:'customer@example.invalid',vehicle:'TEST · Fahrzeug'},offer:{services:'TEST · Innenreinigung',totalCents:10000},appointment:{start:'2026-10-03T10:00:00Z',end:'2026-10-03T12:00:00Z',location:'Testort'},acceptance:{at:'2026-10-03T09:00:00Z'}};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture',Number(synthetic)).run();
  const request=async(path,data)=>app.fetch(new Request(origin+path,{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify(data)}));
  const upload=async(orderId,kind,params='')=>{const result=await app.fetch(new Request(origin+'/api/upload/'+orderId+'?kind='+kind+params,{method:'POST',headers:{origin,cookie,'Content-Type':'image/png'},body:png}));assert.equal(result.status,200);return (await result.json()).id;};
  await setting(env,'resendKey',await protect(env,'synthetic-key'));await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);await setting(env,'sender','test@example.invalid');
  async function signed(kind){const current=await getOrder(env,order.id),photo=await upload(order.id,'photo');const protocol={kind,plate:'TEST',at:'2026-10-03T14:00',location:'TEST · Übergabeort',condition:'TEST · Kratzer an Tür links',customerName:current.source.name,operatorName:COMPANY.owner,mileage:100,keys:1,delivery:'Kunde bringt',photos:[photo],...(kind==='return'?{services:'TEST · Innenreinigung abgeschlossen',openPoints:'Keine',workComplete:true}:{})};
    const prepared=await request('/api/protocol/prepare',{id:order.id,version:current.version,kind,protocol});assert.equal(prepared.status,200);const draft=await prepared.json();assert.deepEqual(draft.protocol.business,COMPANY);
    const params='&draft='+draft.id+'&hash='+draft.hash,a=await upload(order.id,'signature',params),b=await upload(order.id,'signature',params);
    return {version:current.version,input:{draftId:draft.id,snapshotHash:draft.hash,customerSignature:a,operatorSignature:b,signaturesConfirmed:true}};
  }
  return {env,app,files,order,cookie,request,signed};
}
test('intake and return each persist one signed PDF and send immediately to customer with owner CC',async t=>{
  const f=await fixture(t),sent=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push({payload:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return new Response(JSON.stringify({id:'mail-'+sent.length}));});
  for(const kind of ['intake','return']){
    const draft=await f.signed(kind),result=await f.request('/api/action',{id:f.order.id,version:draft.version,action:kind,input:draft.input});assert.equal(result.status,200);const order=await result.json();assert.equal(order.protocolDelivery.state,'sent');assert.equal(order.status,kind==='intake'?'In Arbeit':'Erledigt');
    const message=sent.at(-1).payload;assert.deepEqual(message.to,['customer@example.invalid']);assert.deepEqual(message.cc,[owner]);assert.equal(message.reply_to,owner);assert.equal(message.attachments.length,1);
    const pdf=Buffer.from(message.attachments[0].content,'base64');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    const {PDFDocument}=await import('../dist/pdf/library.mjs'),parsed=await PDFDocument.load(pdf);assert.equal(parsed.getAuthor(),COMPANY.name+' · '+COMPANY.owner);assert.ok(parsed.getPageCount()>=2);
    const download=await f.app.fetch(new Request(origin+'/api/protocol/pdf?id='+f.order.id+'&kind='+kind,{headers:{cookie:f.cookie}}));assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
    assert.equal((await f.request('/api/action',{id:f.order.id,version:draft.version,action:kind,input:draft.input})).status,409);
    await deliverProtocol(f.env,f.order.id,kind);assert.equal(sent.length,kind==='intake'?1:2);
  }
  assert.notEqual(sent[0].key,sent[1].key);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,2);
});
test('a provider timeout preserves signatures and PDF, records uncertainty and is never automatically resent',async t=>{
  const f=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('synthetic timeout');});
  const draft=await f.signed('intake'),result=await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input});assert.equal(result.status,200);const saved=await result.json();assert.equal(saved.status,'In Arbeit');assert.equal(saved.protocolDelivery.state,'unknown');assert.equal(saved.intake.customerSignature,draft.input.customerSignature);
  assert.ok((await f.env.DB.prepare('SELECT asset_id FROM protocol_deliveries').first()).asset_id);await pendingProtocolMails(f.env);await deliverProtocol(f.env,f.order.id,'intake');assert.equal(calls,1);
});
test('mail configuration failure keeps a durable queue; later maintenance sends the saved protocol once',async t=>{
  const f=await fixture(t),sent=[];await setting(f.env,'sendApproved',false);t.mock.method(globalThis,'fetch',async(url,options)=>{sent.push(JSON.parse(options.body));return new Response(JSON.stringify({id:'synthetic-id'}));});
  const draft=await f.signed('intake'),result=await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input});assert.equal(result.status,200);assert.equal((await result.json()).protocolDelivery.state,'failed');assert.equal(sent.length,0);
  await setting(f.env,'sendApproved',true);assert.equal((await maintenance(f.env)).ok,true);assert.equal(sent.length,1);await maintenance(f.env);assert.equal(sent.length,1);
});
test('synthetic protocols generate downloadable PDFs but never queue or send customer mail',async t=>{
  const f=await fixture(t,true);t.mock.method(globalThis,'fetch',()=>{throw Error('No test mail allowed');});const draft=await f.signed('intake'),result=await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input});assert.equal(result.status,200);assert.equal((await result.json()).protocolDelivery.state,'test');assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,0);const saved=await getOrder(f.env,f.order.id);assert.equal((await protocolDocument(f.env,saved,'intake')).bytes.subarray(0,5).toString(),new Uint8Array([37,80,68,70,45]).toString());
});
test('unsigned protocols and failed atomic storage never create a mail job',async t=>{
  const f=await fixture(t),draft=await f.signed('intake');
  t.mock.method(f.env.DB,'batch',()=>{throw Error('synthetic database failure');});assert.equal((await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input})).status,500);assert.equal((await getOrder(f.env,f.order.id)).status,'Termin verbindlich');assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,0);
  t.mock.restoreAll();const unsigned=await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:{protocol:{plate:'TEST'}}});assert.equal(unsigned.status,200);assert.equal((await unsigned.json()).status,'In Arbeit');assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,0);
});
test('corrupt or foreign photos stop PDF email and anonymous/customer PDF downloads are denied',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);const draft=await f.signed('intake');await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input});const saved=await getOrder(f.env,f.order.id);f.files.get(saved.intake.customerSignature).body=new Uint8Array([1,2]);await setting(f.env,'sendApproved',true);t.mock.method(globalThis,'fetch',()=>{throw Error('Corrupt PDF must not be sent');});assert.equal((await deliverProtocol(f.env,f.order.id,'intake')).state,'failed');
  assert.equal((await f.app.fetch(new Request(origin+'/api/protocol/pdf?id='+f.order.id+'&kind=intake'))).status,401);
  await f.env.DB.prepare('UPDATE auth_sessions SET email=?').bind('customer@example.invalid').run();assert.equal((await f.app.fetch(new Request(origin+'/api/protocol/pdf?id='+f.order.id+'&kind=intake',{headers:{cookie:f.cookie}}))).status,403);
});
test('simultaneous delivery workers claim one protocol email and use the persisted attachment',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',false);const draft=await f.signed('intake');await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input});await setting(f.env,'sendApproved',true);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({id:'synthetic-once'}));});
  await Promise.all([deliverProtocol(f.env,f.order.id,'intake'),deliverProtocol(f.env,f.order.id,'intake')]);assert.equal(calls,1);assert.equal((await f.env.DB.prepare("SELECT state FROM jobs WHERE kind='protocol-intake'").first()).state,'sent');assert.ok((await f.env.DB.prepare('SELECT asset_id FROM protocol_deliveries').first()).asset_id);
});
test('a queue insertion failure rolls back the signed order and its audit atomically',async t=>{
  const f=await fixture(t),draft=await f.signed('intake');await f.env.DB.prepare("CREATE TRIGGER reject_test_queue BEFORE INSERT ON protocol_deliveries BEGIN SELECT RAISE(ABORT,'synthetic queue error'); END").run();const before=(await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n;
  const result=await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input});assert.equal(result.status,500);assert.equal((await getOrder(f.env,f.order.id)).status,'Termin verbindlich');assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n,before);assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE kind='protocol-intake'").first()).n,0);
});
