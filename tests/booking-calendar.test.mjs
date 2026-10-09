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
import {calendarRange,calendarDayAfter,bookingCalendarHTML} from '../public/booking-calendar.js';
import {handoverFixture as remoteHandoverFixture,ok as remoteOk,foreign as remoteForeign} from './fixtures/handover.mjs';

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

test('day week and month navigation use calendar dates across year and daylight-saving boundaries',()=>{
  assert.deepEqual([calendarRange('2026-03-29','week').from,calendarRange('2026-03-29','week').to],['2026-03-23','2026-03-30']);
  assert.deepEqual([calendarRange('2026-12-31','week').from,calendarRange('2026-12-31','week').to],['2026-12-28','2027-01-04']);
  assert.equal(calendarDayAfter('2026-10-25',1),'2026-10-26');assert.equal(calendarRange('2028-02-29','month').to,'2028-03-01');
  const html=bookingCalendarHTML();for(const view of ['day','week','month'])assert.ok(html.includes('data-booking-view="'+view+'"'));assert.ok(html.includes('Europe/Berlin'));
});

test('private calendar links validate customer vehicle project and scope, preserve audit snapshots and protect blocked records',async t=>{
  const f=await bookingFixture(t),order=await f.order();
  const files=await(await f.request('/api/customer-files')).json(),linked=files.orders.find(o=>o.id===order.id);
  const body={action:'saveEntry',kind:'appointment',title:'TEST linked',start:'2099-12-02T09:00',end:'2099-12-02T10:00',orderId:order.id};
  const response=await f.calendar(body);assert.equal(response.status,200);const entry=(await response.json()).entry;
  assert.equal(entry.customer_id,linked.customerId);assert.equal(entry.vehicle_id,linked.vehicleId);assert.equal(entry.order_id,order.id);
  assert.equal((await f.calendar({...body,synthetic:true,start:'2099-12-03T10:00',end:'2099-12-03T11:00'})).status,404);
  assert.equal((await f.calendar({...body,customerId:'unknown',start:'2099-12-03T10:00',end:'2099-12-03T11:00'})).status,409);
  const row=await f.env.DB.prepare('SELECT data FROM customer_files WHERE id=?').bind(linked.customerId).first();
  await f.env.DB.prepare('UPDATE customer_files SET data=? WHERE id=?').bind(JSON.stringify({...JSON.parse(row.data),lifecycle:{status:'blocked'}}),linked.customerId).run();
  assert.equal((await f.calendar({...body,start:'2099-12-03T10:00',end:'2099-12-03T11:00'})).status,409);
  const moved=await f.calendar({...body,id:entry.id,version:1,start:'2099-12-02T10:00',end:'2099-12-02T11:00'});assert.equal(moved.status,200);
  assert.equal((await f.calendar({...body,id:entry.id,version:1,start:'2099-12-02T11:00',end:'2099-12-02T12:00'})).status,409);
  const history=await(await f.request('/api/calendar/history?id='+entry.id)).json();assert.equal(history.history.length,2);assert.equal(history.history[0].before.start,entry.start);assert.equal(history.history[0].after.start,berlinISO('2099-12-02T10:00'));
  assert.equal((await f.request('/api/calendar/history?id='+entry.id,undefined,'customer')).status,403);
  assert.equal((await f.calendar({action:'deleteEntry',id:entry.id,version:2})).status,200);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM calendar_entry_links WHERE entry_id=?').bind(entry.id).first()).n,0);
  const deleted=await(await f.request('/api/calendar/history?id='+entry.id)).json();assert.equal(deleted.history.length,3);assert.equal(deleted.history[0].action,'Eintrag gelöscht');
});

async function changeFixture(f){
  const order=await f.order(),acceptance=await f.acceptance(order);assert.equal((await f.request(acceptance.route,acceptance.input,'customer')).status,200);
  const current=await(await f.request('/api/order?id='+order.id)).json();
  const input={action:'propose',orderId:order.id,orderVersion:current.version,requestId:randomUUID(),start:'2099-12-02T10:00',end:'2099-12-02T12:00',reason:'TEST persönlicher Änderungswunsch'};
  return {current,input};
}

test('appointment changes require personal customer consent and preserve original signed agreement and all revisions',async t=>{
  const f=await bookingFixture(t),{current,input}=await changeFixture(f),route='/api/calendar/adjustments';
  assert.equal((await f.request(route,input,'customer')).status,403);
  const response=await f.request(route,input);assert.equal(response.status,200);const proposed=(await response.json()).adjustment;
  assert.equal((await f.request(route,input)).status,200);
  assert.deepEqual((await(await f.request('/api/order?id='+current.id)).json()).appointment,current.appointment);
  assert.equal((await f.request(route+'?orderId='+current.id,undefined,'foreign')).status,404);
  const approval={action:'accept',orderId:current.id,id:proposed.id,version:proposed.version,orderVersion:proposed.orderVersion,snapshotHash:proposed.snapshotHash,confirmed:true};
  assert.equal((await f.request(route,approval)).status,403);assert.equal((await f.request(route,{...approval,confirmed:false},'customer')).status,400);assert.equal((await f.request(route,{...approval,snapshotHash:'changed'},'customer')).status,409);
  assert.equal((await f.request(route,approval,'customer')).status,200);assert.equal((await f.request(route,approval,'customer')).status,200);
  const updated=await(await f.request('/api/order?id='+current.id)).json();assert.deepEqual(updated.acceptance,current.acceptance);assert.deepEqual(updated.offer,current.offer);assert.equal(updated.appointment.start,berlinISO(input.start));assert.equal(updated.appointmentRevisions.length,1);assert.equal(updated.appointmentRevisions[0].acceptance.identity,bookingTestCustomer);assert.deepEqual(updated.appointmentRevisions[0].before,current.appointment);
  const reservation=await f.env.DB.prepare('SELECT * FROM appointments WHERE order_id=?').bind(current.id).first();assert.equal(reservation.start,updated.appointment.start);
  const portal=await(await f.request('/api/customer-portal',undefined,'customer')).json();assert.equal(portal.orders.find(o=>o.id===current.id).appointmentChanges[0].state,'accepted');assert.equal(portal.orders.find(o=>o.id===current.id).appointment.start,updated.appointment.start);
  assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM jobs WHERE order_id=? AND kind='appointment-confirmation' AND state IN ('queued','failed')").bind(current.id).first()).n,0);
});

test('new appointment capacity is checked again on customer consent without moving the old reservation on failure',async t=>{
  const f=await bookingFixture(t),{current,input}=await changeFixture(f),route='/api/calendar/adjustments',item=(await(await f.request(route,input)).json()).adjustment;
  await f.calendar({action:'saveEntry',kind:'block',title:'TEST later occupancy',start:input.start,end:input.end});
  const accepted=await f.request(route,{action:'accept',orderId:current.id,id:item.id,version:item.version,orderVersion:item.orderVersion,snapshotHash:item.snapshotHash,confirmed:true},'customer');assert.equal(accepted.status,409);
  const updated=await(await f.request('/api/order?id='+current.id)).json();assert.deepEqual(updated.appointment,current.appointment);assert.equal(updated.appointmentRevisions,undefined);
  const persisted=await f.env.DB.prepare('SELECT state FROM calendar_adjustments WHERE id=?').bind(item.id).first();assert.equal(persisted.state,'pending');
});

test('withdrawal racing customer consent commits one terminal decision and leaves no silent replacement',async t=>{
  const f=await bookingFixture(t),{current,input}=await changeFixture(f),route='/api/calendar/adjustments',item=(await(await f.request(route,input)).json()).adjustment;
  const results=await Promise.all([f.request(route,{action:'accept',orderId:current.id,id:item.id,version:item.version,orderVersion:item.orderVersion,snapshotHash:item.snapshotHash,confirmed:true},'customer'),f.request(route,{action:'withdraw',orderId:current.id,id:item.id,version:item.version,reason:'TEST zurückgenommen'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const saved=await f.env.DB.prepare('SELECT state FROM calendar_adjustments WHERE id=?').bind(item.id).first(),updated=await(await f.request('/api/order?id='+current.id)).json();
  assert.equal(updated.appointment.start,saved.state==='accepted'?berlinISO(input.start):current.appointment.start);assert.deepEqual(updated.acceptance,current.acceptance);
});

test('stale versions, changed durations, blocked customer records and cancelled documents cannot approve calendar changes',async t=>{
  const f=await bookingFixture(t),{current,input}=await changeFixture(f),route='/api/calendar/adjustments';
  assert.equal((await f.request(route,{...input,end:'2099-12-02T13:00'})).status,409);
  const item=(await(await f.request(route,input)).json()).adjustment;
  assert.equal((await f.request(route,{action:'accept',orderId:current.id,id:item.id,version:item.version,orderVersion:current.version,snapshotHash:item.snapshotHash,confirmed:true},'customer')).status,409);
  const order=await(await f.request('/api/order?id='+current.id)).json();order.recordsRestriction={status:'blocked'};
  await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(order),order.id).run();
  const updatedItem=(await(await f.request(route+'?orderId='+current.id,undefined,'customer')).json()).adjustments[0];assert.equal(updatedItem.canRespond,false);
  assert.equal((await f.request(route,{action:'accept',orderId:current.id,id:item.id,version:item.version,orderVersion:updatedItem.orderVersion,snapshotHash:item.snapshotHash,confirmed:true},'customer')).status,409);
  assert.equal((await f.request('/api/customer-portal/chat?id='+current.id,{action:'send',requestId:randomUUID(),body:'TEST blocked message'},'customer')).status,409);
  delete order.recordsRestriction;order.documentCancellations=[{documentKey:'offer',reason:'TEST Stornierung',at:new Date().toISOString()}];
  await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(order),order.id).run();
  const portal=await(await f.request('/api/customer-portal',undefined,'customer')).json(),visible=portal.orders.find(o=>o.id===current.id);assert.equal(visible.appointmentChanges[0].canRespond,false);assert.match(visible.documents.find(d=>d.kind==='agreement').label,/Originalbeleg.*storniert/);assert.equal(visible.documentCancellations[0].reason,'TEST Stornierung');
});

test('customer block between calendar-link validation and transaction leaves neither entry nor audit behind',async t=>{
  const f=await bookingFixture(t),order=await f.order(),files=await(await f.request('/api/customer-files')).json(),customer=files.customers.find(c=>c.id===files.orders.find(o=>o.id===order.id).customerId);
  const batch=f.env.DB.batch.bind(f.env.DB);let race=true;
  f.env.DB.batch=async statements=>{if(race){race=false;await f.env.DB.prepare('UPDATE customer_files SET data=? WHERE id=?').bind(JSON.stringify({...customer,lifecycle:{status:'blocked'}}),customer.id).run();}return batch(statements);};
  const response=await f.calendar({action:'saveEntry',kind:'appointment',title:'TEST racing link',start:'2099-12-02T09:00',end:'2099-12-02T10:00',customerId:customer.id});assert.equal(response.status,409);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM calendar_entries').first()).n,0);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM calendar_entry_history').first()).n,0);
});

test('customer can decline only their own proposal with a reason while the original reservation remains',async t=>{
  const f=await bookingFixture(t),{current,input}=await changeFixture(f),route='/api/calendar/adjustments',item=(await(await f.request(route,input)).json()).adjustment;
  const body={action:'decline',orderId:current.id,id:item.id,version:item.version,reason:'TEST Termin passt nicht'};
  assert.equal((await f.request(route,body,'foreign')).status,404);assert.equal((await f.request(route,body)).status,403);assert.equal((await f.request(route,{...body,reason:''},'customer')).status,400);
  assert.equal((await f.request(route,body,'customer')).status,200);
  const updated=await(await f.request('/api/order?id='+current.id)).json();assert.deepEqual(updated.appointment,current.appointment);
  const history=(await(await f.request(route+'?orderId='+current.id,undefined,'customer')).json()).adjustments;assert.equal(history[0].state,'declined');assert.equal(history[0].closeReason,body.reason);assert.equal(history[0].closedBy,bookingTestCustomer);assert.ok(history[0].closedAt);
});

test('merged customer portal retains personal handover access and marks revoked cancelled originals without a signing link',async t=>{
  const f=await remoteHandoverFixture(t),pending=await f.publish(await f.add()),at=new Date().toISOString(),reason='TEST private original cancellation reason';
  const cancelled=await f.update(pending,{documentCancellations:[{documentKey:'handover:intake',scope:'document-only',reason,at}]});
  await f.env.DB.prepare('UPDATE handover_tokens SET revoked=1 WHERE order_id=?').bind(cancelled.id).run();
  const portal=await remoteOk(f.req('/api/customer-portal',undefined,'customer')),visible=portal.orders.find(order=>order.id===cancelled.id);
  assert.equal(visible.handovers[0].status,'cancelled');assert.equal(visible.handovers[0].url,null);assert.equal(visible.handovers[0].cancellation.reason,reason);assert.ok(!JSON.stringify(visible).includes(pending.handovers.intake.token));assert.deepEqual(visible.appointmentChanges,[]);
  assert.deepEqual((await f.current(cancelled)).handovers,pending.handovers);
  assert.equal((await f.req('/api/handover/'+pending.handovers.intake.token,undefined,'customer')).status,404);
  await f.update(cancelled,{source:{...cancelled.source,email:remoteForeign}});
  const reassigned=(await remoteOk(f.req('/api/customer-portal',undefined,'foreign'))).orders.find(order=>order.id===cancelled.id);
  assert.equal(reassigned.handovers.length,0);assert.ok(!reassigned.documents.some(document=>document.kind==='intake'));assert.ok(!JSON.stringify(reassigned).includes(reason));
});

test('whole-agreement cancellation marks offer amendments and pending handover consistently while preserving originals',async t=>{
  const f=await remoteHandoverFixture(t),pending=await f.publish(await f.add()),at=new Date().toISOString();
  const amendment={id:randomUUID(),state:'accepted',acceptance:{at,snapshot:{amendment:{services:'TEST extra',totalCents:12000}}}};
  const cancelled=await f.update(pending,{status:'Storniert',amendments:[amendment],documentCancellations:[{documentKey:'pickup',scope:'whole-agreement',at,reason:'TEST Vereinbarung vollständig storniert'}]});
  await f.env.DB.prepare('UPDATE handover_tokens SET revoked=1 WHERE order_id=?').bind(cancelled.id).run();
  const visible=(await remoteOk(f.req('/api/customer-portal',undefined,'customer'))).orders.find(order=>order.id===cancelled.id);
  for(const kind of ['agreement','amendment']){const document=visible.documents.find(item=>item.kind===kind);assert.match(document.label,/Originalbeleg.*storniert/);assert.equal(document.cancellation.scope,'whole-agreement');}
  assert.equal(visible.handovers[0].status,'cancelled');assert.equal(visible.handovers[0].url,null);assert.equal(visible.operationIssue!==null,true);
  assert.deepEqual((await f.current(cancelled)).handovers,pending.handovers);assert.deepEqual((await f.current(cancelled)).acceptance,pending.acceptance);
});
