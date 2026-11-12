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
      const shortDockLabels=dock.map(el=>el.querySelector('span:not(.dock-count):not(.visually-hidden)')).filter(el=>['Start','Chat','Mehr'].includes(el.textContent.trim())).map(el=>{const range=document.createRange();range.selectNodeContents(el);return {text:el.textContent.trim(),rows:new Set([...range.getClientRects()].filter(rect=>rect.width>0&&rect.height>0).map(rect=>Math.round(rect.top))).size};});
      const header=document.querySelector('.overview-orders .card-title'),headerStyle=getComputedStyle(header),heading=header.querySelector('div');
      const table=document.querySelector('.overview-orders .tablewrap'),prices=[...table.querySelectorAll('td.money')].map(el=>({right:el.getBoundingClientRect().right,tableRight:table.getBoundingClientRect().right}));
      return {body:style('body'),title:style('#action-center-title'),number:style('.stat .value'),nav:dock.map(el=>({text:el.textContent.trim(),size:parseFloat(getComputedStyle(el).fontSize),font:getComputedStyle(el).fontFamily,width:el.clientWidth,scroll:el.scrollWidth,inside:el.getBoundingClientRect().right<=innerWidth+.5&&el.getBoundingClientRect().left>=0,uncut:el.scrollWidth<=el.clientWidth+1})),shortDockLabels,cardTitle:{width:heading.getBoundingClientRect().width,available:header.clientWidth-parseFloat(headerStyle.paddingLeft)-parseFloat(headerStyle.paddingRight)},prices,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    t.diagnostic('typography geometry '+browserName+' '+width+' '+JSON.stringify(overview));
    assert.match(overview.body.family,/system-ui/);
    assert.match(overview.title.family,/system-ui/);assert.equal(overview.title.size,width<=760?28:34);assert.equal(overview.title.weight,width<=760?'700':'600');
    assert.match(overview.number.family,/system-ui/);assert.equal(overview.number.size,width<=760?28:27);assert.equal(overview.number.weight,width<=760?'700':'500');
    assert.ok(overview.nav.every(item=>item.size===11&&/Barlow/.test(item.font)&&item.inside&&item.uncut),'every navigation label fits its target');
    if(width<=760){assert.deepEqual(overview.shortDockLabels.map(label=>label.text),['Start','Chat','Mehr']);assert.ok(overview.shortDockLabels.every(label=>label.rows===1),'short dock labels remain whole on one line');}
    if(width<=760)for(const name of ['Eingang','Aufträge'])assert.equal(await page.locator('.mobile-dock').getByRole('button',{name,exact:true}).count(),1,'the original labels preserve the accessible dock name: '+name);
    assert.equal(overview.overflow,false,'no horizontal overflow on the dashboard');
    if(width<=760)assert.ok(overview.cardTitle.width>=overview.cardTitle.available-1,'the work queue title keeps a full row beside its action');
    if(width>=1200)assert.ok(overview.prices.length>0&&overview.prices.every(price=>price.right<=price.tableRight+.5),'every fixed price is visible in the desktop work queue');
    await f.screenshot(`typography-${browserName}-${width}-dashboard`,{fullPage:false});
    await page.goto(origin+'/#orders');await page.locator('.order-table td.money').first().waitFor();await page.evaluate(()=>document.fonts.ready);
    const table=await page.locator('.order-table td.money').first().evaluate(el=>({text:el.textContent,font:getComputedStyle(el).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.match(table.font,/system-ui/);assert.match(table.text,/436,25/);assert.equal(table.overflow,false,'table values remain in the viewport');
    if(width===320){
      await page.goto(origin+'/#mailbox');await page.locator('.cc-head h1').waitFor();await page.evaluate(()=>document.fonts.ready);
      const mail=await page.locator('.cc-head').evaluate(head=>{const title=head.querySelector('h1'),style=getComputedStyle(title);return {size:parseFloat(style.fontSize),titleWidth:title.clientWidth,titleScroll:title.scrollWidth,targets:[...head.querySelectorAll('button')].map(button=>button.getBoundingClientRect()).filter(box=>box.width>0).map(box=>({width:box.width,height:box.height,left:box.left,right:box.right})),overflow:document.documentElement.scrollWidth>innerWidth};});
      t.diagnostic('320px communication geometry '+browserName+' '+JSON.stringify(mail));
      assert.ok(mail.size===26&&mail.titleScroll<=mail.titleWidth+1&&!mail.overflow,'the narrow mail header preserves the full title without page overflow');
      assert.ok(mail.targets.length===2&&mail.targets.every(target=>target.width>=44&&target.height>=44&&target.left>=0&&target.right<=width+.5),'both narrow-screen mail controls remain visible 44px targets');
      await f.screenshot(`typography-${browserName}-${width}-mail`,{fullPage:false});
    }
    await page.goto(origin+'/auth/login');await page.locator('#auth-email').waitFor();await page.evaluate(()=>document.fonts.ready);
    const form=await page.evaluate(()=>{
      const input=getComputedStyle(document.querySelector('#auth-email')),label=getComputedStyle(document.querySelector('#auth-form label')),h1=getComputedStyle(document.querySelector('h1'));
      return {input:{font:input.fontFamily,size:parseFloat(input.fontSize),weight:input.fontWeight},label:{font:label.fontFamily,case:label.textTransform,size:parseFloat(label.fontSize)},heading:{size:parseFloat(h1.fontSize),weight:h1.fontWeight},overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.match(form.input.font,/Barlow/);assert.equal(form.input.size,width<=760?16:13);assert.equal(form.input.weight,'500');
    assert.match(form.label.font,/system-ui/);assert.equal(form.label.case,'none');assert.equal(form.label.size,width<=760?13:12);
    assert.deepEqual(form.heading,{size:32,weight:'400'});assert.equal(form.overflow,false,'login remains within the screen');
    assert.ok(f.requests.some(request=>/^\/barlow-latin(?:-medium|-semibold)?\.woff2$/.test(request.path)&&request.status===200),'the original local control font actually loads');
    assert.ok(!f.requests.some(request=>/syne|jakarta/i.test(request.path)),'website fonts are never requested by the panel');
    assert.deepEqual(f.errors,[],'fonts make no external browser requests and the console is clean');
    await f.screenshot(`typography-${browserName}-${width}-login`,{fullPage:false});
  });
}
