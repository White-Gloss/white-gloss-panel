import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest,issueCustomerAccess} from '../server/auth.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',business='fleet@example.invalid',stranger='other@example.invalid';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
async function fixture(t){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,body,options){files.set(id,{body:new Uint8Array(body),httpMetadata:options.httpMetadata});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('asset')}};
  t.after(()=>env.DB.close());const app=await createApplication(env);
  const session=async email=>{const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+3600000,Date.now()).run();return '__Host-wg-session='+raw;};
  const cookies={owner:await session(owner),business:await session(business),stranger:await session(stranger)};
  const call=(path,role,body)=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:cookies[role],...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}));
  const photo=(path,role,body,mime='image/png')=>app.fetch(new Request(origin+path,{method:'POST',headers:{origin,cookie:cookies[role],'Content-Type':mime},body}));
  const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
  const customer=async(email=business,company='Fuhrpark GmbH')=>{const id=randomUUID(),at=new Date().toISOString();await env.DB.prepare('INSERT INTO customers(id,data,search,synthetic,version,created_at,updated_at) VALUES(?,?,?,0,1,?,?)').bind(id,JSON.stringify({name:'Fuhrpark Kontakt',company,email,emailKey:email}),company.toLowerCase(),at,at).run();return id;};
  return {env,app,call,photo,ok,customer,cookies,files};
}

test('business access is explicit; private and other accounts cannot see fleet data',async t=>{
  const f=await fixture(t),id=await f.customer(),other=await f.customer(stranger,'Andere GmbH');
  assert.deepEqual((await f.ok(await f.call('/api/portal/business/me','business'))).accounts,[]);
  assert.equal((await f.call('/api/portal-admin/business/access','business',{customerId:id,enabled:true})).status,403);
  await f.ok(await f.call('/api/portal-admin/business/access','owner',{customerId:id,enabled:true}));
  await f.ok(await f.call('/api/portal-admin/business/access','owner',{customerId:other,enabled:true}));
  const access=await issueCustomerAccess(f.env,business,'/kunde');assert.match(access.url,/auth\/verify/,'B2B-only accounts can sign in');
  const businessView=await f.ok(await f.call('/api/portal/business/me','business'));
  assert.deepEqual(businessView.accounts.map(a=>a.id),[id]);
  assert.equal((await f.call('/api/portal-admin/business/account/'+id,'business')).status,403);
  assert.equal((await f.call('/api/portal/business/request','business',{accountId:other,count:2,requestKey:randomUUID()})).status,404);
  assert.equal((await f.call('/api/portal/business/request','stranger',{accountId:id,count:2,requestKey:randomUUID()})).status,404);
  await f.env.DB.prepare('UPDATE customers SET data=? WHERE id=?').bind(JSON.stringify({name:'Fuhrpark Kontakt',company:'Fuhrpark GmbH',email:'neu@example.invalid',emailKey:'neu@example.invalid'}),id).run();
  assert.deepEqual((await f.ok(await f.call('/api/portal/business/me','business'))).accounts,[],'a changed customer email revokes the old portal membership');
});

test('fleet request records a bounded count once and owner tracks it without creating an order',async t=>{
  const f=await fixture(t),id=await f.customer(),key=randomUUID();
  await f.ok(await f.call('/api/portal-admin/business/access','owner',{customerId:id,enabled:true}));
  assert.equal((await f.call('/api/portal/business/request','business',{accountId:id,count:0,requestKey:randomUUID()})).status,400);
  assert.equal((await f.call('/api/portal/business/request','business',{accountId:id,count:101,requestKey:randomUUID()})).status,400);
  const payload={accountId:id,count:7,note:'Reinigung nächste Woche',desiredDate:'2030-05-10',requestKey:key};
  const first=await f.ok(await f.call('/api/portal/business/request','business',payload));
  const replay=await f.ok(await f.call('/api/portal/business/request','business',payload));assert.equal(replay.id,first.id);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM business_vehicle_requests').first()).n,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM orders').first()).n,0,'an enquiry is not an order');
  const view=(await f.ok(await f.call('/api/portal/business/me','business'))).accounts[0];
  assert.equal(view.requests[0].count,7);assert.equal(view.requests[0].status,'OPEN');
  await f.ok(await f.call('/api/portal-admin/business/request-status','owner',{id:first.id,status:'IN_PROGRESS'}));
  assert.equal((await f.ok(await f.call('/api/portal/business/me','business'))).accounts[0].requests[0].status,'IN_PROGRESS');
  await assert.rejects(()=>f.env.DB.prepare('DELETE FROM business_vehicle_requests').run(),/nicht gelöscht/);
});

test('completed vehicle stays in draft until published; net price and private photos are scoped',async t=>{
  const f=await fixture(t),id=await f.customer(),other=await f.customer(stranger,'Andere GmbH');
  await f.ok(await f.call('/api/portal-admin/business/access','owner',{customerId:id,enabled:true}));
  await f.ok(await f.call('/api/portal-admin/business/access','owner',{customerId:other,enabled:true}));
  const created=await f.ok(await f.call('/api/portal-admin/business/vehicle','owner',{customerId:id,title:'VW Transporter',plate:'HOR WG 8',completedOn:'2026-10-17',netPriceMinor:25000,note:'Innen gereinigt'}));
  const upload=await f.ok(await f.photo('/api/portal-admin/business/photo?vehicle='+created.id,'owner',png));
  assert.equal((await f.call('/api/portal/business/photo/'+upload.id,'business')).status,404,'draft photo is private');
  assert.equal((await f.ok(await f.call('/api/portal/business/me','business'))).accounts[0].vehicles.length,0);
  await f.ok(await f.call('/api/portal-admin/business/publish','owner',{id:created.id,published:true}));
  const vehicle=(await f.ok(await f.call('/api/portal/business/me','business'))).accounts[0].vehicles[0];
  assert.equal(vehicle.netPriceMinor,25000);assert.equal(vehicle.photos[0].url,'/api/portal/business/photo/'+upload.id);
  const image=await f.call(vehicle.photos[0].url,'business');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  assert.equal((await f.call(vehicle.photos[0].url,'stranger')).status,404);
  f.files.get(upload.id).body[20]^=1;
  assert.equal((await f.call(vehicle.photos[0].url,'business')).status,503,'corrupted photo bytes must not be delivered');
  assert.equal((await f.call('/api/portal-admin/business/vehicle','business',{customerId:other,title:'Fremd',completedOn:'2026-10-17',netPriceMinor:100})).status,403);
  await f.ok(await f.call('/api/portal-admin/business/photo/visibility','owner',{id:upload.id,visible:false}));
  assert.equal((await f.call(vehicle.photos[0].url,'business')).status,404);
  await f.ok(await f.call('/api/portal-admin/business/publish','owner',{id:created.id,published:false}));
  assert.equal((await f.ok(await f.call('/api/portal/business/me','business'))).accounts[0].vehicles.length,0);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM business_portal_events').first()).n>=4,true);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0,'publishing does not invoice or send mail');
});

test('photo visibility limit is enforced in storage even for concurrent uploads',async t=>{
  const f=await fixture(t),customerId=await f.customer(),vehicleId=randomUUID(),at=new Date().toISOString();
  await f.env.DB.prepare('INSERT INTO business_completed_vehicles(id,customer_id,title,plate,completed_on,net_price_minor,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(vehicleId,customerId,'Testfahrzeug','','2026-10-17',10000,'',at,at).run();
  for(let i=0;i<20;i++)await f.env.DB.prepare('INSERT INTO business_vehicle_photos(id,vehicle_id,mime,sha256,size,created_at) VALUES(?,?,?,?,?,?)').bind(randomUUID(),vehicleId,'image/png','a'.repeat(64),100,at).run();
  await assert.rejects(()=>f.env.DB.prepare('INSERT INTO business_vehicle_photos(id,vehicle_id,mime,sha256,size,created_at) VALUES(?,?,?,?,?,?)').bind(randomUUID(),vehicleId,'image/png','a'.repeat(64),100,at).run(),/Höchstens 20/);
  const hiddenId=randomUUID();await f.env.DB.prepare('INSERT INTO business_vehicle_photos(id,vehicle_id,mime,sha256,size,visible,created_at) VALUES(?,?,?,?,?,0,?)').bind(hiddenId,vehicleId,'image/png','a'.repeat(64),100,at).run();
  await assert.rejects(()=>f.env.DB.prepare('UPDATE business_vehicle_photos SET visible=1 WHERE id=?').bind(hiddenId).run(),/Höchstens 20/);
});
