import test from 'node:test';
import assert from 'node:assert/strict';
import {handoverFixture,ok,customer,foreign,COMPANY,syntheticSignature,signatureBytes} from './fixtures/handover.mjs';
import {createTestLetterhead} from './fixtures/letterhead.mjs';
import {protocolDocument} from '../server/protocol-document.mjs';
import {deliverProtocol,pendingProtocolMails} from '../server/protocol-mail.mjs';

test('remote intake and return require separate customer signatures before status, PDF or mail completion',async t=>{
  const f=await handoverFixture(t);let order=await f.add();
  for(const kind of ['intake','return']){
    order=await f.publish(order,kind);const h=order.handovers[kind];
    assert.equal(order.status,kind==='intake'?'Termin verbindlich':'In Arbeit');assert.equal(h.status,'pending');
    assert.ok(h.operatorSignedAt);assert.equal(h.customerSignedAt,null);assert.equal(order[kind],undefined);
    assert.deepEqual(h.protocol.business,COMPANY);assert.deepEqual(h.protocol.documentTemplate,f.template);
    assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,0);
    assert.equal((await f.req('/api/protocol/pdf?id='+order.id+'&kind='+kind)).status,409);
    order=(await f.complete(order,kind)).order;
    assert.equal(order.status,kind==='intake'?'In Arbeit':'Erledigt');assert.equal(order.handovers[kind].status,'completed');
    assert.ok(order.handovers[kind].customerSignedAt);assert.notEqual(order[kind].operatorSignature,order[kind].customerSignature);
    const pdf=await protocolDocument(f.env,order,kind);assert.equal(Buffer.from(pdf.bytes).subarray(0,5).toString(),'%PDF-');
  }
  assert.ok(order.completedAt);assert.equal(order.return.keyLocation,'TEST · vereinbartes Schlüsselfach');assert.ok(order.return.keyPhoto);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);
});

test('runtime sessions isolate customers and disregard spoofed operator identity headers',async t=>{
  const f=await handoverFixture(t),order=await f.publish(await f.add()),route='/api/handover/'+order.handovers.intake.token;
  const owner=await ok(f.req(route)),view=await ok(f.req(route,undefined,'customer'));
  assert.equal(owner.ownerPreview,true);assert.equal(view.ownerPreview,false);assert.equal(view.hash,owner.hash);
  for(const field of ['orders','source','notes','payments','offer'])assert.equal(field in view,false,field);
  assert.ok(!JSON.stringify(view).includes('PRIVATE OPERATOR NOTE'));
  assert.equal((await f.req(route,undefined,'')).status,401);
  assert.equal((await f.req(route,undefined,'foreign',{'oai-authenticated-user-email':customer})).status,403);
  const input={snapshotHash:view.hash,signature:syntheticSignature,confirmed:true};
  assert.equal((await f.req(route,input,'owner')).status,403);
  assert.equal((await f.req(route,input,'foreign',{'oai-authenticated-user-email':customer})).status,403);
  assert.equal((await f.req('/api/handover/publish',{id:order.id},'customer',{'oai-authenticated-user-email':COMPANY.email})).status,403);
  assert.equal((await f.req('/api/state',undefined,'customer')).status,403);
  assert.equal((await f.current(order)).handovers.intake.status,'pending');
});

test('both signature stages reject a changed snapshot, missing confirmation and malformed PNG',async t=>{
  const f=await handoverFixture(t),order=await f.add(),prepared=await f.prepare(order);
  const input={id:order.id,version:order.version,draftId:prepared.draft.id,snapshotHash:prepared.draft.hash,operatorSignature:prepared.signature,operatorConfirmed:true};
  assert.equal((await f.req('/api/handover/publish',{...input,snapshotHash:'wrong'})).status,409);
  assert.equal((await f.req('/api/handover/publish',{...input,operatorConfirmed:false})).status,400);
  const pending=await ok(f.req('/api/handover/publish',input)),view=await f.displayed(pending),route='/api/handover/'+pending.handovers.intake.token;
  const customerInput={snapshotHash:view.hash,signature:syntheticSignature,confirmed:true};
  assert.equal((await f.req(route,{...customerInput,snapshotHash:'wrong'},'customer')).status,409);
  assert.equal((await f.req(route,{...customerInput,confirmed:false},'customer')).status,400);
  assert.equal((await f.req(route,{...customerInput,signature:'data:image/png;base64,'+Buffer.alloc(400).toString('base64')},'customer')).status,400);
  const corrupt=Buffer.from(signatureBytes());corrupt[corrupt.length-1]^=1;
  assert.equal((await f.req(route,{...customerInput,signature:'data:image/png;base64,'+corrupt.toString('base64')},'customer')).status,400);
  assert.equal((await f.req(route,customerInput,'customer',{origin:'https://foreign.example.invalid'})).status,403);
  assert.equal((await f.current(order)).handovers.intake.status,'pending');
});

test('an operator signature is bound to its own displayed draft',async t=>{
  const f=await handoverFixture(t),order=await f.add(),details=await f.protocol(order),first=await f.prepare(order,'intake',details);
  const second=await ok(f.req('/api/handover/prepare',{id:order.id,version:order.version,kind:'intake',protocol:{...details,condition:'TEST · changed condition'}}));
  assert.equal((await f.req('/api/handover/publish',{id:order.id,version:order.version,draftId:second.id,snapshotHash:second.hash,operatorSignature:first.signature,operatorConfirmed:true})).status,400);
  assert.equal((await f.current(order)).handovers,undefined);
});

test('a remote draft cannot be finalized through the onsite API or forged onsite workflow flag',async t=>{
  const f=await handoverFixture(t),order=await f.add(),remote=await f.prepare(order),params='&draft='+remote.draft.id+'&hash='+remote.draft.hash,second=await f.upload(order,'signature',params);
  assert.equal((await f.req('/api/action',{id:order.id,version:order.version,action:'intake',input:{draftId:remote.draft.id,snapshotHash:remote.draft.hash,operatorSignature:remote.signature,customerSignature:second,signaturesConfirmed:true}})).status,409);
  const onsite=await ok(f.req('/api/protocol/prepare',{id:order.id,version:order.version,kind:'intake',protocol:await f.protocol(order,'intake',{workflow:'remote'})}));
  assert.notEqual(onsite.protocol.workflow,'remote');
  assert.equal((await f.current(order)).intake,undefined);
});

test('reassigning a pending order cannot transfer its signed snapshot to another customer',async t=>{
  const f=await handoverFixture(t);let pending=await f.publish(await f.add());const original=await f.displayed(pending),token=pending.handovers.intake.token;
  pending=await f.update(pending,{source:{...pending.source,email:foreign}});
  for(const role of ['customer','foreign']){
    assert.equal((await f.req('/api/handover/'+token,undefined,role)).status,403);
    assert.equal((await f.req('/api/handover/'+token+'/asset/'+original.protocol.photos[0],undefined,role)).status,403);
    assert.equal((await f.req('/api/handover/'+token,{snapshotHash:original.hash,signature:syntheticSignature,confirmed:true},role)).status,403);
  }
  assert.equal((await f.current(pending)).handovers.intake.status,'pending');
});

test('remote return requires an order-owned key location photo and description',async t=>{
  const f=await handoverFixture(t);let order=await f.publish(await f.add());order=(await f.complete(order)).order;
  const details=await f.protocol(order,'return'),other=await f.add({source:{name:'TEST foreign',email:foreign,vehicle:'TEST'}}),otherPhoto=await f.upload(other),booking=await f.upload(order,'booking');
  for(const overrides of [{keyPhoto:null},{keyLocation:''},{keyPhoto:otherPhoto},{keyPhoto:booking},{photos:[]},{workComplete:false},{services:''}]){
    assert.equal((await f.req('/api/handover/prepare',{id:order.id,version:order.version,kind:'return',protocol:{...details,...overrides}})).status,400,JSON.stringify(overrides));
  }
  const prepared=await f.prepare(order,'return',details);assert.equal(prepared.draft.protocol.keyPhoto,details.keyPhoto);
});

test('published snapshots retain business and approved letterhead after notes and template changes',async t=>{
  const f=await handoverFixture(t);let order=await f.publish(await f.add());const view=await f.displayed(order);
  order=await ok(f.req('/api/action',{id:order.id,version:order.version,action:'note',input:{note:'TEST · added after publication'}}));
  await createTestLetterhead(f.env,{marker:'TEST replacement letterhead'});
  const reread=await f.displayed(order);assert.equal(reread.hash,view.hash);assert.deepEqual(reread.protocol,view.protocol);
  const signed=(await f.complete(order)).order;assert.deepEqual(signed.intake.documentTemplate,view.protocol.documentTemplate);
  assert.deepEqual(signed.intake.business,view.protocol.business);assert.equal(signed.notes.at(-1).note,'TEST · added after publication');
});

test('an abandoned remote handover blocks onsite and direct bypasses in either phase',async t=>{
  const f=await handoverFixture(t);let order=await f.publish(await f.add());
  for(const kind of ['intake','return']){
    const details=await f.protocol(order,kind,{direct:true,directReason:'TEST · attempted bypass'});
    for(const endpoint of ['protocol/prepare','handover/prepare'])assert.equal((await f.req('/api/'+endpoint,{id:order.id,version:order.version,kind,protocol:details})).status,409);
    assert.equal((await f.req('/api/action',{id:order.id,version:order.version,action:kind,input:{direct:true}})).status,409);
  }
  order=(await f.complete(order)).order;order=await f.publish(order,'return');
  assert.equal((await f.req('/api/action',{id:order.id,version:order.version,action:'return',input:{}})).status,409);
  assert.equal((await f.current(order)).status,'In Arbeit');
});

test('parallel completion and replay save one signature, one customer audit and one final version',async t=>{
  const f=await handoverFixture(t),order=await f.publish(await f.add()),view=await f.displayed(order),route='/api/handover/'+order.handovers.intake.token,input={snapshotHash:view.hash,signature:syntheticSignature,confirmed:true};
  const before=(await f.env.DB.prepare("SELECT COUNT(*) n FROM assets WHERE kind='signature'").first()).n;
  const responses=await Promise.all([f.req(route,input,'customer'),f.req(route,input,'customer'),f.req(route,input,'customer')]);
  for(const response of responses)assert.equal(response.status,200,await response.text());
  const saved=await f.current(order);await ok(f.req(route,input,'customer'));const replayed=await f.current(order);
  assert.equal(replayed.version,saved.version);assert.equal(replayed.intake.customerSignature,saved.intake.customerSignature);
  assert.equal(replayed.handovers.intake.customerSignedAt,saved.handovers.intake.customerSignedAt);
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM assets WHERE kind='signature'").first()).n,before+1);
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM audit WHERE order_id=? AND actor='customer'").bind(order.id).first()).n,1);
  assert.equal((await f.req(route,{...input,snapshotHash:'wrong'},'customer')).status,409);
});

test('a note that wins the optimistic update is preserved when customer completion retries',async t=>{
  const f=await handoverFixture(t),order=await f.publish(await f.add()),originalBatch=f.env.DB.batch.bind(f.env.DB);let intervened=false;
  t.mock.method(f.env.DB,'batch',async statements=>{
    if(!intervened){intervened=true;const current=await f.current(order);await ok(f.req('/api/action',{id:order.id,version:current.version,action:'note',input:{note:'TEST · concurrent retained note'}}));}
    return originalBatch(statements);
  });
  const result=await f.complete(order);assert.equal(intervened,true);assert.equal(result.order.status,'In Arbeit');
  assert.equal(result.order.notes.at(-1).note,'TEST · concurrent retained note');
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM audit WHERE order_id=? AND actor='customer'").bind(order.id).first()).n,1);
});

test('new open amendments block a pending return until they are resolved',async t=>{
  const f=await handoverFixture(t);let order=await f.publish(await f.add());order=(await f.complete(order)).order;
  const amendment={id:crypto.randomUUID(),state:'open',services:'TEST extra',amountCents:1000,expiresAt:new Date(Date.now()+86400000).toISOString()};
  order=await f.update(order,{amendments:[amendment]});const details=await f.protocol(order,'return');
  assert.equal((await f.req('/api/handover/prepare',{id:order.id,version:order.version,kind:'return',protocol:details})).status,409);
  order=await f.update(order,{amendments:[]});order=await f.publish(order,'return',details);const view=await f.displayed(order,'return');
  order=await f.update(order,{amendments:[amendment]});
  assert.equal((await f.req('/api/handover/'+order.handovers.return.token,{snapshotHash:view.hash,signature:syntheticSignature,confirmed:true},'customer')).status,409);
  assert.equal((await f.current(order)).handovers.return.status,'pending');
  order=await f.update(order,{amendments:[{...amendment,state:'withdrawn'}]});order=(await f.complete(order,'return')).order;
  assert.equal(order.status,'Erledigt');
});

test('private assets expose only published photos, previews and signatures to the assigned customer',async t=>{
  const f=await handoverFixture(t);let order=await f.publish(await f.add());order=(await f.complete(order)).order;
  const p=await f.protocol(order,'return'),preview=await f.upload(order),keyPreview=await f.upload(order);p.photoPreviews={[p.photos[0]]:preview,[p.keyPhoto]:keyPreview};
  const hidden=await f.upload(order),booking=await f.upload(order,'booking'),other=await f.add({source:{name:'TEST other',email:foreign,vehicle:'TEST'}}),otherPhoto=await f.upload(other);
  order=await f.publish(order,'return',p);const prefix='/api/handover/'+order.handovers.return.token+'/asset/';
  for(const id of [...p.photos,p.keyPhoto,preview,keyPreview,order.handovers.return.protocol.operatorSignature]){
    const image=await f.req(prefix+id,undefined,'customer');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),signatureBytes());
    assert.equal((await f.req(prefix+id,undefined,'foreign')).status,403);assert.equal((await f.req(prefix+id,undefined,'')).status,401);
  }
  for(const id of [hidden,booking,otherPhoto,crypto.randomUUID()])assert.equal((await f.req(prefix+id,undefined,'customer')).status,404);
  order=(await f.complete(order,'return')).order;assert.equal((await f.req(prefix+order.return.customerSignature,undefined,'customer')).status,200);
  assert.equal((await f.req('/api/asset/'+hidden,undefined,'customer')).status,403);
});

test('existing onsite and direct intake and return preserve their original behavior',async t=>{
  const f=await handoverFixture(t);let onsite=await f.add(),direct=await f.add({status:'Preise prüfen',offer:undefined,acceptance:undefined,appointment:undefined});
  for(const kind of ['intake','return']){
    onsite=await f.onsite(onsite,kind);direct=await f.onsite(direct,kind,await f.protocol(direct,kind,{direct:true,directReason:'TEST · telephone agreement'}));
  }
  assert.equal(onsite.status,'Erledigt');assert.equal(direct.status,'Erledigt');assert.equal(onsite.handovers,undefined);assert.equal(direct.handovers,undefined);
  assert.equal(direct.acceptance,undefined);assert.equal(direct.intake.direct,true);assert.equal(direct.return.direct,true);
});

test('remote direct return keeps the reason and does not create a fictitious offer acceptance',async t=>{
  const f=await handoverFixture(t),order=await f.add({status:'Preise prüfen',offer:undefined,acceptance:undefined,appointment:undefined});
  const details=await f.protocol(order,'return',{direct:true,directReason:'TEST · independently agreed vehicle dropoff'});
  assert.equal((await f.req('/api/handover/prepare',{id:order.id,version:order.version,kind:'return',protocol:{...details,directReason:''}})).status,400);
  const pending=await f.publish(order,'return',details);assert.equal(pending.status,'Preise prüfen');
  const completed=(await f.complete(pending,'return')).order;assert.equal(completed.status,'Erledigt');assert.equal(completed.acceptance,undefined);assert.equal(completed.intake,undefined);
  assert.equal(completed.return.directReason,details.directReason);
});

test('remote completion alone queues and sends one immutable PDF per phase using mocked delivery',async t=>{
  const f=await handoverFixture(t),sent=[];await f.mail();
  t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');sent.push(JSON.parse(options.body));return Response.json({id:'TEST mocked protocol '+sent.length});});
  let order=await f.add({synthetic:false});
  for(const kind of ['intake','return']){
    order=await f.publish(order,kind);assert.equal(sent.length,kind==='intake'?0:1);
    const pendingCount=(await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n;assert.equal(pendingCount,kind==='intake'?0:1);
    const result=await f.complete(order,kind);order=result.order;assert.equal(sent.length,kind==='intake'?1:2);
    const message=sent.at(-1);assert.deepEqual(message.to,[customer]);assert.deepEqual(message.cc,[COMPANY.email]);assert.equal(message.attachments.length,1);
    const pdf=Buffer.from(message.attachments[0].content,'base64');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
    const download=await f.req('/api/customer-portal/document?id='+order.id+'&kind='+kind,undefined,'customer');assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
    await f.complete(order,kind);await deliverProtocol(f.env,order.id,kind);assert.equal(sent.length,kind==='intake'?1:2);
  }
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,2);
  const original=Buffer.from((await protocolDocument(f.env,order,'return')).bytes);assert.equal(original.subarray(0,5).toString(),'%PDF-');
  f.files.get(order.return.keyPhoto).body=new Uint8Array([1,2]);await assert.rejects(protocolDocument(f.env,order,'return'),/nicht mehr vollständig/);
});

test('missing letterhead keeps both signatures and delays PDF and mocked mail until approval',async t=>{
  const f=await handoverFixture(t,{withTemplate:false}),sent=[];await f.mail();
  t.mock.method(globalThis,'fetch',async(_url,options)=>{sent.push(JSON.parse(options.body));return Response.json({id:'TEST delayed protocol'});});
  const pending=await f.publish(await f.add({synthetic:false}));assert.equal(pending.handovers.intake.protocol.documentTemplatePending,true);
  const signed=(await f.complete(pending)).order;assert.equal(signed.status,'In Arbeit');assert.ok(signed.intake.customerSignature);assert.ok(signed.intake.operatorSignature);assert.equal(sent.length,0);
  assert.equal((await f.req('/api/customer-portal/document?id='+signed.id+'&kind=intake',undefined,'customer')).status,409);
  const original=structuredClone(signed.intake);await createTestLetterhead(f.env);await pendingProtocolMails(f.env);assert.equal(sent.length,1);
  assert.equal((await f.req('/api/customer-portal/document?id='+signed.id+'&kind=intake',undefined,'customer')).status,200);
  assert.deepEqual((await f.current(signed)).intake,original);await pendingProtocolMails(f.env);assert.equal(sent.length,1);
});

test('failed final queue insertion rolls back customer signature, status and audit together',async t=>{
  const f=await handoverFixture(t),pending=await f.publish(await f.add({synthetic:false})),view=await f.displayed(pending);
  await f.env.DB.prepare("CREATE TRIGGER refuse_handover_queue BEFORE INSERT ON protocol_deliveries BEGIN SELECT RAISE(ABORT,'TEST queue failure'); END").run();
  const before=(await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n;
  const response=await f.req('/api/handover/'+pending.handovers.intake.token,{snapshotHash:view.hash,signature:syntheticSignature,confirmed:true},'customer');assert.equal(response.status,500);
  const unchanged=await f.current(pending);assert.equal(unchanged.version,pending.version);assert.equal(unchanged.status,'Termin verbindlich');assert.equal(unchanged.handovers.intake.status,'pending');
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM audit').first()).n,before);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,0);
});
