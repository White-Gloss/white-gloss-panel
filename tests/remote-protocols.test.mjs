import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import worker,{getOrder,setting,protect} from '../src/worker.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {providerOperations} from '../server/providers.mjs';
import {transition,billedTotalCents} from '../src/domain.mjs';
const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='customer@example.invalid';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const signature='data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(300)]).toString('base64');
async function fixture(t){
  const files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,4).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id);},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')}};t.after(()=>env.DB.close());await createApplication(env);
  const id=randomUUID(),initial={id,synthetic:false,status:'Termin verbindlich',source:{name:'TEST · Abwesende Kundin',email:customer,vehicle:'TEST · Fahrzeug'},offer:{totalCents:10000}};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(id,'WG-TEST-'+id,initial.status,JSON.stringify(initial),new Date().toISOString(),'test','fixture').run();
  const request=(path,data,email=owner)=>worker.fetch(new Request(origin+'/api/'+path,{method:data===undefined?'GET':'POST',headers:{origin,'oai-authenticated-user-email':email,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}),env);
  const ok=async(path,data,email)=>{const response=await request(path,data,email),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
  const action=async(name,input)=>{const current=await getOrder(env,id);return ok('action',{id,version:current.version,action:name,input});};
  const pending=async(kind='intake',protocol={})=>{await action('protocolRequest',{kind,protocol});const order=await action('documentLink',{kind});return 'document/'+order.pending[kind].token;};
  const signing=async route=>{const shown=await ok(route,undefined,customer);return {signature,confirmed:true,snapshotHash:digest(JSON.stringify(shown))};};
  return {env,files,id,request,ok,action,pending,signing};
}

test('absent customer signs a first intake in their own access; owner and other customers cannot sign',async t=>{
  const f=await fixture(t),route=await f.pending('intake',{plate:'TEST-1',customerSignature:'forged',operatorSignature:'forged'});
  let order=await getOrder(f.env,f.id);assert.equal(order.intake,undefined);assert.equal(order.pending.intake.replaces,null);assert.equal(order.pending.intake.content.customerSignature,null);assert.equal(order.pending.intake.content.operatorSignature,null);
  const shown=await f.ok(route,undefined,customer);assert.equal(shown.replaces,null);assert.equal(shown.document.plate,'TEST-1');assert.ok(shown.requestId);assert.ok(!JSON.stringify(shown).includes('baseSnapshot'));assert.ok(!('pending' in shown));
  const input=await f.signing(route);assert.equal((await f.request(route,input,owner)).status,403);assert.equal((await f.request(route,input,'other@example.invalid')).status,403);assert.equal((await f.request(route,{...input,snapshotHash:'wrong'},customer)).status,409);assert.equal((await f.request(route,{...input,confirmed:false},customer)).status,400);
  await f.ok(route,input,customer);order=await getOrder(f.env,f.id);assert.equal(order.status,'In Arbeit');assert.equal(order.intake.signedRemotely,true);assert.equal(order.intake.operatorSignature,null);assert.equal(order.intake.replaces,null);assert.equal(order.pending.intake,undefined);assert.equal((await f.request(route,undefined,customer)).status,404);
  assert.equal((await f.request('action',{id:f.id,version:order.version,action:'intake',input:{protocol:{plate:'CHANGED'}}})).status,409);
});

test('the first return protocol completes the order only after personal customer confirmation',async t=>{
  const f=await fixture(t),route=await f.pending('return',{services:'TEST · Reinigung',workComplete:true});assert.equal((await getOrder(f.env,f.id)).status,'Termin verbindlich');await f.ok(route,await f.signing(route),customer);const order=await getOrder(f.env,f.id);assert.equal(order.status,'Erledigt');assert.ok(order.completedAt);assert.equal(order.return.workComplete,true);assert.equal(order.return.replaces,null);
});

test('replacement preserves the signed original and never inherits either prior signature',async t=>{
  const f=await fixture(t),route=await f.pending('intake',{plate:'ORIGINAL'});await f.ok(route,await f.signing(route),customer);const original=structuredClone((await getOrder(f.env,f.id)).intake);
  await f.action('replacement',{kind:'intake',protocol:{plate:'KORREKTUR',operatorSignature:original.customerSignature}});let current=await getOrder(f.env,f.id);assert.deepEqual(current.intake,original);assert.equal(current.pending.intake.content.operatorSignature,null);
  const linked=await f.action('documentLink',{kind:'intake'}),correction='document/'+linked.pending.intake.token;const shown=await f.ok(correction,undefined,customer);assert.ok(shown.replaces.signedAt);await f.ok(correction,await f.signing(correction),customer);current=await getOrder(f.env,f.id);const {replacedAt,...retained}=current.intakeHistory.at(-1);assert.ok(replacedAt);assert.deepEqual(retained,original);assert.equal(current.intake.plate,'KORREKTUR');assert.notEqual(current.intake.customerSignature,original.customerSignature);assert.equal(current.intake.operatorSignature,null);
});

test('rotated, superseded and directly edited protocol requests revoke the earlier document and photo access',async t=>{
  const f=await fixture(t),first=await f.pending('intake',{plate:'FIRST'}),input=await f.signing(first);
  await f.action('documentLink',{kind:'intake'});assert.equal((await f.request(first,input,customer)).status,404);
  const second='document/'+(await getOrder(f.env,f.id)).pending.intake.token;await f.action('protocolRequest',{kind:'intake',protocol:{plate:'SECOND'}});assert.equal((await f.request(second,undefined,customer)).status,404);
  const third='document/'+(await f.action('documentLink',{kind:'intake'})).pending.intake.token;await f.action('intake',{protocol:{plate:'DIRECT'}});assert.equal((await f.request(third,undefined,customer)).status,404);assert.equal((await getOrder(f.env,f.id)).pending.intake,undefined);
});

test('changed pending content, source version and base document cannot silently receive an older signature',async t=>{
  const f=await fixture(t),route=await f.pending('intake',{plate:'SHOWN'}),input=await f.signing(route);await f.action('note',{note:'TEST · Zwischenzeitliche Änderung'});assert.equal((await f.request(route,input,customer)).status,409);
  let current=await getOrder(f.env,f.id);current.pending.intake.content.plate='TAMPERED';await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(current),f.id).run();assert.equal((await f.request(route,undefined,customer)).status,409);
  await f.action('protocolRequest',{kind:'intake',protocol:{plate:'FRESH'}});const fresh='document/'+(await f.action('documentLink',{kind:'intake'})).pending.intake.token;current=await getOrder(f.env,f.id);current.intake={plate:'UNEXPECTED'};await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(current),f.id).run();assert.equal((await f.request(fresh,undefined,customer)).status,409);
});

test('document photo review checks ownership, method and stored bytes',async t=>{
  const f=await fixture(t),photo=randomUUID();await f.env.BUCKET.put(photo,png,{httpMetadata:{contentType:'image/png'}});await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(photo,f.id,'photo','image/png',digest(png),png.length,new Date().toISOString()).run();
  const route=await f.pending('intake',{photos:[photo]});assert.equal((await f.request(route+'/asset/'+photo,undefined,customer)).status,200);assert.equal((await f.request(route+'/asset/'+photo,{},customer)).status,405);assert.equal((await f.request(route+'/asset/'+photo,undefined,'other@example.invalid')).status,403);assert.equal((await f.request(route+'/asset/'+randomUUID(),undefined,customer)).status,404);f.files.get(photo).body=new Uint8Array([1,2]);assert.equal((await f.request(route+'/asset/'+photo,undefined,customer)).status,404);
});

test('remote signature race stores one personal signature and one audit entry',async t=>{
  const f=await fixture(t),route=await f.pending('intake',{plate:'PARALLEL'}),input=await f.signing(route);const results=await Promise.all([f.request(route,input,customer),f.request(route,input,customer)]);assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.every(r=>[200,409].includes(r.status)));assert.equal(f.env.DB.sql.prepare("SELECT count(*) n FROM assets WHERE kind='signature'").get().n,1);assert.equal(f.files.size,1);assert.equal(f.env.DB.sql.prepare("SELECT count(*) n FROM audit WHERE actor='customer'").get().n,1);
});

test('first protocol PIN email uses the checked request and repeated sends are locked',async t=>{
  const f=await fixture(t);await f.action('protocolRequest',{kind:'intake',protocol:{plate:'REMOTE'}});await setting(f.env,'resendKey',await protect(f.env,'synthetic-key'));for(const [key,value] of Object.entries({emailVerified:true,sendApproved:true,sender:'test@example.invalid'}))await setting(f.env,key,value);
  const messages=[];t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');messages.push(JSON.parse(options.body));return Response.json({id:'synthetic-message'});});const order=await getOrder(f.env,f.id);const saved=await providerOperations.action(f.env,order,'sendDocument',{kind:'intake'});assert.ok(saved.pending.intake.token);assert.equal(messages.length,1);assert.deepEqual(messages[0].to,[customer]);assert.match(messages[0].text,/persönliche einmalige PIN: \d{6}/);assert.match(messages[0].text,/Kundenzugang/);assert.doesNotMatch(messages[0].text,/ersetzt.*unterschriebene/);assert.doesNotMatch(messages[0].subject,/Ersatz/);await assert.rejects(providerOperations.action(f.env,saved,'sendDocument',{kind:'intake'}),/bereits versendet/);assert.equal(messages.length,1);
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
