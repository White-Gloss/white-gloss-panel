import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication,maintenance} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {getOrder,saveOrder,setting,protect,claimJob} from '../src/worker.mjs';
import {transitionOrderTrash,orderTrashStatements,resumePausedOrderJobs} from '../src/order-trash.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='customer@example.invalid';
async function fixture(t){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());const app=await createApplication(env);
  const cookie=async email=>{const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+600000,Date.now()).run();return '__Host-wg-session='+raw;};
  const ownerCookie=await cookie(owner),customerCookie=await cookie(customer);
  const expiresAt=new Date(Date.now()+14*86400000).toISOString(),offerToken=randomBytes(32).toString('hex'),documentToken=randomBytes(32).toString('hex'),invoiceToken=randomBytes(32).toString('hex'),chatToken=randomBytes(32).toString('hex');
  const o={id:randomUUID(),wg:'WG-TEST-TRASH',version:1,status:'Termin verbindlich',synthetic:false,source:{name:'Synthetischer Kunde',email:customer,vehicle:'Synthetisches Fahrzeug',reviewConsent:true},offer:{totalCents:11900,services:'Test',expiresAt},offerToken,acceptance:{at:'2026-10-01T10:00:00Z',signature:randomUUID(),snapshot:{source:{name:'Originalkunde'},offer:{totalCents:11900}}},intake:{at:'2026-10-01T11:00:00Z',customerSignature:randomUUID(),operatorSignature:randomUUID(),savedAt:'2026-10-01T11:00:00Z'},intakeHistory:[{customerSignature:randomUUID(),savedAt:'2026-09-01T11:00:00Z'}],return:{customerSignature:randomUUID(),savedAt:'2026-10-02T11:00:00Z'},invoice:{provider:'qonto',providerId:'synthetic-remote',status:'unpaid',number:'WG-TEST-TRASH',totalCents:11900},payments:[{id:randomUUID(),amountCents:1000,at:'2026-10-01T11:00:00Z'}],notes:[{at:'2026-10-01T10:00:00Z',text:'Originalnotiz'}],appointment:{start:'2026-11-05T09:00:00Z',end:'2026-11-05T10:00:00Z',location:'Synthetischer Ort'},pending:{intake:{createdAt:'2026-10-12T10:00:00Z',token:documentToken}}};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(o.id,o.wg,o.status,JSON.stringify(o),new Date().toISOString(),'test','Synthetischer Auftrag').run();
  await env.DB.prepare('INSERT INTO appointments VALUES(?,?,?)').bind(o.id,o.appointment.start,o.appointment.end).run();
  await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(offerToken),o.id,expiresAt).run();
  await env.DB.prepare('INSERT INTO document_requests(hash,order_id,kind,expires_at,created_at) VALUES(?,?,?,?,?)').bind(digest(documentToken),o.id,'intake',expiresAt,new Date().toISOString()).run();
  await env.DB.prepare('INSERT INTO invoice_tokens(hash,order_id,expires_at,created_at) VALUES(?,?,?,?)').bind(digest(invoiceToken),o.id,expiresAt,new Date().toISOString()).run();
  const chatId=randomUUID();await env.DB.prepare('INSERT INTO chat_threads(id,order_id,token_hash,token_sealed,token_expires_at,created_at,last_at) VALUES(?,?,?,?,?,?,?)').bind(chatId,o.id,digest(chatToken),'retained-sealed-token',expiresAt,new Date().toISOString(),new Date().toISOString()).run();
  await env.DB.prepare('INSERT INTO chat_messages(thread_id,sender,body,client_id,created_at) VALUES(?,?,?,?,?)').bind(chatId,'owner','Gespeicherte Nachricht','synthetic-message',new Date().toISOString()).run();
  const assetId=randomUUID(),bytes=new Uint8Array([1,2,3]);files.set(assetId,{body:bytes,httpMetadata:{contentType:'image/png'}});await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(assetId,o.id,'signature','image/png',digest(bytes),bytes.byteLength,new Date().toISOString()).run();
  const post=(path,data,cookie=ownerCookie)=>app.fetch(new Request(origin+path,{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify(data)}));
  const get=(path,cookie=ownerCookie)=>app.fetch(new Request(origin+path,{headers:{cookie}}));
  const action=(name,version=1,input={})=>post('/api/action',{id:o.id,version,action:name,input});
  return {env,app,order:o,files,assetId,chatId,chatToken,offerToken,documentToken,invoiceToken,post,get,action,ownerCookie,customerCookie};
}
async function job(env,orderId,kind,state,detail='Originaler Anbieterstatus'){
  const id=randomUUID(),at=new Date().toISOString();await env.DB.prepare('INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at,detail) VALUES(?,?,?,?,?,?,?)').bind(id,orderId,kind,state,at,at,detail).run();return id;
}

test('trash preserves originals, hides working lists, revokes customer links and pauses unsent work',async t=>{
  const f=await fixture(t),queued=await job(f.env,f.order.id,'invoice-mail','queued'),sent=await job(f.env,f.order.id,'protocol-intake','sent');
  const linked=await (await f.get('/api/state')).json(),customerId=linked.orders[0].customerId;
  let outbound=0;t.mock.method(globalThis,'fetch',()=>{outbound++;throw Error('No outbound action from deletion');});
  const removed=await f.action('deleteOrder',1,{reason:'Synthetische Löschprüfung'});assert.equal(removed.status,200);const deleted=await removed.json();assert.ok(deleted.trash.deletedAt);assert.equal(deleted.version,2);assert.equal(deleted.status,f.order.status);
  assert.equal(deleted.offerToken,undefined);assert.equal(deleted.pending.intake.token,undefined);
  for(const key of ['source','offer','acceptance','intake','intakeHistory','return','invoice','payments','notes','appointment'])assert.deepEqual(deleted[key],f.order[key],key+' original preserved');
  const state=await (await f.get('/api/state')).json();assert.equal(state.orders.length,0);assert.equal(state.trash.length,1);
  assert.equal((await (await f.get('/api/customer/'+customerId)).json()).orders.length,0);
  assert.equal((await (await f.get('/api/customers')).json()).customers[0].orderCount,0);
  assert.equal((await (await f.get('/api/chats')).json()).threads.length,0);
  assert.ok(!(await (await f.get('/api/calendar.ics')).text()).includes(f.order.wg));
  assert.equal((await f.get('/api/order/'+f.order.id)).status,200);assert.equal((await f.get('/api/asset/'+f.assetId)).status,200);
  for(const [path,token] of [['offer',f.offerToken],['document',f.documentToken],['rechnung',f.invoiceToken]])assert.equal((await f.get('/api/'+path+'/'+token,f.customerCookie)).status,404);
  assert.equal((await f.get('/api/kundenchat/'+f.chatToken,f.customerCookie)).status,404);
  assert.equal((await f.get('/api/state',f.customerCookie)).status,403);
  assert.equal((await f.get('/api/chats/t/'+f.chatId)).status,200,'owner can still read retained chat');
  assert.equal((await f.post('/api/chats/t/'+f.chatId+'/message',{text:'Forbidden'},f.ownerCookie)).status,409);
  for(const action of ['note','payment','sendOffer','invoice','invoiceMail'])assert.equal((await f.action(action,2,{})).status,409,action+' is blocked');
  await assert.rejects(claimJob(f.env,deleted,'reminder'),/Papierkorb/);
  await setting(f.env,'resendKey',await protect(f.env,'synthetic-key'));await setting(f.env,'emailVerified',true);await setting(f.env,'sendApproved',true);await setting(f.env,'backgroundApproved',true);
  assert.equal((await maintenance(f.env)).ok,true);assert.equal(outbound,0);
  assert.equal((await f.env.DB.prepare('SELECT state,detail FROM jobs WHERE id=?').bind(queued).first()).state,'paused');
  assert.equal((await f.env.DB.prepare('SELECT detail FROM jobs WHERE id=?').bind(queued).first()).detail,'Originaler Anbieterstatus');
  assert.equal((await f.env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(sent).first()).state,'sent');
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM chat_messages').first()).n,1);assert.equal(f.files.size,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM appointments').first()).n,0);
  const originalChat=await f.env.DB.prepare('SELECT token_hash,token_sealed,closed FROM chat_threads WHERE id=?').bind(f.chatId).first();assert.equal(originalChat.token_hash,digest(f.chatToken));assert.equal(originalChat.token_sealed,'retained-sealed-token');assert.equal(originalChat.closed,1);
  const restored=await f.action('restoreOrder',2);assert.equal(restored.status,200);const active=await restored.json();assert.equal(active.trash,undefined);assert.equal(active.version,3);assert.equal(active.trashHistory.length,2);
  assert.deepEqual(active.acceptance,f.order.acceptance);assert.deepEqual(active.intakeHistory,f.order.intakeHistory);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM appointments').first()).n,1);
  for(const table of ['offer_tokens','document_requests','invoice_tokens'])assert.equal((await f.env.DB.prepare('SELECT revoked FROM '+table+' WHERE order_id=?').bind(f.order.id).first()).revoked,1);
  assert.equal((await f.env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(queued).first()).state,'paused');assert.equal(outbound,0);
  await assert.rejects(f.env.DB.prepare('DELETE FROM orders WHERE id=?').bind(f.order.id).run(),/Aufträge werden nicht gelöscht/);
});

test('restoring a conflicting appointment fails atomically and keeps the order in trash',async t=>{
  const f=await fixture(t);assert.equal((await f.action('deleteOrder')).status,200);
  const other=randomUUID();await f.env.DB.prepare('INSERT INTO appointments VALUES(?,?,?)').bind(other,f.order.appointment.start,f.order.appointment.end).run();
  const result=await f.action('restoreOrder',2);assert.equal(result.status,409);assert.match((await result.json()).error,/überschneidet/);
  const retained=await getOrder(f.env,f.order.id);assert.ok(retained.trash.deletedAt);assert.equal(retained.version,2);assert.equal(retained.trashHistory.length,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM appointments WHERE order_id=?').bind(f.order.id).first()).n,0);
});

test('active or uncertain provider work blocks deletion without changing any record',async t=>{
  for(const state of ['pending','unknown','draft']){
    const f=await fixture(t);await job(f.env,f.order.id,'invoice',state);
    const result=await f.action('deleteOrder');assert.equal(result.status,409,state);assert.match((await result.json()).error,/Anbieteraktion.*nicht bestätigt/);
    assert.equal((await getOrder(f.env,f.order.id)).version,1);assert.equal((await getOrder(f.env,f.order.id)).trash,undefined);
    assert.equal((await f.env.DB.prepare('SELECT revoked FROM offer_tokens WHERE order_id=?').bind(f.order.id).first()).revoked,0);
    assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM appointments WHERE order_id=?').bind(f.order.id).first()).n,1);
  }
});

test('an in-flight provider job that starts after preflight aborts the deletion transaction',async t=>{
  const f=await fixture(t),updated=transitionOrderTrash(f.order,'deleteOrder'),operationId=randomUUID();updated.operationId=operationId;
  const statements=await orderTrashStatements(f.env,updated,'deleteOrder',operationId,2);
  await job(f.env,f.order.id,'reminder','pending');
  await assert.rejects(saveOrder(f.env,updated,1,'deleteOrder','owner',statements),/Anbieteraktion.*nicht bestätigt/);
  assert.equal((await getOrder(f.env,f.order.id)).trash,undefined);assert.equal((await getOrder(f.env,f.order.id)).version,1);
  assert.equal((await f.env.DB.prepare('SELECT revoked FROM offer_tokens WHERE order_id=?').bind(f.order.id).first()).revoked,0);
});

test('stale deletion side effects are guarded and an explicit retry releases only its matching paused job',async t=>{
  const f=await fixture(t),paused=await job(f.env,f.order.id,'invoice-mail','paused'),other=await job(f.env,f.order.id,'protocol-return','paused');
  const stale=transitionOrderTrash(f.order,'deleteOrder'),operationId=randomUUID();stale.operationId=operationId;const statements=await orderTrashStatements(f.env,stale,'deleteOrder',operationId,2);
  await saveOrder(f.env,{...f.order,notes:[{text:'Current'}]},1,'note');
  await assert.rejects(saveOrder(f.env,stale,1,'deleteOrder','owner',statements),/veraltet/);
  assert.equal((await f.env.DB.prepare('SELECT revoked FROM offer_tokens WHERE order_id=?').bind(f.order.id).first()).revoked,0);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM appointments WHERE order_id=?').bind(f.order.id).first()).n,1);
  const current=await getOrder(f.env,f.order.id);await resumePausedOrderJobs(f.env,current,'invoiceMail');
  assert.equal((await f.env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(paused).first()).state,'failed');assert.equal((await f.env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(other).first()).state,'paused');
  assert.throws(()=>transitionOrderTrash(current,'deleteOrder',{},undefined,'customer'),/Nur der Betreiber/);
});
