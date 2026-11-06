import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin} from './harness.mjs';
for(const colorScheme of ['dark','light'])for(const width of [320,390,768,1024,1440]){
 test(`order evidence ${colorScheme} ${width}px`,async t=>{
  const f=await browserFixture(t,{viewport:{width,height:1000},colorScheme}),{page}=f;
  const order=await f.seedOrder({intake:{savedAt:'2026-11-01T10:00:00Z',customerSignature:'synthetic-signature',photos:[]},pending:{intake:{createdAt:'2026-11-02T10:00:00Z',content:{photos:[]}}},workflow:{intake:{state:'skipped',reason:'Separat dokumentierter Schritt',at:'2026-11-01T10:00:00Z'}}});
  const writes=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await page.goto(origin+'/#auftrag='+order.id);await page.locator('#order-tab-notes').click();
  assert.equal(await page.locator('[data-evidence-document]').count(),4);assert.equal(await page.locator('[role=tab]').count(),6);
  assert.match(await page.locator('[data-evidence-document=intake]').textContent(),/Vom Kunden unterschrieben.*Offene Fassung.*Übersprungen/s);
  await page.locator('[data-order-media=stored] summary').click();await page.getByText('Keine gespeicherten Medien vorhanden.').waitFor();
  assert.deepEqual(writes,[],'opening evidence must not write');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const button of await page.locator('.order-evidence button').all()){const box=await button.boundingBox();assert.ok(box.height>=44&&box.width>=44);}
  await page.locator('.workspace').evaluate(el=>{el.scrollTop=0;});await f.screenshot(`order-evidence-${colorScheme}-${width}`);
  await page.locator('[data-evidence-document=return]').scrollIntoViewIfNeeded();assert.match(await page.locator('[data-evidence-document=return]').textContent(),/Datum: Nicht hinterlegt/);await f.screenshot(`order-evidence-documents-${colorScheme}-${width}`);
  await page.locator('#noteform').scrollIntoViewIfNeeded();await f.screenshot(`order-evidence-communication-${colorScheme}-${width}`);
  if(width===1440){await page.evaluate(()=>{document.body.style.zoom='2';});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% CSS zoom reflow');await f.screenshot(`order-evidence-${colorScheme}-zoom200`);await page.evaluate(()=>{document.body.style.zoom='';});}
  await page.locator('#noteform textarea').fill('Ungespeichert');let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
  await page.locator('[data-evidence-document=return] button').click();assert.equal(dialogs,1);assert.equal(await page.locator('#noteform textarea').inputValue(),'Ungespeichert');
  await page.locator('#noteform textarea').fill('');await page.locator('[data-evidence-document=return] button').click();await page.locator('#protocolform').waitFor();
  assert.deepEqual(f.errors,[]);
 });
}
