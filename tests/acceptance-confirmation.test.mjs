import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFArray,decodePDFRawStream} from 'pdf-lib';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {COMPANY} from '../src/company.mjs';
import {transition} from '../src/domain.mjs';
import {setting,protect,getOrder} from '../src/worker.mjs';
import {protocolQueueStatements,deliverProtocol,pendingProtocolMails,protocolDownload} from '../server/protocol-mail.mjs';

const at='2026-10-01T10:00:00Z';
async function fixture(t){
  const files=new Map(),env={PANEL_ORIGIN:'https://panel.example.invalid',OWNER_EMAIL_SHA256:digest(COMPANY.email),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options.httpMetadata});},async get(id){return files.get(id);},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());await createApplication(env);
  await setting(env,'resendKey',await protect(env,'synthetic-key'));await setting(env,'sender','test@example.invalid');await setting(env,'emailVerified',true);await setting(env,'sendApproved',false);
  const base={id:crypto.randomUUID(),wg:'WG-TEST-CONFIRMATION',version:1,status:'Preise prüfen',synthetic:false,source:{name:'TEST · Original customer',email:'customer@example.invalid',vehicle:'TEST · Original vehicle'},notes:[],payments:[]};
  async function save(order){
    order.operationId=crypto.randomUUID();
    await env.DB.batch([env.DB.prepare('INSERT INTO orders(id,wg,version,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET version=excluded.version,status=excluded.status,data=excluded.data,updated_at=excluded.updated_at').bind(order.id,order.wg,order.version,order.status,JSON.stringify(order),at,'test','synthetic acceptance'),...protocolQueueStatements(env,order,'acceptance',order.operationId,order.version)]);
    return getOrder(env,order.id);
  }
  return {env,base,save};
}
function accept(base,title,amountCents){const priced=transition(base,'price',{lines:[{id:'p',kind:'custom',title,amountCents}]},at);return transition(priced,'onsiteAccept',{paymentObligation:true,release:true,releaseReason:'Test ohne Unterschrift'},at);}
async function pdfText(bytes){
  const doc=await PDFDocument.load(bytes),mapping=new Map(),texts=[];
  for(const page of doc.getPages()){
    const fonts=page.node.Resources().lookup(PDFName.of('Font'));
    for(const [,ref] of fonts.entries()){
      const font=doc.context.lookup(ref),cmap=doc.context.lookup(font.get(PDFName.of('ToUnicode')));if(!cmap)continue;
      const raw=Buffer.from(decodePDFRawStream(cmap).decode()).toString();
      for(const match of raw.matchAll(/^<([A-Fa-f0-9]{4})>\s*<([A-Fa-f0-9]+)>$/gm))mapping.set(match[1].toUpperCase(),match[2].match(/.{4}/g).map(code=>String.fromCharCode(parseInt(code,16))).join(''));
    }
    const contents=page.node.Contents(),streams=contents instanceof PDFArray?contents.asArray():[contents];
    for(const ref of streams){const raw=Buffer.from(decodePDFRawStream(doc.context.lookup(ref)).decode()).toString();for(const match of raw.matchAll(/<([A-Fa-f0-9]+)>\s*Tj/g))texts.push(match[1].match(/.{4}/g).map(code=>mapping.get(code.toUpperCase())??'').join(''));}
  }
  return texts.join('\n');
}
test('each pending acceptance keeps its own content and sends once, including two acceptances at the same timestamp',async t=>{
  const f=await fixture(t),sent=[];t.mock.method(globalThis,'fetch',async(_url,options)=>{sent.push({key:options.headers['Idempotency-Key'],payload:JSON.parse(options.body)});return Response.json({id:'synthetic-'+sent.length});});
  const first=await f.save(accept(f.base,'FIRST AGREED SERVICE',1000));assert.equal((await deliverProtocol(f.env,first.id,'acceptance')).state,'failed');
  const second=accept({...first,version:first.version+1},'SECOND AGREED SERVICE',2000);await f.save(second);assert.notEqual(first.acceptance.confirmationId,second.acceptance.confirmationId);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM acceptance_deliveries').first()).n,2);
  await setting(f.env,'sendApproved',true);assert.deepEqual(await pendingProtocolMails(f.env),[]);assert.equal(sent.length,2);assert.notEqual(sent[0].key,sent[1].key);
  const firstText=await pdfText(Buffer.from(sent[0].payload.attachments[0].content,'base64')),secondText=await pdfText(Buffer.from(sent[1].payload.attachments[0].content,'base64'));
  assert.match(firstText,/FIRST AGREED SERVICE/);assert.doesNotMatch(firstText,/SECOND AGREED SERVICE/);assert.match(firstText,/10,00/);
  assert.match(secondText,/SECOND AGREED SERVICE/);assert.match(secondText,/20,00/);
  await pendingProtocolMails(f.env);await deliverProtocol(f.env,first.id,'acceptance');assert.equal(sent.length,2);
});
test('acceptance without email or signature downloads its original source, full service name and price after edits',async t=>{
  const f=await fixture(t),longTitle='TEST service '+('complete agreed treatment '.repeat(5))+'FINAL SCOPE';
  const first=accept({...f.base,source:{...f.base.source,email:''}},longTitle,1000);await f.save(first);
  const edited=transition(first,'price',{lines:[{id:'p',kind:'custom',title:'UNACCEPTED CHANGED SERVICE',amountCents:2000}]},at);edited.source={...edited.source,name:'UNACCEPTED CUSTOMER',vehicle:'UNACCEPTED VEHICLE'};edited.version++;
  await f.env.DB.prepare('UPDATE orders SET data=?,version=? WHERE id=?').bind(JSON.stringify(edited),edited.version,edited.id).run();
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM acceptance_deliveries').first()).n,0);
  const response=await protocolDownload(f.env,first.id,'acceptance'),text=await pdfText(new Uint8Array(await response.arrayBuffer()));
  assert.match(text,/Original customer/);assert.match(text,/Original vehicle/);assert.match(text,/10,00/);assert.match(text,/FINAL SCOPE/);assert.doesNotMatch(text,/UNACCEPTED|20,00/);
});
test('an uncertain confirmation is never retried when a new acceptance is saved',async t=>{
  const f=await fixture(t);await setting(f.env,'sendApproved',true);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;if(calls===1)throw Error('synthetic timeout');return Response.json({id:'synthetic-second'});});
  const first=await f.save(accept(f.base,'FIRST SERVICE',1000));assert.equal((await deliverProtocol(f.env,first.id,'acceptance')).state,'unknown');
  const second=await f.save(accept({...first,version:first.version+1},'SECOND SERVICE',2000));assert.equal((await deliverProtocol(f.env,second.id,'acceptance')).state,'sent');
  await pendingProtocolMails(f.env);assert.equal(calls,2);assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE kind LIKE 'protocol-acceptance-%' AND state='unknown'").first()).n,1);
});
test('legacy acceptance captures its previous source and offer before its first edit',async t=>{
  const f=await fixture(t),first=accept({...f.base,source:{...f.base.source,email:''}},'LEGACY AGREED SERVICE',1000);delete first.acceptance.snapshot;delete first.acceptance.confirmationId;
  const changed=transition(first,'price',{lines:[{id:'p',kind:'custom',title:'UNACCEPTED CHANGED SERVICE',amountCents:2000}]},at);
  const edited=transition(changed,'editSource',{name:'UNACCEPTED CUSTOMER',vehicle:'UNACCEPTED VEHICLE'},at);edited.version++;
  await f.save(edited);
  assert.equal(edited.acceptance.at,first.acceptance.at);assert.equal(edited.acceptance.confirmationId,undefined);
  const response=await protocolDownload(f.env,first.id,'acceptance'),text=await pdfText(new Uint8Array(await response.arrayBuffer()));
  assert.match(text,/LEGACY AGREED SERVICE/);assert.match(text,/Original customer/);assert.match(text,/Original vehicle/);assert.match(text,/10,00/);assert.doesNotMatch(text,/UNACCEPTED|20,00/);
});
