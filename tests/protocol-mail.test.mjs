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
import {createTestLetterhead} from './fixtures/letterhead.mjs';
import {PDFDocument as InspectPDFDocument,PDFName,PDFDict,PDFArray,decodePDFRawStream} from 'pdf-lib';
const origin='https://panel.example.invalid',owner=COMPANY.email;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
async function fixture(t,synthetic=false,{withTemplate=true}={}){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options.httpMetadata});},async get(id){return files.get(id);},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};t.after(()=>env.DB.close());
  const app=await createApplication(env),raw='c'.repeat(64),cookie='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+600000,Date.now()).run();
  if(withTemplate)await createTestLetterhead(env);
  const order={id:randomUUID(),wg:'WG-TEST-ONLY',version:1,status:'Termin verbindlich',synthetic,source:{name:'TEST · Kundin Şahin',email:'customer@example.invalid',vehicle:'TEST · Fahrzeug'},offer:{services:'TEST · Innenreinigung',totalCents:10000},appointment:{start:'2026-10-03T10:00:00Z',end:'2026-10-03T12:00:00Z',location:'Testort'},acceptance:{at:'2026-10-03T09:00:00Z'}};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),new Date().toISOString(),'test','fixture',Number(synthetic)).run();
  const request=async(path,data)=>app.fetch(new Request(origin+path,{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify(data)}));
  const upload=async(orderId,kind,params='')=>{const result=await app.fetch(new Request(origin+'/api/upload/'+orderId+'?kind='+kind+params,{method:'POST',headers:{origin,cookie,'Content-Type':'image/png'},body:png}));assert.equal(result.status,200);return (await result.json()).id;};
  await setting(env,'resendKey',await protect(env,'synthetic-key'));await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);await setting(env,'sender','test@example.invalid');
  async function signed(kind,overrides={}){const current=await getOrder(env,order.id),photo=await upload(order.id,'photo');const protocol={kind,plate:'TEST',at:'2026-10-03T14:00',location:'TEST · Übergabeort',condition:'TEST · Kratzer an Tür links',customerName:current.source.name,operatorName:COMPANY.owner,mileage:100,keys:1,delivery:'Kunde bringt',photos:[photo],...(kind==='return'?{services:'TEST · Innenreinigung abgeschlossen',openPoints:'Keine',workComplete:true}:{}),...overrides};
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
test('missing signatures and failed atomic storage cannot create a mail job',async t=>{
  const f=await fixture(t),draft=await f.signed('intake');const incomplete=await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:{...draft.input,signaturesConfirmed:false}});assert.equal(incomplete.status,400);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,0);
  t.mock.method(f.env.DB,'batch',()=>{throw Error('synthetic database failure');});assert.equal((await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input})).status,500);assert.equal((await getOrder(f.env,f.order.id)).status,'Termin verbindlich');assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,0);
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

test('missing approved letterhead preserves signatures, blocks PDF and mail, then sends exactly once after approval',async t=>{
  const f=await fixture(t,false,{withTemplate:false}),sent=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return Response.json({id:'TEST letterhead approved delivery'});});
  const draft=await f.signed('intake'),result=await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input});
  assert.equal(result.status,200);const saved=await result.json();assert.equal(saved.status,'In Arbeit');assert.equal(saved.intake.documentTemplatePending,true);assert.equal(saved.intake.customerSignature,draft.input.customerSignature);assert.equal(saved.intake.operatorSignature,draft.input.operatorSignature);assert.equal(sent.length,0);assert.equal(saved.protocolDelivery.state,'failed');
  const download=()=>f.app.fetch(new Request(origin+'/api/protocol/pdf?id='+f.order.id+'&kind=intake',{headers:{cookie:f.cookie}}));assert.equal((await download()).status,409);
  const before=structuredClone((await getOrder(f.env,f.order.id)).intake),template=await createTestLetterhead(f.env);await pendingProtocolMails(f.env);assert.equal(sent.length,1);assert.equal((await download()).status,200);await deliverProtocol(f.env,f.order.id,'intake');await pendingProtocolMails(f.env);assert.equal(sent.length,1);assert.deepEqual((await getOrder(f.env,f.order.id)).intake,before);
  const original=Buffer.from(await(await download()).arrayBuffer());await createTestLetterhead(f.env,{marker:'TEST second immutable blank version'});assert.deepEqual(Buffer.from(await(await download()).arrayBuffer()),original);assert.notEqual((await f.env.DB.prepare('SELECT value FROM settings WHERE key=?').bind('documentTemplate').first()).value,JSON.stringify(template));assert.equal(sent.length,1);
});

function assertProtocolContentBounds(doc,box){
  let textCount=0,imageCount=0;
  const multiply=(m,n)=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
  for(const page of doc.getPages()){
    const resources=page.node.Resources(),fonts=resources.lookup(PDFName.of('Font'),PDFDict),fontWidths=new Map();
    for(const [name,reference] of fonts.entries()){
      const font=doc.context.lookup(reference,PDFDict),children=font.lookup(PDFName.of('DescendantFonts'),PDFArray),descendant=children.lookup(0,PDFDict),widths=descendant.lookup(PDFName.of('W'),PDFArray),map=new Map();
      for(let index=0;index<widths.size();){const first=widths.lookup(index++).asNumber(),next=widths.lookup(index++);if(next instanceof PDFArray){for(let offset=0;offset<next.size();offset++)map.set(first+offset,next.lookup(offset).asNumber());}else{const end=next.asNumber(),width=widths.lookup(index++).asNumber();for(let cid=first;cid<=end;cid++)map.set(cid,width);}}
      fontWidths.set(name.asString().slice(1),map);
    }
    const contents=page.node.Contents(),streams=contents instanceof PDFArray?Array.from({length:contents.size()},(_,index)=>doc.context.lookup(contents.get(index))):[contents];
    const source=streams.map(stream=>Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')).join('\n');
    for(const block of source.matchAll(/BT([\s\S]*?)ET/g)){
      const selected=block[1].match(/\/([A-Za-z0-9_.-]+) ([\d.]+) Tf/),position=block[1].match(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/),encoded=block[1].match(/<([0-9A-Fa-f]+)> Tj/);if(!selected||!position||!encoded)continue;
      textCount++;const map=fontWidths.get(selected[1]),size=Number(selected[2]),x=Number(position[1]),y=Number(position[2]);assert.ok(map,'Embedded text font must be inspectable');let advance=0;for(let offset=0;offset<encoded[1].length;offset+=4)advance+=(map.get(parseInt(encoded[1].slice(offset,offset+4),16))??1000)*size/1000;
      assert.ok(x>=box.left-.1&&x+advance<=page.getWidth()-box.right+.1,'Rendered text exceeds horizontal approved margins');assert.ok(y>=box.bottom+1.9&&y<=page.getHeight()-box.top+.1,'Rendered text exceeds vertical approved margins');
    }
    const objects=resources.lookup(PDFName.of('XObject'),PDFDict),stack=[];let matrix=[1,0,0,1,0,0];
    const operations=/(?:^|\s)(?<state>q|Q)(?=\s|$)|(?<a>-?[\d.]+) (?<b>-?[\d.]+) (?<c>-?[\d.]+) (?<d>-?[\d.]+) (?<e>-?[\d.]+) (?<f>-?[\d.]+) cm|\/(?<object>[A-Za-z0-9_.-]+) Do/g;
    for(const operation of source.matchAll(operations)){
      const value=operation.groups;if(value.state==='q')stack.push([...matrix]);else if(value.state==='Q')matrix=stack.pop();else if(value.a!==undefined)matrix=multiply(matrix,['a','b','c','d','e','f'].map(key=>Number(value[key])));else if(value.object){const object=objects.lookup(PDFName.of(value.object));if(object.dict.get(PDFName.of('Subtype')).asString()!=='/Image')continue;imageCount++;const corners=[[0,0],[0,1],[1,0],[1,1]].map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]);assert.ok(corners.every(([x,y])=>x>=box.left-.1&&x<=page.getWidth()-box.right+.1&&y>=box.bottom-.1&&y<=page.getHeight()-box.top+.1),'Photo/signature exceeds approved content box');}
    }
  }
  assert.ok(textCount>50,'Multi-page test must inspect actual generated text operators');assert.ok(imageCount>=3,'Both signatures and the photo must be inspected');
}

test('multi-page protocol uses the approved background on every page and keeps text, photos and signatures inside margins',async t=>{
  const f=await fixture(t,true),box={left:90,right:90,top:170,bottom:130};await createTestLetterhead(f.env,{contentBox:box});
  const draft=await f.signed('intake',{condition:'TEST · dokumentierter Zustand und Schäden. '.repeat(80),notes:'TEST · Zeile zur mehrseitigen Dokumentation.\n'.repeat(80)}),response=await f.request('/api/action',{id:f.order.id,version:draft.version,action:'intake',input:draft.input});assert.equal(response.status,200);
  const order=await getOrder(f.env,f.order.id),pdf=await protocolDocument(f.env,order,'intake'),doc=await InspectPDFDocument.load(pdf.bytes);assert.ok(doc.getPageCount()>=4);
  for(const page of doc.getPages()){const objects=page.node.Resources().lookup(PDFName.of('XObject'),PDFDict);assert.ok(objects.keys().some(name=>name.asString().includes('EmbeddedPdfPage')),'Every page must embed the approved original letterhead');}
  assertProtocolContentBounds(doc,box);
});
