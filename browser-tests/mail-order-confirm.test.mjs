import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin,owner,customer} from './harness.mjs';
import {protect} from '../src/worker.mjs';

for(const width of [390,1440])for(const colorScheme of ['dark','light'])test(`UX005 explicit mail confirmation ${width} ${colorScheme}`,async t=>{
 const f=await browserFixture(t,{viewport:{width,height:900},colorScheme}),{page,env}=f,o=await f.seedOrder(),at=new Date().toISOString(),sent=[];
 env.MAILBOX_ADAPTERS={sendMail:async(_config,message)=>{sent.push(message);return {accepted:[message.to],rejected:[],messageId:'synthetic'};}};
 await env.DB.prepare('INSERT INTO mailbox_accounts(id,email,display_name,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password,smtp_verified_at,updated_at) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?)').bind(owner,'Synthetic','imap.example.invalid',993,1,'smtp.example.invalid',465,1,owner,await protect(env,'synthetic-password'),at,at).run();
 await page.goto(origin+'/#mailbox');await page.locator('.cc-kpi').first().waitFor();
 if(!await page.locator('[data-mail-compose]').isVisible())await page.locator('[data-cc-rail]').click();await page.locator('[data-mail-compose]').click();
 await page.locator('#mailbox-compose [name=to]').fill(customer);await page.locator('#mailbox-compose [name=orderId]').selectOption(o.id);await page.locator('#mailbox-compose [name=subject]').fill('Synthetic appointment reply');await page.locator('[data-compose-editor]').fill('This is a synthetic fixture.');
 await page.locator('#mailbox-compose button[type=submit]').click();const confirmation=page.getByRole('alertdialog',{name:'Versand bestätigen'});await confirmation.waitFor();
 const preview=await confirmation.textContent();assert.ok(preview.includes(customer)&&preview.includes(o.wg)&&preview.includes('Erika Muster')&&preview.includes('E-Mail')&&preview.includes('Anhänge: Keine'));assert.equal(sent.length,0);await f.screenshot(`UX005-mail-${width}-${colorScheme}-confirm`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#mailbox-compose [name=subject]').fill('Changed synthetic subject');await page.locator('[data-compose-send-confirmed]').click();await page.locator('[data-mailbox-message]').filter({hasText:'Die Nachricht wurde geändert'}).waitFor();assert.equal(sent.length,0);assert.ok((await confirmation.textContent()).includes('Changed synthetic subject'));
 await page.locator('[data-compose-send-confirmed]').click();await page.locator('#mailbox-compose').waitFor({state:'detached'});assert.equal(sent.length,1);assert.equal(sent[0].subject,'Changed synthetic subject');assert.equal((await env.DB.prepare('SELECT order_id FROM mail_order_links').first()).order_id,o.id);assert.deepEqual(f.errors,[]);
});
