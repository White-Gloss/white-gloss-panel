import test from 'node:test';
import assert from 'node:assert/strict';
import {transition} from '../src/domain.mjs';
import {calendarExport} from '../src/calendar.mjs';
import {calendarEvent} from '../server/providers.mjs';

const at='2026-10-01T12:00:00.000Z';
const appointment={start:'2026-10-05T09:00',duration:180,delivery:'Kunde bringt',location:'Horb'};
function offered(){
  const base={id:'test',wg:'WG-TEST',version:1,status:'Preise prüfen',synthetic:false,source:{name:'Nur Test',vehicle:'Testwagen'}};
  return transition(transition(base,'price',{services:'Testleistung',totalCents:10000},at),'confirm',{},at);
}
function accepted(){return transition(offered(),'accept',{signature:'customer-signature',snapshotHash:'offer-hash',paymentObligation:true},at,'customer');}
function confirmed(){return transition(transition(accepted(),'appointment',appointment,at),'confirmAppointment',{signature:'appointment-signature',confirmed:true,snapshotHash:'appointment-hash'},at,'customer');}

test('offer acceptance remains idempotent after early appointment confirmation and subsequent progress',()=>{
  const early=transition(transition(offered(),'appointment',appointment,at),'confirmAppointment',{signature:'appointment-signature',confirmed:true,snapshotHash:'appointment-hash'},at,'customer');
  const first=transition(early,'accept',{signature:'offer-signature',snapshotHash:'offer-hash',paymentObligation:true},at,'customer');
  assert.equal(first.status,'Termin verbindlich');
  for(const status of ['Termin verbindlich','In Arbeit','Erledigt','Bezahlt']){
    const saved={...first,status};
    assert.deepEqual(transition(saved,'accept',{},'2026-10-02T12:00:00.000Z','customer'),saved);
  }
});

test('appointment changes after work starts require an owner release and removals remain blocked',()=>{
  const first=confirmed();
  for(const status of ['In Arbeit','Erledigt','Bezahlt']){
    const saved={...first,status};
    assert.deepEqual(transition(saved,'appointment',appointment,at).appointment,saved.appointment);
    for(const input of [{...appointment,start:'2026-10-06T09:00'},{...appointment,duration:240},{...appointment,delivery:'Abholung'},{...appointment,location:'Anderer Ort'}]){
      assert.throws(()=>transition(saved,'appointment',input,at),error=>error.status===409&&/läuft bereits/.test(error.message));
      assert.throws(()=>transition(saved,'appointment',{...input,release:true},at),/Grund/);
      const changed=transition(saved,'appointment',{...input,release:true,releaseReason:'Länger gebraucht, telefonisch abgestimmt'},at);
      assert.equal(changed.status,status);assert.equal(changed.appointment.confirmation.mode,'ohne Unterschrift freigegeben');
      assert.equal(changed.appointment.confirmation.release.reason,'Länger gebraucht, telefonisch abgestimmt');
      assert.deepEqual(changed.appointmentHistory[0].confirmation,saved.appointment.confirmation);
    }
    assert.throws(()=>transition(saved,'appointment',{start:'',release:true,releaseReason:'Termin entfernen'},at),error=>error.status===409&&/Arbeitsbeginn/.test(error.message));
    assert.deepEqual(saved.appointment,first.appointment,'failed edits do not mutate the original confirmation');
  }
});

test('manual progress past an unconfirmed appointment always requires and preserves an owner release',()=>{
  const proposed=transition(accepted(),'appointment',appointment,at);
  for(const status of ['Termin verbindlich','In Arbeit','Erledigt','Bezahlt']){
    assert.throws(()=>transition(proposed,'setStatus',{status},at),/nicht vom Kunden bestätigt/);
    const released=transition(proposed,'setStatus',{status,reason:'Kunde hat telefonisch bestätigt'},at);
    assert.equal(released.status,status);
    assert.equal(released.appointment.confirmation.mode,'ohne Unterschrift freigegeben');
    assert.equal(released.appointment.confirmation.release.reason,'Kunde hat telefonisch bestätigt');
    assert.equal(released.appointment.confirmation.signature,undefined);
  }
});

test('manual offer releases create canonical unsigned acceptance and work with both calendar formats',()=>{
  for(const initial of [offered(),{...offered(),offer:undefined,status:'Preise prüfen'}]){
    const proposed=transition(initial,'appointment',appointment,at);
    const released=transition(proposed,'setStatus',{status:'Termin verbindlich',reason:'Kunde hat mündlich beauftragt'},at);
    assert.equal(released.acceptance.mode,'ohne Unterschrift freigegeben');
    assert.equal(released.acceptance.signature,null);
    assert.equal(released.acceptance.release.reason,'Kunde hat mündlich beauftragt');
    assert.equal(released.acceptance.paymentObligation,false);
    assert.equal(released.acceptanceRelease,undefined);
    assert.deepEqual(released.acceptance.snapshot.offer,released.offer);
    assert.deepEqual(released.acceptance.snapshot.source,released.source);
    assert.match(calendarExport([released],at),/BEGIN:VEVENT/);
    assert.equal(calendarEvent(released).start.dateTime,released.appointment.start);
    const edited=transition(released,'price',{totalCents:20000,services:'Geändert'},at);
    assert.equal(edited.offer.totalCents,20000,'unsigned offers remain editable');
    assert.equal(edited.acceptance.snapshot.offer.totalCents,10000,'release keeps its original snapshot');
  }
});

test('manual status releases with no priced content only record the reason without inventing an offer',()=>{
  for(const content of [{},{offer:{totalCents:0,lines:[]}},{assessment:{totalCents:0,lines:[]}}]){
    const original={id:'unpriced',wg:'WG-UNPRICED',status:'Preise prüfen',source:{name:'Nur Test'},...content};
    const released=transition(original,'setStatus',{status:'Angenommen',reason:'Nur Statuswechsel, Angebot folgt'},at);
    assert.equal(released.acceptance,undefined);assert.deepEqual(released.offer,original.offer);
    assert.equal(released.acceptanceRelease.reason,'Nur Statuswechsel, Angebot folgt');
  }
});

test('existing legacy binding states keep their status without a new appointment release reason',()=>{
  const proposed=transition(accepted(),'appointment',appointment,at);
  for(const from of ['Termin verbindlich','In Arbeit','Erledigt','Bezahlt']){
    for(const status of ['Termin verbindlich','In Arbeit','Erledigt','Bezahlt']){
      const changed=transition({...proposed,status:from},'setStatus',{status},at);
      assert.equal(changed.status,status);assert.equal(changed.appointment.confirmation,undefined);
    }
  }
});

test('saving or signing protocols cannot advance work before the offer and appointment are confirmed',()=>{
  const proposed=transition(accepted(),'appointment',appointment,at),early=transition(transition(offered(),'appointment',appointment,at),'confirmAppointment',{signature:'appointment-signature',confirmed:true,snapshotHash:'appointment-hash'},at,'customer');
  for(const original of [offered(),accepted(),proposed,early]){
    for(const kind of ['intake','return']){
      const saved=transition(original,kind,{notes:'Nur Dokumentation'},at);
      assert.equal(saved.status,original.status);assert.equal(saved[kind].notes,'Nur Dokumentation');assert.equal(saved.completedAt,undefined);
      const pending=transition(original,'protocolRequest',{kind,content:{notes:'Zur Kundenunterschrift'}},at);
      const signed=transition(pending,'signReplacement',{kind,signature:'protocol-signature',snapshotHash:'protocol-hash'},at,'customer');
      assert.equal(signed.status,original.status);assert.equal(signed[kind].customerSignature,'protocol-signature');assert.equal(signed.completedAt,undefined);
    }
  }
  const authorized=confirmed();
  assert.equal(transition(authorized,'intake',{},at).status,'In Arbeit');assert.equal(transition(authorized,'return',{},at).status,'Erledigt');
  for(const kind of ['intake','return']){
    const pending=transition(authorized,'protocolRequest',{kind,content:{}},at);
    assert.equal(transition(pending,'signReplacement',{kind,signature:'protocol-signature',snapshotHash:'protocol-hash'},at,'customer').status,kind==='intake'?'In Arbeit':'Erledigt');
  }
});
