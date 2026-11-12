// Uses the existing isolated GitHub runner; never starts a local website server.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin} from './harness.mjs';

for(const colorScheme of ['dark','light'])for(const width of [320,390,768,1440]){
  test(`order workspace ${colorScheme} ${width}px`,async t=>{
    const f=await browserFixture(t,{viewport:{width,height:900},colorScheme}),{page}=f;
    const order=await f.seedOrder({pending:{offer:{createdAt:new Date().toISOString(),content:{lines:[],totalCents:43625}}},workflow:{intake:{state:'skipped',reason:'Kunde nicht vor Ort',at:new Date().toISOString()}},source:{name:'Erika Muster',phone:'+49 170 0000000',email:'customer@example.invalid',address:'Teststraße 1',city:'Horb',vehicle:'Mercedes-Benz C-Klasse',plate:'FDS-WG 1',desiredDate:'2035-10-14',timeWindow:'Vormittags'}});
    const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
    await page.goto(origin+'/#auftrag='+order.id);await page.locator('.order-tabs').waitFor();
    assert.equal(await page.locator('[role="tablist"]').count(),1);
    // Schnellkontakt: vier Geräte-Links im Auftragskopf, auf dem Handy jeweils mindestens 44 px und ohne Überlauf.
    const contact=await page.locator('.order-contact a').evaluateAll(links=>links.map(a=>{const r=a.getBoundingClientRect();return {href:a.getAttribute('href').split(/[:?]/)[0],w:r.width,h:r.height,inside:r.left>=0&&r.right<=innerWidth+.5&&a.scrollWidth<=a.clientWidth+1};}));
    assert.deepEqual(contact.map(c=>c.href),['tel','https','mailto','https']);
    assert.ok(contact.every(c=>c.inside&&c.h>=40&&(width>760||c.w>=44)),'contact links are reachable: '+JSON.stringify(contact));
    if(width<=760){const bar=await page.locator('.order-commandbar>.button,.order-more>summary').evaluateAll(nodes=>nodes.map(n=>({h:Math.round(n.getBoundingClientRect().height),fits:n.scrollWidth<=n.clientWidth+1})));assert.ok(bar.every(b=>b.h<=50&&b.fits),'back and more stay on one line: '+JSON.stringify(bar));}
    assert.equal(await page.locator('.guided-workflow').count(),0);
    assert.match(await page.locator('.order-overview').textContent(),/Terminvorschlag · unbestätigt/);
    assert.match(await page.locator('#order-tab-intake').textContent(),/Kein Protokoll.*Übersprungen/);
    assert.match(await page.locator('#order-tab-price').textContent(),/Unterschrift offen/);
    for(const area of ['source','price','intake','return','payment','notes']){
      const button=page.locator('#order-tab-'+area);await button.click();
      assert.equal(await button.getAttribute('aria-selected'),'true',area+' must open without changes');
      assert.deepEqual(dialogs,[],'untouched forms must not ask to discard changes');
      await page.locator('#order-panel-'+area).waitFor();
      // Handy: jede Beschriftung, jeder Hinweis, Abschnittstitel und jede aufklappbare Zeile in jedem der sechs Bereiche ist lesbar.
      if(width<=760){const small=await page.locator('#order-panel-'+area).evaluate(panel=>{const found=[],check=(selector,min)=>{for(const el of panel.querySelectorAll(selector)){if(!el.getClientRects().length)continue;const size=parseFloat(getComputedStyle(el).fontSize);if(size<min)found.push(selector+' '+size+'px: '+el.textContent.trim().slice(0,40));}};check('label',15);check('.hint',13);check('.sectiontitle',17);check('details>summary',16);return found;});assert.deepEqual(small,[],area+': form text is readable on phones');}
      const box=await button.boundingBox();assert.ok(box.height>=48&&box.width>=48);
      if(area==='price'){
        const total=await page.locator('[data-price-total]').evaluate(el=>{const r=el.getBoundingClientRect(),card=el.closest('.catalog-total').getBoundingClientRect(),c=getComputedStyle(el),range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect();return {font:c.fontFamily,size:parseFloat(c.fontSize),weight:c.fontWeight,left:text.left,right:text.right,cardLeft:card.left,cardRight:card.right,width:r.width,scroll:el.scrollWidth,client:el.clientWidth};});
        t.diagnostic('order total '+colorScheme+' '+width+' '+JSON.stringify(total));
        assert.ok(/system-ui/.test(total.font)&&total.weight==='700'&&total.size===(width<=760?14:15),'the complete total retains its original font role');
        assert.ok(total.left>=total.cardLeft&&total.right<=total.cardRight&&total.scroll<=total.client+1,'the full total fits within its card');
      }
      const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth,viewport:innerWidth,offenders:[...document.querySelectorAll('.content *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>innerWidth+.5);}).slice(0,12).map(el=>({tag:el.tagName,class:el.className,text:el.textContent.trim().slice(0,50),width:el.getBoundingClientRect().width}))}));
      if(overflow.page>overflow.viewport)t.diagnostic('order overflow '+area+' '+JSON.stringify(overflow));
      assert.ok(overflow.page<=overflow.viewport,'no page overflow: '+area);
    }
    await page.locator('#order-tab-source').click();await page.locator('#order-tab-source').focus();await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#order-tab-price').evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator('.pending h3').textContent(),'Angebot · wartet auf Kundenunterschrift');
    assert.equal(await page.locator('.mobile-task').isVisible(),false);
    assert.ok(await page.locator('.order-tabs').evaluate(el=>el.scrollWidth<=el.clientWidth),'all areas fit without horizontal scrolling');
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
