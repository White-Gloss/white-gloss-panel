import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {init,setting} from '../src/worker.mjs';
import {providerOperations} from '../server/providers.mjs';

for (const values of [{},{qontoDocumentLayoutApproved:false,qontoDocumentLayoutEvidence:'TEST Nachweis'},{qontoDocumentLayoutApproved:true}]) {
  test('missing Qonto layout approval stops before any provider request: '+JSON.stringify(values),async t => {
    const env = {DB:new PanelDatabase(':memory:')};t.after(() => env.DB.close());await init(env);
    for (const [key,value] of Object.entries({numberAudit:true,qontoVerified:true,...values})) await setting(env,key,value);
    let calls = 0;t.mock.method(globalThis,'fetch',async() => {calls++;throw Error('Keine externe Rechnung im Test.');});
    const order = {id:'TEST-layout-order',wg:'TEST-layout',version:1,status:'Erledigt',synthetic:false,source:{name:'TEST Kunde',email:'synthetic@example.invalid'},return:{at:'2026-10-03T13:00:00Z'},completedAt:'2026-10-03T13:00:00Z',offer:{totalCents:11900,services:'TEST Leistung'}};
    const input = {reviewed:true,vatBasisPoints:1900,iban:'DE02120300000000202051',dueDate:'2099-10-20',clientId:'11111111-1111-1111-1111-111111111111'};
    await assert.rejects(providerOperations.action(env,order,'invoice',input),/Rechnungsbriefpapier/);
    assert.equal(calls,0);assert.equal((await env.DB.prepare('SELECT count(*) n FROM jobs').first()).n,0);assert.equal(order.invoice,undefined);
  });
}
