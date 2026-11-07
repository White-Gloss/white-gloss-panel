import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {browserFixture,origin,customer} from './harness.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
for(const role of ['customer','owner'])test(`QA004 ${role} batch cancellation during preview`,async t=>{
 const f=await browserFixture(t,{identity:role==='customer'?customer:undefined,viewport:{width:390,height:844},colorScheme:'dark'}),o=await f.seedOrder(),{page}=f;
 await page.addInitScript(()=>{window.createImageBitmap=()=>{window.qaPreviewStarted=true;return new Promise((_resolve,reject)=>{window.qaFinishPreview=()=>reject(Error('Synthetic preview interruption'));});};});
 await page.goto(origin+(role==='customer'?'/kunde':'/#auftrag='+o.id));if(role==='owner')await page.locator('#order-tab-notes').click();
 const form=page.locator('[data-gallery-upload]');await form.waitFor();await form.locator('[name=photos]').setInputFiles(['one.png','two.png'].map(name=>({name,mimeType:'image/png',buffer:png})));
 await form.locator('[type=submit]').click();await page.waitForFunction(()=>window.qaPreviewStarted===true);
 assert.equal(await page.locator('[data-gallery-filter]').isDisabled(),true);
 await form.locator('[data-upload-cancel]').click();await page.evaluate(()=>window.qaFinishPreview());await page.waitForFunction(()=>document.querySelector('[data-upload-status]').textContent.includes('abgebrochen'));
 assert.equal(f.requests.filter(r=>r.path==='/api/order-media/'+o.id&&r.method==='POST').length,1);
 assert.equal(await form.locator('[type=submit]').isEnabled(),true);assert.equal(await page.locator('[data-gallery-filter]').isEnabled(),true);
 await mkdir('test-results',{recursive:true});await form.locator('[data-upload-status]').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/qa004-cancel-${role}.png`});
 // A deliberate retry remains safe: real backend reuses the successful original.
 await page.evaluate(()=>{window.createImageBitmap=()=>Promise.reject(Error('Preview unsupported in this fixture'));});
 await form.locator('[type=submit]').click();await page.locator('.gallery-photo').waitFor();
 assert.equal((await f.env.DB.prepare("SELECT COUNT(*) n FROM assets WHERE kind='gallery'").first()).n,1);
 assert.deepEqual(f.errors,[]);await mkdir('test-results',{recursive:true});await page.locator('[data-order-gallery] h3').evaluate(el=>el.scrollIntoView({block:'center'}));await page.screenshot({path:`test-results/qa004-gallery-${role}.png`});
});
