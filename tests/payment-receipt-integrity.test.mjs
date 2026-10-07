import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {init,getOrder} from '../src/worker.mjs';
import {recordPayment,paymentSchema} from '../server/payment-ledger.mjs';
import {digest} from '../server/auth.mjs';
import {syntheticSignature} from './fixtures/signature.mjs';

async function fixture(t,method) {
  const files = new Map(),env = {DB:new PanelDatabase(':memory:'),BUCKET:{async get(id) { return files.get(id) ?? null; }}};
  t.after(() => env.DB.close()); await init(env); await paymentSchema(env);
  const now = new Date(Date.now()-1000).toISOString(),id = randomUUID();
  const order = {id,wg:'TEST-RECEIPT',version:1,status:'Erledigt',synthetic:true,source:{name:'Synthetischer Kunde'},offer:{totalCents:10000,services:'Synthetische Testleistung'},acceptance:{at:now},completedAt:now,payments:[]};
  await env.DB.prepare('INSERT INTO orders(id,wg,version,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?,1)').bind(id,order.wg,1,order.status,JSON.stringify(order),now,'test','Isolierter Belegtest').run();
  const receipt = randomUUID(),original = new Uint8Array(Buffer.from(syntheticSignature.split(',')[1],'base64'));
  await env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(receipt,id,'photo','image/png',digest(original),original.length,now).run();
  const input = {idempotencyKey:randomUUID(),amountCents:10000,method,reference:'TEST-ORIGINAL-RECEIPT',at:now,receipt};
  return {env,files,order,input,original};
}

for (const method of ['Karte','Überweisung']) {
  test(method+' rejects a database-only receipt without recording any payment',async t => {
    const f = await fixture(t,method);
    await assert.rejects(recordPayment(f.env,f.order,f.input),/Original.*fehlt|originale.*fehlt/);
    const saved = await getOrder(f.env,f.order.id);
    assert.equal(saved.version,1); assert.equal(saved.status,'Erledigt'); assert.deepEqual(saved.payments,[]);
    assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM payment_records').first()).n,0);
  });
  test(method+' rejects changed original receipt bytes before committing',async t => {
    const f = await fixture(t,method); f.files.set(f.input.receipt,{body:new Uint8Array([1,2,3])});
    await assert.rejects(recordPayment(f.env,f.order,f.input),/verändert/);
    assert.equal((await getOrder(f.env,f.order.id)).version,1);
    assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM payment_records').first()).n,0);
  });
  test(method+' records a payment only when its own original receipt hash matches',async t => {
    const f = await fixture(t,method); f.files.set(f.input.receipt,{body:f.original});
    const saved = await recordPayment(f.env,f.order,f.input);
    assert.equal(saved.status,'Bezahlt'); assert.equal(saved.payments.length,1); assert.equal(saved.payments[0].receipt,f.input.receipt);
    assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM payment_records').first()).n,1);
  });
}
