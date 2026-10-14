// Kundenportal: Zugriff nur auf eigene Aufträge, Dokumente, Unterschriften, Zusatzleistungen,
// Terminwünsche, Chat und Betreibervorschau. Alles im Prozess mit SQLite im Speicher, ohne Server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import worker,{getOrder,setting} from '../src/worker.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {chatNotificationsSettled} from '../server/chat.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='kundin@example.invalid';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const signature='data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(300)]).toString('base64');
async function session(env,email){const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();return '__Host-wg-session='+raw;}
async function fixture(t){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,4).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,o){files.set(id,{body:new Uint8Array(bytes),httpMetadata:o?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async request=>new Response('asset:'+new URL(request.url).pathname)}};
  t.after(async()=>{await chatNotificationsSettled();env.DB.close();});
  const app=await createApplication(env);
  const get=(path,cookie)=>app.fetch(new Request(origin+path,{headers:cookie?{cookie}:{}}));
  const post=(path,cookie,data,extra={})=>app.fetch(new Request(origin+path,{method:'POST',headers:{origin,'Content-Type':'application/json',...(cookie?{cookie}:{}),...extra},body:JSON.stringify(data??{})}));
  const ownerApi=(path,data)=>worker.fetch(new Request(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{origin,'oai-authenticated-user-email':owner,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}),env);
  const ok=async(response)=>{const d=await response.json();assert.equal(response.status,200,JSON.stringify(d));return d;};
  return {env,app,get,post,ownerApi,ok,files,owner:await session(env,owner),customer:await session(env,customer),stranger:await session(env,'fremd@example.invalid')};
}
async function order(env,{email=customer,synthetic=false,status='Termin verbindlich',extra={}}={}){
  const id=randomUUID(),wg='WG-'+id.slice(0,6),data={id,wg,status,synthetic,source:{name:'Erika Muster',email,vehicle:'VW Golf',plate:'FDS-WG 1',packageId:'premium',classId:'suv',package:'Reinigung & Politur'},assessment:{lines:[{id:'package',kind:'package',catalogId:'premium',title:'Reinigung & Politur',description:'',amountCents:43625}],condition:'',totalCents:43625,pickupCents:0,pricesReviewed:true,services:'Reinigung & Politur'},offer:{lines:[{id:'package',kind:'package',catalogId:'premium',title:'Reinigung & Politur',description:'',amountCents:43625}],totalCents:43625,pickupCents:0,services:'Reinigung & Politur'},notes:[],payments:[],createdAt:new Date().toISOString(),...extra};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(id,wg,status,JSON.stringify(data),new Date().toISOString(),'test','fixture',Number(synthetic)).run();
  return data;
}

test('portal page needs a sign-in and the login accepts only emails with an order',async t=>{
  const f=await fixture(t);
  const page=await f.get('/kunde');assert.equal(page.status,303);assert.equal(new URL(page.headers.get('location')).searchParams.get('returnTo'),'/kunde');
  assert.equal((await f.get('/api/portal/me')).status,401);
  assert.equal(await (await f.get('/kunde',f.customer)).text(),'asset:/kunde');
  const unknown=await f.post('/auth/request',null,{email:'niemand@example.invalid',returnTo:'/kunde'});assert.equal(unknown.status,200);const neutral=await unknown.json();
  await order(f.env);
  const known=await f.post('/auth/request',null,{email:customer.toUpperCase(),returnTo:'/kunde'});assert.equal(known.status,200,'same neutral answer while mail is not configured');
  assert.deepEqual(await known.json(),neutral,'the response does not reveal whether an order exists');
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM auth_tokens').first()).n,0);
});

test('customers see only their own real orders; trash, test data and other customers stay hidden',async t=>{
  const f=await fixture(t);
  const mine=await order(f.env,{email:'Kundin@Example.invalid '}),other=await order(f.env,{email:'fremd2@example.invalid'});
  await order(f.env,{synthetic:true});await order(f.env,{extra:{trash:{deletedAt:new Date().toISOString()}}});
  const me=await f.ok(await f.get('/api/portal/me',f.customer));
  assert.deepEqual(me.orders.map(o=>o.id),[mine.id]);assert.equal(me.customer.name,'Erika Muster');assert.equal(me.preview,false);
  const view=me.orders[0];assert.equal(view.step,3);assert.equal(view.offer.totalCents,43625);assert.ok(view.extras.length>0);assert.ok(!view.extras.some(e=>e.id==='scheinwerfer'),'not requestable');
  assert.equal(view.extras.find(e=>e.id==='tierhaar').priceCents,12375,'SUV factor 125 %');
  assert.equal((await f.get('/api/portal/o/'+other.id+'/pdf/acceptance',f.customer)).status,403);
  assert.equal((await f.post('/api/portal/o/'+other.id+'/extras',f.customer,{extraIds:['tierhaar']})).status,403);
  assert.equal((await f.ok(await f.get('/api/portal/me',f.stranger))).orders.length,0);
});

test('extras are requests: stored, posted to the chat and applied only by the owner',async t=>{
  const f=await fixture(t),o=await order(f.env,{extra:{acceptance:{at:new Date().toISOString(),signature:'x'}}});
  assert.equal((await f.post('/api/portal/o/'+o.id+'/extras',f.customer,{extraIds:['scheinwerfer']})).status,400);
  assert.equal((await f.post('/api/portal/o/'+o.id+'/extras',f.customer,{extraIds:['tierhaar']},{origin:'https://evil.example'})).status,403);
  const sent=await f.ok(await f.post('/api/portal/o/'+o.id+'/extras',f.customer,{extraIds:['tierhaar','ozon'],note:'Hund fährt oft mit'}));assert.match(sent.message,/ergänztes Angebot/);
  const msg=await f.env.DB.prepare("SELECT m.sender,m.body FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE t.order_id=?").bind(o.id).first();
  assert.equal(msg.sender,'customer');assert.match(msg.body,/Tierhaarentfernung – 123,75 €/);assert.match(msg.body,/Hund fährt oft mit/);
  const me=await f.ok(await f.get('/api/portal/me',f.customer));assert.equal(me.orders[0].requests[0].status,'offen');
  const list=await f.ok(await f.get('/api/portal-admin/requests',f.owner));assert.equal(list.requests.length,1);
  assert.equal((await f.get('/api/portal-admin/requests',f.customer)).status,403);
  const applied=await f.ok(await f.post('/api/portal-admin/request',f.owner,{id:sent.id,decision:'apply'}));assert.equal(applied.signed,true);
  const saved=await getOrder(f.env,o.id);
  assert.deepEqual(saved.assessment.lines.filter(l=>l.kind==='extra').map(l=>[l.catalogId,l.amountCents]),[['tierhaar',12375],['ozon',12375]]);
  assert.equal(saved.assessment.totalCents,43625+2*12375);assert.equal(saved.offer.totalCents,43625,'signed offer stays unchanged');
  assert.equal((await f.post('/api/portal-admin/request',f.owner,{id:sent.id,decision:'apply'})).status,409);
  const after=await f.ok(await f.get('/api/portal/me',f.customer));assert.ok(!after.orders[0].extras.some(e=>e.id==='tierhaar'),'already in assessment');assert.equal(after.orders[0].requests[0].status,'übernommen');
  await assert.rejects(()=>f.env.DB.prepare('DELETE FROM portal_requests').run(),/nicht gelöscht/);
});

test('appointment wishes and the chat link work for the customer; a revoked chat link stays revoked',async t=>{
  const f=await fixture(t),o=await order(f.env,{extra:{appointment:{start:'2030-10-14T07:00:00.000Z',end:'2030-10-14T13:00:00.000Z',delivery:'Kunde bringt',location:''}}});
  const wish=await f.ok(await f.post('/api/portal/o/'+o.id+'/termin',f.customer,{wish:'Lieber eine Woche später'}));
  const me=await f.ok(await f.get('/api/portal/me',f.customer));assert.equal(me.orders[0].appointment.start,'2030-10-14T07:00:00.000Z');assert.equal(me.orders[0].requests[0].kind,'termin');
  await f.ok(await f.post('/api/portal-admin/request',f.owner,{id:wish.id,decision:'done'}));
  const chat=await f.ok(await f.post('/api/portal/o/'+o.id+'/chat',f.customer,{}));assert.equal(chat.available,true);assert.match(chat.base,/^\/api\/kundenchat\/[a-f0-9]{64}$/);
  const messages=await f.ok(await f.get(chat.base,f.customer));assert.equal(messages.wg,o.wg);
  const again=await f.ok(await f.post('/api/portal/o/'+o.id+'/chat',f.customer,{}));assert.equal(again.base,chat.base,'same link');
  const thread=await f.env.DB.prepare('SELECT id FROM chat_threads WHERE order_id=?').bind(o.id).first();
  await f.ok(await f.post('/api/chats/t/'+thread.id+'/link',f.owner,{action:'revoke'}));
  const blocked=await f.ok(await f.post('/api/portal/o/'+o.id+'/chat',f.customer,{}));assert.equal(blocked.available,false);
  await f.ok(await f.post('/api/chats/t/'+thread.id+'/link',f.owner,{action:'create'}));
  assert.equal((await f.ok(await f.post('/api/portal/o/'+o.id+'/chat',f.customer,{}))).available,true);
});

test('pending protocol: the portal opens the signing link once and the customer signs it',async t=>{
  const f=await fixture(t),o=await order(f.env);
  let current=await getOrder(f.env,o.id);
  await f.ok(await f.ownerApi('action',{id:o.id,version:current.version,action:'protocolRequest',input:{kind:'intake',protocol:{plate:'FDS-WG 1'}}}));
  const me=await f.ok(await f.get('/api/portal/me',f.customer));assert.deepEqual(me.orders[0].todo.map(x=>x.kind),['sign-intake']);
  const first=await f.ok(await f.post('/api/portal/o/'+o.id+'/sign/intake',f.customer,{}));assert.match(first.url,/^\/dokument\/[a-f0-9]{64}$/);
  const second=await f.ok(await f.post('/api/portal/o/'+o.id+'/sign/intake',f.customer,{}));assert.equal(second.url,first.url,'valid link is reused');
  const route='/api/document/'+first.url.split('/').pop(),shown=await f.ok(await f.get(route,f.customer));
  await f.ok(await f.post(route,f.customer,{signature,confirmed:true,snapshotHash:digest(JSON.stringify(shown))}));
  current=await getOrder(f.env,o.id);assert.equal(current.intake.signedRemotely,true);
  const after=await f.ok(await f.get('/api/portal/me',f.customer));assert.equal(after.orders[0].todo.length,0);
  assert.deepEqual(after.orders[0].documents.map(d=>[d.kind,d.signed]),[['intake',true]]);
  const pdf=await f.get('/api/portal/o/'+o.id+'/pdf/intake',f.customer);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');
  assert.equal((await f.get('/api/portal/o/'+o.id+'/pdf/return',f.customer)).status,404);
  assert.equal((await f.post('/api/portal/o/'+o.id+'/sign/intake',f.customer,{})).status,409);
});

test('owner preview is read-only, review link appears after completion',async t=>{
  const f=await fixture(t),o=await order(f.env,{status:'Erledigt'});await order(f.env,{status:'Angenommen'});
  await setting(f.env,'reviewUrl','https://g.page/r/white-gloss-test/review');
  assert.equal((await f.get('/api/portal/me',f.owner)).status,400);
  const preview=await f.ok(await f.get('/api/portal/me?vorschau='+o.id,f.owner));assert.equal(preview.preview,true);assert.equal(preview.orders.length,2);
  assert.equal(preview.orders.find(x=>x.id===o.id).review,'https://g.page/r/white-gloss-test/review');
  assert.equal(preview.orders.find(x=>x.id!==o.id).review,null);
  assert.equal(preview.orders.find(x=>x.id===o.id).extras.length,0,'no extras after completion');
  assert.equal((await f.post('/api/portal/o/'+o.id+'/termin',f.owner,{wish:'Test'})).status,403);
});

test('review fixes: unsigned offer untouched by apply, single decision, closed orders, restricted records, read state',async t=>{
  const f=await fixture(t),open=await order(f.env,{status:'Angebot offen'});
  const sent=await f.ok(await f.post('/api/portal/o/'+open.id+'/extras',f.customer,{extraIds:['motor']}));
  const applied=await f.ok(await f.post('/api/portal-admin/request',f.owner,{id:sent.id,decision:'apply'}));assert.match(applied.message,/erst dann/);
  const saved=await getOrder(f.env,open.id);assert.equal(saved.offer.totalCents,43625,'customer cannot accept unreviewed extras');assert.ok(saved.assessment.lines.some(l=>l.catalogId==='motor'));
  assert.equal((await f.post('/api/portal-admin/request',f.owner,{id:sent.id,decision:'decline'})).status,409);
  const second=await f.ok(await f.post('/api/portal/o/'+open.id+'/extras',f.customer,{extraIds:['ozon']}));
  await f.env.DB.prepare("UPDATE orders SET status='Storniert',version=version+1,data=json_set(data,'$.status','Storniert') WHERE id=?").bind(open.id).run();
  assert.equal((await f.post('/api/portal-admin/request',f.owner,{id:second.id,decision:'apply'})).status,409);
  assert.equal((await f.env.DB.prepare('SELECT status FROM portal_requests WHERE id=?').bind(second.id).first()).status,'offen','failed apply leaves the wish open');
  const cancelled=await order(f.env,{status:'Storniert',extra:{appointment:{start:'2030-10-14T07:00:00.000Z',end:'2030-10-14T13:00:00.000Z'}}});
  assert.equal((await f.post('/api/portal/o/'+cancelled.id+'/termin',f.customer,{wish:'Bitte später'})).status,409);
  const blocked=await order(f.env,{extra:{recordsRestriction:{status:'blocked'}}});
  const me=await f.ok(await f.get('/api/portal/me',f.customer)),view=me.orders.find(o=>o.id===blocked.id);
  assert.equal(view.restricted,true);assert.equal(view.offer,null);assert.equal(view.appointment,null);assert.deepEqual(view.documents,[]);
  // A portal wish must not mark unread owner messages as read.
  const o=await order(f.env);const chat=await f.ok(await f.post('/api/portal/o/'+o.id+'/chat',f.customer,{}));
  const thread=await f.env.DB.prepare('SELECT id FROM chat_threads WHERE order_id=?').bind(o.id).first();
  await f.ok(await f.post('/api/chats/t/'+thread.id+'/message',f.owner,{text:'Neue Info vom Betrieb'}));
  await f.ok(await f.post('/api/portal/o/'+o.id+'/extras',f.customer,{extraIds:['motor']}));
  assert.equal((await f.env.DB.prepare('SELECT customer_read_id FROM chat_threads WHERE id=?').bind(thread.id).first()).customer_read_id,0);
  assert.ok(chat.available);
});

test('existing chats without a link count as revoked after the update',async t=>{
  const db=new PanelDatabase(':memory:');t.after(async()=>{await chatNotificationsSettled();db.close();});
  db.sql.exec("CREATE TABLE chat_threads(id TEXT PRIMARY KEY,order_id TEXT UNIQUE NOT NULL,token_hash TEXT UNIQUE,token_sealed TEXT,token_expires_at TEXT,closed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,last_at TEXT NOT NULL,owner_read_id INTEGER NOT NULL DEFAULT 0,customer_read_id INTEGER NOT NULL DEFAULT 0,owner_seen_at INTEGER NOT NULL DEFAULT 0,customer_seen_at INTEGER NOT NULL DEFAULT 0,owner_notified_id INTEGER NOT NULL DEFAULT 0,customer_notified_id INTEGER NOT NULL DEFAULT 0,owner_notified_at INTEGER NOT NULL DEFAULT 0,customer_notified_at INTEGER NOT NULL DEFAULT 0);INSERT INTO chat_threads(id,order_id,created_at,last_at) VALUES('a','order-a','x','x');INSERT INTO chat_threads(id,order_id,token_hash,created_at,last_at) VALUES('b','order-b','h','x','x');");
  await createApplication({PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,4).toString('base64'),DB:db,BUCKET:{async put(){},async get(){return null;},async delete(){}},ASSETS:{fetch:async()=>new Response('')}});
  assert.deepEqual(db.sql.prepare('SELECT id,link_revoked FROM chat_threads ORDER BY id').all().map(r=>[r.id,r.link_revoked]),[['a',1],['b',0]]);
  await createApplication({PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,4).toString('base64'),DB:db,BUCKET:{async put(){},async get(){return null;},async delete(){}},ASSETS:{fetch:async()=>new Response('')}});
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM chat_threads WHERE link_revoked=1').get().n,1,'migration runs once');
});

test('Codex review: no duplicate extra requests, restricted orders serve no files',async t=>{
  const f=await fixture(t),o=await order(f.env,{extra:{acceptance:{at:new Date().toISOString()}}});
  await f.ok(await f.post('/api/portal/o/'+o.id+'/extras',f.customer,{extraIds:['tierhaar']}));
  assert.equal((await f.post('/api/portal/o/'+o.id+'/extras',f.customer,{extraIds:['tierhaar']})).status,400,'already requested');
  const me=await f.ok(await f.get('/api/portal/me',f.customer));assert.ok(!me.orders[0].extras.some(e=>e.id==='tierhaar'));
  const blocked=await order(f.env,{extra:{acceptance:{at:new Date().toISOString()},recordsRestriction:{status:'blocked'}}});
  assert.equal((await f.get('/api/portal/o/'+blocked.id+'/pdf/acceptance',f.customer)).status,409);
  assert.equal((await f.get('/api/portal/o/'+blocked.id+'/rechnung.pdf',f.customer)).status,409);
});
