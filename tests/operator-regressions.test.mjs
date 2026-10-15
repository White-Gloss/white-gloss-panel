import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import worker,{getOrder,saveOrder,setting,protect} from '../src/worker.mjs';
import {transition,appointmentSnapshot} from '../src/domain.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {deliverProtocol} from '../server/protocol-mail.mjs';
import {handleChat,notifyThread} from '../server/chat.mjs';
import {handlePortal} from '../server/portal.mjs';
import {COMPANY} from '../src/company.mjs';

const origin='https://panel.example.invalid',owner='owner@example.invalid';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const signature='data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(400)]).toString('base64');
async function fixture(t){
  const files=new Map(),puts=[],env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,8).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){puts.push(id);files.set(id,{body:new Uint8Array(bytes),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());await createApplication(env);
  const request=(path,input)=>worker.fetch(new Request(origin+'/api/'+path,{method:input===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json','oai-authenticated-user-email':owner},body:input===undefined?undefined:JSON.stringify(input)}),env);
  return {env,files,puts,request};
}
async function insertOrder(env,overrides={}){
  const at=new Date().toISOString(),order={id:randomUUID(),wg:'TEST-'+randomUUID().slice(0,8),version:1,status:'Angenommen',synthetic:false,source:{name:'TEST · Kunde',email:'old@example.invalid',vehicle:'TEST · Fahrzeug'},offer:{services:'TEST · Leistung',totalCents:10000},payments:[],notes:[],...overrides};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(order.id,order.wg,order.status,JSON.stringify(order),at,'test','Synthetischer Operator-Test',order.synthetic?1:0).run();
  return order;
}

async function customerSignatureFlow(t,kind){
  const f=await fixture(t),at=new Date().toISOString(),token='a'.repeat(64);f.env.operations={};
  let order=await insertOrder(f.env,kind==='offer'?{status:'Angebot offen',offer:{services:'TEST · Leistung',totalCents:10000,expiresAt:new Date(Date.now()+86400000).toISOString()}}:{acceptance:{at,signature:'existing-offer-signature'},appointment:{start:'2035-10-15T07:00:00.000Z',end:'2035-10-15T10:00:00.000Z',duration:180,delivery:'Kunde bringt',location:'TEST'},...(kind==='replacement'?{intake:{plate:'TEST · original',customerSignature:'existing-protocol-signature',savedAt:at}}:{})});
  const customerRequest=(path,input)=>worker.fetch(new Request(origin+'/api/'+path,{method:input===undefined?'GET':'POST',headers:{origin,'Content-Type':'application/json','oai-authenticated-user-email':order.source.email},body:input===undefined?undefined:JSON.stringify(input)}),f.env);
  let sign,signatureOf;
  if(kind==='portal'){
    const input={signature,confirmed:true,customerName:'TEST · Kunde',snapshotHash:digest(JSON.stringify(appointmentSnapshot(order)))};
    sign=()=>handlePortal(f.env,new Request(origin+'/api/portal/o/'+order.id+'/termin-bestaetigen',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(input)}),order.source.email,false).catch(error=>Response.json({error:error.message},{status:error.status??500}));
    signatureOf=o=>o.appointment?.confirmation?.signature;
  }else{
    const route=(kind==='offer'?'offer/':'document/')+token;
    if(kind==='offer')await f.env.DB.prepare('INSERT INTO offer_tokens(hash,order_id,expires_at) VALUES(?,?,?)').bind(digest(token),order.id,order.offer.expiresAt).run();
    else{
      order=transition(order,'replacement',{kind:'intake',content:{plate:'TEST · replacement'}},at);order.pending.intake.token=token;
      await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(order),order.id).run();order=await getOrder(f.env,order.id);
      await f.env.DB.prepare('INSERT INTO document_requests(hash,order_id,kind,expires_at,created_at) VALUES(?,?,?,?,?)').bind(digest(token),order.id,'intake',new Date(Date.now()+86400000).toISOString(),at).run();
    }
    const shown=await customerRequest(route);assert.equal(shown.status,200,await shown.clone().text());
    const input={signature,confirmed:true,paymentObligation:true,snapshotHash:digest(JSON.stringify(await shown.json()))};
    sign=()=>customerRequest(route,input);signatureOf=o=>kind==='offer'?o.acceptance?.signature:o.intake?.customerSignature;
  }
  return {...f,order,sign,signatureOf};
}

test('correcting a customer email prevents queued signed documents from being sent to the previous address',async t=>{
  for(const kind of ['acceptance','intake'])for(const duringRead of [false,true]){
    const f=await fixture(t),at=new Date().toISOString(),order=await insertOrder(f.env,{acceptance:{at,mode:'vor Ort',signature:randomUUID(),confirmationId:randomUUID()},intake:{customerSignature:randomUUID(),savedAt:at,business:{...COMPANY},plate:'TEST'}});
    order.acceptance.snapshot={source:structuredClone(order.source),offer:structuredClone(order.offer)};
    await saveOrder(f.env,order,1,'Synthetische Originale gespeichert','test');
    const bytes=new TextEncoder().encode('%PDF-1.7\nSynthetic previously persisted attachment\n'),assetId=randomUUID(),jobId=randomUUID();
    f.files.set(assetId,{body:bytes,httpMetadata:{contentType:'application/pdf'}});
    await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(assetId,order.id,'protocol','application/pdf',digest(bytes),bytes.byteLength,at).run();
    await f.env.DB.prepare("INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at) VALUES(?,?,?,'queued',?,?)").bind(jobId,order.id,'protocol-'+kind,at,at).run();
    if(kind==='acceptance'){
      const snapshot=JSON.stringify({id:order.id,wg:order.wg,synthetic:false,source:order.source,offer:order.offer,acceptance:order.acceptance});
      await f.env.DB.prepare('INSERT INTO acceptance_deliveries(job_id,order_id,acceptance_version,snapshot_hash,snapshot,recipient,copy_to,asset_id) VALUES(?,?,?,?,?,?,?,?)').bind(jobId,order.id,order.acceptance.confirmationId,digest(snapshot),snapshot,order.source.email,'',assetId).run();
    }else await f.env.DB.prepare('INSERT INTO protocol_deliveries(job_id,order_id,kind,snapshot_hash,recipient,copy_to,asset_id) VALUES(?,?,?,?,?,?,?)').bind(jobId,order.id,kind,order.intake.savedAt,order.source.email,'',assetId).run();
    const changeEmail=async()=>{const current=await getOrder(f.env,order.id),changed=transition(current,'editSource',{source:{email:'corrected@example.invalid'}});await saveOrder(f.env,changed,current.version,'Kundenadresse korrigiert','owner');};
    if(!duringRead)await changeEmail();
    else{const get=f.env.BUCKET.get.bind(f.env.BUCKET);let changed=false;t.mock.method(f.env.BUCKET,'get',async id=>{const file=await get(id);if(id===assetId&&!changed){changed=true;await changeEmail();}return file;});}
    for(const [key,value] of Object.entries({resendKey:await protect(f.env,'synthetic-key'),emailVerified:true,sendApproved:true,sender:'sender@example.invalid'}))await setting(f.env,key,value);
    const recipients=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://api.resend.com/emails');recipients.push(...JSON.parse(options.body).to);return new Response(JSON.stringify({id:'synthetic-mail'}));});
    const result=await deliverProtocol(f.env,order.id,kind);
    assert.deepEqual(recipients,[],kind+' must not send private original documents to the corrected old address'+(duringRead?' after PDF loading':''));
    assert.equal(result.state,'cancelled');assert.equal((await f.env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(jobId).first()).state,'cancelled');
    const saved=await getOrder(f.env,order.id);assert.deepEqual(saved.acceptance.snapshot.source,order.acceptance.snapshot.source,'the signed original stays unchanged');
    t.mock.restoreAll();
  }
});

test('payment corrections reject future dates just like newly entered payments and preserve the previous record',()=>{
  const at='2030-10-15T09:00:00.000Z',order={id:'synthetic',status:'Erledigt',source:{},offer:{totalCents:10000},payments:[],notes:[]};
  const paid=transition(order,'payment',{amountCents:10000,method:'Karte'},at),saved=structuredClone(paid),future='2031-10-15T09:00:00.000Z';
  assert.throws(()=>transition(order,'payment',{amountCents:10000,method:'Karte',at:future},at),/Zukunft/);
  assert.throws(()=>transition(paid,'paymentEdit',{id:paid.payments[0].id,at:future},at),/Zukunft/);
  assert.deepEqual(paid,saved);
});

test('a rejected in-person appointment signature leaves no private file without a database record',async t=>{
  const f=await fixture(t),order=await insertOrder(f.env,{status:'In Arbeit',appointment:{start:'2030-10-15T09:00:00.000Z',end:'2030-10-15T10:00:00.000Z',duration:60,delivery:'Kunde bringt',location:'TEST'}});
  const result=await f.request('action',{id:order.id,version:1,action:'confirmAppointment',input:{signature,inPerson:true}});
  assert.equal(result.status,409);
  assert.equal((await getOrder(f.env,order.id)).version,1);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM assets WHERE order_id=?').bind(order.id).first()).n,0);
  assert.equal(f.files.size,0,'rejected signature files must be removed from private storage');
});

test('a committed signature survives a failed response read because its file is already bound to the order',async t=>{
  const f=await fixture(t),order=await insertOrder(f.env);f.env.operations={};
  const prepare=f.env.DB.prepare.bind(f.env.DB);let reads=0;
  t.mock.method(f.env.DB,'prepare',query=>{const statement=prepare(query);if(query==='SELECT * FROM orders WHERE id=?'){const first=statement.first.bind(statement);statement.first=async()=>{reads++;if(reads===2)throw Error('Synthetic response read failure after commit');return first();};}return statement;});
  const result=await f.request('action',{id:order.id,version:1,action:'onsiteAccept',input:{signature}});
  assert.equal(result.status,500);t.mock.restoreAll();
  const saved=await getOrder(f.env,order.id);assert.equal(saved.version,2);assert.ok(saved.acceptance.signature);
  assert.ok((await f.env.DB.prepare('SELECT id FROM assets WHERE id=? AND order_id=?').bind(saved.acceptance.signature,order.id).first()).id);
  assert.ok(f.files.has(saved.acceptance.signature),'a persisted signature file must never be removed by failure cleanup');
});

for(const kind of ['portal','offer','replacement']){
  test(kind+' customer signature survives a response read failure after its transaction commits',async t=>{
    const f=await customerSignatureFlow(t,kind),prepare=f.env.DB.prepare.bind(f.env.DB);let reads=0;
    t.mock.method(f.env.DB,'prepare',query=>{const statement=prepare(query);if(query==='SELECT * FROM orders WHERE id=?'){const first=statement.first.bind(statement);statement.first=async()=>{reads++;if(reads===2)throw Error('Synthetic customer response read failure after commit');return first();};}return statement;});
    const response=await f.sign();assert.equal(response.status,500);t.mock.restoreAll();
    const saved=await getOrder(f.env,f.order.id),id=f.signatureOf(saved);assert.equal(saved.version,f.order.version+1);assert.ok(id);
    assert.ok(await f.env.DB.prepare('SELECT id FROM assets WHERE id=? AND order_id=?').bind(id,f.order.id).first(),'committed handwriting has a database record');
    assert.ok(f.files.has(id),'committed customer handwriting must remain in private storage');
    if(kind==='replacement')assert.equal(saved.intakeHistory.at(-1).customerSignature,'existing-protocol-signature');
  });

  test(kind+' rejected customer signature removes its new unbound file after a version conflict',async t=>{
    const f=await customerSignatureFlow(t,kind),put=f.env.BUCKET.put.bind(f.env.BUCKET);
    t.mock.method(f.env.BUCKET,'put',async(...args)=>{await put(...args);await f.env.DB.prepare('UPDATE orders SET version=version+1 WHERE id=?').bind(f.order.id).run();});
    const response=await f.sign();assert.equal(response.status,409,await response.clone().text());t.mock.restoreAll();
    assert.equal(f.puts.length,1,'the rejection occurs after creating the new private file');
    assert.equal(f.files.size,0,'the rejected new signature is not left without a database binding');
    assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM assets WHERE order_id=?').bind(f.order.id).first()).n,0);
    const saved=await getOrder(f.env,f.order.id);assert.equal(saved.version,f.order.version+1);assert.equal(f.signatureOf(saved),kind==='replacement'?'existing-protocol-signature':undefined,'the previous record remains unchanged');
  });
}

test('chat customer emails stop when the recipient changes while a personal login is being prepared',async t=>{
  for(const mode of ['invite','notification']){
    const f=await fixture(t),order=await insertOrder(f.env),threadId=randomUUID(),token='e'.repeat(64),now=Date.now(),at=new Date(now).toISOString();
    await f.env.DB.prepare('INSERT INTO chat_threads(id,order_id,token_hash,token_sealed,token_expires_at,created_at,last_at) VALUES(?,?,?,?,?,?,?)').bind(threadId,order.id,digest(token),await protect(f.env,token),new Date(now+86400000).toISOString(),at,at).run();
    await f.env.DB.prepare('INSERT INTO chat_messages(thread_id,sender,body,client_id,created_at) VALUES(?,?,?,?,?)').bind(threadId,'owner','TEST · Nachricht an den Kunden','synthetic-message',at).run();
    for(const [key,value] of Object.entries({resendKey:await protect(f.env,'synthetic-key'),emailVerified:true,sendApproved:true,sender:'sender@example.invalid'}))await setting(f.env,key,value);
    const batch=f.env.DB.batch.bind(f.env.DB);let changed=false;
    t.mock.method(f.env.DB,'batch',async statements=>{const result=await batch(statements);if(!changed&&(await f.env.DB.prepare('SELECT COUNT(*) n FROM auth_tokens').first()).n){changed=true;const current=await getOrder(f.env,order.id);await saveOrder(f.env,transition(current,'editSource',{source:{email:'corrected@example.invalid'}}),current.version,'Empfänger während der Zugangserstellung korrigiert','owner');}return result;});
    const recipients=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(String(url),'https://api.resend.com/emails');recipients.push(...JSON.parse(options.body).to);return new Response(JSON.stringify({id:'synthetic-chat-mail'}));});
    const result=await(mode==='invite'?handleChat(f.env,new Request(origin+'/api/chats/t/'+threadId+'/invite',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:'{}'}),owner,true):notifyThread(f.env,threadId,now)).catch(error=>error);
    assert.equal(changed,true,'the test changes the recipient after issuing the login, before dispatch');
    assert.deepEqual(recipients,[],mode+' must not disclose a login or message excerpt to the previous customer address');
    assert.equal(result.status,409);
    if(mode==='notification')assert.equal((await f.env.DB.prepare('SELECT customer_notified_id FROM chat_threads WHERE id=?').bind(threadId).first()).customer_notified_id,0,'notification slot remains available for a safe later attempt');
    t.mock.restoreAll();
  }
});
