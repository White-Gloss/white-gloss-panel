// Genuine Linux CI only. Layout and interaction checks of the Communication Center against an
// isolated in-process application. No listener, real mailbox, provider or external image request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserFixture,origin,customer,owner} from './harness.mjs';
import {ingestMessage} from '../server/mailbox.mjs';

const viewports=[{width:1600,height:900},{width:1280,height:800},{width:900,height:900},{width:390,height:844}];
const plain=subject=>Buffer.from(`From: Erika Muster <${customer}>\r\nTo: ${owner}\r\nCc: partner@example.invalid\r\nSubject: ${subject}\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGuten Tag, wann passt der Termin für die Politur?`);
const html=Buffer.from(`From: Newsletter <news@example.invalid>\r\nTo: ${owner}\r\nSubject: Sommeraktion Newsletter\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Fri, 16 Oct 2026 08:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><head><style>.hero{padding:24px;background:#eef3f7;font-size:22px}</style></head><body><div class="hero">Sommeraktion</div><img src="https://tracker.example.invalid/pixel.gif" width="1" height="1"><p>Ein langer Absatz mit Inhalt.</p><a href="https://shop.example.invalid/">Zum Shop</a><script>document.body.dataset.executed='yes'</script></body></html>\r\n`);
async function noOverflow(page,label){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' has no horizontal overflow');}
async function openRail(page,width){if(width<1400&&!(await page.locator('.cc').evaluate(element=>element.classList.contains('cc-rail-open'))))await page.locator('[data-cc-rail]').click();}

for(const viewport of viewports)test(`communication center layout and mail workflow at ${viewport.width}x${viewport.height}`,async t=>{
  const f=await browserFixture(t,{viewport}),{page}=f,tag=viewport.width+'x'+viewport.height;
  await f.seedOrder({status:'In Arbeit'});
  await ingestMessage(f.env,plain('Frage zur Politur'),{folder:'INBOX',uid:1,uidValidity:'browser'});
  await ingestMessage(f.env,html,{folder:'INBOX',uid:2,uidValidity:'browser'});
  await page.goto(origin+'/#mailbox');await page.locator('.cc-head h1').waitFor();await page.locator('.cc-kpi').first().waitFor();
  assert.equal((await page.locator('.cc-head h1').textContent()).trim(),'Übersicht');await noOverflow(page,'start view');await f.screenshot('communication-home-'+tag,{fullPage:false});

  await openRail(page,viewport.width);await page.locator('.cc-rail [data-mail-folder="INBOX"]').click();await page.locator('.cc-row[data-mail-open]').nth(1).waitFor();
  assert.equal(await page.locator('.cc-row.unread').count(),2);await noOverflow(page,'inbox');

  await page.locator('.cc-row',{hasText:'Sommeraktion'}).click();const frame=page.frameLocator('[data-mail-frame]');await frame.locator('.hero').waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-executed'),null,'scripts in mail never run');
  assert.ok(await page.locator('.cc-images-blocked').isVisible(),'blocked external images are announced');
  assert.equal(await frame.locator('.hero').evaluate(element=>getComputedStyle(element).fontSize),'22px','mail styles render inside the sandbox');
  await page.waitForFunction(()=>document.querySelector('[data-mail-frame]').getBoundingClientRect().height>=180);
  if(viewport.width<1000){assert.equal(await page.locator('.cc-list').isVisible(),false,'single column shows the reader only');}
  await noOverflow(page,'reader');await f.screenshot('communication-reader-'+tag,{fullPage:false});
  if(viewport.width<1000){await page.locator('.cc-back').click();await page.locator('.cc-list').waitFor({state:'visible'});}

  await page.locator('.cc-row',{hasText:'Frage zur Politur'}).click();await page.locator('.cc-crm').waitFor();assert.match(await page.locator('.cc-crm').textContent(),/In Arbeit/);
  await page.locator('[data-mail-reply-all]').click();const compose=page.locator('#mailbox-compose');await compose.waitFor();
  assert.equal(await compose.locator('[name="cc"]').inputValue(),'partner@example.invalid');
  const box=await compose.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,'editor fits the viewport');
  await compose.locator('[data-compose-editor]').click();await page.keyboard.type('Gerne am Freitag.');await f.screenshot('communication-compose-'+tag,{fullPage:false});
  await page.locator('[data-mail-compose-close]').click();await page.locator('[data-compose-discard]').click();await compose.waitFor({state:'detached'});

  for(const section of ['orders','calendar']){await openRail(page,viewport.width);await page.locator(`.cc-rail [data-cc-section="${section}"]`).click();await page.locator(section==='orders'?'.cc-order-card':'.cc-day').first().waitFor();await noOverflow(page,section);}
  await f.screenshot('communication-calendar-'+tag,{fullPage:false});
  await openRail(page,viewport.width);await page.locator('.cc-rail [data-mail-notes]').click();await page.locator('#cc-note-body').fill('Rückruf vor Terminbestätigung');await page.locator('#mail-note-form [type="submit"]').click();await page.locator('.cc-note',{hasText:'Rückruf'}).waitFor();await noOverflow(page,'notes');
  assert.ok(!f.requests.some(item=>item.path.startsWith('/pixel')),'tracking pixel was never requested');assert.deepEqual(f.errors,[]);
});
