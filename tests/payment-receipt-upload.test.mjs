import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid',maximum=5*1024*1024;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');

async function fixture(t){
  const files=new Map();
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),ASSETS:{fetch:async()=>new Response('shell')},BUCKET:{
    async put(id,bytes,metadata){files.set(id,{body:new Uint8Array(bytes).slice(),httpMetadata:metadata.httpMetadata});},
    async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}
  }};
  t.after(()=>env.DB.close());
  const app=await createApplication(env),cookies={};
  for(const [who,email] of [['owner',owner],['customer','customer@example.invalid']]){const raw=who==='owner'?'a'.repeat(64):'b'.repeat(64);cookies[who]='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),email,Date.now()+600000,Date.now()).run();}
  const id=randomUUID(),order={id,wg:'TEST-ORIGINAL-BELEG',status:'Erledigt',source:{name:'TEST · Kunde',vehicle:'TEST · Fahrzeug'},synthetic:true,payments:[]};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture',1).run();
  const upload=(bytes,{kind='payment',mime='application/pdf',who='owner',headers={},orderId=id}={})=>app.fetch(new Request(origin+'/api/upload/'+orderId+(kind===null?'':'?kind='+kind),{method:'POST',headers:{origin,'Content-Type':mime,...(cookies[who]?{cookie:cookies[who]}:{}),...headers},body:bytes,...(bytes instanceof ReadableStream?{duplex:'half'}:{})}));
  const asset=(assetId,who='owner')=>app.fetch(new Request(origin+'/api/asset/'+assetId,{headers:cookies[who]?{cookie:cookies[who]}:{}}));
  const count=async()=>Number((await env.DB.prepare('SELECT COUNT(*) n FROM assets').first()).n);
  return {env,app,id,files,upload,asset,count};
}

async function pdf({pages=1,dimensions=[595.28,841.89]}={}){
  const doc=await PDFDocument.create();
  for(let i=0;i<pages;i++)doc.addPage(dimensions).drawText('TEST · external synthetic original receipt '+(i+1),{x:20,y:40,size:9});
  return doc.save({addDefaultPage:false,useObjectStreams:false});
}

test('owner payment PDF upload preserves exact original bytes, hash and content type behind protected download',async t=>{
  const f=await fixture(t),bytes=await pdf({pages:2}),response=await f.upload(bytes);
  assert.equal(response.status,200);const {id}=await response.json();
  const stored=await f.env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(id).first();
  assert.equal(stored.kind,'payment');assert.equal(stored.order_id,f.id);assert.equal(stored.mime,'application/pdf');assert.equal(stored.hash,digest(bytes));assert.equal(stored.size,bytes.byteLength);
  const downloaded=await f.asset(id);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'application/pdf');assert.equal(downloaded.headers.get('cache-control'),'no-store');assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()),bytes);
  for(const [who,status] of [['anonymous',401],['customer',403]]){assert.equal((await f.upload(bytes,{who})).status,status);assert.equal((await f.asset(id,who)).status,status);}
  assert.equal((await f.upload(bytes,{headers:{origin:'https://foreign.example.invalid'}})).status,403);
  assert.equal((await f.upload(bytes,{orderId:randomUUID()})).status,404);assert.equal(await f.count(),1);assert.equal(f.files.size,1);
});

test('PDF is confined to payment assets and unsupported MIME or fake PDF headers never reach storage',async t=>{
  const f=await fixture(t),bytes=await pdf();
  for(const kind of [null,'photo','booking','signature','unexpected'])assert.equal((await f.upload(bytes,{kind})).status,400);
  for(const mime of ['text/csv','text/plain','application/octet-stream'])assert.equal((await f.upload(bytes,{mime})).status,400);
  for(const invalid of [png,new TextEncoder().encode('%PDF-1.7\n'+('not a PDF object '.repeat(20))+'\n%%EOF'),new Uint8Array()])assert.equal((await f.upload(invalid)).status,400);
  assert.equal(await f.count(),0);assert.equal(f.files.size,0);
});

test('unreadable, encrypted, empty-page and impossible-size PDF structures are rejected before persistence',async t=>{
  const f=await fixture(t),bytes=await pdf();
  const encrypted=new TextEncoder().encode(new TextDecoder().decode(bytes).replace('trailer\n<<','trailer\n<<\n/Encrypt 1 0 R'));
  assert.notDeepEqual(encrypted,bytes);
  const invalidPage=await pdf({dimensions:[-10,100]});
  for(const invalid of [encrypted,await pdf({pages:0}),invalidPage])assert.equal((await f.upload(invalid)).status,400);
  assert.equal(await f.count(),0);assert.equal(f.files.size,0);
});

test('payment PDF body is bounded while streaming, independent of an announced length, with the 5 MB boundary accepted',async t=>{
  const f=await fixture(t),bytes=await pdf();
  assert.equal((await f.upload(bytes,{headers:{'content-length':String(maximum+1)}})).status,413);
  let cancelled=false,emitted=0,validated=0;const validate=f.env.validatePaymentPDF;f.env.validatePaymentPDF=async b=>{validated++;return validate(b);};
  const stream=new ReadableStream({pull(controller){emitted++;controller.enqueue(new Uint8Array(512*1024));if(emitted===20)controller.close();},cancel(){cancelled=true;}});
  assert.equal((await f.upload(stream,{headers:{'content-length':'1'}})).status,413);assert.equal(cancelled,true);assert.ok(emitted<20);assert.equal(validated,0);assert.equal(await f.count(),0);assert.equal(f.files.size,0);
  const exact=new Uint8Array(maximum);exact.fill(32);exact.set(bytes);const accepted=await f.upload(exact);assert.equal(accepted.status,200);const {id}=await accepted.json();
  assert.equal(validated,1);assert.equal((await f.env.DB.prepare('SELECT size,hash FROM assets WHERE id=?').bind(id).first()).size,maximum);assert.deepEqual(new Uint8Array(await (await f.asset(id)).arrayBuffer()),exact);
});

test('runtime without a PDF validator rejects PDFs and payment images keep existing image rules and distinct kinds',async t=>{
  const f=await fixture(t);delete f.env.validatePaymentPDF;
  assert.equal((await f.upload(await pdf())).status,503);
  for(const [kind,mime,bytes] of [['payment','image/png',png],['payment','image/jpeg',new Uint8Array([255,216,...new Array(60).fill(0)])],['payment','image/webp',new Uint8Array([...new TextEncoder().encode('RIFF'),...new Array(60).fill(0)])],['photo','image/png',png],['booking','image/png',png]]){
    const response=await f.upload(bytes,{kind,mime});assert.equal(response.status,200);const {id}=await response.json();assert.equal((await f.env.DB.prepare('SELECT kind,mime FROM assets WHERE id=?').bind(id).first()).kind,kind);assert.equal((await f.asset(id)).headers.get('content-type'),mime);
  }
  assert.equal((await f.upload(png,{kind:'signature',mime:'image/png'})).status,409);
  assert.equal((await f.upload(png,{mime:'image/jpeg'})).status,400);assert.equal(await f.count(),5);assert.equal(f.files.size,5);
});

test('asset database failure rolls back the uploaded original from private storage',async t=>{
  const f=await fixture(t);t.mock.method(f.env.DB,'batch',async()=>{throw Error('Synthetic database failure');});
  assert.equal((await f.upload(await pdf())).status,500);assert.equal(await f.count(),0);assert.equal(f.files.size,0);
});
