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
  assert.ok(await page.locator('.sidebar .nav').evaluate(nav=>[...nav.querySelectorAll('button,a')].every(el=>el.scrollWidth<=el.clientWidth)),'enlarged German navigation labels wrap inside their controls');
  const last=page.locator('.sidebar a[href="/vor-ort"]');await last.focus();
  const box=await last.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=600);assert.ok(await page.locator('.sidebar').evaluate(el=>el.scrollTop>0));assert.deepEqual(f.errors,[]);
});
