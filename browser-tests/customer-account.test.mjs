import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin,customer} from './harness.mjs';
import {setting,protect} from '../src/worker.mjs';
import {deliverCustomerCodes} from '../server/customer-auth.mjs';

for(const width of [390,1440])for(const colorScheme of ['dark','light'])test(`AUTH001 customer account ${width} ${colorScheme}`,async t=>{
 const f=await browserFixture(t,{viewport:{width,height:900},identity:null,colorScheme}),{page,env}=f;
 await f.seedOrder();await f.seedOrder({source:{email:'foreign@example.invalid',name:'FOREIGN SECRET'}});
 await setting(env,'resendKey',await protect(env,'synthetic-provider-key'));await setting(env,'emailVerified',true);await setting(env,'sendApproved',true);await setting(env,'sender','test@example.invalid');
 const capture=async step=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');await f.screenshot(`AUTH001-${width}-${colorScheme}-${step}`);};
 await page.goto(origin+'/auth/customer');await page.getByLabel('E-Mail-Adresse',{exact:true}).waitFor();await capture('login');
 const welcome=page.getByRole('heading',{name:'Willkommen zurück',exact:true});assert.equal(await welcome.count(),1);
 const welcomeParts=await welcome.evaluate(title=>{
  const node=title.firstChild;
  const rectangles=(start,end)=>{const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);return [...range.getClientRects()].filter(rect=>rect.width>0&&rect.height>0).map(rect=>({left:rect.left,top:rect.top,width:rect.width,height:rect.height}));};
  return ['Will','kommen','zurück'].map(part=>{
   const start=node.textContent.indexOf(part),glyphs=[...part].map((letter,index)=>{
    const offset=start+index,measured=rectangles(offset,offset+1),precedingHyphen=node.textContent[offset-1]==='\u00ad'?rectangles(offset-1,offset):[];
    // Chromium includes the preceding rendered soft hyphen in the next letter's range.
    // Exclude only that separately measured rectangle; every actual letter must remain.
    const rects=measured.filter(rect=>!precedingHyphen.some(hyphen=>['left','top','width','height'].every(key=>rect[key]===hyphen[key])));
    return {letter,rects,precedingHyphen};
   });
   return {part,glyphs,rows:new Set(glyphs.flatMap(glyph=>glyph.rects.map(rect=>Math.round(rect.top)))).size};
  });
 });
 t.diagnostic('customer welcome wrapping '+width+' '+JSON.stringify(welcomeParts));assert.ok(welcomeParts.every(part=>part.rows===1&&part.glyphs.every(glyph=>glyph.rects.length>0)),'the welcome title wraps at whole readable word parts');
 await page.getByRole('button',{name:'Erstmals einrichten',exact:true}).click();await capture('setup');
 await page.getByLabel('E-Mail-Adresse',{exact:true}).fill(customer);await page.getByRole('button',{name:'Bestätigungscode anfordern',exact:true}).click();await page.getByLabel('Bestätigungscode',{exact:true}).waitFor();await capture('code');
 let code;const mail=t.mock.method(globalThis,'fetch',async(_url,options)=>{code=JSON.parse(options.body).text.match(/\b\d{6}\b/)[0];return Response.json({id:'synthetic-email'});});await deliverCustomerCodes(env);mail.mock.restore();assert.match(code,/^\d{6}$/);
 await page.getByLabel('Bestätigungscode',{exact:true}).fill(code);await page.getByRole('button',{name:'E-Mail bestätigen',exact:true}).click();await page.getByLabel('Neues Passwort',{exact:true}).waitFor();await capture('password');
 const password='Synthetic browser password only';await page.getByLabel('Neues Passwort',{exact:true}).fill(password);await page.getByLabel('Passwort wiederholen',{exact:true}).fill(password);await page.getByRole('button',{name:'Passwort speichern',exact:true}).click();await page.getByRole('button',{name:'Jetzt anmelden',exact:true}).waitFor();await capture('success');
 await page.getByRole('button',{name:'Jetzt anmelden',exact:true}).click();await page.getByLabel('E-Mail-Adresse',{exact:true}).fill(customer);await page.getByLabel('Passwort',{exact:true}).fill(password);await page.getByRole('button',{name:'Anmelden',exact:true}).click();await page.waitForURL(origin+'/kunde');await page.locator('.portal-hello').waitFor();assert.ok(!(await page.locator('body').textContent()).includes('FOREIGN SECRET'));
 await page.goto(origin+'/auth/customer');await page.getByRole('button',{name:'Passwort vergessen?',exact:true}).click();await capture('reset');
 assert.deepEqual(f.errors,[]);
});

