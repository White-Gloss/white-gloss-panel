import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserFixture,origin,customer} from './harness.mjs';
import {saveCustomer} from '../src/customers.mjs';

for(const width of [320,390,768,1440])for(const colorScheme of ['dark','light'])test(`UX005 customer dossier ${width} ${colorScheme}`,async t=>{
 const f=await browserFixture(t,{viewport:{width,height:900},colorScheme}),{env,page}=f;
 const c=await saveCustomer(env,{customer:{name:'Erika Muster',email:customer,phone:'000000000'}}),a=await f.seedOrder(),b=await f.seedOrder();
 for(const o of [a,b])await env.DB.prepare('INSERT INTO customer_orders(order_id,customer_id) VALUES(?,?)').bind(o.id,c.id).run();
 const at=new Date().toISOString(),thread=randomUUID();await env.DB.prepare('INSERT INTO chat_threads(id,order_id,created_at,last_at) VALUES(?,?,?,?)').bind(thread,a.id,at,at).run();
 await env.DB.prepare("INSERT INTO chat_messages(thread_id,sender,body,client_id,created_at) VALUES(?,'customer','Passt auch ein anderer Termin?',?,?)").bind(thread,randomUUID(),at).run();
 await env.DB.prepare("INSERT INTO portal_requests(id,order_id,kind,data,created_at) VALUES(?,?,'termin','{}',?)").bind(randomUUID(),a.id,at).run();
 await page.goto(origin+'/#customers');await page.locator(`[data-customer="${c.id}"]`).first().click();await page.getByRole('region',{name:'Zentrale Kundenakte',exact:true}).waitFor();
 assert.equal(await page.locator('.record-order').count(),2);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.ok(await page.locator('#modal').evaluate(el=>el.scrollWidth<=el.clientWidth),'no modal overflow');await f.screenshot(`UX005-${width}-${colorScheme}-dossier`);
 const select=page.locator('[data-record-filter]');await select.scrollIntoViewIfNeeded();await select.selectOption(b.id);assert.equal(await page.locator('[data-record-message]:visible').count(),0);await select.selectOption(a.id);assert.equal(await page.locator('[data-record-message]:visible').count(),1);await f.screenshot(`UX005-${width}-${colorScheme}-communications`);
 assert.equal((await env.DB.prepare('SELECT owner_read_id FROM chat_threads').first()).owner_read_id,0);assert.deepEqual(f.errors,[]);
});
