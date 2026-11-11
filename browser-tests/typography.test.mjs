// Real browser engines on the genuine Linux GitHub runner only; all data is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin} from './harness.mjs';

for(const browserName of ['chromium','firefox','webkit'])for(const width of [320,768,1440]){
  test(`typography ${browserName} ${width}px: loaded fonts, headings, prices, inputs and uncut navigation`,async t=>{
    const f=await browserFixture(t,{browserName,viewport:{width,height:900},colorScheme:'dark'}),{page}=f;
    await f.seedOrder();await page.goto(origin);await page.locator('#action-center-title').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const overview=await page.evaluate(()=>{
      const style=selector=>{const c=getComputedStyle(document.querySelector(selector));return {family:c.fontFamily,size:parseFloat(c.fontSize),weight:c.fontWeight};};
      const dock=[...document.querySelectorAll('.mobile-dock>button')].filter(el=>el.getBoundingClientRect().width>0);
      return {body:style('body'),title:style('#action-center-title'),number:style('.stat .value'),nav:dock.map(el=>({size:parseFloat(getComputedStyle(el).fontSize),font:getComputedStyle(el).fontFamily,inside:el.getBoundingClientRect().right<=innerWidth+.5&&el.getBoundingClientRect().left>=0,uncut:el.scrollWidth<=el.clientWidth+1})),overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.match(overview.body.family,/Plus Jakarta Sans/);
    assert.match(overview.title.family,/Syne/);assert.equal(overview.title.size,width<768?33:46);assert.equal(overview.title.weight,'800');
    assert.match(overview.number.family,/Syne/);assert.equal(overview.number.size,width<768?24:28);assert.equal(overview.number.weight,'800');
    assert.ok(overview.nav.every(item=>item.size===16&&/Syne/.test(item.font)&&item.inside&&item.uncut),'every navigation label fits its target');
    assert.equal(overview.overflow,false,'no horizontal overflow on the dashboard');
    await f.screenshot(`typography-${browserName}-${width}-dashboard`,{fullPage:false});
    await page.goto(origin+'/#orders');await page.locator('.order-table td.money').first().waitFor();await page.evaluate(()=>document.fonts.ready);
    const table=await page.locator('.order-table td.money').first().evaluate(el=>({text:el.textContent,font:getComputedStyle(el).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.match(table.font,/Syne/);assert.match(table.text,/436,25/);assert.equal(table.overflow,false,'table values remain in the viewport');
    await page.goto(origin+'/auth/login');await page.locator('#auth-email').waitFor();await page.evaluate(()=>document.fonts.ready);
    const form=await page.evaluate(()=>{
      const input=getComputedStyle(document.querySelector('#auth-email')),label=getComputedStyle(document.querySelector('#auth-form label')),h1=getComputedStyle(document.querySelector('h1'));
      return {input:{font:input.fontFamily,size:parseFloat(input.fontSize),weight:input.fontWeight},label:{font:label.fontFamily,case:label.textTransform,size:parseFloat(label.fontSize)},heading:{size:parseFloat(h1.fontSize),weight:h1.fontWeight},overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.match(form.input.font,/Plus Jakarta Sans/);assert.equal(form.input.size,width<768?16:15);assert.equal(form.input.weight,'500');
    assert.match(form.label.font,/Syne/);assert.equal(form.label.case,'uppercase');assert.equal(form.label.size,12);
    assert.deepEqual(form.heading,{size:width<768?33:46,weight:'800'});assert.equal(form.overflow,false,'login remains within the screen');
    assert.ok(f.requests.some(request=>request.path==='/syne-variable.woff2'&&request.status===200));
    assert.ok(f.requests.some(request=>request.path==='/plus-jakarta-sans-variable.woff2'&&request.status===200));
    assert.deepEqual(f.errors,[],'fonts make no external browser requests and the console is clean');
    await f.screenshot(`typography-${browserName}-${width}-login`,{fullPage:false});
  });
}
