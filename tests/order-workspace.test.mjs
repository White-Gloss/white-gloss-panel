import test from 'node:test';
import assert from 'node:assert/strict';
import {orderAreas,orderAppointment} from '../public/order-workspace.js';

test('later order statuses never invent missing protocols, invoices or confirmations',()=>{
  for(const status of ['In Arbeit','Erledigt','Bezahlt','Storniert']){
    const order={status,source:{},workflow:{intake:{state:'skipped'},return:{state:'completed'}}};
    const areas=orderAreas(order);
    assert.equal(areas.find(a=>a.id==='intake').evidence,'Kein Protokoll');
    assert.equal(areas.find(a=>a.id==='intake').annotation,'Übersprungen');
    assert.equal(areas.find(a=>a.id==='return').evidence,'Kein Protokoll');
    assert.equal(areas.find(a=>a.id==='return').annotation,'Manuell erledigt');
    assert.equal(areas.find(a=>a.id==='payment').evidence,'Keine Rechnung');
    assert.equal(orderAppointment(order).confirmed,false);
  }
});
test('pending replacements stay visible alongside workflow annotations',()=>{
  const order={intake:{signedAt:'2026-11-01'},pending:{intake:{},offer:{}},workflow:{intake:{state:'completed'}}};
  const areas=orderAreas(order);
  assert.equal(areas.find(a=>a.id==='intake').evidence,'Unterschrift offen');
  assert.equal(areas.find(a=>a.id==='intake').annotation,'Manuell erledigt');
  assert.equal(areas.find(a=>a.id==='price').pending,true);
});
test('requested date, proposal and confirmed appointment remain distinct without mutations',()=>{
  const order={source:{desiredDate:'2026-12-01',timeWindow:'Vormittags'},status:'Termin verbindlich'};
  assert.equal(orderAppointment(order).wish,'2026-12-01 · Vormittags');
  assert.equal(orderAppointment(order).start,null);
  order.appointment={start:'2026-12-02T10:00:00Z'};
  assert.equal(orderAppointment(order).label,'Terminvorschlag · unbestätigt');
  assert.equal(orderAppointment(order).confirmed,false);
  order.appointment.confirmation={at:'2026-11-06'};
  const before=JSON.stringify(order);
  assert.equal(orderAppointment(order).label,'Bestätigter Termin');
  assert.equal(orderAppointment(order).start,order.appointment.start);
  orderAreas(order);assert.equal(JSON.stringify(order),before);
});
