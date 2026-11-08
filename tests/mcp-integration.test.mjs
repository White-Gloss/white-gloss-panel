import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {fixture,origin} from './mcp-fixture.mjs';

test('real application routes OAuth before session gate and all read tools use existing schemas',async t=>{
 const f=await fixture(t);Object.assign(f.env,{BUCKET:{get:async()=>{throw Error('unexpected file access');}},ASSETS:{fetch:async()=>new Response('asset')}});
 const app=await createApplication(f.env);
 assert.equal((await app.fetch(new Request(origin+'/mcp'))).status,401);
 const token=await (await f.exchange(await f.grant())).json();
 const rpc=async(name,args={})=>{
  const r=await app.fetch(new Request(origin+'/mcp',{method:'POST',headers:{authorization:'Bearer '+token.access_token,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));
  assert.equal(r.status,200);const value=await r.json();assert.equal(value.result?.isError,false,JSON.stringify(value));return value.result.structuredContent;
 };
 for(const name of ['panel_profile','panel_dashboard','panel_bookings','panel_orders','panel_customers','panel_vehicles','panel_appointments','panel_messages','panel_documents','panel_media','panel_invoices','panel_accounting'])await rpc(name,name==='panel_media'?{wg:'WG-000001'}:{});
 await rpc('panel_messages',{channel:'email'});
 const source={name:'Synthetic Fixture',email:'fixture@example.test'},order={source,offer:{totalCents:12300},invoice:{totalCents:12300,status:'unpaid'},payments:[{amountCents:2300}]};
 await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind('fixture-order','WG-000001','Erledigt',JSON.stringify(order),'2026-11-08','test','seed').run();
 await f.env.DB.prepare("INSERT INTO customers(id,data,search,created_at,updated_at) VALUES('c',?,'fixture','2026-11-08','2026-11-08')").bind(JSON.stringify({name:'Fixture',email:'fixture@example.test'})).run();
 await f.env.DB.prepare("INSERT INTO vehicles(id,customer_id,data,search,created_at,updated_at) VALUES('v','c',?,'car','2026-11-08','2026-11-08')").bind(JSON.stringify({label:'Car',plate:'TEST'})).run();
 await f.env.DB.prepare("INSERT INTO accounting_documents VALUES('doc',0,'fixture.pdf','application/pdf','hash',100,'2026-11-08','PANEL')").run();
 for(const [id,to] of [['mail-object',JSON.stringify([{address:'fixture@example.test'}])],['mail-string',JSON.stringify(['fixture@example.test'])]])await f.env.DB.prepare("INSERT INTO mail_messages(id,dedupe_key,synthetic,direction,folder,from_name,from_address,to_json,subject,text_body,received_at,imported_at) VALUES(?,?,0,'OUTBOUND','SENT','Owner','owner@example.test',?,'Fixture','Stored message','2026-11-08','2026-11-08')").bind(id,id,to).run();
 const businessTables=['orders','audit','customers','vehicles','mail_messages','mail_message_state','jobs','accounting_documents','accounting_classifications'];
 const snapshot=()=>JSON.stringify(businessTables.map(table=>[table,f.env.DB.sql.prepare('SELECT * FROM '+table).all()]));
 const before=snapshot();
 assert.equal((await rpc('panel_invoices')).items[0].outstandingCents,10000);
 assert.equal((await rpc('panel_customers')).items[0].name,'Fixture');assert.equal((await rpc('panel_vehicles')).items[0].plate,'TEST');
 assert.ok((await rpc('panel_accounting')).items[0].missing.includes('classification'));
 assert.equal((await rpc('panel_messages',{channel:'email',wg:'WG-000001'})).items.length,2);
 assert.equal(snapshot(),before,'MCP reads must not change business records, read markers, or send jobs');
 // Existing owner session alone never authorizes the MCP resource.
 const cookie='a'.repeat(64);await f.env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(cookie),'owner@example.test',Date.now()+3600000,Date.now()).run();
 assert.equal((await app.fetch(new Request(origin+'/mcp',{headers:{cookie:'__Host-wg-session='+cookie}}))).status,401);
 const health=await app.fetch(new Request(origin+'/healthz'));assert.equal(await health.text(),'ok');
});
