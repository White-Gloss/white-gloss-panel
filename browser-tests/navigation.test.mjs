import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin} from './harness.mjs';

for(const viewport of [{width:1366,height:600},{width:1024,height:360}])test(`desktop menu scrolls by wheel and every destination remains reachable at ${viewport.width}x${viewport.height}`,async t=>{
  const f=await browserFixture(t,{viewport}),{page}=f;await page.goto(origin);await page.locator('h1').waitFor();
  const sidebar=page.locator('.sidebar');
  assert.equal(await sidebar.evaluate(el=>getComputedStyle(el).overflowY),'auto');
  assert.ok(await sidebar.evaluate(el=>el.scrollHeight>el.clientHeight),'short viewport reproduces overflowing navigation');
  await sidebar.hover();await page.mouse.wheel(0,1800);
  await page.waitForFunction(()=>document.querySelector('.sidebar').scrollTop>0);
  const end=await sidebar.locator('a[href="/vor-ort"]').boundingBox();assert.ok(end.y>=0&&end.y+end.height<=viewport.height,'last entry is inside the visible viewport after scrolling');
  const destinations=await sidebar.locator('[data-view]').evaluateAll(els=>els.map(el=>({id:el.dataset.view,label:el.textContent.trim()})));
  for(const item of destinations){await sidebar.locator(`[data-view="${item.id}"]`).click();await page.waitForFunction(id=>document.querySelector('.sidebar [aria-current="page"]')?.dataset.view===id,item.id);const heading=item.id==='chat'?page.locator('.inbox-list-head h2'):page.locator('#content h1');assert.ok((await heading.textContent()).length>0,item.label+' renders');}
  await f.screenshot('operator-menu-'+viewport.width+'x'+viewport.height,{fullPage:false});assert.deepEqual(f.errors,[]);
});

for(const viewport of [{width:390,height:600},{width:320,height:480},{width:740,height:360}])test(`mobile menu scrolls, closes by keyboard and restores focus at ${viewport.width}x${viewport.height}`,async t=>{
  const f=await browserFixture(t,{viewport}),{page}=f;await page.goto(origin);await page.locator('h1').waitFor();
  const opener=page.locator('.mobile-dock [data-click="menu"]');await opener.click();
  const sidebar=page.locator('.sidebar.open');await sidebar.waitFor({state:'visible'});await sidebar.hover();await page.mouse.wheel(0,1800);await page.waitForFunction(()=>document.querySelector('.sidebar').scrollTop>0);
  const last=sidebar.locator('a[href="/vor-ort"]');await last.scrollIntoViewIfNeeded();const box=await last.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
  await f.screenshot('operator-menu-mobile-'+viewport.width+'x'+viewport.height,{fullPage:false});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.sidebar.open').count(),0);assert.equal(await opener.getAttribute('aria-expanded'),'false');assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
  await opener.click();await sidebar.locator('[data-view="settings"]').click();assert.equal(await page.locator('.sidebar.open').count(),0);assert.match(await page.locator('h1').textContent(),/Einstellungen/);assert.deepEqual(f.errors,[]);
});

test('desktop menu still scrolls with enlarged text and its final link can receive keyboard focus',async t=>{
  const f=await browserFixture(t,{viewport:{width:1280,height:600}}),{page}=f;await page.goto(origin);await page.locator('h1').waitFor();
  await page.route(origin+'/text-scaling.css',route=>route.fulfill({contentType:'text/css',body:'.sidebar{font-size:200%}.sidebar .nav button,.sidebar .navlink{font-size:26px;line-height:1.5}'}));
  await page.addStyleTag({url:origin+'/text-scaling.css'});
  assert.equal(await page.locator('.sidebar .nav button').first().evaluate(el=>getComputedStyle(el).fontSize),'26px');
  assert.ok(await page.locator('.sidebar .nav').evaluateAll(navs=>navs.every(nav=>[...nav.querySelectorAll('button,a')].every(el=>el.scrollWidth<=el.clientWidth))),'enlarged German navigation labels wrap inside their controls');
  const last=page.locator('.sidebar a[href="/vor-ort"]');await last.focus();
  const box=await last.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=600);assert.ok(await page.locator('.sidebar').evaluate(el=>el.scrollTop>0));assert.deepEqual(f.errors,[]);
});

for(const width of [1440,1024,805,390,320])test(`compact operator workspace remains usable without page overflow at ${width}px`,async t=>{
  const f=await browserFixture(t,{viewport:{width,height:900}}),{page}=f;await page.goto(origin);await page.locator('.overview-shell').waitFor();
  assert.equal(await page.locator('.overview-orders').count(),1);assert.equal(await page.locator('.operations-panel').count(),1);assert.equal(await page.locator('.premium-hero,.premium-modules,.integration-grid').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
  const skipLink=await page.locator('.visually-hidden').boundingBox();assert.ok(skipLink.width<=1&&skipLink.height<=1,'keyboard skip link stays visually hidden until focused');
  const topbar=await page.locator('.topbar').boundingBox();assert.ok(topbar.height<=(width<=760?65:69),'compact application header');
  const search=await page.locator('#search').boundingBox();assert.ok(search.x>=0&&search.x+search.width<=width,'global search stays inside the viewport');
  await page.evaluate(()=>{location.hash='#system';});await page.locator('.system-page').waitFor();
  await page.evaluate(()=>{location.hash='#overview';});await page.locator('.overview-shell').waitFor();assert.equal(await page.locator('.sidebar [data-view="overview"]').getAttribute('aria-current'),'page');
  await f.screenshot('operator-workspace-'+width,{fullPage:true});assert.deepEqual(f.errors,[]);
});

for(const width of [1440,390,320])test(`calendar workspace stays precise and usable at ${width}px`,async t=>{
  const f=await browserFixture(t,{viewport:{width,height:900}}),{page}=f,today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  await f.seedOrder({status:'Termin verbindlich',appointment:{start:today+'T10:00:00.000Z',end:today+'T13:00:00.000Z',duration:180,delivery:'Kunde bringt',location:'Teststraße 1, Horb',confirmation:{at:new Date().toISOString(),mode:'Test'}}});
  await page.goto(origin+'/#calendar');await page.locator('.schedule-event[data-order]').waitFor();
  assert.equal(await page.locator('.schedule-grid .schedule-cell').count(),42);assert.equal(await page.locator(`.schedule-date[data-day="${today}"]`).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.schedule-day .schedule-detail[data-order]').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'calendar causes no horizontal page overflow');
  await f.screenshot('operator-calendar-'+width,{fullPage:true});
  const month=await page.locator('#schedule-month-title').textContent();await page.locator('[data-click="nextMonth"]').click();assert.notEqual(await page.locator('#schedule-month-title').textContent(),month);await page.locator('[data-click="today"]').click();assert.equal(await page.locator('#schedule-month-title').textContent(),month);
  assert.deepEqual(f.errors,[]);
});

for(const width of [1440,390])test(`on-site booking presents all scheduling modes without layout overflow at ${width}px`,async t=>{
  const f=await browserFixture(t,{viewport:{width,height:900}}),{page}=f;await page.goto(origin+'/vor-ort#buchung');
  await page.locator('#c-new [name="name"]').fill('Layout Test');await page.locator('#c-new [type="submit"]').click();await page.locator('#v-new').waitFor();await page.locator('#v-new [type="submit"]').click();await page.locator('#s-form').waitFor();await page.locator('#s-form [type="submit"]').click();await page.locator('#a-form').waitFor();
  assert.equal(await page.locator('.vo-booking-steps li').count(),4);assert.equal(await page.locator('[name="bookingMode"]').count(),3);
  await page.locator('[name="bookingMode"][value="planned"]').check();await page.locator('[name="appointmentStart"]').fill('2030-06-15T10:30');await page.locator('[name="appointmentDuration"]').fill('240');
  assert.equal(await page.locator('[data-onsite-appointment-start]').getAttribute('datetime'),'2030-06-15T08:30:00.000Z');assert.match(await page.locator('[data-onsite-appointment-duration]').textContent(),/240 Minuten/);
  await page.locator('[name="bookingMode"][value="later"]').check();assert.equal(await page.locator('[data-schedule-editor]').isVisible(),false);assert.match(await page.locator('[data-onsite-appointment-review]').textContent(),/Noch kein verbindlicher Termin/);
  await page.locator('[name="bookingMode"][value="planned"]').check();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'booking causes no horizontal page overflow');
  await f.screenshot('onsite-booking-'+width,{fullPage:true});assert.deepEqual(f.errors,[]);
});
