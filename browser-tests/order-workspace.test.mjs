// Uses the existing isolated GitHub runner; never starts a local website server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin} from './harness.mjs';

for(const colorScheme of ['dark','light'])for(const width of [320,390,768,1440]){
  test(`order workspace ${colorScheme} ${width}px`,async t=>{
    const f=await browserFixture(t,{viewport:{width,height:900},colorScheme}),{page}=f;
    const order=await f.seedOrder({pending:{offer:{createdAt:new Date().toISOString(),content:{lines:[],totalCents:43625}}},workflow:{intake:{state:'skipped',reason:'Kunde nicht vor Ort',at:new Date().toISOString()}},source:{name:'Erika Muster',vehicle:'Mercedes-Benz C-Klasse',plate:'FDS-WG 1',desiredDate:'2035-10-14',timeWindow:'Vormittags'}});
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto(origin+'/#auftrag='+order.id);await page.locator('.order-tabs').waitFor();
    assert.equal(await page.locator('[role="tablist"]').count(),1);
    assert.equal(await page.locator('.guided-workflow').count(),0);
    assert.match(await page.locator('.order-overview').textContent(),/Terminvorschlag · unbestätigt/);
    assert.match(await page.locator('#order-tab-intake').textContent(),/Kein Protokoll.*Übersprungen/);
    assert.match(await page.locator('#order-tab-price').textContent(),/Unterschrift offen/);
    for(const area of ['source','price','intake','return','payment','notes']){
      const button=page.locator('#order-tab-'+area);await button.click();
      assert.equal(await button.getAttribute('aria-selected'),'true',area+' must open without changes');
      assert.deepEqual(dialogs,[],'untouched forms must not ask to discard changes');
      await page.locator('#order-panel-'+area).waitFor();
      const box=await button.boundingBox();assert.ok(box.height>=48&&box.width>=48);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow: '+area);
    }
    await page.locator('#order-tab-source').click();await page.locator('#order-tab-source').focus();await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#order-tab-price').evaluate(el=>el===document.activeElement),true);
    await f.screenshot(`order-workspace-${colorScheme}-${width}`);
    const photo=page.locator('#bookingphotoform input[type=file]');
    await photo.setInputFiles({name:'test.png',mimeType:'image/png',buffer:Buffer.from('synthetic fixture')});
    await page.locator('#order-tab-return').click();
    assert.equal(await page.locator('#order-tab-price').getAttribute('aria-selected'),'true','selected photos must remain protected');
    assert.equal(dialogs.length,1);assert.match(dialogs[0],/ungespeicherte/);
    await photo.setInputFiles([]);dialogs.length=0;
    await page.locator('#order-tab-return').click();await f.screenshot(`order-return-${colorScheme}-${width}`);
    assert.deepEqual(dialogs,[]);
    assert.deepEqual(f.errors,[]);
  });
}
