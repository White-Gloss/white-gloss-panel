import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appointmentHTML,appointmentOptionsInitialValues,clearAppointmentOptionsDraft,createOfferAppointmentSelection,mountAppointmentOptions,offerAcceptancePresentation,offerNeedsAppointmentOptions,offerSnapshotHash,readAppointmentOptions,appointmentOptionsDeliveryIssue} from '../public/appointment-options.js';

const proposal=(id='first')=>({id,start:'2099-12-01T09:00:00.000Z',end:'2099-12-01T11:00:00.000Z',duration:120,delivery:'Kunde bringt',location:'TEST · Betrieb'});
const input=()=>({start:'2099-12-01T10:00',duration:'120',delivery:'Abholung',location:'  TEST · Kundenadresse  '});

function formHarness(options,orderId='test-order'){
  const listeners={};
  const rows=options.map(option=>{
    const fields=Object.entries(option).map(([name,value])=>({dataset:{appointmentField:name},value}));
    const legend={textContent:''};
    const remove={disabled:false,setAttribute(){}};
    return {fields,querySelectorAll:()=>fields,querySelector:selector=>selector==='legend'?legend:remove};
  });
  const status={textContent:''},add={disabled:false};
  return {
    dataset:{orderId,dirty:'false'},rows,listeners,status,
    querySelectorAll:()=>rows,
    querySelector:selector=>selector==='[data-appointment-rows]'?{children:rows}:selector==='[data-appointment-add]'?add:status,
    addEventListener:(name,handler)=>listeners[name]=handler
  };
}

test('changing the chosen appointment clears signature and payment confirmation',()=>{
  let drawn=false,clears=0;
  const obligation={checked:false};
  const selections=[];
  const selection=createOfferAppointmentSelection([proposal('first'),proposal('second')],{clearSignature(){drawn=false;clears++;},obligation,onSelect:option=>selections.push(option.id)});
  assert.equal(selection.selected(),null);
  selection.choose('first');
  drawn=true;obligation.checked=true;
  selection.choose('first');
  assert.equal(drawn,true);assert.equal(obligation.checked,true);
  selection.choose('second');
  assert.equal(drawn,false);assert.equal(obligation.checked,false);assert.equal(clears,2);
  assert.equal(selection.selected().id,'second');assert.deepEqual(selections,['first','second']);
  assert.throws(()=>selection.choose('foreign'));
  assert.equal(selection.selected().id,'second');
});

test('customer signature hash binds the selected ID after every visible field',async()=>{
  const visible={wg:'WG-TEST',customer:'TEST',vehicle:'TEST',offer:{totalCents:10000},status:'Angebot offen',ownerPreview:false,appointmentOptions:[proposal('first'),proposal('second')],appointmentOptionsVersion:3,appointment:null,acceptance:null};
  const expected=createHash('sha256').update(JSON.stringify({...visible,selectedAppointmentOptionId:'second'})).digest('hex');
  assert.equal(await offerSnapshotHash(visible,'second'),expected);
  assert.notEqual(await offerSnapshotHash(visible,'first'),expected);
  await assert.rejects(offerSnapshotHash(visible));
  await assert.rejects(offerSnapshotHash(visible,'foreign'));
  assert.equal(Object.hasOwn(visible,'selectedAppointmentOptionId'),false);
});

test('earlier offers keep their original signature hash without an appointment ID',async()=>{
  const visible={wg:'WG-TEST',offer:{totalCents:10000},status:'Angebot offen'};
  assert.equal(await offerSnapshotHash(visible),createHash('sha256').update(JSON.stringify(visible)).digest('hex'));
});

test('new offers awaiting proposals cannot silently use the earlier acceptance flow',async()=>{
  const waiting={offer:{totalCents:10000,requiresAppointmentSelection:true},status:'Angebot offen',appointmentOptions:[]};
  assert.equal(offerNeedsAppointmentOptions(waiting),true);
  await assert.rejects(offerSnapshotHash(waiting));
  assert.equal(offerNeedsAppointmentOptions({...waiting,appointmentOptions:[proposal()]}),false);
  assert.equal(offerNeedsAppointmentOptions({offer:{totalCents:10000},status:'Angebot offen'}),false);
});

test('an acceptance retry after cancellation shows current cancellation and no confirmed appointment',()=>{
  const appointment=proposal();
  const accepted=offerAcceptancePresentation({status:'Termin verbindlich',appointment});
  assert.equal(accepted.heading,'Termin und Angebot sind angenommen');assert.equal(accepted.appointment,appointment);
  const cancelled=offerAcceptancePresentation({status:'Storniert',appointment,confirmationDelivery:{state:'cancelled'}},appointment);
  assert.equal(cancelled.heading,'Der Auftrag wurde storniert');assert.equal(cancelled.appointment,null);
  assert.ok(cancelled.body.includes('inzwischen storniert'));
  const concurrentCancellation=offerAcceptancePresentation({status:'Termin verbindlich',appointment,confirmationDelivery:{state:'cancelled'}},appointment);
  assert.equal(concurrentCancellation.heading,'Der Auftrag wurde storniert');assert.equal(concurrentCancellation.appointment,null);
  const legacy=offerAcceptancePresentation({status:'Angenommen'});
  assert.equal(legacy.appointment,null);assert.ok(legacy.body.includes('Termin mit Ihnen vereinbaren'));
});

test('owner form accepts one to three complete proposals and normalizes duration/address',()=>{
  for(const count of [1,2,3]){
    const read=readAppointmentOptions(formHarness(Array.from({length:count},input)));
    assert.equal(read.length,count);assert.equal(read[0].duration,120);assert.equal(read[0].location,'TEST · Kundenadresse');
  }
  assert.throws(()=>readAppointmentOptions(formHarness([])));
  assert.throws(()=>readAppointmentOptions(formHarness(Array.from({length:4},input))));
});

test('owner form rejects incomplete or invalid proposal fields',()=>{
  for(const change of [{start:''},{duration:'14'},{duration:'1441'},{duration:'1.5'},{delivery:''},{delivery:'unknown'},{location:'   '}])assert.throws(()=>readAppointmentOptions(formHarness([{...input(),...change}])));
});

test('a paid pickup cannot be offered as customer delivery while free options can differ',()=>{
  const bringing={...input(),delivery:'Kunde bringt'};
  const paid=formHarness([bringing]);paid.dataset.pickupCents='5000';
  assert.throws(()=>readAppointmentOptions(paid));
  const free=formHarness([input(),bringing]);free.dataset.pickupCents='0';
  assert.equal(readAppointmentOptions(free).length,2);
  assert.equal(appointmentOptionsDeliveryIssue({offer:{pickupCents:5000},appointmentOptions:[proposal()]}).length>0,true);
  assert.equal(appointmentOptionsDeliveryIssue({offer:{pickupCents:0,lines:[{kind:'pickup',amountCents:0}]},appointmentOptions:[proposal()]}),'');
});

test('an edited appointment draft survives a different owner form saving and rerendering',t=>{
  const previousDocument=globalThis.document;
  globalThis.document={querySelectorAll:()=>[]};
  t.after(()=>{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;clearAppointmentOptionsDraft('draft-order');});
  const order={id:'draft-order',source:{delivery:'Kunde bringt'},appointmentOptions:[proposal()]};
  const initial=appointmentOptionsInitialValues(order);
  assert.equal(initial.options[0].start,'2099-12-01T10:00');
  const form=formHarness(initial.options,'draft-order');
  mountAppointmentOptions(form);
  form.rows[0].fields.find(field=>field.dataset.appointmentField==='start').value='2099-12-03T14:30';
  form.rows[0].fields.find(field=>field.dataset.appointmentField==='location').value='TEST · geänderter Ort';
  form.listeners.input({});
  assert.equal(form.dataset.dirty,'true');
  const afterPriceSave=appointmentOptionsInitialValues({...order,version:2,assessment:{totalCents:12000}});
  assert.equal(afterPriceSave.dirty,true);
  assert.equal(afterPriceSave.options[0].start,'2099-12-03T14:30');
  assert.equal(afterPriceSave.options[0].location,'TEST · geänderter Ort');
  afterPriceSave.options[0].location='accidental mutation';
  assert.equal(appointmentOptionsInitialValues(order).options[0].location,'TEST · geänderter Ort');
  clearAppointmentOptionsDraft(order.id);
  assert.equal(appointmentOptionsInitialValues(order).dirty,false);
  assert.equal(appointmentOptionsInitialValues(order).options[0].start,'2099-12-01T10:00');
});

test('free pickup and confirmed pickup lines are preserved; unclear delivery needs an explicit choice',()=>{
  const source={address:'TEST · Abholadresse',pickupCents:0,raw:{pickup_requested:true}};
  const freePickup=appointmentOptionsInitialValues({id:'free',source});
  assert.equal(freePickup.options[0].delivery,'Abholung');assert.equal(freePickup.options[0].location,source.address);
  const freeLine=appointmentOptionsInitialValues({id:'line',source:{address:source.address},assessment:{lines:[{kind:'pickup',amountCents:0}]}});
  assert.equal(freeLine.options[0].delivery,'Abholung');
  const bringing=appointmentOptionsInitialValues({id:'bring',source:{catalogQuote:{delivery:'Kunde bringt'}}},{street:'TESTstraße 1',city:'TESTort'});
  assert.equal(bringing.options[0].delivery,'Kunde bringt');assert.equal(bringing.options[0].location,'TESTstraße 1, TESTort');
  assert.equal(appointmentOptionsInitialValues({id:'unknown',source:{}}).options[0].delivery,'');
  assert.equal(appointmentOptionsInitialValues({id:'conflict',source:{delivery:'Kunde bringt',pickupCents:5000}}).options[0].delivery,'');
});

test('appointment display uses Berlin time and escapes an address supplied by the user',()=>{
  const html=appointmentHTML({...proposal(),location:'<script>alert("test")</script>'});
  assert.ok(html.includes('10:00 – 12:00 Uhr'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});
