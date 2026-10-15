import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import worker,{getOrder,setting,protect,documentLinkUpdate} from '../src/worker.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {providerOperations} from '../server/providers.mjs';
import {transition,billedTotalCents} from '../src/domain.mjs';
const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='customer@example.invalid';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const signature='data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(300)]).toString('base64');
async function fixture(t,authorized=false){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,4).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id);},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};t.after(()=>env.DB.close());await createApplication(env);
  const id=randomUUID(),initial={id,synthetic:false,status:'Termin verbindlich',source:{name:'TEST · Abwesende Kundin',email:customer,vehicle:'TEST · Fahrzeug'},offer:{totalCents:10000}};
  if(authorized)Object.assign(initial,{acceptance:{at:'2026-10-01T12:00:00.000Z',signature:'existing-customer-signature'},appointment:{start:'2030-10-05T07:00:00.000Z',end:'2030-10-05T09:00:00.000Z',duration:120,delivery:'Kunde bringt',location:'',confirmation:{mode:'online',at:'2026-10-01T12:00:00.000Z',signature:'existing-appointment-signature'}}});
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(id,'WG-TEST-'+id,initial.status,JSON.stringify(initial),new Date().toISOString(),'test','fixture').run();
  const request=(path,data,email=owner)=>worker.fetch(new Request(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{origin,'oai-authenticated-user-email':email,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}),env);
  const ok=async(path,data,email)=>{const response=await request(path,data,email),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const action=async(name,input)=>{const current=await getOrder(env,id);return ok('action',{id,version:current.version,action:name,input});};
  const operatorDraft=async(kind='intake',protocol={})=>{const current=await getOrder(env,id),draft=await ok('protocol/prepare',{id,version:current.version,kind,protocol:{...protocol,customerAbsent:true}});const response=await worker.fetch(new Request(origin+'/api/upload/'+id+'?kind=signature&draft='+draft.id+'&hash='+draft.hash,{method:'POST',headers:{origin,'oai-authenticated-user-email':owner,'Content-Type':'image/png'},body:png}),env),uploaded=await response.json();assert.equal(response.status,200,JSON.stringify(uploaded));return {kind,customerAbsent:true,draftId:draft.id,snapshotHash:draft.hash,operatorSignature:uploaded.id,signaturesConfirmed:true};};
  const absent=async(kind='intake',protocol={})=>action('protocolRequest',await operatorDraft(kind,protocol));
  const pending=async(kind='intake',protocol={})=>{await absent(kind,protocol);const order=await action('documentLink',{kind});return 'document/'+order.pending[kind].token;};
  const signing=async route=>{const shown=await ok(route,undefined,customer);return {signature,confirmed:true,snapshotHash:digest(JSON.stringify(shown))};};
  return {env,files,id,request,ok,action,pending,signing,absent,operatorDraft};
}

test('absent customer signs a first intake in their own access; owner and other customers cannot sign',async t=>{
  const f=await fixture(t,true),route=await f.pending('intake',{plate:'TEST-1',customerSignature:'forged',operatorSignature:'forged'});
  let order=await getOrder(f.env,f.id);assert.equal(order.intake,undefined);assert.equal(order.pending.intake.replaces,null);assert.equal(order.pending.intake.content.customerSignature,null);const operator=order.pending.intake.content.operatorSignature,operatorAt=order.pending.intake.content.operatorSignedAt,originalHash=order.pending.intake.content.snapshotHash;assert.ok(operator);assert.ok(operatorAt);assert.equal(order.pending.intake.content.customerAbsent,true);
  const shown=await f.ok(route,undefined,customer);assert.equal(shown.replaces,null);assert.equal(shown.document.plate,'TEST-1');assert.ok(shown.requestId);assert.ok(!JSON.stringify(shown).includes('baseSnapshot'));assert.ok(!('pending' in shown));
  const input=await f.signing(route);assert.equal((await f.request(route,input,owner)).status,403);assert.equal((await f.request(route,input,'other@example.invalid')).status,403);assert.equal((await f.request(route,{...input,snapshotHash:'wrong'},customer)).status,409);assert.equal((await f.request(route,{...input,confirmed:false},customer)).status,400);
  assert.equal(shown.document.operatorSignature,operator);assert.equal((await f.request(route+'/asset/'+operator,undefined,customer)).status,200);assert.equal((await f.request(route+'/asset/'+operator,undefined,'other@example.invalid')).status,403);
  await f.ok(route,input,customer);order=await getOrder(f.env,f.id);assert.equal(order.status,'In Arbeit');assert.equal(order.intake.signedRemotely,true);assert.equal(order.intake.operatorSignature,operator);assert.equal(order.intake.operatorSignedAt,operatorAt);assert.equal(order.intake.snapshotHash,originalHash);assert.equal(order.intake.customerSnapshotHash,input.snapshotHash);assert.equal(order.intake.replaces,null);assert.equal(order.pending.intake,undefined);assert.equal((await f.request(route,undefined,customer)).status,404);
  assert.equal((await f.request('action',{id:f.id,version:order.version,action:'intake',input:{protocol:{plate:'CHANGED'}}})).status,409);
});

test('the first return protocol completes the order only after personal customer confirmation',async t=>{
  const f=await fixture(t,true),route=await f.pending('return',{services:'TEST · Reinigung',workComplete:true});assert.equal((await getOrder(f.env,f.id)).status,'Termin verbindlich');await f.ok(route,await f.signing(route),customer);const order=await getOrder(f.env,f.id);assert.equal(order.status,'Erledigt');assert.ok(order.completedAt);assert.equal(order.return.workComplete,true);assert.equal(order.return.replaces,null);
});

test('remote preparation requires explicit absence and the operator signature bound to that exact draft',async t=>{
  const f=await fixture(t),attempt=async input=>{const current=await getOrder(f.env,f.id);return f.request('action',{id:f.id,version:current.version,action:'protocolRequest',input});};
  assert.equal((await attempt({kind:'intake',protocol:{plate:'UNSIGNED'}})).status,409);
  const first=await f.operatorDraft('intake',{plate:'SIGNED'});
  assert.equal((await attempt({...first,customerAbsent:false})).status,409);
  assert.equal((await attempt({...first,operatorSignature:null})).status,409);
  assert.equal((await attempt({...first,signaturesConfirmed:false})).status,409);
  assert.equal((await attempt({...first,snapshotHash:'forged'})).status,409);
  const second=await f.operatorDraft('intake',{plate:'DIFFERENT'});
  assert.equal((await attempt({...first,operatorSignature:second.operatorSignature})).status,400);
  const current=await getOrder(f.env,f.id),present=await f.ok('protocol/prepare',{id:f.id,version:current.version,kind:'intake',protocol:{plate:'PRESENT'}});
  // Even a correctly bound signature on a normal onsite draft cannot silently turn into absence.
  await f.env.DB.prepare('INSERT INTO signature_bindings VALUES(?,?,?)').bind('test-bound',present.id,present.hash).run();
  await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind('test-bound',f.id,'signature','image/png',digest(png),png.length,new Date().toISOString()).run();
  assert.equal((await attempt({...first,draftId:present.id,snapshotHash:present.hash,operatorSignature:'test-bound'})).status,409);
  assert.equal((await getOrder(f.env,f.id)).pending,undefined);
  await f.action('note',{note:'Änderung nach Anzeige'});assert.equal((await attempt(first)).status,409);
});

test('operator signing keeps the prepared content immutable, source edits do not change the signed customer or vehicle',async t=>{
  const f=await fixture(t),input=await f.operatorDraft('return',{plate:'PLATE',customerAbsent:true,operatorSignedAt:'forged',customerSnapshotHash:'forged'}),draft=await f.env.DB.prepare('SELECT data FROM protocol_drafts WHERE id=?').bind(input.draftId).first();
  assert.equal(digest(draft.data),input.snapshotHash);assert.equal(JSON.parse(draft.data).operatorSignedAt,undefined);assert.equal(JSON.parse(draft.data).customerSnapshotHash,undefined);
  await f.action('protocolRequest',input);let current=await getOrder(f.env,f.id);assert.equal(current.return,undefined);assert.notEqual(current.pending.return.content.operatorSignedAt,'forged');assert.equal(current.pending.return.content.snapshotHash,input.snapshotHash);
  current.source.name='Changed after operator signed';current.source.vehicle='Changed vehicle';await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(current),f.id).run();
  const linked=await f.action('documentLink',{kind:'return'}),shown=await f.ok('document/'+linked.pending.return.token,undefined,customer);assert.equal(shown.customer,'TEST · Abwesende Kundin');assert.equal(shown.vehicle,'TEST · Fahrzeug');
});

test('an absent-customer replacement retains the original until both new signatures are present',async t=>{
  const f=await fixture(t),first=await f.pending('intake',{plate:'ORIGINAL'});await f.ok(first,await f.signing(first),customer);const original=structuredClone((await getOrder(f.env,f.id)).intake);
  const input=await f.operatorDraft('intake',{plate:'CORRECTION'});await f.action('protocolRequest',input);let current=await getOrder(f.env,f.id);assert.deepEqual(current.intake,original);assert.equal(current.pending.intake.replaces.snapshotHash,original.snapshotHash);assert.equal(current.pending.intake.content.replaces.snapshotHash,original.snapshotHash);
  const route='document/'+(await f.action('documentLink',{kind:'intake'})).pending.intake.token;await f.ok(route,await f.signing(route),customer);current=await getOrder(f.env,f.id);assert.equal(current.intake.operatorSignature,input.operatorSignature);assert.equal(current.intake.snapshotHash,input.snapshotHash);assert.notEqual(current.intake.customerSignature,original.customerSignature);assert.equal(current.intakeHistory.at(-1).customerSignature,original.customerSignature);assert.equal(current.intakeHistory.at(-1).operatorSignature,original.operatorSignature);
});

test('legacy unsigned first requests cannot be linked, sent or signed without renewed operator consent',async t=>{
  const f=await fixture(t),token='a'.repeat(64),current=await getOrder(f.env,f.id);current.pending={intake:{content:{plate:'LEGACY'},token,createdAt:new Date().toISOString()}};
  await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(current),f.id).run();await f.env.DB.prepare('INSERT INTO document_requests(hash,order_id,kind,expires_at,created_at) VALUES(?,?,?,?,?)').bind(digest(token),f.id,'intake',new Date(Date.now()+3600000).toISOString(),new Date().toISOString()).run();
  assert.equal((await f.request('action',{id:f.id,version:current.version+1,action:'documentLink',input:{kind:'intake'}})).status,409);assert.equal((await f.request('document/'+token,undefined,customer)).status,409);assert.equal((await f.request('document/'+token,{signature,confirmed:true,snapshotHash:'x'},customer)).status,409);
  await assert.rejects(providerOperations.action(f.env,current,'sendDocument',{kind:'intake'}),/Betrieb muss/);assert.equal((await getOrder(f.env,f.id)).pending.intake.content.customerAbsent,undefined);
});

test('simultaneous operator submissions create one signed request and preserve the bound signature',async t=>{
  const f=await fixture(t),input=await f.operatorDraft(),current=await getOrder(f.env,f.id),request={id:f.id,version:current.version,action:'protocolRequest',input};const results=await Promise.all([f.request('action',request),f.request('action',request)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await getOrder(f.env,f.id)).pending.intake.content.operatorSignature,input.operatorSignature);assert.equal((await getOrder(f.env,f.id)).pendingHistory,undefined);
});

test('altered or missing operator signature bytes stop customer viewing, signing and new links',async t=>{
  const f=await fixture(t),route=await f.pending(),input=await f.signing(route),current=await getOrder(f.env,f.id);f.files.get(current.pending.intake.content.operatorSignature).body=new Uint8Array([1,2]);
  assert.equal((await f.request(route,undefined,customer)).status,409);assert.equal((await f.request(route,input,customer)).status,409);assert.equal((await f.request('action',{id:f.id,version:current.version,action:'documentLink',input:{kind:'intake'}})).status,409);assert.equal((await getOrder(f.env,f.id)).intake,undefined);
});

test('absent protocols require owner release even when a stored token exists',async t=>{
  const f=await fixture(t);await f.absent();let current=await getOrder(f.env,f.id);
  await assert.rejects(documentLinkUpdate(f.env,current,'intake',undefined,'customer'),/noch nicht.*freigegeben/);
  const linked=await f.action('documentLink',{kind:'intake'}),route='document/'+linked.pending.intake.token,input=await f.signing(route);current=await getOrder(f.env,f.id);delete current.pending.intake.releasedAt;
  await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(current),f.id).run();
  for(const path of [route,route+'/asset/'+current.pending.intake.content.operatorSignature])assert.equal((await f.request(path,undefined,customer)).status,409);
  assert.equal((await f.request(route,input,customer)).status,409);assert.equal((await getOrder(f.env,f.id)).intake,undefined);
});

test('replacement preserves the signed original and never inherits either prior signature',async t=>{
  const f=await fixture(t),route=await f.pending('intake',{plate:'ORIGINAL'});await f.ok(route,await f.signing(route),customer);const original=structuredClone((await getOrder(f.env,f.id)).intake);
  await f.action('replacement',{kind:'intake',protocol:{plate:'KORREKTUR',operatorSignature:original.customerSignature}});let current=await getOrder(f.env,f.id);assert.deepEqual(current.intake,original);assert.equal(current.pending.intake.content.operatorSignature,null);
  const linked=await f.action('documentLink',{kind:'intake'}),correction='document/'+linked.pending.intake.token;const shown=await f.ok(correction,undefined,customer);assert.ok(shown.replaces.signedAt);await f.ok(correction,await f.signing(correction),customer);current=await getOrder(f.env,f.id);const {replacedAt,...retained}=current.intakeHistory.at(-1);assert.ok(replacedAt);assert.deepEqual(retained,original);assert.equal(current.intake.plate,'KORREKTUR');assert.notEqual(current.intake.customerSignature,original.customerSignature);assert.equal(current.intake.operatorSignature,null);
});

test('rotated, superseded and directly edited protocol requests revoke the earlier document and photo access',async t=>{
  const f=await fixture(t),first=await f.pending('intake',{plate:'FIRST'}),input=await f.signing(first);
  await f.action('documentLink',{kind:'intake'});assert.equal((await f.request(first,input,customer)).status,404);
  const second='document/'+(await getOrder(f.env,f.id)).pending.intake.token;const original=(await getOrder(f.env,f.id)).pending.intake;await f.absent('intake',{plate:'SECOND'});assert.equal((await f.request(second,undefined,customer)).status,404);assert.deepEqual((await getOrder(f.env,f.id)).pendingHistory[0].content,original.content);assert.ok(original.releasedAt);assert.equal((await getOrder(f.env,f.id)).pending.intake.releasedAt,undefined,'a new signed version needs a new release');
  const third='document/'+(await f.action('documentLink',{kind:'intake'})).pending.intake.token,current=await getOrder(f.env,f.id);assert.equal((await f.request('action',{id:f.id,version:current.version,action:'intake',input:{protocol:{plate:'DIRECT'}}})).status,409);await f.action('discardReplacement',{kind:'intake'});await f.action('intake',{protocol:{plate:'DIRECT'}});assert.equal((await f.request(third,undefined,customer)).status,404);assert.equal((await getOrder(f.env,f.id)).pending.intake,undefined);assert.equal((await getOrder(f.env,f.id)).pendingHistory.length,2);
});

test('changed pending content, source version and base document cannot silently receive an older signature',async t=>{
  const f=await fixture(t),route=await f.pending('intake',{plate:'SHOWN'}),input=await f.signing(route);await f.action('note',{note:'TEST · Zwischenzeitliche Änderung'});assert.equal((await f.request(route,input,customer)).status,409);
  let current=await getOrder(f.env,f.id);current.pending.intake.content.plate='TAMPERED';await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(current),f.id).run();assert.equal((await f.request(route,undefined,customer)).status,409);
  await f.absent('intake',{plate:'FRESH'});const fresh='document/'+(await f.action('documentLink',{kind:'intake'})).pending.intake.token;current=await getOrder(f.env,f.id);current.intake={plate:'UNEXPECTED'};await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(current),f.id).run();assert.equal((await f.request(fresh,undefined,customer)).status,409);
});

test('document photo review checks ownership, method and stored bytes',async t=>{
  const f=await fixture(t),photo=randomUUID();await f.env.BUCKET.put(photo,png,{httpMetadata:{contentType:'image/png'}});await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(photo,f.id,'photo','image/png',digest(png),png.length,new Date().toISOString()).run();
  const route=await f.pending('intake',{photos:[photo]});assert.equal((await f.request(route+'/asset/'+photo,undefined,customer)).status,200);assert.equal((await f.request(route+'/asset/'+photo,{},customer)).status,405);assert.equal((await f.request(route+'/asset/'+photo,undefined,'other@example.invalid')).status,403);assert.equal((await f.request(route+'/asset/'+randomUUID(),undefined,customer)).status,404);f.files.get(photo).body=new Uint8Array([1,2]);assert.equal((await f.request(route+'/asset/'+photo,undefined,customer)).status,404);
});

test('remote signature race stores one personal signature and one audit entry',async t=>{
  const f=await fixture(t),route=await f.pending('intake',{plate:'PARALLEL'}),input=await f.signing(route);const results=await Promise.all([f.request(route,input,customer),f.request(route,input,customer)]);assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.every(r=>[200,409].includes(r.status)));assert.equal(f.env.DB.sql.prepare("SELECT count(*) n FROM assets WHERE kind='signature'").get().n,2);assert.equal(f.files.size,2);assert.equal(f.env.DB.sql.prepare("SELECT count(*) n FROM audit WHERE actor='customer'").get().n,1);
});

test('first protocol PIN email uses the checked request and repeated sends are locked',async t=>{
  const f=await fixture(t);await f.absent('intake',{plate:'REMOTE'});await setting(f.env,'resendKey',await protect(f.env,'synthetic-key'));for(const [key,value] of Object.entries({emailVerified:true,sendApproved:true,sender:'test@example.invalid'}))await setting(f.env,key,value);
  const messages=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');messages.push(JSON.parse(options.body));return Response.json({id:'synthetic-message'});});const order=await getOrder(f.env,f.id);const saved=await providerOperations.action(f.env,order,'sendDocument',{kind:'intake'});assert.ok(saved.pending.intake.token);assert.ok(saved.pending.intake.releasedAt,'explicit email action also releases the protocol to the portal');assert.equal(messages.length,1);assert.deepEqual(messages[0].to,[customer]);assert.match(messages[0].text,/persönliche einmalige PIN: \d{6}/);assert.match(messages[0].text,/Kundenzugang/);assert.doesNotMatch(messages[0].text,/ersetzt.*unterschriebene/);assert.doesNotMatch(messages[0].subject,/Ersatz/);await assert.rejects(providerOperations.action(f.env,saved,'sendDocument',{kind:'intake'}),/bereits versendet/);assert.equal(messages.length,1);
});

test('billing uses edited invoice total without changing a signed offer',()=>{
  const order={status:'Erledigt',source:{},offer:{totalCents:10000},acceptance:{signature:'original-signature',snapshot:{offer:{totalCents:10000},source:{}}},invoiceDraft:{totalCents:12000},payments:[]};const paid=transition(order,'payment',{amountCents:12000});assert.equal(paid.status,'Bezahlt');assert.equal(paid.offer.totalCents,10000);assert.equal(billedTotalCents({...paid,invoice:{status:'unpaid',totalCents:15000}}),15000);assert.equal(billedTotalCents({...paid,invoice:{status:'canceled',totalCents:15000}}),12000);
});

test('explicit renewal replaces a revoked offer link and permits one newly authorized PIN email',async t=>{
  const f=await fixture(t);await f.action('setStatus',{status:'Preise prüfen'});const first=await f.action('confirm',{});const original=digest(first.offerToken);await setting(f.env,'resendKey',await protect(f.env,'synthetic-key'));for(const [key,value] of Object.entries({emailVerified:true,sendApproved:true,sender:'test@example.invalid'}))await setting(f.env,key,value);
  const messages=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');messages.push({body:JSON.parse(options.body),key:options.headers['Idempotency-Key']});return Response.json({id:'synthetic-mail-'+messages.length});});await providerOperations.action(f.env,first,'sendOffer',{});await assert.rejects(providerOperations.action(f.env,first,'sendOffer',{}),/bereits versendet/);await f.env.DB.prepare('UPDATE offer_tokens SET revoked=1 WHERE order_id=?').bind(f.id).run();await assert.rejects(providerOperations.action(f.env,first,'sendOffer',{}),/nicht mehr aktiv/);
  const renewed=await f.action('renewOfferLink',{});assert.notEqual(renewed.offerToken,first.offerToken);assert.equal((await f.request('offer/'+first.offerToken,undefined,customer)).status,404);assert.equal((await f.request('offer/'+renewed.offerToken,undefined,customer)).status,200);assert.equal((await f.env.DB.prepare('SELECT revoked FROM offer_tokens WHERE hash=?').bind(original).first()).revoked,1);await providerOperations.action(f.env,renewed,'sendOffer',{});assert.equal(messages.length,2);assert.notEqual(messages[0].key,messages[1].key);await assert.rejects(providerOperations.action(f.env,renewed,'sendOffer',{}),/bereits versendet/);
});

test('offer renewal is blocked for unknown earlier provider results and closed offers',async t=>{
  const f=await fixture(t);assert.equal((await f.request('action',{id:f.id,version:1,action:'renewOfferLink',input:{}})).status,409);await f.action('setStatus',{status:'Preise prüfen'});const offered=await f.action('confirm',{}),now=new Date().toISOString();await f.env.DB.prepare("INSERT INTO jobs(id,order_id,kind,state,created_at,updated_at) VALUES(?,?,?,'unknown',?,?)").bind(randomUUID(),f.id,'offer',now,now).run();const response=await f.request('action',{id:f.id,version:offered.version,action:'renewOfferLink',input:{}});assert.equal(response.status,409);assert.equal((await getOrder(f.env,f.id)).version,offered.version);assert.equal((await getOrder(f.env,f.id)).offerToken,offered.offerToken);
});
