import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './mcp-fixture.mjs';
import {SCHEMA} from '../src/schema.mjs';
import {normalizeSource} from '../src/domain.mjs';
import {normalizeAssessment} from '../src/assessment.mjs';
async function setup(t){
 const f=await fixture(t);await f.env.DB.batch(SCHEMA.map(sql=>f.env.DB.prepare(sql)));
 const token=await (await f.exchange(await f.grant())).json();
 const rpc=(method,params={},id=7)=>f.call('/mcp',JSON.stringify({jsonrpc:'2.0',id,method,params}),{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:'Bearer '+token.access_token,'mcp-protocol-version':'2025-06-18'});
 const seed=async(id,data,synthetic=0)=>f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,?)').bind(id,'WG-'+id,data.status??'Preise prüfen',JSON.stringify(data),'2026-11-08T12:00:00Z','test','seed',synthetic).run();
 return {...f,rpc,seed,token};
}
test('MCP negotiates version, lists read-only tools and rejects unknown/write requests',async t=>{
 const f=await setup(t),init=await (await f.rpc('initialize',{protocolVersion:'2099-01-01'})).json();assert.equal(init.id,7);assert.equal(init.result.protocolVersion,'2025-06-18');
 const list=await (await f.rpc('tools/list')).json();assert.equal(list.result.tools.length,12);
 for(const tool of list.result.tools){assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['panel:read']}]);}
 assert.equal((await (await f.rpc('orders/delete')).json()).error.code,-32601);
 assert.equal((await (await f.rpc('tools/call',{name:'panel_delete',arguments:{}})).json()).error.code,-32602);
 assert.equal((await (await f.rpc('tools/call',{name:'panel_orders',arguments:{sql:'DELETE FROM orders'}})).json()).error.code,-32602);
 assert.equal((await (await f.rpc('tools/call',{name:'panel_orders',arguments:{constructor:'unexpected'}})).json()).error.code,-32602);
});
test('profile contains identity only; orders isolate wishes, proposals, confirmed appointments and secrets',async t=>{
 const f=await setup(t);await f.seed('000050',{source:{name:'Fixture',email:'fixture@example.test',vehicle:'Car',requestedDate:'2026-11-09',requestedTimeWindow:'Vormittags'},appointment:{start:'2026-11-09T09:00:00Z',end:'2026-11-09T10:00:00Z',duration:60},appointmentOptions:[{start:'2026-11-10T09:00:00Z'}],offer:{token:'never-leak',totalCents:20000},acceptance:{signature:'private-signature'},remoteHandover:{location:'secret-key-location'},assessment:{totalCents:10000}});
 await f.seed('000051',{source:{name:'Hidden'},trash:{deletedAt:'2026-11-01'}});await f.seed('000052',{source:{name:'Test area'}},1);
 const before=f.env.DB.sql.prepare('SELECT total_changes() n').get().n;
 const profile=await (await f.rpc('tools/call',{name:'panel_profile',arguments:{}})).json();assert.equal(profile.result.structuredContent.role,'owner');assert.ok(!JSON.stringify(profile).includes('Fixture'));
 const response=await f.rpc('tools/call',{name:'panel_orders',arguments:{wg:'WG-000050'}}),body=await response.json();const order=body.result.structuredContent.items[0];assert.equal(order.wg,'WG-000050');assert.equal(order.appointment,null);assert.equal(order.appointmentProposal.start,'2026-11-09T09:00:00Z');assert.equal(order.requestedDate,'2026-11-09');
 assert.doesNotMatch(JSON.stringify(body),/never-leak|private-signature|secret-key-location|Hidden|Test area/);
 const calendar=await (await f.rpc('tools/call',{name:'panel_appointments',arguments:{date:'2026-11-09'}})).json();assert.equal(calendar.result.structuredContent.items.length,0);
 const all=await (await f.rpc('tools/call',{name:'panel_orders',arguments:{}})).json();assert.equal(all.result.structuredContent.items.length,1);
 // Technical auth/rate rows may change, business records and audit may not.
 assert.ok(f.env.DB.sql.prepare('SELECT total_changes() n').get().n>=before);assert.equal(f.env.DB.sql.prepare('SELECT count(*) n FROM audit').get().n,3);
});
test('calendar uses confirmed appointments and Berlin day boundaries, pagination is explicit',async t=>{
 const f=await setup(t);
 for(let i=0;i<3;i++)await f.seed('10000'+i,{status:'Termin verbindlich',source:{name:'Fixture'},appointment:{start:'2026-11-08T23:30:00Z',end:'2026-11-09T01:00:00Z',duration:90,confirmation:{at:'2026-11-01'}}});
 const page=await (await f.rpc('tools/call',{name:'panel_appointments',arguments:{date:'2026-11-09',limit:2}})).json();assert.equal(page.result.structuredContent.items.length,2);assert.equal(page.result.structuredContent.nextOffset,2);
 const second=await (await f.rpc('tools/call',{name:'panel_appointments',arguments:{date:'2026-11-09',limit:2,offset:2}})).json();assert.equal(second.result.structuredContent.items.length,1);
 assert.equal((await (await f.rpc('tools/call',{name:'panel_appointments',arguments:{date:'2026-02-30'}})).json()).error.code,-32602);
});
test('transport enforces media types, origins, batch limits and notification semantics',async t=>{
 const f=await setup(t),headers={authorization:'Bearer '+f.token.access_token};
 assert.equal((await f.call('/mcp',null,headers)).status,405);
 assert.equal((await f.call('/mcp','{}',headers)).status,415);
 assert.equal((await f.call('/mcp','{',{'content-type':'application/json',accept:'application/json, text/event-stream',...headers})).status,400);
 const batch=await f.call('/mcp','[]',{'content-type':'application/json',accept:'application/json, text/event-stream',...headers});assert.equal(batch.status,400);
 const note=await f.call('/mcp',JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}),{'content-type':'application/json',accept:'application/json, text/event-stream',...headers});assert.equal(note.status,202);
 assert.equal((await f.call('/mcp','{}',{'content-type':'application/json',origin:'https://evil.example',...headers})).status,403);
});
test('actual normalized production fields retain customer wishes and priced services',async t=>{
 const f=await setup(t);
 const source=normalizeSource({id:'fixture',name:'Fixture',email:'fixture@example.test',vehicle:'Car',desiredDate:'2026-11-09',timeWindow:'Vormittags'});
 const assessment=normalizeAssessment({lines:[{id:'polish',kind:'custom',title:'Politur',amountCents:12000}],pricesReviewed:true});
 await f.seed('000099',{source,assessment});
 const result=await (await f.rpc('tools/call',{name:'panel_orders',arguments:{wg:'WG-000099'}})).json(),order=result.result.structuredContent.items[0];
 assert.equal(order.requestedDate,'2026-11-09');assert.equal(order.requestedTimeWindow,'Vormittags');assert.equal(order.services[0].name,'Politur');assert.equal(order.services[0].totalCents,12000);
});
test('provider-paid invoices do not become open debt when local payment entries are absent',async t=>{
 const f=await setup(t);await f.seed('000088',{invoice:{status:'paid',totalCents:20000},payments:[]});
 const result=await (await f.rpc('tools/call',{name:'panel_invoices',arguments:{}})).json();assert.equal(result.result.structuredContent.items[0].outstandingCents,0);
});
test('open customer requests remain distinguishable from completed requests',async t=>{
 const f=await setup(t);await f.seed('000077',{source:{name:'Fixture'}});
 f.env.DB.sql.exec("CREATE TABLE portal_requests(id TEXT,order_id TEXT,kind TEXT,data TEXT,status TEXT,created_at TEXT); CREATE TABLE portal_change_requests(id TEXT,order_id TEXT,data TEXT,status TEXT,created_at TEXT)");
 await f.env.DB.prepare('INSERT INTO portal_requests VALUES(?,?,?,?,?,?)').bind('open','000077','termin',JSON.stringify({wish:'Please reschedule'}),'offen','2026-11-08').run();
 await f.env.DB.prepare('INSERT INTO portal_requests VALUES(?,?,?,?,?,?)').bind('done','000077','termin',JSON.stringify({wish:'Already handled'}),'erledigt','2026-11-08').run();
 const result=await (await f.rpc('tools/call',{name:'panel_messages',arguments:{channel:'requests'}})).json();
 assert.equal(result.result?.isError,false);assert.equal(result.result.structuredContent.items.length,1);assert.equal(result.result.structuredContent.items[0].wish,'Please reschedule');
});

test('extras requests retain bounded services and note without presenting them as booked',async t=>{
 const f=await setup(t);await f.seed('000078',{source:{name:'Fixture'}});
 f.env.DB.sql.exec("CREATE TABLE portal_requests(id TEXT,order_id TEXT,kind TEXT,data TEXT,status TEXT,created_at TEXT); CREATE TABLE portal_change_requests(id TEXT,order_id TEXT,data TEXT,status TEXT,created_at TEXT)");
 const extras=Array.from({length:25},(_,i)=>({id:String(i),name:'Requested polish '+i,priceCents:2500,inspect:true}));
 await f.env.DB.prepare('INSERT INTO portal_requests VALUES(?,?,?,?,?,?)').bind('extras','000078','extras',JSON.stringify({extras,note:'Please check paint',privateField:'never-return'}),'offen','2026-11-08').run();
 const response=await (await f.rpc('tools/call',{name:'panel_messages',arguments:{channel:'requests'}})).json();
 const item=response.result.structuredContent.items[0];assert.equal(item.note,'Please check paint');assert.equal(item.extras.length,20);assert.equal(item.extras[0].name,'Requested polish 0');assert.equal(item.extras[0].priceCents,2500);assert.equal(item.status,'offen');assert.equal(response.result.structuredContent.requestedOnly,true);assert.doesNotMatch(JSON.stringify(response),/never-return/);
});
