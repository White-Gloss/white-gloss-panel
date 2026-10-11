import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker,{getOrder} from '../src/worker.mjs';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {protocolDocument} from '../server/protocol-document.mjs';
import {COMPANY} from '../src/company.mjs';
import {priceNote} from '../src/catalog.mjs';

const origin='https://panel.example.invalid',ownerEmail='test-owner@example.invalid';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const signature='data:image/png;base64,'+Buffer.concat([png,Buffer.alloc(300)]).toString('base64');
function env(t){const files=new Map(),e={DB:new PanelDatabase(':memory:'),BUCKET:{async put(id,bytes,options){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options?.httpMetadata??{}});},async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}},ASSETS:{fetch:async()=>new Response('shell')},OWNER_EMAIL_SHA256:createHash('sha256').update(ownerEmail).digest('hex'),CONFIG_KEY:Buffer.alloc(32,7).toString('base64'),files};t.after(()=>e.DB.close());return e;}
async function req(e,path,b,identity=ownerEmail,headers={}){const r=await worker.fetch(new Request(origin+'/api/'+path,{method:b===undefined?'GET':'POST',headers:{'oai-authenticated-user-email':identity,Origin:origin,'Content-Type':'application/json',...headers},body:b===undefined?undefined:JSON.stringify(b)}),e);return r;}
async function ok(e,path,b,identity){const r=await req(e,path,b,identity);const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;}
const lines=[{id:'package',kind:'package',catalogId:'premium',title:'Reinigung & Politur',amountCents:43625},{id:'custom-dirt',kind:'custom',title:'Zuschlag Verschmutzung',amountCents:5000}];

test('customers and vehicles are created, found by name, phone or plate and never deleted',async t=>{
  const e=env(t);const c=await ok(e,'customer',{customer:{name:'Erika Muster',phone:'+49 152 1234567',email:'Erika@Example.invalid'}});
  assert.equal(c.emailKey,'erika@example.invalid');assert.equal(c.phoneKey,'01521234567');
  const v=await ok(e,'vehicle',{customerId:c.id,vehicle:{plate:'fds-wg 77',make:'VW',model:'Golf',classId:'kompakt'}});assert.equal(v.plate,'FDS-WG 77');assert.equal(v.label,'VW Golf');
  for(const q of ['erika','1234567','FDSWG77','golf'])assert.equal((await ok(e,'customers?q='+encodeURIComponent(q))).customers[0]?.id,c.id,q);
  assert.equal((await ok(e,'customers?q=niemand')).customers.length,0);
  const updated=await ok(e,'customer',{id:c.id,version:c.version,customer:{phone:'0170 999999'}});assert.equal(updated.version,2);assert.equal(updated.history[0].before.phone,'+49 152 1234567');
  assert.equal((await req(e,'customer',{id:c.id,version:1,customer:{name:'Stale'}})).status,409);
  await ok(e,'create',{synthetic:true,source:{name:'Auftrag'}});assert.throws(()=>e.DB.sql.exec('DELETE FROM customers'),/nicht gelöscht/);assert.throws(()=>e.DB.sql.exec('DELETE FROM vehicles'),/nicht gelöscht/);assert.throws(()=>e.DB.sql.exec('DELETE FROM orders'),/nicht gelöscht/);
});

test('on-site booking stores customer, price, personal signature and immediate start in one step',async t=>{
  const e=env(t);const c=await ok(e,'customer',{synthetic:true,customer:{name:'Vor Ort',phone:'0152 7654321'}});
  const before=Date.now();const o=await ok(e,'onsite',{synthetic:true,customerId:c.id,source:{vehicle:'BMW 320d',plate:'TÜ-AB 1'},selection:{packageId:'premium',classId:'suv',extraIds:[],delivery:'Kunde bringt'},assessment:{lines,condition:'Starke Verschmutzung',pricesReviewed:true},acceptance:{signature,customerName:'Vor Ort',paymentObligation:true,immediateStart:true}});
  assert.equal(o.status,'Termin verbindlich');assert.equal(o.offer.totalCents,48625);assert.equal(o.acceptance.mode,'vor Ort');assert.equal(o.acceptance.immediateStart,true);
  assert.ok(Date.parse(o.appointment.start)>=before-1000);assert.equal(o.appointment.duration,360);assert.match(o.source.name,/^TEST · Vor Ort/);assert.equal(o.customerId,c.id);
  const asset=e.DB.sql.prepare("SELECT kind FROM assets WHERE id=?").get(o.acceptance.signature);assert.equal(asset.kind,'acceptance');
  assert.equal(o.acceptance.snapshotHash,createHash('sha256').update(JSON.stringify({offer:o.offer.lines?{condition:'Starke Verschmutzung',lines:o.offer.lines,totalCents:48625,pickupCents:0,pricesReviewed:true,services:o.offer.services}:null,hints:{price:priceNote,withdrawal:''}})).digest('hex'));
  assert.equal(e.DB.sql.prepare('SELECT COUNT(*) n FROM appointments').get().n,1);
  const vehicles=(await ok(e,'customer/'+c.id)).vehicles;assert.equal(vehicles.length,1);assert.equal(vehicles[0].plate,'TÜ-AB 1');
  // A second immediate start at the same time is rejected as overlap and leaves nothing behind.
  const r=await req(e,'onsite',{synthetic:true,customerId:c.id,source:{vehicle:'Zweitwagen'},assessment:{lines},acceptance:{signature},appointment:{start:o.appointment.start}});assert.equal(r.status,409);
  assert.equal(e.DB.sql.prepare('SELECT COUNT(*) n FROM orders').get().n,1);assert.equal(e.files.size,1);
  // Without signature or price the booking is still possible (no required fields).
  const bare=await ok(e,'onsite',{synthetic:true,source:{name:'Ohne Angaben'},appointment:{skip:true}});assert.equal(bare.status,'Angenommen');assert.equal(bare.offer.totalCents,0);
});

test('real on-site orders still respect the WG number audit',async t=>{const e=env(t);assert.equal((await req(e,'onsite',{source:{name:'Echt'}})).status,409);});

test('state lists compact orders and the detail view loads the complete order',async t=>{
  const e=env(t);const o=await ok(e,'onsite',{synthetic:true,source:{name:'Kompakt',email:'k@example.invalid'},assessment:{lines},acceptance:{signature}});
  const s=await ok(e,'state');const listed=s.orders[0];assert.equal(listed.slim,true);assert.equal(listed.offerToken,undefined);assert.equal(listed.source.raw,undefined);assert.deepEqual(Object.keys(listed.acceptance),['at','mode']);assert.equal(typeof s.settings.withdrawalText,'string');
  const full=await ok(e,'order/'+o.id);assert.equal(full.acceptance.signature,o.acceptance.signature);assert.ok(full.customer);
});

test('every step is editable: source, status, appointment removal and payments in any state',async t=>{
  const e=env(t);let o=await ok(e,'create',{synthetic:true,source:{}});assert.equal(o.status,'Preise prüfen');
  o=await ok(e,'action',{id:o.id,version:o.version,action:'editSource',input:{source:{name:'Neu',phone:'0151 1111111',plate:'AB-C 1'}}});assert.equal(o.source.name,'Neu');assert.equal(o.sourceHistory.length,1);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'appointment',input:{start:'2030-01-02T10:00',duration:60}});assert.equal(o.status,'Preise prüfen');assert.equal(e.DB.sql.prepare('SELECT COUNT(*) n FROM appointments').get().n,1);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'setStatus',input:{status:'In Arbeit',reason:'Direkt begonnen'}});assert.equal(o.status,'In Arbeit');
  o=await ok(e,'action',{id:o.id,version:o.version,action:'appointment',input:{start:''}});assert.equal(o.appointment,null);assert.equal(e.DB.sql.prepare('SELECT COUNT(*) n FROM appointments').get().n,0);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'payment',input:{amountCents:5000,method:'Bar'}});assert.equal(o.payments.length,1);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'paymentEdit',input:{id:o.payments[0].id,amountCents:4500}});assert.equal(o.payments[0].amountCents,4500);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'cancel',input:{}});assert.equal(o.status,'Storniert');
  o=await ok(e,'action',{id:o.id,version:o.version,action:'setStatus',input:{status:'Preise prüfen'}});assert.equal(o.statusHistory.length,3);
});

test('signed protocols are replaced only by a document the customer signs, in person or through the link',async t=>{
  const e=env(t);e.CUSTOMER_ACCESS_APPROVED='true';let o=await ok(e,'onsite',{synthetic:true,source:{name:'Protokoll'},assessment:{lines},acceptance:{signature}});
  // Unsigned protocol: saved and edited directly.
  o=await ok(e,'action',{id:o.id,version:o.version,action:'intake',input:{protocol:{plate:'X-1',paint:{readings:[{panel:'Dach',values:[110,115]}]}}}});assert.equal(o.status,'In Arbeit');assert.equal(o.intake.plate,'X-1');assert.equal(o.intake.business.name,COMPANY.name);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'intake',input:{protocol:{plate:'X-2'}}});assert.equal(o.intakeHistory.length,1);
  // Signing through the displayed draft.
  const draft=await ok(e,'protocol/prepare',{id:o.id,version:o.version,kind:'intake',protocol:{plate:'X-2',condition:'Kratzer'}});
  const upload=async()=>{const r=await worker.fetch(new Request(origin+'/api/upload/'+o.id+'?kind=signature&draft='+draft.id+'&hash='+draft.hash,{method:'POST',headers:{'oai-authenticated-user-email':ownerEmail,Origin:origin,'Content-Type':'image/png'},body:png}),e);return (await r.json()).id;};
  const customer=await upload(),operator=await upload();
  o=await ok(e,'action',{id:o.id,version:o.version,action:'intake',input:{draftId:draft.id,snapshotHash:draft.hash,customerSignature:customer,operatorSignature:operator,signaturesConfirmed:true}});assert.equal(o.intake.customerSignature,customer);
  assert.equal((await req(e,'action',{id:o.id,version:o.version,action:'intake',input:{protocol:{plate:'X-3'}}})).status,409);
  // Replacement in person on the operator's device.
  o=await ok(e,'action',{id:o.id,version:o.version,action:'replacement',input:{kind:'intake',protocol:{plate:'X-3'}}});assert.equal(o.intake.plate,'X-2');assert.equal(o.pending.intake.content.plate,'X-3');
  assert.equal((await req(e,'action',{id:o.id,version:o.version,action:'signReplacement',input:{kind:'intake',signature}})).status,403);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'signReplacement',input:{kind:'intake',signature,inPerson:true}});assert.equal(o.intake.plate,'X-3');assert.ok(o.intake.replaces.signedAt);assert.equal(o.pending.intake,undefined);
  // Replacement through the customer's personal link.
  o=await ok(e,'action',{id:o.id,version:o.version,action:'replacement',input:{kind:'intake',protocol:{plate:'X-4'}}});
  o=await ok(e,'action',{id:o.id,version:o.version,action:'documentLink',input:{kind:'intake'}});const token=o.pending.intake.token;assert.match(token,/^[a-f0-9]{64}$/);
  const route='document/'+token,customerEmail='synthetisch@example.invalid';
  assert.equal((await req(e,route,undefined,'fremd@example.invalid')).status,403);
  const preview=await ok(e,route);assert.equal(preview.ownerPreview,true);assert.equal((await req(e,route,{signature,confirmed:true,snapshotHash:'x'})).status,403);
  const shown=await ok(e,route,undefined,customerEmail);assert.equal(shown.document.plate,'X-4');assert.ok(shown.replaces.signedAt);
  const snapshotHash=createHash('sha256').update(JSON.stringify(shown)).digest('hex');
  assert.equal((await req(e,route,{signature,confirmed:true,snapshotHash:'falsch'},customerEmail)).status,409);
  await ok(e,route,{signature,confirmed:true,snapshotHash},customerEmail);
  const final=await getOrder(e,o.id);assert.equal(final.intake.plate,'X-4');assert.equal(final.intake.signedRemotely,true);assert.equal(final.intakeHistory.filter(p=>p.customerSignature).length,2);
  assert.equal((await req(e,route,undefined,customerEmail)).status,404);
});

test('signed offers are replaced by a signed replacement offer that states the price note',async t=>{
  const e=env(t);e.CUSTOMER_ACCESS_APPROVED='true';let o=await ok(e,'onsite',{synthetic:true,source:{name:'Angebot'},assessment:{lines},acceptance:{signature},appointment:{skip:true}});
  o=await ok(e,'action',{id:o.id,version:o.version,action:'price',input:{lines:[...lines,{id:'custom-extra',kind:'custom',title:'Mehraufwand',amountCents:2000}]}});assert.equal(o.offer.totalCents,48625);assert.equal(o.assessment.totalCents,50625);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'replacement',input:{kind:'offer'}});o=await ok(e,'action',{id:o.id,version:o.version,action:'documentLink',input:{kind:'offer'}});
  const route='document/'+o.pending.offer.token,shown=await ok(e,route,undefined,'synthetisch@example.invalid');assert.equal(shown.document.totalCents,50625);assert.equal(shown.hints.price,priceNote);
  const snapshotHash=createHash('sha256').update(JSON.stringify(shown)).digest('hex');
  assert.equal((await req(e,route,{signature,confirmed:true,snapshotHash},'synthetisch@example.invalid')).status,400);
  await ok(e,route,{signature,confirmed:true,paymentObligation:true,snapshotHash},'synthetisch@example.invalid');
  const final=await getOrder(e,o.id);assert.equal(final.offer.totalCents,50625);assert.equal(final.acceptance.mode,'online');assert.ok(final.offer.replaces);assert.equal(final.offerHistory.at(-1).offer.totalCents,48625);
});

test('uploads accept large phone photos up to 15 MB and check WebP content',async t=>{
  const e=env(t);const o=await ok(e,'create',{synthetic:true,source:{}});const send=(bytes,type,size=bytes.length)=>worker.fetch(new Request(origin+'/api/upload/'+o.id+'?kind=receipt',{method:'POST',headers:{'oai-authenticated-user-email':ownerEmail,Origin:origin,'Content-Type':type,'Content-Length':String(size)},body:bytes}),e);
  const jpeg=Buffer.alloc(12*1024*1024);jpeg[0]=255;jpeg[1]=216;assert.equal((await send(jpeg,'image/jpeg')).status,200);
  const wav=Buffer.alloc(100);wav.write('RIFF',0);wav.write('WAVE',8);assert.equal((await send(wav,'image/webp')).status,400);
  const webp=Buffer.alloc(100);webp.write('RIFF',0);webp.write('WEBP',8);assert.equal((await send(webp,'image/webp')).status,200);
  assert.equal((await send(Buffer.alloc(100),'image/jpeg',16*1024*1024)).status,413);
  assert.equal(e.DB.sql.prepare("SELECT COUNT(*) n FROM assets WHERE kind='receipt'").get().n,2);
});

test('protocol PDF renders paint thickness, damages, checklist and unsigned state without required fields',async t=>{
  const e=env(t);const o={id:'pdf-order',wg:'TEST-PDF',synthetic:true,source:{name:'PDF'},intake:{business:{...COMPANY},plate:'',at:null,mileage:null,keys:null,fuel:40,soilingInside:3,checklist:{valuablesRemoved:true},damages:[{area:'Tür vorne links',kind:'Kratzer',size:'5 cm',note:'Längs'}],paint:{device:'Messgerät',readings:[{panel:'Motorhaube',values:[95,102,250]}],notes:'Motorhaube vermutlich nachlackiert'},photos:[],customerSignature:null,operatorSignature:null,replaces:{signedAt:'2026-10-01T10:00:00Z'},savedAt:'2026-10-02T10:00:00Z'}};
  const pdf=await protocolDocument(e,o,'intake');assert.ok(pdf.bytes.byteLength>1000);assert.equal(Buffer.from(pdf.bytes.subarray(0,5)).toString(),'%PDF-');
});

test('IONOS runtime serves the Vor-Ort app, its manifest and customer document links',async t=>{
  const e=env(t);e.PANEL_ORIGIN=origin;e.OWNER_EMAIL_SHA256=digest(ownerEmail);const app=await createApplication(e);
  const manifest=await app.fetch(new Request(origin+'/manifest.webmanifest'));assert.equal(manifest.status,200);
  const page=await app.fetch(new Request(origin+'/vor-ort'));assert.equal(page.status,303);assert.match(page.headers.get('location'),/returnTo=%2Fvor-ort/);
  const doc=await app.fetch(new Request(origin+'/dokument/'+'a'.repeat(64)));assert.equal(doc.status,303);assert.match(doc.headers.get('location'),/returnTo=%2Fdokument%2F/);
});

test('review fixes: signatureless acceptance stays editable, corrections respect overpayment, receipts and vehicle versions are checked',async t=>{
  const e=env(t);let o=await ok(e,'onsite',{synthetic:true,source:{name:'Ohne Unterschrift'},assessment:{lines},appointment:{skip:true}});assert.equal(o.acceptance.signature,null);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'price',input:{lines:[lines[0]]}});assert.equal(o.offer.totalCents,43625);
  assert.equal((await req(e,'action',{id:o.id,version:o.version,action:'replacement',input:{kind:'offer'}})).status,409);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'onsiteAccept',input:{signature}});assert.ok(o.acceptance.signature);assert.equal(o.offer.replaces,undefined);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'payment',input:{amountCents:40000,method:'Bar'}});
  assert.equal((await req(e,'action',{id:o.id,version:o.version,action:'paymentEdit',input:{id:o.payments[0].id,amountCents:50000}})).status,409);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'paymentEdit',input:{id:o.payments[0].id,amountCents:50000,allowOverpayment:true}});assert.equal(o.payments[0].amountCents,50000);
  o=await ok(e,'action',{id:o.id,version:o.version,action:'paymentEdit',input:{id:o.payments[0].id,note:'Trinkgeld enthalten'}});assert.equal(o.payments[0].note,'Trinkgeld enthalten');
  const photo=await worker.fetch(new Request(origin+'/api/upload/'+o.id+'?kind=photo',{method:'POST',headers:{'oai-authenticated-user-email':ownerEmail,Origin:origin,'Content-Type':'image/png'},body:png}),e);const photoId=(await photo.json()).id;
  assert.equal((await req(e,'action',{id:o.id,version:o.version,action:'payment',input:{amountCents:100,method:'Karte',receipt:photoId,allowOverpayment:true}})).status,400);
  assert.equal((await req(e,'action',{id:o.id,version:o.version,action:'intake',input:{protocol:{paint:{readings:[{panel:'Dach',values:[1,2,3,4,5,6]}]}}}})).status,400);
  const c=await ok(e,'customer',{synthetic:true,customer:{name:'Fahrzeug'}});const v=await ok(e,'vehicle',{customerId:c.id,vehicle:{plate:'A-1'}});assert.equal(v.version,1);
  const v2=await ok(e,'vehicle',{id:v.id,version:1,vehicle:{color:'Blau'}});assert.equal(v2.version,2);assert.equal((await req(e,'vehicle',{id:v.id,version:1,vehicle:{color:'Rot'}})).status,409);
});

test('German phone numbers match in national and international form',async()=>{
  const {phoneKey}=await import('../src/customers.mjs');
  for(const value of ['+49 7451 12345','0049 7451 12345','07451 12345','+49 (0)7451-12345'.replace('(0)','')])assert.equal(phoneKey(value),'0745112345',value);
  assert.equal(phoneKey('+49 152 1234567'),'01521234567');assert.equal(phoneKey('4915212345678'),'015212345678');assert.equal(phoneKey('+43 1 234567'),'431234567');
});

test('on-site bookings are checked against the business calendar before they are stored',async t=>{
  const e=env(t);const calls=[];e.operations={validateAppointment:async(_env,order)=>{calls.push(order.appointment.start);throw Object.assign(new (await import('../src/domain.mjs')).AppError('Dieser Zeitraum ist im geschäftlichen Google-Kalender bereits belegt.',409));}};
  const r=await req(e,'onsite',{synthetic:true,source:{name:'Kalender'},assessment:{lines},acceptance:{signature}});assert.equal(r.status,409);assert.equal(calls.length,1);
  assert.equal(e.DB.sql.prepare('SELECT COUNT(*) n FROM orders').get().n,0);assert.equal(e.files.size,0);
  assert.equal((await req(e,'onsite',{synthetic:true,source:{name:'Ohne Termin'},appointment:{skip:true}})).status,200);assert.equal(calls.length,1);
});
