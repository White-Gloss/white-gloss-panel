import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {saveCustomer} from '../src/customers.mjs';
import {protect} from '../src/worker.mjs';

const origin='https://panel.example.invalid',email='customer@example.invalid',owner='owner@example.invalid';
async function fixture(t){
 const sent=[],env={DB:new PanelDatabase(':memory:'),PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,8).toString('base64'),ASSETS:{fetch:async()=>new Response('asset')},BUCKET:{get:async()=>null},MAILBOX_ADAPTERS:{sendMail:async(_config,message)=>{sent.push(message);return {accepted:[message.to],rejected:[],messageId:'synthetic'};}}};
 const app=await createApplication(env);t.after(()=>env.DB.close());
 const cookies={};for(const role of ['owner','customer']){const raw=randomBytes(32).toString('hex');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),role==='owner'?owner:email,Date.now()+3600000,Date.now()).run();cookies[role]='__Host-wg-session='+raw;}
 const call=(path,body,role='owner')=>app.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:cookies[role]??'','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
 const customer=await saveCustomer(env,{synthetic:false,customer:{name:'Synthetic customer',email}}),ids=[];
 for(let i=0;i<2;i++){const id=randomUUID(),at=new Date().toISOString(),data={id,wg:'WG-TEST-'+i,synthetic:false,status:'Preise prüfen',source:{name:'Synthetic customer',email,vehicle:'Test car'},notes:[],updatedAt:at};await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(id,data.wg,data.status,JSON.stringify(data),at,'test','fixture').run();await env.DB.prepare('INSERT INTO customer_orders(order_id,customer_id) VALUES(?,?)').bind(id,customer.id).run();ids.push(id);}
 return {env,app,call,customer,ids,sent};
}
test('central dossier is operator-only, read-only and separates two orders with the same email',async t=>{
 const f=await fixture(t),{env,ids}=f,thread=randomUUID(),at=new Date().toISOString();
 await env.DB.prepare('INSERT INTO chat_threads(id,order_id,created_at,last_at) VALUES(?,?,?,?)').bind(thread,ids[0],at,at).run();
 for(let i=0;i<2;i++)await env.DB.prepare("INSERT INTO chat_messages(thread_id,sender,body,client_id,created_at) VALUES(?,'customer',?,?,?)").bind(thread,'Synthetic chat '+i,randomUUID(),at).run();
 await env.DB.prepare("INSERT INTO portal_requests(id,order_id,kind,data,created_at) VALUES(?,?,'termin','{}',?)").bind(randomUUID(),ids[1],at).run();
 await env.DB.prepare('INSERT INTO mail_notes(id,synthetic,body,order_id,created_at,updated_at) VALUES(?,0,?,?,?,?)').bind(randomUUID(),'PRIVATE NOTE',ids[0],at,at).run();
 const before=await env.DB.prepare('SELECT count(*) n FROM audit').first();
 for(let i=0;i<2;i++){
  const response=await f.call('/api/customer-record/'+f.customer.id);assert.equal(response.status,200,await response.clone().text());const d=await response.json();assert.equal(d.record.orders.length,2);assert.equal(d.record.messages.length,2);assert.equal(d.record.tasks.filter(x=>x.id.startsWith('unread:')).length,1);assert.equal(d.record.tasks.filter(x=>x.label==='Termin passt nicht').length,1);assert.ok(d.record.messages.every(m=>m.orderId===ids[0]));assert.ok(!JSON.stringify(d.record.messages).includes('PRIVATE NOTE'));assert.equal(d.record.notes[0].body,'PRIVATE NOTE');
 }
 assert.equal((await env.DB.prepare('SELECT owner_read_id FROM chat_threads').first()).owner_read_id,0);assert.deepEqual(await env.DB.prepare('SELECT count(*) n FROM audit').first(),before);assert.equal(f.sent.length,0);
 assert.equal((await f.call('/api/customer-record/'+f.customer.id,undefined,'customer')).status,403);assert.equal((await f.call('/api/customer-record/'+f.customer.id,undefined,'anonymous')).status,401);assert.equal((await f.call('/api/customer-record/'+f.customer.id,{})).status,405);
});
test('manual customer creation and reading existing customers never queue automatic invitations',async t=>{
 const f=await fixture(t);assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM auth_customer_invites').first()).n,0);
 await f.env.DB.prepare('DELETE FROM auth_customer_invites').run();await f.call('/api/customer-record/'+f.customer.id);assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM auth_customer_invites').first()).n,0);
});

test('reading dashboard and customer search never creates customers or links legacy orders',async t=>{
 const f=await fixture(t),id=randomUUID(),at=new Date().toISOString();
 const order={id,wg:'WG-LEGACY',status:'Preise prüfen',source:{name:'Legacy fixture',email:'legacy@example.invalid',vehicle:'Legacy car'},notes:[]};
 await f.env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(id,order.wg,order.status,JSON.stringify(order),at,'test','fixture').run();
 const snapshot=async()=>Promise.all(['customers','vehicles','customer_orders','auth_customer_invites'].map(async table=>(await f.env.DB.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results));
 const before=await snapshot();
 for(const path of ['/api/state','/api/customers','/api/customers?q=Legacy']){
  const response=await f.call(path);assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(await snapshot(),before,path+' must not backfill business data');
 }
 assert.equal((await (await f.call('/api/order/'+id)).json()).wg,'WG-LEGACY');
 assert.equal(f.sent.length,0);
});
test('explicit SMTP links only the selected order, saves draft attribution and refuses a different recipient',async t=>{
 const f=await fixture(t),at=new Date().toISOString();
 await f.env.DB.prepare('INSERT INTO mailbox_accounts(id,email,display_name,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password,smtp_verified_at,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?)').bind(owner,'Synthetic','imap.example.invalid',993,1,'smtp.example.invalid',465,1,owner,await protect(f.env,'synthetic-password'),at,at).run();
 const input={requestId:randomUUID(),orderId:f.ids[1],to:email,subject:'Synthetic order reply',text:'Only a fixture',confirmed:true};
 const rejected=await f.call('/api/mailbox/send',{...input,to:'foreign@example.invalid'});assert.equal(rejected.status,409);assert.equal(f.sent.length,0);
 const draft=await f.call('/api/mailbox/draft',input);assert.equal(draft.status,200,await draft.clone().text());const drafts=await f.env.DB.prepare('SELECT order_id FROM mail_drafts').all();assert.equal(drafts.results[0].order_id,f.ids[1]);
 const accepted=await f.call('/api/mailbox/send',input);assert.equal(accepted.status,200,await accepted.clone().text());await f.call('/api/mailbox/send',input);assert.equal(f.sent.length,1);
 const record=await (await f.call('/api/customer-record/'+f.customer.id)).json();assert.equal(record.record.messages.filter(m=>m.channel==='E-Mail').length,1);assert.equal(record.record.messages[0].orderId,f.ids[1]);assert.equal(record.record.messages[0].status,'Vom Anbieter angenommen');
 const old=JSON.parse((await f.env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(f.ids[1]).first()).data);old.recordsRestriction={status:'blocked'};await f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(old),f.ids[1]).run();assert.equal((await f.call('/api/mailbox/send',{...input,requestId:randomUUID()})).status,409);assert.equal(f.sent.length,1);
});
