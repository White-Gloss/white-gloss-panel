import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelDatabase} from '../server/storage.mjs';
import {SCHEMA} from '../src/schema.mjs';
import {mcpRead} from '../server/mcp-tools.mjs';
import {customerRecordModel} from '../server/customer-record.mjs';
import {fixture as oauthFixture,origin} from './mcp-fixture.mjs';

async function fixture(t){
 const DB=new PanelDatabase(':memory:');t.after(()=>DB.close());await DB.batch(SCHEMA.map(sql=>DB.prepare(sql)));
 DB.sql.exec(`CREATE TABLE portal_requests(id TEXT,order_id TEXT,kind TEXT,data TEXT,status TEXT,created_at TEXT);
 CREATE TABLE portal_change_requests(id TEXT,order_id TEXT,data TEXT,status TEXT,created_at TEXT);
 CREATE TABLE mail_messages(id TEXT PRIMARY KEY,synthetic INTEGER,direction TEXT,from_name TEXT,from_address TEXT,to_json TEXT,subject TEXT,text_body TEXT,received_at TEXT);
 CREATE TABLE mail_order_links(message_id TEXT PRIMARY KEY,order_id TEXT,recipient TEXT,created_at TEXT);
 CREATE TABLE mail_deliveries(message_id TEXT,status TEXT,created_at TEXT);
 CREATE TABLE order_media(asset_id TEXT,stage TEXT,description TEXT,shared INTEGER);`);
 const env={DB,CONFIG_KEY:Buffer.alloc(32,7).toString('base64')},identity={owner:'owner-fixture',id:'grant-fixture'};
 const seed=async(id,data={},status='Angenommen')=>DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(id,'WG-'+id,status,JSON.stringify({source:{name:'Fixture',email:'shared@example.invalid'},...data}),'2026-11-08T12:00:00Z','test','seed').run();
 const read=(name,args={})=>mcpRead(env,name,args,identity);
 const customer=async(id,data={})=>DB.prepare('INSERT INTO customers(id,data,search,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,JSON.stringify({name:'Customer '+id,...data}),id,'2026-11-08','2026-11-08').run();
 return {DB,env,identity,seed,read,customer};
}
const slot={start:'2026-11-09T09:00:00Z',end:'2026-11-09T10:00:00Z',duration:60};

test('all MCP appointment views reject primitive confirmations and inactive appointment history',async t=>{
 const f=await fixture(t);await f.seed('000001',{appointment:{...slot,confirmation:true}},'Termin verbindlich');
 for(const [i,status] of ['Storniert','Abgelehnt','Abgelaufen'].entries())await f.seed('00000'+(i+2),{appointment:{...slot,confirmation:{at:'2026-11-01'}}},status);
 await f.seed('000005',{appointment:{...slot,confirmation:{at:'2026-11-01'}}},'Termin verbindlich');
 const orders=await f.read('panel_orders');
 assert.equal(orders.items.find(o=>o.wg==='WG-000001').appointment,null);
 for(const id of ['000002','000003','000004']){const o=orders.items.find(o=>o.wg==='WG-'+id);assert.equal(o.appointment,null,id);assert.equal(o.appointmentProposal,null,id);}
 assert.deepEqual((await f.read('panel_appointments',{date:'2026-11-09'})).items.map(o=>o.wg),['WG-000005']);
 const record=customerRecordModel({orders:[{id:'cancelled',status:'Storniert',appointment:{...slot,confirmation:{}}},{id:'primitive',status:'Angenommen',appointment:{...slot,confirmation:true}}]});
 assert.equal(record.orders[0].appointment,null);assert.equal(record.orders[1].appointment.confirmed,false);
});

test('Berlin calendar overlap handles timestamp offsets and DST day boundaries',async t=>{
 const f=await fixture(t);
 // March 29 is a 23-hour Berlin day: 23:00Z on March 28 through 22:00Z on March 29.
 await f.seed('000001',{appointment:{start:'2026-03-30T00:30:00+03:00',end:'2026-03-30T01:00:00+03:00',confirmation:{}}},'Termin verbindlich');
 await f.seed('000002',{appointment:{start:'2026-03-29T22:00:00Z',end:'2026-03-29T23:00:00Z',confirmation:{}}},'Termin verbindlich');
 assert.deepEqual((await f.read('panel_appointments',{date:'2026-03-29'})).items.map(o=>o.wg),['WG-000001']);
});

test('restricted orders and their linked customer and vehicle never enter external MCP exports',async t=>{
 const f=await fixture(t);
 await f.seed('000001',{recordsRestriction:{status:'blocked'},invoice:{totalCents:100,status:'unpaid'},appointment:{...slot,confirmation:{}}});
 await f.seed('000002',{recordsRestriction:{status:'anonymized'}});
 await f.seed('000003');await f.customer('private');await f.customer('public');
 await f.DB.prepare("INSERT INTO customer_orders VALUES('000001','private',NULL)").run();
 await f.DB.prepare("INSERT INTO vehicles(id,customer_id,data,search,created_at,updated_at) VALUES('private-car','private','{}','car','2026-11-08','2026-11-08')").run();
 for(const name of ['panel_orders','panel_bookings','panel_appointments','panel_invoices','panel_documents','panel_media']){
  const result=await f.read(name,name==='panel_appointments'?{}:{wg:'WG-000001'}).catch(error=>{throw Error(name+': '+error.message);});assert.deepEqual(result.items,[],name);
 }
 assert.deepEqual((await f.read('panel_customers')).items.map(c=>c.id),['public']);assert.deepEqual((await f.read('panel_vehicles')).items,[]);
 const dashboard=await f.read('panel_dashboard');assert.equal(dashboard.counts.reduce((n,c)=>n+c.count,0),1);
 const before=f.DB.sql.prepare('SELECT total_changes() n').get().n;await f.read('panel_orders');assert.equal(f.DB.sql.prepare('SELECT total_changes() n').get().n,before);
});

test('email exports require explicit links and cannot borrow another order with the same address',async t=>{
 const f=await fixture(t);await f.seed('000001');await f.seed('000002');await f.seed('000003',{recordsRestriction:{status:'blocked'}});
 for(const [id,order] of [['first','000001'],['second','000002'],['blocked','000003'],['unlinked',null]]){
  await f.DB.prepare('INSERT INTO mail_messages VALUES(?,0,?,?,?,?,?,?,?)').bind(id,'OUTBOUND','Owner','owner@example.invalid','[{"address":"shared@example.invalid"}]',id,'Stored content','2026-11-08').run();
  if(order)await f.DB.prepare('INSERT INTO mail_order_links VALUES(?,?,?,?)').bind(id,order,'shared@example.invalid','2026-11-08').run();
 }
 const before=f.DB.sql.prepare('SELECT total_changes() n').get().n;
 assert.deepEqual((await f.read('panel_messages',{channel:'email',wg:'WG-000001'})).items.map(m=>m.id),['first']);
 const all=await f.read('panel_messages',{channel:'email'});assert.deepEqual(all.items.map(m=>m.id).sort(),['first','second']);assert.ok(all.items.every(m=>m.wg&&m.association==='explicit-order'));
 assert.equal(f.DB.sql.prepare('SELECT total_changes() n').get().n,before);
});

test('pagination cursors bind filters, tool and grant and expose live consistency',async t=>{
 const f=await fixture(t);for(let i=1;i<=3;i++)await f.seed('00000'+i);
 const first=await f.read('panel_orders',{limit:1});assert.equal(typeof first.nextCursor,'string');assert.equal(first.pagination.snapshot,false);
 const second=await f.read('panel_orders',{limit:1,cursor:first.nextCursor});assert.notEqual(second.items[0].id,first.items[0].id);
 await assert.rejects(()=>f.read('panel_orders',{limit:1,q:'other',cursor:first.nextCursor}),/invalid_cursor/);
 await assert.rejects(()=>f.read('panel_bookings',{limit:1,cursor:first.nextCursor}),/invalid_cursor/);
 await assert.rejects(()=>mcpRead(f.env,'panel_orders',{limit:1,cursor:first.nextCursor},{...f.identity,id:'other-grant'}),/invalid_cursor/);
 await assert.rejects(()=>f.read('panel_orders',{limit:1,cursor:first.nextCursor+'x'}),/invalid_cursor/);
 await f.seed('000004');assert.match((await f.read('panel_orders',{limit:1,cursor:first.nextCursor})).pagination.warning,/changes|Änderungen/);
});

test('byte-limited pages resume after the last delivered item without omissions',async t=>{
 const f=await fixture(t);for(let i=1;i<=30;i++)await f.seed(String(i).padStart(6,'0'),{assessment:{lines:Array.from({length:50},()=>({title:'🚙'.repeat(150),amountCents:1}))}});
 const seen=[];let cursor;do{const p=await f.read('panel_orders',{limit:50,...(cursor?{cursor}:{})});assert.ok(Buffer.byteLength(JSON.stringify(p))<=60000);assert.ok(p.items.length>0);seen.push(...p.items.map(o=>o.id));cursor=p.nextCursor;}while(cursor);
 assert.equal(seen.length,30);assert.equal(new Set(seen).size,30);
});

test('refresh cannot mint tokens after the grant scope is changed',async t=>{
 const f=await oauthFixture(t),tokens=await (await f.exchange(await f.grant())).json();f.env.DB.sql.prepare("UPDATE mcp_grants SET scope='panel:write'").run();
 const before=f.env.DB.sql.prepare('SELECT count(*) n FROM mcp_tokens').get().n;
 const r=await f.call('/auth/mcp/token',{grant_type:'refresh_token',client_id:'test-client',resource:origin+'/mcp',refresh_token:tokens.refresh_token});assert.equal(r.status,400);assert.equal(f.env.DB.sql.prepare('SELECT count(*) n FROM mcp_tokens').get().n,before);
});

test('accounting and document metadata cannot bypass blocked orders through linked mail attachments',async t=>{
 const f=await fixture(t);await f.seed('000001',{recordsRestriction:{status:'blocked'}});await f.seed('000002');
 f.DB.sql.exec(`CREATE TABLE accounting_documents(id TEXT PRIMARY KEY,synthetic INTEGER,filename TEXT,mime TEXT,size INTEGER,received_at TEXT);
 CREATE TABLE accounting_classifications(id TEXT,document_id TEXT,version INTEGER,category TEXT,payment_path TEXT,amount_minor INTEGER,document_date TEXT,partner TEXT);
 CREATE TABLE mail_attachments(message_id TEXT,document_id TEXT);`);
 for(const [id,order] of [['blocked','000001'],['public','000002'],['unlinked',null]]){
  f.DB.sql.prepare('INSERT INTO accounting_documents VALUES(?,0,?,?,100,?)').run(id,id+'.pdf','application/pdf','2026-11-08');
  if(order){f.DB.sql.prepare('INSERT INTO mail_order_links VALUES(?,?,?,?)').run(id,order,'fixture@example.invalid','2026-11-08');f.DB.sql.prepare('INSERT INTO mail_attachments VALUES(?,?)').run(id,id);}
 }
 for(const name of ['panel_accounting','panel_documents'])assert.deepEqual((await f.read(name)).items.map(d=>d.id).sort(),['public','unlinked']);
});
