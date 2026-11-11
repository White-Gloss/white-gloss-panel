import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin} from './harness.mjs';

async function openGroup(sidebar,index){const button=sidebar.locator(`[data-nav-group="${index}"]`);if(await button.getAttribute('aria-expanded')!=='true')await button.click();}

for(const viewport of [{width:1366,height:600},{width:1024,height:360}])test(`desktop menu scrolls by wheel and every destination remains reachable at ${viewport.width}x${viewport.height}`,async t=>{
  const f=await browserFixture(t,{viewport}),{page}=f;await page.goto(origin);await page.locator('h1').waitFor();
  const sidebar=page.locator('.sidebar');for(let index=0;index<4;index++)await openGroup(sidebar,index);
  assert.equal(await sidebar.evaluate(el=>getComputedStyle(el).overflowY),'auto');
  assert.ok(await sidebar.evaluate(el=>el.scrollHeight>el.clientHeight),'short viewport reproduces overflowing navigation');
  await sidebar.hover();await page.mouse.wheel(0,1800);
  await page.waitForFunction(()=>document.querySelector('.sidebar').scrollTop>0);
  const lastLink=sidebar.locator('a[href="/vor-ort"]');await lastLink.scrollIntoViewIfNeeded();
  const end=await lastLink.boundingBox();assert.ok(end.y>=0&&end.y+end.height<=viewport.height,'last entry is inside the visible viewport after scrolling');
  const destinations=await sidebar.locator('[data-view]').evaluateAll(els=>els.map(el=>({id:el.dataset.view,label:el.textContent.trim(),group:el.closest('.nav').id})));
  for(const item of destinations){const group=sidebar.locator(`[aria-controls="${item.group}"]`);if(await group.count()&&await group.getAttribute('aria-expanded')!=='true')await group.click();await sidebar.locator(`[data-view="${item.id}"]`).click();await page.waitForFunction(id=>document.querySelector('.sidebar [aria-current="page"]')?.dataset.view===id,item.id);const heading=item.id==='chat'?page.locator('.inbox-list-head h2'):page.locator('#content h1');assert.ok((await heading.textContent()).length>0,item.label+' renders');}
  await f.screenshot('operator-menu-'+viewport.width+'x'+viewport.height,{fullPage:false});assert.deepEqual(f.errors,[]);
});

for(const viewport of [{width:390,height:600},{width:320,height:480},{width:740,height:360}])test(`mobile menu scrolls, closes by keyboard and restores focus at ${viewport.width}x${viewport.height}`,async t=>{
  const f=await browserFixture(t,{viewport}),{page}=f;await page.goto(origin);await page.locator('h1').waitFor();
  const opener=page.locator('.mobile-dock [data-click="menu"]');await opener.click();
  const sidebar=page.locator('.sidebar.open');await sidebar.waitFor({state:'visible'});await openGroup(sidebar,3);assert.equal(await page.locator('.sidebar.open').count(),1,'expanding a section keeps the mobile drawer open');
  await sidebar.hover();await page.mouse.wheel(0,1800);await page.waitForFunction(()=>document.querySelector('.sidebar').scrollTop>0);
  const last=sidebar.locator('a[href="/vor-ort"]');await last.scrollIntoViewIfNeeded();const box=await last.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
  await f.screenshot('operator-menu-mobile-'+viewport.width+'x'+viewport.height,{fullPage:false});
  await page.keyboard.press('Escape');assert.equal(await page.locator('.sidebar.open').count(),0);assert.equal(await opener.getAttribute('aria-expanded'),'false');assert.equal(await opener.evaluate(el=>el===document.activeElement),true);
  await opener.click();await openGroup(sidebar,3);await sidebar.locator('[data-view="settings"]').click();assert.equal(await page.locator('.sidebar.open').count(),0);assert.match(await page.locator('h1').textContent(),/Einstellungen/);assert.deepEqual(f.errors,[]);
});

test('desktop menu still scrolls with enlarged text and its final link can receive keyboard focus',async t=>{
  const f=await browserFixture(t,{viewport:{width:1280,height:600}}),{page}=f;await page.goto(origin);await page.locator('h1').waitFor();
  // Die Textvergrößerung muss auch ausdrücklich formatierte Blattbeschriftungen erreichen.
  await page.route(origin+'/text-scaling.css',route=>route.fulfill({contentType:'text/css',body:'.sidebar{font-size:200%}.sidebar .nav button,.sidebar .nav .navlink,.sidebar .nav-primary-label strong,.sidebar .nav-primary-sub{font-size:26px!important;line-height:1.5!important}'}));
  await page.addStyleTag({url:origin+'/text-scaling.css'});await openGroup(page.locator('.sidebar'),3);
  assert.equal(await page.locator('.sidebar .nav button').first().evaluate(el=>getComputedStyle(el).fontSize),'26px');
  const labels=await page.locator('.sidebar .nav:not([hidden]) button,.sidebar .nav:not([hidden]) .navlink').evaluateAll(controls=>controls.map(control=>{const label=control.querySelector('.nav-primary-label strong')||(control.matches('.nav-primary-sub')?control.querySelector('span'):control),style=getComputedStyle(label);return {label:label.textContent.trim(),size:parseFloat(style.fontSize),width:label.clientWidth,scroll:label.scrollWidth};}));
  t.diagnostic('enlarged navigation labels '+JSON.stringify(labels));
  assert.ok(labels.length>0&&labels.every(label=>label.size===26),'visible destination labels themselves use the enlarged 26px type');
  assert.ok(labels.every(label=>label.scroll<=label.width+1),'the enlarged destination text is not clipped inside its label');
  assert.ok(await page.locator('.sidebar .nav:not([hidden])').evaluateAll(navs=>navs.every(nav=>[...nav.querySelectorAll('button,a')].every(el=>el.scrollWidth<=el.clientWidth))),'enlarged German navigation labels wrap inside their controls');
  const last=page.locator('.sidebar a[href="/vor-ort"]');await last.focus();
  const box=await last.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=600);assert.ok(await page.locator('.sidebar').evaluate(el=>el.scrollTop>0));assert.deepEqual(f.errors,[]);
});

test('accordion navigation works by keyboard, persists after reload and reveals the active section',async t=>{
  const f=await browserFixture(t,{viewport:{width:1280,height:800}}),{page}=f;await page.goto(origin);await page.locator('h1').waitFor();
  const groups=page.locator('.sidebar>.navgroup');assert.equal(await groups.count(),4);
  assert.deepEqual(await groups.evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-expanded'))),['true','false','false','false']);
  const finance=page.locator('[data-nav-group="2"]');await finance.focus();await page.keyboard.press('Enter');
  assert.equal(await finance.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#nav-group-2').isVisible(),true);assert.equal(await finance.evaluate(button=>button===document.activeElement),true);
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('wg-nav-groups'))),[0,2]);
  await page.reload();await page.locator('h1').waitFor();assert.equal(await finance.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#nav-group-2').isVisible(),true);
  await finance.focus();await page.keyboard.press('Space');assert.equal(await finance.getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#nav-group-2').isVisible(),false);
  await page.evaluate(()=>{location.hash='#system';});await page.locator('.system-page').waitFor();
  assert.equal(await page.locator('[data-nav-group="3"]').getAttribute('aria-expanded'),'true');assert.equal(await page.locator('#nav-group-3').isVisible(),true);assert.equal(await page.locator('.sidebar [data-view="system"]').getAttribute('aria-current'),'page');
  await f.screenshot('operator-navigation-accordion',{fullPage:false});assert.deepEqual(f.errors,[]);
});

for(const width of [1440,1024,805,390,320])test(`compact operator workspace remains usable without page overflow at ${width}px`,async t=>{
  const f=await browserFixture(t,{viewport:{width,height:900}}),{page}=f;await page.goto(origin);await page.locator('.overview-shell').waitFor();
  assert.equal(await page.locator('.overview-orders').count(),1);assert.equal(await page.locator('.operations-panel').count(),1);assert.equal(await page.locator('.action-center').count(),1);assert.equal(await page.locator('.premium-hero,.premium-modules,.integration-grid').count(),0);
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
  if(width<=760){
    // Handy: große Tageszahl, Punkt je Termin, das ganze Feld wählt den Tag, lesbare Tagesliste.
    const controls=await page.locator('.schedule-actions button,.schedule-actions .button').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent.trim(),x:r.x,right:r.right,width:r.width,client:el.clientWidth,scroll:el.scrollWidth};}));
    t.diagnostic('calendar controls '+width+' '+JSON.stringify(controls));
    const phone=await page.evaluate(today=>{const px=(el,prop='fontSize')=>parseFloat(getComputedStyle(el)[prop]),box=el=>el.getBoundingClientRect(),cell=document.querySelector(`.schedule-date[data-day="${today}"]`).closest('.schedule-cell'),dot=box(cell.querySelector('.schedule-event')),other=[...document.querySelectorAll('.schedule-cell:not(.outside) .schedule-date')].find(b=>b.dataset.day!==today),oc=box(other.closest('.schedule-cell')),hit=document.elementFromPoint(oc.left+oc.width/2,oc.bottom-6);return {day:px(cell.querySelector('.schedule-date>span')),dot:[Math.round(dot.width),Math.round(dot.height)],weekday:px(document.querySelector('.schedule-weekdays>div')),name:px(document.querySelector('.schedule-detail-main strong')),time:px(document.querySelector('.schedule-detail-time strong')),toggle:Math.round(box(document.querySelector('.schedule-view-toggle button')).height),pager:Math.round(Math.min(...[...document.querySelectorAll('.schedule-pager button')].map(b=>Math.min(box(b).width,box(b).height)))),wholeCell:hit===other||other.contains(hit),otherDay:other.dataset.day,clipped:(bar=>[...bar.querySelectorAll('.schedule-actions button,.schedule-actions .button')].filter(el=>box(el).right>box(bar).right-8||box(el).left<box(bar).left+8||el.scrollWidth>el.clientWidth+1).map(el=>el.textContent.trim()))(document.querySelector('.schedule-commandbar')),smallest:Math.min(...[...document.querySelectorAll('.schedule-day .schedule-detail *')].filter(el=>el.children.length===0&&el.textContent.trim()).map(el=>px(el)))};},today);
    t.diagnostic('calendar phone '+width+' '+JSON.stringify(phone));
    assert.ok(phone.day>=16&&phone.weekday>=12&&phone.name>=16&&phone.time>=16,'calendar text is readable');
    assert.deepEqual(phone.dot,[7,7],'an appointment shows as a dot');
    assert.ok(phone.toggle>=40&&phone.pager>=44,'view toggle and pager are comfortable targets');
    assert.ok(phone.wholeCell,'tapping anywhere in a day field selects that day');
    assert.deepEqual(phone.clipped,[],'no calendar control is cut off at the card edge');
    assert.ok(phone.smallest>=12,'no text in the day list is smaller than 12px: '+phone.smallest);
    const separation=await page.locator('.schedule-day .schedule-detail').evaluateAll(rows=>rows.map(row=>{const time=row.querySelector('.schedule-detail-time').getBoundingClientRect(),name=row.querySelector('.schedule-detail-main').getBoundingClientRect();return {timeRight:time.right,nameLeft:name.left,gap:name.left-time.right};}));
    t.diagnostic('calendar time/name '+width+' '+JSON.stringify(separation));
    assert.ok(separation.every(row=>row.gap>=12),'time and customer columns keep their full 12px gap');
    await page.locator(`.schedule-date[data-day="${phone.otherDay}"]`).click({position:{x:4,y:4}});assert.equal(await page.locator(`.schedule-date[data-day="${phone.otherDay}"]`).getAttribute('aria-pressed'),'true');
    await page.locator(`.schedule-date[data-day="${today}"]`).click();assert.equal(await page.locator(`.schedule-date[data-day="${today}"]`).getAttribute('aria-pressed'),'true');
    // Mehr als drei Termine an einem Tag: die Punkte behalten ihre Statusfarbe und sind keine Tastaturziele.
    const slot=(hour,{proposed=false,...extra}={})=>f.seedOrder({status:'Termin verbindlich',...extra,appointment:{start:`${today}T${hour}:00:00.000Z`,end:`${today}T${hour}:30:00.000Z`,duration:30,delivery:'Kunde bringt',location:'Teststraße 1, Horb',...(proposed?{}:{confirmation:{at:new Date().toISOString(),mode:'Test'}})}});
    await slot('06',{status:'In Arbeit'});await slot('07',{status:'Angenommen',proposed:true});await slot('14',{status:'Erledigt'});await slot('15');
    await page.reload();await page.locator('.schedule-more').waitFor({state:'attached'});
    const dots=await page.evaluate(today=>{const cell=document.querySelector(`.schedule-date[data-day="${today}"]`).closest('.schedule-cell'),events=[...cell.querySelectorAll('.schedule-event')],shown=events.filter(el=>el.getClientRects().length),color=el=>getComputedStyle(el).backgroundColor;const focusable=events.filter(el=>{el.focus();return document.activeElement===el;}).length;return {shown:shown.length,states:shown.map(el=>[...el.classList].find(name=>name!=='schedule-event')),colors:shown.map(color),inert:cell.querySelector('.schedule-events').inert,focusable,more:getComputedStyle(cell.querySelector('.schedule-more')).display};},today);
    t.diagnostic('calendar dots '+width+' '+JSON.stringify(dots));
    assert.deepEqual(dots.states,['running','proposed','confirmed'],'the first three appointments show as dots in time order');
    assert.equal(new Set(dots.colors).size,3,'each status keeps its own dot colour: '+dots.colors);
    assert.ok(dots.inert&&dots.focusable===0,'dots are indicators, not keyboard targets');assert.equal(dots.more,'none');
    assert.equal(await page.locator('.schedule-day .schedule-detail[data-order]').count(),5,'every appointment stays reachable in the day list');
  }
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
