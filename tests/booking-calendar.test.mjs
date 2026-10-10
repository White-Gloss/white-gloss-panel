import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {COMPANY} from '../src/company.mjs';
import {transition,normalizeAppointmentOptions,berlinISO} from '../src/domain.mjs';
import {bookingWindowError,bookingFreeRanges} from '../src/booking-calendar.mjs';
import {validateBookingCalendar,changeBookingCalendar,readBookingCalendar} from '../server/booking-calendar.mjs';
import {syntheticSignature} from './fixtures/signature.mjs';

const bookingTestOrigin='https://panel.example.invalid';
const bookingTestCustomer='calendar-customer@example.invalid';
const bookingTestNow='2026-10-01T12:00:00.000Z';
const bookingTestOption=(start='2099-12-01T10:00',duration=120)=>({start,duration,delivery:'Kunde bringt',location:'TEST · Übergabeort'});

async function bookingFixture(t){
  const env={PANEL_ORIGIN:bookingTestOrigin,OWNER_EMAIL_SHA256:digest(COMPANY.email),CONFIG_KEY:Buffer.alloc(32,6).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{},ASSETS:{fetch:async()=>new Response('TEST shell')}};
  t.after(()=>env.DB.close());
  const app=await createApplication(env),cookies={};
  for(const [name,email,char] of [['owner',COMPANY.email,'a'],['customer',bookingTestCustomer,'b'],['foreign','foreign@example.invalid','c']]){const token=char.repeat(64);cookies[name]='__Host-wg-session='+token;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(token),email,Date.now()+600000,Date.now()).run();}
  const request=(route,body,who='owner')=>app.fetch(new Request(bookingTestOrigin+route,{method:body===undefined?'GET':'POST',headers:{...(cookies[who]?{cookie:cookies[who]}:{}),...(body===undefined?{}:{origin:bookingTestOrigin,'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  const calendar=(input)=>request('/api/calendar/action',input);
  async function order({start='2099-12-01T10:00',duration=120,synthetic=false}={}){
    let value={id:randomUUID(),wg:'WG-TEST-'+randomUUID(),version:1,status:'Preise prüfen',source:{name:'TEST private customer',email:bookingTestCustomer,vehicle:'TEST private vehicle'},synthetic};
    value=transition(value,'price',{services:'TEST cleaning',totalCents:11900,pickupCents:0},bookingTestNow);
    value=transition(value,'appointmentOptions',{options:[bookingTestOption(start,duration)]},bookingTestNow);
    value=transition(value,'confirm',{},new Date().toISOString());value.offerToken=digest(randomUUID());
    await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(value.id,value.wg,value.status,JSON.stringify(value),new Date().toISOString(),'test','fixture',Number(synthetic)).run();
    await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(value.offerToken),value.id,value.offer.expiresAt).run();
    return value;
  }
  async function acceptance(value){const route='/api/offer/'+value.offerToken,response=await request(route,undefined,'customer');assert.equal(response.status,200);const visible=await response.json(),id=visible.appointmentOptions[0].id;return {route,input:{signature:syntheticSignature,paymentObligation:true,appointmentOptionId:id,snapshotHash:digest(JSON.stringify({...visible,selectedAppointmentOptionId:id}))}};}
  return {env,app,request,calendar,order,acceptance};
}

test('entire service must fit exactly inside 08:30–18:00 Berlin in summer and winter',()=>{
  for(const start of ['2099-07-01T08:30','2099-12-01T08:30']){const appointment=normalizeAppointmentOptions([bookingTestOption(start,570)],bookingTestNow)[0];assert.equal(bookingWindowError(appointment),'');assert.equal(appointment.calendarStartMinute,510);assert.equal(appointment.calendarEndMinute,1080);}
  assert.equal(berlinISO('2099-07-01T08:30'),'2099-07-01T06:30:00.000Z');assert.equal(berlinISO('2099-12-01T08:30'),'2099-12-01T07:30:00.000Z');
  for(const [start,duration] of [['2099-12-01T08:29',15],['2099-12-01T17:46',15],['2099-12-01T08:30',571],['2099-12-01T23:00',120]])assert.throws(()=>normalizeAppointmentOptions([bookingTestOption(start,duration)],bookingTestNow),/08:30 und 18:00|570 Minuten/);
  for(const start of ['2026-03-29T02:30','2026-10-25T02:30'])assert.throws(()=>berlinISO(start),/Zeitumstellung|Europe\/Berlin/);
});

test('weekends start closed and explicit windows can be released and relocked without changing weekdays',async t=>{
  const f=await bookingFixture(t),appointment=normalizeAppointmentOptions([bookingTestOption('2099-12-05T10:00',120)],bookingTestNow)[0];
  await assert.rejects(validateBookingCalendar(f.env,appointment),/gesperrt/);
  const released=await f.calendar({action:'setDayRule',day:'2099-12-05',version:0,windows:[{start:'09:00',end:'12:00'},{start:'14:00',end:'18:00'}]});assert.equal(released.status,200);
  const rule=(await released.json()).rule;await validateBookingCalendar(f.env,appointment);
  await assert.rejects(validateBookingCalendar(f.env,normalizeAppointmentOptions([bookingTestOption('2099-12-05T11:00',120)],bookingTestNow)[0]),/gesperrt/);
  assert.equal((await f.calendar({action:'setDayRule',day:'2099-12-05',version:rule.version,windows:[]})).status,200);await assert.rejects(validateBookingCalendar(f.env,appointment),/gesperrt/);
  assert.equal((await f.calendar({action:'setDayRule',day:'2099-12-05',version:rule.version,windows:[{start:'08:30',end:'18:00'}]})).status,409);
  await validateBookingCalendar(f.env,normalizeAppointmentOptions([bookingTestOption('2099-12-01T08:30',570)],bookingTestNow)[0]);
});

test('manual entries without a customer block availability and never expose private labels or IDs to customers',async t=>{
  const f=await bookingFixture(t),response=await f.calendar({action:'saveEntry',kind:'block',title:'PRIVATE title',note:'PRIVATE note',start:'2099-12-01T10:00',end:'2099-12-01T12:00'});assert.equal(response.status,200);const entry=(await response.json()).entry;
  const owner=await f.request('/api/calendar/month?from=2099-12-01&to=2099-12-02');assert.equal(owner.status,200);assert.equal((await owner.json()).entries[0].id,entry.id);
  const publicResponse=await f.request('/api/calendar/availability?from=2099-12-01&to=2099-12-02',undefined,'customer');assert.equal(publicResponse.status,200);const visible=await publicResponse.json(),serialized=JSON.stringify(visible);
  assert.ok(!serialized.includes('PRIVATE'));assert.ok(!serialized.includes(entry.id));assert.equal(visible.entries,undefined);assert.equal(visible.appointments,undefined);assert.equal(visible.days[0].free.length,2);
  const anonymous=await f.request('/api/calendar/availability?from=2099-12-01&to=2099-12-02',undefined,'anonymous');assert.equal(anonymous.status,200);assert.ok(!JSON.stringify(await anonymous.json()).includes('PRIVATE'));
  assert.equal((await f.request('/api/calendar/month?from=2099-12-01&to=2099-12-02',undefined,'anonymous')).status,401);
  await assert.rejects(validateBookingCalendar(f.env,normalizeAppointmentOptions([bookingTestOption()],bookingTestNow)[0]),/belegt/);
  assert.equal((await f.request('/api/calendar/month?from=2099-12-01&to=2099-12-02',undefined,'customer')).status,403);
  assert.equal((await f.request('/api/calendar/action',{action:'deleteEntry',id:entry.id,version:entry.version},'customer')).status,403);
});

test('manual edits and deletion use versions, preserve audit and release capacity only after successful deletion',async t=>{
  const f=await bookingFixture(t),created=await changeBookingCalendar(f.env,{action:'saveEntry',kind:'appointment',title:'TEST',start:'2099-12-01T10:00',end:'2099-12-01T11:00'}),entry=created.entry;
  const updated=await f.calendar({action:'saveEntry',id:entry.id,version:entry.version,kind:'block',title:'TEST changed',start:'2099-12-01T11:00',end:'2099-12-01T12:00'});assert.equal(updated.status,200);const current=(await updated.json()).entry;
  assert.equal((await f.calendar({action:'deleteEntry',id:entry.id,version:entry.version})).status,409);
  assert.equal((await f.calendar({action:'deleteEntry',id:entry.id,version:current.version})).status,200);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM calendar_audit WHERE entry_id=?').bind(entry.id).first()).n,3);
  await validateBookingCalendar(f.env,normalizeAppointmentOptions([bookingTestOption()],bookingTestNow)[0]);
});

test('parallel manual entries reserve capacity once and failed insertion does not leave audit behind',async t=>{
  const f=await bookingFixture(t),input={action:'saveEntry',kind:'block',title:'TEST concurrent',start:'2099-12-01T10:00',end:'2099-12-01T12:00'};
  const responses=await Promise.all([f.calendar(input),f.calendar({...input,kind:'appointment'})]);assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM calendar_entries').first()).n,1);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM calendar_audit').first()).n,1);
});

test('manual block racing customer acceptance produces one reservation and rolls back the losing signature',async t=>{
  const f=await bookingFixture(t),order=await f.order(),acceptance=await f.acceptance(order);
  const responses=await Promise.all([f.request(acceptance.route,acceptance.input,'customer'),f.calendar({action:'saveEntry',kind:'block',title:'TEST race',start:'2099-12-01T10:00',end:'2099-12-01T12:00'})]);
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,409]);
  const appointments=(await f.env.DB.prepare('SELECT COUNT(*) n FROM appointments').first()).n,entries=(await f.env.DB.prepare('SELECT COUNT(*) n FROM calendar_entries').first()).n;assert.equal(appointments+entries,1);
  const saved=JSON.parse((await f.env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(order.id).first()).data);assert.equal(Boolean(saved.acceptance),appointments===1);
});

test('accepted appointment blocks later manual writes and adjacent timestamps allow exact boundaries',async t=>{
  const f=await bookingFixture(t),order=await f.order(),acceptance=await f.acceptance(order);assert.equal((await f.request(acceptance.route,acceptance.input,'customer')).status,200);
  assert.equal((await f.calendar({action:'saveEntry',kind:'appointment',title:'TEST overlap',start:'2099-12-01T11:59',end:'2099-12-01T13:00'})).status,409);
  assert.equal((await f.calendar({action:'saveEntry',kind:'block',title:'TEST adjacent',start:'2099-12-01T12:00',end:'2099-12-01T13:00'})).status,200);
});

test('weekend closure between validation and transaction cannot commit a stale release',async t=>{
  const f=await bookingFixture(t),day='2099-12-05';await f.calendar({action:'setDayRule',day,version:0,windows:[{start:'08:30',end:'18:00'}]});
  const order=await f.order({start:day+'T10:00'}),option=order.appointmentOptions[0],updated=transition(order,'accept',{signature:'TEST direct transactional fixture',snapshotHash:'TEST',appointmentOptionId:option.id,paymentObligation:true},new Date().toISOString(),'customer');
  await validateBookingCalendar(f.env,updated.appointment,{excludeOrderId:order.id});await f.calendar({action:'setDayRule',day,version:1,windows:[]});
  await assert.rejects(f.env.DB.batch([f.env.DB.prepare('UPDATE orders SET data=?,status=?,version=version+1 WHERE id=?').bind(JSON.stringify(updated),updated.status,order.id),f.env.DB.prepare('INSERT INTO appointments VALUES(?,?,?)').bind(order.id,option.start,option.end)]),/Wochenendtag gesperrt/);
  assert.equal((await f.env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(order.id).first()).status,'Angebot offen');assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM appointments').first()).n,0);
});

test('test reservations and weekend releases are isolated from the real calendar in both directions',async t=>{
  const f=await bookingFixture(t);await f.calendar({action:'saveEntry',synthetic:true,kind:'block',title:'TEST only',start:'2099-12-01T10:00',end:'2099-12-01T12:00'});
  const order=await f.order(),acceptance=await f.acceptance(order);assert.equal((await f.request(acceptance.route,acceptance.input,'customer')).status,200);
  assert.equal((await f.calendar({action:'saveEntry',synthetic:true,kind:'appointment',title:'TEST adjacent synthetic',start:'2099-12-01T12:00',end:'2099-12-01T13:00'})).status,200);
  assert.equal((await f.calendar({action:'setDayRule',synthetic:true,day:'2099-12-05',version:0,windows:[{start:'08:30',end:'18:00'}]})).status,200);
  await assert.rejects(validateBookingCalendar(f.env,normalizeAppointmentOptions([bookingTestOption('2099-12-05T10:00')],bookingTestNow)[0]),/gesperrt/);
  const publicResult=await(await f.request('/api/calendar/availability?from=2099-12-05&to=2099-12-06&test=true',undefined,'customer')).json();assert.equal(publicResult.days[0].closed,true);
});

test('monthly query finds older accepted appointments beyond the 300-order overview cap',async t=>{
  const f=await bookingFixture(t),order=await f.order(),acceptance=await f.acceptance(order);assert.equal((await f.request(acceptance.route,acceptance.input,'customer')).status,200);
  const statements=Array.from({length:301},(_,index)=>f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(randomUUID(),'TEST filler '+index,'Preise prüfen',JSON.stringify({source:{name:'TEST filler'}}),'9999-01-01T00:00:00Z','test','fixture'));await f.env.DB.batch(statements);
  const overview=await(await f.request('/api/state')).json();assert.equal(overview.orders.length,300);assert.ok(!overview.orders.some(value=>value.id===order.id));
  const calendar=await(await f.request('/api/calendar/month?from=2099-12-01&to=2100-01-01')).json();assert.equal(calendar.appointments[0].id,order.id);
});

test('range validation, duration-aware availability and DST day boundaries stay consistent',async t=>{
  const f=await bookingFixture(t);
  assert.equal((await f.request('/api/calendar/month?from=2026-02-30&to=2026-03-01')).status,400);assert.equal((await f.request('/api/calendar/month?from=2099-01-01&to=2100-01-01')).status,400);
  await f.calendar({action:'setDayRule',day:'2026-10-25',version:0,windows:[{start:'08:30',end:'18:00'}]});
  const data=await readBookingCalendar(f.env,{from:'2026-10-24',to:'2026-10-27',owner:false,duration:570,now:'2026-10-23T00:00:00Z'});assert.equal(data.days[0].closed,true);assert.equal(data.days[1].windows[0].start,'2026-10-25T07:30:00.000Z');assert.equal(data.days[1].available,true);
  assert.deepEqual(bookingFreeRanges([{start:'2099-12-01T07:30:00.000Z',end:'2099-12-01T17:00:00.000Z'}],[{start:'2099-12-01T10:00:00Z',end:'2099-12-01T11:00:00Z'}]).map(value=>[value.start,value.end]),[['2099-12-01T07:30:00.000Z','2099-12-01T10:00:00Z'],['2099-12-01T11:00:00Z','2099-12-01T17:00:00.000Z']]);
});
