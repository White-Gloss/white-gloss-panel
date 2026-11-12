import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserFixture,origin,customer} from './harness.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
for(const colorScheme of ['dark','light'])for(const width of [390,768,1440])for(const role of ['customer','owner'])test(`FLOW003 ${role} ${colorScheme} ${width}`,async t=>{
 const f=await browserFixture(t,{viewport:{width,height:1000},colorScheme,...role==='customer'?{identity:customer}:{}}),{page}=f,o=await f.seedOrder();
 const id=randomUUID();await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(id,o.id,'gallery','image/png','synthetic',png.length,new Date().toISOString()).run();await f.env.DB.prepare('INSERT INTO order_media(asset_id,order_id,stage,shared,role,name,description) VALUES(?,?,?,?,?,?,?)').bind(id,o.id,'intake',1,'customer','Synthetisches Testbild','Aufnahme bei der Annahme').run();f.files.set(id,{body:png,httpMetadata:{contentType:'image/png'}});
 await page.goto(origin+(role==='customer'?'/kunde':'/#auftrag='+o.id));
 if(role==='owner'){
  await page.locator('#order-tab-price').click();await page.locator('[name=durationHours]').fill('3,5');assert.equal(await page.locator('#appointmentform [name=duration]').inputValue(),'210');assert.match(await page.locator('[data-hours-preview]').textContent(),/Ende:/);await page.locator('[name=durationHours]').fill('3');await page.locator('#order-tab-notes').click();
 }else{
  await page.locator('[data-form=handover-preference]').waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.locator('.portal-jump').evaluate(el=>el.scrollWidth<=el.clientWidth),'all customer destinations fit');assert.equal(await page.locator('a[href="#vehicle-gallery"]').count(),1);
  const roles=await page.evaluate(()=>{const style=el=>{const c=getComputedStyle(el),box=el.getBoundingClientRect();return {font:c.fontFamily,size:parseFloat(c.fontSize),weight:c.fontWeight,case:c.textTransform,width:el.clientWidth,scroll:el.scrollWidth,height:box.height,left:box.left,right:box.right};};return {links:[...document.querySelectorAll('.portal-jump a')].map(style),amounts:[...document.querySelectorAll('.portal-lines tbody td:last-child')].map(style),totals:[...document.querySelectorAll('.portal-lines tfoot td')].map(style)};});
  t.diagnostic('portal type roles '+colorScheme+' '+width+' '+JSON.stringify(roles));
  assert.ok(roles.links.length===6&&roles.links.every(link=>/system-ui/.test(link.font)&&link.size===12&&link.weight==='500'&&link.case==='none'&&link.height>=44&&link.scroll<=link.width+1&&link.left>=0&&link.right<=width+.5),'all six portal destinations preserve navigation typography and touch targets');
  assert.ok(roles.amounts.length>0&&roles.amounts.every(amount=>/system-ui/.test(amount.font)&&amount.weight==='400'&&amount.size===14),'line amounts retain their original compact system-font role');
  assert.ok(roles.totals.length>0&&roles.totals.every(total=>/system-ui/.test(total.font)&&total.weight==='700'&&total.size===15),'offer and invoice totals keep the original bold table role');
  await page.waitForFunction(()=>{const portal=document.querySelector('.portal'),top=document.querySelector('.portal-top').getBoundingClientRect().height,jump=document.querySelector('.portal-jump').getBoundingClientRect().height;return parseFloat(getComputedStyle(portal).getPropertyValue('--portal-scroll-offset'))===Math.ceil(top+jump+16);});
  const destinations=await page.locator('.portal-jump a').evaluateAll(links=>links.map(link=>link.getAttribute('href'))),writes=f.requests.filter(request=>request.method==='POST').length;
  for(const href of destinations){
    assert.equal(await page.locator(href).count(),1,'anchor target exists: '+href);
    await page.locator('.portal-jump a[href="'+href+'"]').click();
    const arrived=await page.waitForFunction(href=>{const el=document.querySelector(href),nav=document.querySelector('.portal-jump').getBoundingClientRect(),title=(el.querySelector('h2,h3')??el).getBoundingClientRect();return el.getBoundingClientRect().top>=nav.bottom+8&&title.top<innerHeight;},href,{timeout:5000}).then(()=>true,()=>false);
    const target=await page.locator(href).evaluate(el=>{const box=el.getBoundingClientRect(),nav=document.querySelector('.portal-jump').getBoundingClientRect(),title=(el.querySelector('h2,h3')??el).getBoundingClientRect();return {top:box.top,title:title.top,bottom:nav.bottom,viewport:innerHeight,margin:parseFloat(getComputedStyle(el).scrollMarginTop)};});
    t.diagnostic('portal anchor '+width+' '+href.split('-')[0]+' '+JSON.stringify(target));
    assert.ok(arrived&&target.top>=target.bottom+8&&target.title<target.viewport,'the destination heading is visible below the complete sticky navigation: '+href);
  }
  assert.equal(f.requests.filter(request=>request.method==='POST').length,writes,'anchor navigation only reads existing content');
 }
 await page.locator('.gallery-photo').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
 const before=f.requests.filter(r=>r.method==='POST').length;await f.screenshot(`flow003-${role}-${colorScheme}-${width}`);assert.equal(f.requests.filter(r=>r.method==='POST').length,before,'viewing gallery triggers no writes');
 await page.locator('[data-order-gallery] h3').first().evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));await page.screenshot({path:`test-results/flow003-upload-${role}-${colorScheme}-${width}.png`});
 await page.locator('.gallery-photo img').evaluate(img=>{img.scrollIntoView({block:'center',behavior:'instant'});return img.decode();});await page.screenshot({path:`test-results/flow003-gallery-${role}-${colorScheme}-${width}.png`});
 for(const button of await page.locator('[data-order-gallery] button').all()){if(await button.isVisible()){const b=await button.boundingBox();assert.ok(b.height>=44,'gallery touch target');}}
 if(role==='customer'){
  await page.locator('[name=photos]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});await page.locator('[data-gallery-upload] button[type=submit]').click();await page.locator('.gallery-photo').nth(1).waitFor();
  assert.equal(await page.locator('[data-gallery-edit]').count(),0);
 }
 assert.deepEqual(f.errors,[]);
});
