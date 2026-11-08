import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {handleAgentBridge} from '../server/agent.mjs';
import {digest} from '../server/auth.mjs';

const origin='https://panel.example.invalid',token='synthetic-appointment-read-token';
const dates={start:'2026-11-10T10:00:00Z',end:'2026-11-10T12:00:00Z'};
function fixture(t){
  const DB=new PanelDatabase(':memory:');
  t.after(()=>DB.close());
  DB.sql.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,wg TEXT,status TEXT,data TEXT,updated_at TEXT,synthetic INTEGER)');
  const env={DB,PANEL_AGENT_ENABLED:'true',PANEL_AGENT_READ_TOKEN_SHA256:digest(token)};
  const save=(id,data,status='Angenommen')=>DB.prepare('INSERT INTO orders VALUES(?,?,?,?,?,0)').bind(id,'WG-'+id,status,JSON.stringify(data),'2026-11-08T04:00:00Z').run();
  const read=async()=>{
    const before=DB.sql.prepare('SELECT total_changes() AS n').get().n;
    const snapshot=DB.sql.prepare('SELECT * FROM orders ORDER BY id').all();
    const response=await handleAgentBridge(env,new Request(origin+'/api/agent-bridge/context',{headers:{authorization:'Bearer '+token}}));
    assert.equal(response.status,200);
    const value=await response.json();
    assert.equal(DB.sql.prepare('SELECT total_changes() AS n').get().n,before,'a bridge read must not write to the database');
    assert.deepEqual(DB.sql.prepare('SELECT * FROM orders ORDER BY id').all(),snapshot,'a bridge read must preserve every order');
    return value.orders;
  };
  return {save,read};
}

test('bridge labels an unconfirmed appointment as a proposal instead of a confirmed appointment',async t=>{
  const f=fixture(t);
  await f.save('proposal',{source:{name:'Synthetic customer',requestedDate:'2026-12-01',requestedTimeWindow:'abends'},appointment:{...dates,location:'PRIVATE-LOCATION'},appointmentOptions:[{start:'2026-12-02T15:00:00Z'}]});
  const [order]=await f.read();
  assert.equal(order.appointment,null);
  assert.deepEqual(order.appointmentProposal,dates);
  assert.doesNotMatch(JSON.stringify(order),/PRIVATE-LOCATION|2026-12-01|2026-12-02|abends/);
});

test('bridge requires object confirmation evidence even when a legacy status says binding',async t=>{
  const f=fixture(t);
  for(const [id,confirmation] of [['missing',undefined],['false',false],['null',null],['unknown','unknown'],['true',true],['number',1]]){
    await f.save(id,{appointment:{...dates,...(confirmation===undefined?{}:{confirmation})}},'Termin verbindlich');
  }
  const orders=await f.read();
  assert.equal(orders.length,6);
  for(const order of orders){assert.equal(order.appointment,null,order.id);assert.deepEqual(order.appointmentProposal,dates,order.id);}
});

test('bridge keeps evidenced customer and operator confirmations separate from proposals without exposing proof contents',async t=>{
  const f=fixture(t);
  await f.save('customer',{appointment:{...dates,confirmation:{mode:'online',at:'2026-11-08T03:00:00Z',signature:'PRIVATE-SIGNATURE',snapshotHash:'PRIVATE-HASH'}}},'Termin verbindlich');
  await f.save('operator',{appointment:{...dates,confirmation:{mode:'ohne Unterschrift freigegeben',at:'2026-11-08T03:00:00Z',release:{by:'owner',reason:'PRIVATE-REASON'}}}},'In Arbeit');
  await f.save('legacy-proof',{appointment:{...dates,confirmation:{mode:'bereits verbindlich (vor Einführung der Bestätigung)',at:'2026-11-08T03:00:00Z',legacy:true}}},'Termin verbindlich');
  const orders=await f.read();
  assert.equal(orders.length,3);
  for(const order of orders){assert.deepEqual(order.appointment,dates,order.id);assert.equal(order.appointmentProposal,null,order.id);}
  assert.doesNotMatch(JSON.stringify(orders),/PRIVATE-|signature|snapshotHash|release/);
});

test('bridge does not present cancelled appointment history as a current appointment or proposal',async t=>{
  const f=fixture(t);
  await f.save('cancelled-confirmed',{appointment:{...dates,confirmation:{mode:'online',at:'2026-11-08T03:00:00Z'}}},'Storniert');
  await f.save('cancelled-proposal',{appointment:dates},'Storniert');
  for(const order of await f.read()){assert.equal(order.appointment,null,order.id);assert.equal(order.appointmentProposal,null,order.id);}
});

test('bridge never promotes requested dates or appointment options to an appointment',async t=>{
  const f=fixture(t);
  await f.save('request-only',{source:{requestedDate:'2026-12-01',requestedTimeWindow:'morgens'},appointmentOptions:[{...dates,confirmed:true}]},'Preise prüfen');
  const [order]=await f.read();
  assert.equal(order.appointment,null);
  assert.equal(order.appointmentProposal,null);
});

