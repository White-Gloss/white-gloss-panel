import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PDFDocument,PDFName,PDFDict,PDFArray,decodePDFRawStream} from 'pdf-lib';
import {PanelDatabase} from '../server/storage.mjs';
import {digest} from '../server/auth.mjs';
import {init,setting,protect} from '../src/worker.mjs';
import {COMPANY} from '../src/company.mjs';
import {berlin} from '../src/domain.mjs';
import {protocolDocument} from '../server/protocol-document.mjs';
import {protocolMailSchema,protocolQueueStatements,deliverProtocol} from '../server/protocol-mail.mjs';
import {createTestLetterhead} from './fixtures/letterhead.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
async function fixture(t,kind='return'){
  const files=new Map(),env={DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options.httpMetadata});},async get(id){return files.get(id);}}};t.after(()=>env.DB.close());await init(env);
  const template=await createTestLetterhead(env),order={id:randomUUID(),wg:'WG-TEST-HANDOVER',synthetic:true};
  async function asset(type,bytes=png,mime='image/png',orderId=order.id){const id=randomUUID();await env.BUCKET.put(id,bytes,{httpMetadata:{contentType:mime}});await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(id,orderId,type,mime,digest(bytes),bytes.length,new Date().toISOString()).run();return id;}
  const p={workflow:'remote',kind,snapshotHash:'a'.repeat(64),signaturesConfirmed:true,business:COMPANY,documentTemplate:template,at:'2026-10-09T08:00:00.000Z',operatorSignedAt:'2026-10-09T08:15:00.000Z',customerSignedAt:'2026-10-09T16:30:00.000Z',customerName:'TEST · Kundin Şahin',operatorName:'TEST · Betreiber',vehicle:'TEST · Fahrzeug',plate:'TEST',location:'TEST · Einfahrt',delivery:'Betrieb holt ab',mileage:100,keys:1,condition:'TEST · Fahrzeugzustand',photos:[await asset('photo')],customerSignature:await asset('signature'),operatorSignature:await asset('signature'),...(kind==='return'?{services:'TEST · Reinigung',workComplete:true,openPoints:'Keine',keyLocation:'TEST · Schlüssel im vereinbarten Schlüsselkasten',keyPhoto:await asset('photo')}:{} )};order[kind]=p;
  return {env,order,p,files,asset};
}
function inspect(doc){
  const text=[],images=[];
  for(const page of doc.getPages()){
    const resources=page.node.Resources(),fonts=resources.lookup(PDFName.of('Font'),PDFDict),maps=new Map();
    for(const [name,reference] of fonts.entries()){
      const font=doc.context.lookup(reference,PDFDict),stream=font.lookup(PDFName.of('ToUnicode'));if(!stream)continue;
      const source=Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1'),map=new Map();
      for(const section of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const pair of section[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)){const units=pair[2].match(/.{4}/g).map(hex=>parseInt(hex,16));map.set(pair[1].toUpperCase(),String.fromCharCode(...units));}
      maps.set(name.asString().slice(1),map);
    }
    const contents=page.node.Contents(),streams=contents instanceof PDFArray?contents.asArray().map(ref=>doc.context.lookup(ref)):[contents],source=streams.map(stream=>Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')).join('\n');
    for(const block of source.matchAll(/BT([\s\S]*?)ET/g)){const font=block[1].match(/\/([A-Za-z0-9_.-]+) [\d.]+ Tf/),encoded=block[1].match(/<([0-9a-f]+)> Tj/i);if(font&&encoded&&maps.has(font[1]))text.push(encoded[1].match(/.{4}/g).map(cid=>maps.get(font[1]).get(cid.toUpperCase())??'').join(''));}
    const objects=resources.lookup(PDFName.of('XObject'),PDFDict);for(const object of source.matchAll(/\/([A-Za-z0-9_.-]+) Do/g)){const value=objects.lookup(PDFName.of(object[1]));if(value.dict.get(PDFName.of('Subtype')).asString()==='/Image')images.push(object[1]);}
  }
  return {text:text.join('\n'),images};
}
test('remote return PDF records key placement photo and each separate signature time on approved letterhead',async t=>{
  const f=await fixture(t),pdf=await protocolDocument(f.env,f.order,'return'),doc=await PDFDocument.load(pdf.bytes),rendered=inspect(doc);
  assert.match(doc.getSubject(),/zeitversetzter Bestätigung/);assert.equal(doc.getCreationDate().toISOString(),f.p.customerSignedAt);assert.equal(doc.getAuthor(),COMPANY.name+' · '+COMPANY.owner);
  assert.ok(rendered.text.includes(f.p.keyLocation));assert.ok(rendered.text.includes('Foto des Schlüsselablageorts'));assert.ok(rendered.text.includes(berlin(f.p.operatorSignedAt)));assert.ok(rendered.text.includes(berlin(f.p.customerSignedAt)));assert.match(rendered.text,/Der Betrieb hat dieses Protokoll vorab unterschrieben/);assert.ok(rendered.text.includes(f.p.snapshotHash));assert.equal(rendered.images.length,4);
  for(const page of doc.getPages())assert.ok(page.node.Resources().lookup(PDFName.of('XObject'),PDFDict).keys().some(name=>name.asString().includes('EmbeddedPdfPage')));
});
test('remote PDFs cannot be generated before the customer signs or without documented confirmation times',async t=>{
  const f=await fixture(t,'intake');for(const update of [{customerSignature:null},{signaturesConfirmed:false},{customerSignedAt:null},{customerSignedAt:'invalid'},{customerSignedAt:'2026-10-09T07:00:00.000Z'},{operatorSignedAt:null}])await assert.rejects(protocolDocument(f.env,{...f.order,intake:{...f.p,...update}},'intake'),error=>error.status===409);
  const pdf=await protocolDocument(f.env,f.order,'intake');assert.equal((await PDFDocument.load(pdf.bytes)).getSubject(),'Fahrzeugprotokoll mit zeitversetzter Bestätigung im Kundenzugang');
});
test('key location PDF uses the saved preview while verifying the protected original and rejects foreign or corrupt assets',async t=>{
  const f=await fixture(t),original=Buffer.from('TEST · protected WebP original'),id=await f.asset('photo',original,'image/webp'),preview=await f.asset('photo');f.p.keyPhoto=id;f.p.photoPreviews={[id]:preview};
  const rendered=inspect(await PDFDocument.load((await protocolDocument(f.env,f.order,'return')).bytes));assert.ok(rendered.text.includes(digest(original)));assert.equal(rendered.images.length,4);
  f.files.get(id).body=Buffer.from('TEST · corrupted original');await assert.rejects(protocolDocument(f.env,f.order,'return'),error=>error.status===409);
  f.p.keyPhoto=await f.asset('photo',png,'image/png',randomUUID());await assert.rejects(protocolDocument(f.env,f.order,'return'),error=>error.status===409);
  for(const update of [{keyLocation:''},{keyPhoto:null}])await assert.rejects(protocolDocument(f.env,{...f.order,return:{...f.p,...update}},'return'),error=>error.status===409);
});
test('completed remote protocol email retains customer recipient and owner copy with a matching confirmation description',async t=>{
  const f=await fixture(t),sent=[];Object.assign(f.env,{OWNER_EMAIL_SHA256:digest(COMPANY.email),CONFIG_KEY:Buffer.alloc(32,7).toString('base64')});Object.assign(f.order,{synthetic:false,status:'Erledigt',version:1,operationId:'TEST-remote-protocol-operation',source:{email:'test-customer@example.invalid'}});
  await protocolMailSchema(f.env);await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(f.order.id,f.order.wg,f.order.status,JSON.stringify(f.order),new Date().toISOString(),'test','fixture').run();
  await setting(f.env,'resendKey',await protect(f.env,'TEST-key'));await setting(f.env,'emailVerified',true);await setting(f.env,'sendApproved',true);await setting(f.env,'sender','test@example.invalid');
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return Response.json({id:'TEST-remote-mail'});});
  await f.env.DB.batch(protocolQueueStatements(f.env,f.order,'return',f.order.operationId,f.order.version));assert.equal((await deliverProtocol(f.env,f.order.id,'return')).state,'sent');assert.equal(sent.length,1);
  assert.deepEqual(sent[0].to,['test-customer@example.invalid']);assert.deepEqual(sent[0].cc,[COMPANY.email]);assert.match(sent[0].text,/vorab unterschriebene und von Ihnen anschließend im Kundenzugang bestätigte Rückgabeprotokoll/);const doc=await PDFDocument.load(Buffer.from(sent[0].attachments[0].content,'base64'));assert.ok(inspect(doc).text.includes(f.p.keyLocation));
  await deliverProtocol(f.env,f.order.id,'return');assert.equal(sent.length,1);
});
