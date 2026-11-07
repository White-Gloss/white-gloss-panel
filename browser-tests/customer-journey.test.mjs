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
 }else{await page.locator('[data-form=handover-preference]').waitFor();assert.ok(await page.locator('.portal-jump').evaluate(el=>el.scrollWidth<=el.clientWidth),'all customer destinations fit');assert.equal(await page.locator('a[href="#vehicle-gallery"]').count(),1);}
 await page.locator('.gallery-photo').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
 const before=f.requests.filter(r=>r.method==='POST').length;await f.screenshot(`flow003-${role}-${colorScheme}-${width}`);assert.equal(f.requests.filter(r=>r.method==='POST').length,before,'viewing gallery triggers no writes');
 await page.locator('.gallery-photo img').scrollIntoViewIfNeeded();await page.locator('.gallery-photo img').evaluate(img=>img.decode());await page.locator('[data-order-gallery]').screenshot({path:`test-results/flow003-gallery-${role}-${colorScheme}-${width}.png`});
 for(const button of await page.locator('[data-order-gallery] button').all()){if(await button.isVisible()){const b=await button.boundingBox();assert.ok(b.height>=44,'gallery touch target');}}
 if(role==='customer'){
  await page.locator('[name=photos]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});await page.locator('[data-gallery-upload] button[type=submit]').click();await page.locator('.gallery-photo').nth(1).waitFor();
  assert.equal(await page.locator('[data-gallery-edit]').count(),0);
 }
 assert.deepEqual(f.errors,[]);
});
