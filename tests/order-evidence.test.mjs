import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOrderEvidence} from '../dist/client/order-evidence.js';
const row=(o,k)=>buildOrderEvidence(o).documents.find(d=>d.kind===k);
test('slim orders remain loading rather than claiming missing documents',()=>{assert.equal(buildOrderEvidence({slim:true}).loading,true);});
test('signed original coexists with pending replacement and independent skipped annotation',()=>{
 const order={intake:{customerSignature:'private-signature',savedAt:'2026-11-01'},pending:{intake:{createdAt:'2026-11-02',content:{}}},workflow:{intake:{state:'skipped',reason:'Nicht erforderlich'}}};
 Object.freeze(order.intake);Object.freeze(order);
 const d=row(order,'intake');assert.equal(d.current.customerSigned,true);assert.equal(d.pending.customerSigned,false);assert.equal(d.annotation.state,'skipped');assert.ok(!JSON.stringify(d).includes('private-signature'));
});
test('acceptance without signature and unsigned protocols never imply signed evidence',()=>{
 assert.equal(row({offer:{},acceptance:{at:'2026-11-01'}},'offer').current.status,'Ohne Kundenunterschrift angenommen');
 assert.equal(row({return:{savedAt:'2026-11-01'}},'return').current.status,'Gespeichert · Kundenunterschrift fehlt');
 assert.equal(row({},'intake').current.status,'Noch nicht vorhanden');
});
test('discarded requests are inactive and do not replace current evidence',()=>{
 const d=row({pendingHistory:[{kind:'return',discardedAt:'2026-11-03',content:{operatorSignature:'secret'}}]},'return');
 assert.equal(d.current.exists,false);assert.equal(d.history[0].active,false);assert.equal(d.history[0].status,'Frühere Unterschriftsanfrage · inaktiv');assert.equal(d.pending,null);
});
test('invoice states use German labels and preserve unknown states honestly',()=>{
 assert.equal(row({invoice:{status:'unpaid'}},'invoice').current.status,'Offen');
 assert.equal(row({invoice:{status:'new-state'}},'invoice').current.status,'Unbekannter Status');
 assert.equal(row({invoiceDraft:{}},'invoice').current.status,'Entwurf');
 assert.deepEqual(buildOrderEvidence({}).documents.map(d=>d.targetTab),['price','intake','return','payment']);
});
test('prior handover permission is separate from the final protocol signature',()=>{
 const d=row({handover:{return:{signature:'private-permission',at:'2026-11-01'}}},'return');
 assert.equal(d.current.customerSigned,false);assert.deepEqual(d.handover,{signed:true,at:'2026-11-01'});assert.ok(!JSON.stringify(d).includes('private-permission'));
});
test('Qonto payment evidence agrees with existing invoice display',()=>{
 assert.equal(row({invoice:{provider:'qonto',status:'unpaid',totalCents:1000},invoiceInfo:{openCents:0}},'invoice').current.status,'Bezahlt');
});
