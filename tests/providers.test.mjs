import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,basename} from 'node:path';
import {PanelDatabase,PrivateBucket} from '../server/storage.mjs';
import {createApplication,maintenance} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {providerOperations,calendarAvailability} from '../server/providers.mjs';
import {calendarAccessToken} from '../server/calendar-oauth.mjs';
import {syncBookingPhotos,bookingPhotos} from '../server/booking-photos.mjs';
import {setting,protect,unprotect,getOrder,settings} from '../src/worker.mjs';
const clientId='11111111-1111-1111-1111-111111111111',invoiceId='22222222-2222-2222-2222-222222222222',iban='DE02120300000000202051';
const input={reviewed:true,vatBasisPoints:1900,iban,dueDate:'2099-10-20',clientId};
function completed(){return {id:'test-order',wg:'WG-000100',version:1,status:'Erledigt',synthetic:false,source:{name:'Test',email:'test@example.invalid',vehicle:'Testauto'},return:{at:'2026-10-03T13:00:00Z'},completedAt:'2026-10-03T13:00:00Z',offer:{totalCents:11900,services:'Test',lines:[{title:'Paket',amountCents:11900}]}};}
async function fixture(t,order=completed()){
  const env={PANEL_ORIGIN:'https://panel.example.invalid',OWNER_EMAIL_SHA256:digest('owner@example.invalid'),CONFIG_KEY:Buffer.alloc(32,3).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('test')}};t.after(()=>env.DB.close());await createApplication(env);
  await env.DB.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?)').bind(order.id,order.wg,order.source.id??null,1,order.status,JSON.stringify(order),new Date().toISOString(),'test','Test fixture',0).run();
  for(const [key,value] of Object.entries({qontoVerified:true,numberAudit:true,qontoLogin:'synthetic-login'}))await setting(env,key,value);await setting(env,'qontoKey',await protect(env,'synthetic-key'));return env;
}
function mockQonto(t,{total=11900,finalizeUnknown=false,existing=[]}={}){
  const writes=[];t.mock.method(globalThis,'fetch',async(url,options={})=>{
    const u=new URL(url);assert.equal(u.origin,'https://thirdparty.qonto.com');assert.equal(options.redirect,'manual');
    if(u.pathname==='/v2/organization')return Response.json({organization:{id:'test-org',bank_accounts:[{iban,name:'Testkonto'}]}});
    if(u.pathname==='/v2/clients')return Response.json({clients:[{id:clientId,email:'test@example.invalid',currency:'EUR'}],meta:{total_pages:1,current_page:1,total_count:1}});
    if(u.pathname==='/v2/client_invoices'&&!options.method)return Response.json({client_invoices:existing,meta:{total_pages:1,current_page:1,total_count:existing.length}});
    writes.push({path:u.pathname,body:JSON.parse(options.body)});
    if(u.pathname.endsWith('/finalize')){if(finalizeUnknown)throw Error('Synthetic lost response');return Response.json({client_invoice:{id:invoiceId,number:'WG-000100',status:'unpaid',currency:'EUR',total_amount_cents:11900}});}
    return Response.json({client_invoice:{id:invoiceId,number:'WG-000100',status:'draft',currency:'EUR',total_amount_cents:total}});
  });return writes;
}
test('Qonto finalization verifies the fixed gross price and preserves unpaid workflow',async t=>{
  const order=completed(),env=await fixture(t),writes=mockQonto(t);const saved=await providerOperations.action(env,order,'invoice',input);
  assert.equal(saved.status,'Erledigt');assert.equal(saved.invoice.status,'unpaid');assert.equal(writes.length,2);assert.equal(writes[0].body.items[0].unit_price.value,'100.000000');assert.equal(writes[0].body.number,order.wg);
  await assert.rejects(providerOperations.action(env,saved,'invoice',input),/bereits/);assert.equal(writes.length,2);
});
test('a gross amount mismatch retains one draft and never finalizes or duplicates it',async t=>{
  const order=completed(),env=await fixture(t),writes=mockQonto(t,{total:11901});await assert.rejects(providerOperations.action(env,order,'invoice',input),/Bruttobetrag/);
  assert.equal(writes.length,1);assert.equal((await env.DB.prepare("SELECT state FROM jobs WHERE kind='invoice'").first()).state,'draft');await assert.rejects(providerOperations.action(env,order,'invoice',input),/Providerabgleich/);assert.equal(writes.length,1);
});
test('unknown finalization stays locked until a matching provider invoice is read',async t=>{
  const order=completed(),env=await fixture(t),writes=mockQonto(t,{finalizeUnknown:true});await assert.rejects(providerOperations.action(env,order,'invoice',input));
  const job=await env.DB.prepare("SELECT * FROM jobs WHERE kind='invoice'").first();assert.equal(job.state,'unknown');assert.equal(job.provider_id,invoiceId);
  await assert.rejects(providerOperations.action(env,order,'invoice',input),/Providerabgleich/);assert.equal(writes.length,2);
  mockQonto(t,{existing:[{id:invoiceId,number:order.wg,status:'unpaid',currency:'EUR',total_amount_cents:11900}]});const saved=await providerOperations.action(env,order,'reconcile',{});assert.equal(saved.invoice.id,invoiceId);assert.equal(saved.status,'Erledigt');assert.equal((await env.DB.prepare('SELECT state FROM jobs WHERE id=?').bind(job.id).first()).state,'sent');
});
test('existing WG number prevents another provider invoice',async t=>{
  const env=await fixture(t),writes=mockQonto(t,{existing:[{id:invoiceId,number:'WG-000100'}]});await assert.rejects(providerOperations.action(env,completed(),'invoice',input),/bereits vorhanden/);assert.equal(writes.length,0);
});
test('synthetic invoices stop before any external read or write',async t=>{
  const env=await fixture(t);let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;throw Error('No external test');});await assert.rejects(providerOperations.action(env,{...completed(),synthetic:true},'invoice',input),/Schlussrechnung/);assert.equal(calls,0);
});
test('provider failure does not prevent expiry checks and is never reported as scheduled success',async t=>{
  const order={...completed(),status:'Angebot offen',offer:{...completed().offer,expiresAt:'2020-01-01T00:00:00Z'}},env=await fixture(t,order);for(const [key,value] of Object.entries({hubVerified:true,autoImportApproved:true}))await setting(env,key,value);await setting(env,'hubKey',await protect(env,'synthetic-hub'));
  t.mock.method(globalThis,'fetch',async()=>new Response('test',{status:503}));const result=await maintenance(env);assert.equal((await getOrder(env,order.id)).status,'Abgelaufen');assert.ok(result.deliveryError);assert.equal((await settings(env)).lastScheduledAt,undefined);
  t.mock.method(providerOperations,'background',async()=>({errors:['Synthetic provider failure']}));const failed=await maintenance(env);assert.equal(failed.ok,false);assert.match((await settings(env)).lastScheduledError,/Synthetic/);
});
test('booked photos are copied once, and saved photos survive a temporary source failure',async t=>{
  const root=await mkdtemp(resolve(tmpdir(),'white-gloss-panel-test-'));t.after(async()=>{assert.equal(dirname(root),resolve(tmpdir()));assert.ok(basename(root).startsWith('white-gloss-panel-test-'));await rm(root,{recursive:true,force:true});});
  const order={...completed(),source:{...completed().source,id:'100'}},env=await fixture(t,order);env.BUCKET=new PrivateBucket(resolve(root,'uploads'));await setting(env,'hubVerified',true);await setting(env,'hubKey',await protect(env,'synthetic-hub'));let downloads=0,fail=false;
  t.mock.method(globalThis,'fetch',async url=>{if(String(url)==='https://white-gloss.de/api/hub'){if(fail)return new Response('',{status:503});return Response.json({photos:[{name:'Testbild',mime:'image/png',url:'https://test.supabase.co/storage/v1/object/sign/bookings/100/test.png?token=synthetic'}]});}downloads++;return new Response(new Uint8Array([137,80,1,2]),{headers:{'content-type':'image/png'}});});
  await syncBookingPhotos(env,order);await syncBookingPhotos(env,order);assert.equal(downloads,1);fail=true;const result=await bookingPhotos(env,order.id,true);assert.equal(result.photos.length,1);assert.match(result.photos[0].url,/^\/api\/asset\//);assert.ok(result.warning);assert.ok(!JSON.stringify(result.photos).includes('token='));
});
async function connectedCalendar(env){for(const [key,value] of Object.entries({calendarOAuth:true,calendarVerified:true,calendarId:'test@example.invalid',calendarExpiresAt:Date.now()+3600000}))await setting(env,key,value);await setting(env,'calendarToken',await protect(env,'synthetic-access'));await setting(env,'calendarRefreshToken',await protect(env,'synthetic-refresh'));}
function appointmentOrder(){return {...completed(),status:'Termin verbindlich',acceptance:{at:'2026-10-03T10:00:00Z'},appointment:{start:'2099-10-03T10:00:00Z',end:'2099-10-03T12:00:00Z',location:'Testort'}};}
test('Google busy times include recurrent and all-day events and reject overlaps before writes',async t=>{
  const order=appointmentOrder(),env=await fixture(t,order);await connectedCalendar(env);let calls=0;t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.ok(!options.method);assert.equal(new URL(url).searchParams.get('singleEvents'),'true');return Response.json({items:[{id:'external',start:{date:'2099-10-03'},end:{date:'2099-10-04'}}]});});
  await assert.rejects(calendarAvailability(env,order),/bereits belegt/);await assert.rejects(providerOperations.action(env,order,'calendarSync',{}),/bereits belegt/);assert.equal(calls,2);assert.equal((await env.DB.prepare('SELECT state FROM jobs').first()).state,'failed');
});
test('a Google insertion uses one stable private event and a second call makes no second event',async t=>{
  const order=appointmentOrder(),env=await fixture(t,order);await connectedCalendar(env);let writes=0;
  t.mock.method(globalThis,'fetch',async(url,options={})=>{if(options.method==='POST'){writes++;assert.equal(new URL(url).searchParams.get('sendUpdates'),'none');return Response.json(JSON.parse(options.body));}return new URL(url).pathname.endsWith('/events')?Response.json({items:[]}):new Response(null,{status:404});});
  const saved=await providerOperations.action(env,order,'calendarSync',{});assert.match(saved.calendar.eventId,/^[a-f0-9]{64}$/);assert.equal(saved.status,'Termin verbindlich');await providerOperations.action(env,saved,'calendarSync',{});assert.equal(writes,1);
});
test('calendar refreshes coalesce and a rotated refresh credential is protected',async t=>{
  const env=await fixture(t);await connectedCalendar(env);await setting(env,'calendarExpiresAt',0);env.GOOGLE_CLIENT_ID='synthetic-client';env.GOOGLE_CLIENT_SECRET='synthetic-secret';let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;assert.equal(String(url),'https://oauth2.googleapis.com/token');assert.equal(options.body.get('grant_type'),'refresh_token');return Response.json({access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:3600});});
  assert.deepEqual(await Promise.all([calendarAccessToken(env),calendarAccessToken(env)]),['synthetic-new-access','synthetic-new-access']);assert.equal(calls,1);assert.equal(await unprotect(env,(await settings(env)).calendarRefreshToken),'synthetic-new-refresh');
});
test('Google cancellation checks ownership before deleting and never deletes an unrelated event',async t=>{
  const order={...appointmentOrder(),status:'Storniert'},env=await fixture(t,order);await connectedCalendar(env);let writes=0;
  t.mock.method(globalThis,'fetch',async(_url,options={})=>{if(options.method){writes++;return new Response(null,{status:204});}return Response.json({id:'unrelated',etag:'test-version',extendedProperties:{private:{whiteGlossOrder:'another-order'}}});});
  await assert.rejects(providerOperations.action(env,order,'calendarSync',{}),/gehört nicht/);assert.equal(writes,0);
});
