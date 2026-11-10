// Genuine Linux CI only. Layout and interaction checks of the Communication Center against an
// isolated in-process application. No listener, real mailbox, provider or external image request.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserFixture,origin,customer,owner} from './harness.mjs';
import {ingestMessage} from '../server/mailbox.mjs';

const viewports=[{width:1600,height:900},{width:1280,height:800},{width:900,height:900},{width:390,height:844}];
const plain=subject=>Buffer.from(`From: Erika Muster <${customer}>\r\nTo: ${owner}\r\nCc: partner@example.invalid\r\nSubject: ${subject}\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGuten Tag, wann passt der Termin für die Politur?`);
const html=Buffer.from(`From: Newsletter <news@example.invalid>\r\nTo: ${owner}\r\nSubject: Sommeraktion Newsletter\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Fri, 16 Oct 2026 08:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><head><style>.hero{padding:24px;background:#eef3f7;font-size:22px}</style></head><body><div class="hero">Sommeraktion</div><img src="https://tracker.example.invalid/pixel.gif" width="1" height="1"><p>Ein langer Absatz mit Inhalt.</p><a href="https://shop.example.invalid/">Zum Shop</a><script>document.body.dataset.executed='yes'</script></body></html>\r\n`);
async function noOverflow(page,label){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' has no horizontal overflow');}
// Liefert bei Layoutfehlern die Lage von Knopf, Lesebereich und Treffer im Testprotokoll.
async function geometry(page,selector){return page.evaluate(selector=>{const box=element=>{if(!element)return null;const r=element.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),sl:element.scrollLeft,st:element.scrollTop,sw:element.scrollWidth,cw:element.clientWidth};};const target=document.querySelector(selector),rect=target?.getBoundingClientRect(),hit=rect?document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2):null;return {target:box(target),reader:box(document.querySelector('.cc-reader')),mail:box(document.querySelector('.cc-mail')),shell:box(document.querySelector('.cc-shell')),page:{x:scrollX,y:scrollY,sw:document.documentElement.scrollWidth,iw:innerWidth,ih:innerHeight},hit:hit?(hit.tagName+'.'+String(hit.className)).slice(0,80):null};},selector);}
async function openRail(page,width){if(width<1400&&!(await page.locator('.cc').evaluate(element=>element.classList.contains('cc-rail-open'))))await page.locator('[data-cc-rail]').click();}

for(const viewport of viewports)test(`communication center layout and mail workflow at ${viewport.width}x${viewport.height}`,async t=>{
  const f=await browserFixture(t,{viewport}),{page}=f,tag=viewport.width+'x'+viewport.height;
  // Bilder sind standardmäßig an; der Browsertest prüft den gesperrten Modus, weil externe Anfragen hier verboten sind.
  await page.addInitScript(()=>{try{localStorage.setItem('wg-cc-images','off');}catch{/* optional */}});
  // Kurze Schrittzeit: ein hängender Schritt darf die übrigen Bildschirmbreiten nicht abbrechen.
  page.setDefaultTimeout(10000);
  await f.seedOrder({status:'In Arbeit'});
  await ingestMessage(f.env,plain('Frage zur Politur'),{folder:'INBOX',uid:1,uidValidity:'browser'});
  await ingestMessage(f.env,html,{folder:'INBOX',uid:2,uidValidity:'browser'});
  // Realistische Voraussetzung: Postfach ist eingerichtet, die eigene Adresse ist bekannt.
  await page.goto(origin);await page.locator('#content h1').first().waitFor();
  await page.evaluate(async owner=>{const response=await fetch('/api/mailbox/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:owner,displayName:'White Gloss',imapHost:'imap.example.invalid',imapPort:993,imapSecure:true,smtpHost:'smtp.example.invalid',smtpPort:465,smtpSecure:true,username:owner,password:'synthetic-browser-secret'})});if(!response.ok)throw Error(await response.text());},owner);
  await page.goto(origin+'/#mailbox');await page.locator('.cc-head h1').waitFor();await page.locator('.cc-kpi').first().waitFor();
  assert.equal((await page.locator('.cc-head h1').textContent()).trim(),'Übersicht');await noOverflow(page,'start view');
  // Kennzahlen stehen linksbündig mit gleichem Einzug; auf dem Handy liegt der Kopf in einer Reihe.
  const kpis=await page.locator('.cc-kpi').evaluateAll(cards=>cards.map(card=>{const box=card.getBoundingClientRect();return [...card.children].map(child=>Math.round(child.getBoundingClientRect().left-box.left));}));
  t.diagnostic('kpi insets '+tag+' '+JSON.stringify(kpis));
  assert.ok(kpis.length>=5&&kpis.flat().every(inset=>inset>=10&&inset<=24),'every figure starts at the left edge of its card');
  if(viewport.width<=760){const head=await page.locator('.cc-head').evaluate(element=>({h:Math.round(element.getBoundingClientRect().height),targets:[...element.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>Math.round(Math.min(b.getBoundingClientRect().width,b.getBoundingClientRect().height)))}));t.diagnostic('cc head '+tag+' '+JSON.stringify(head));assert.ok(head.h<=56,'title and status share one row: '+head.h);assert.ok(head.targets.every(size=>size>=44),'header buttons are 44px targets: '+head.targets);}
await f.screenshot('communication-home-'+tag,{fullPage:false});

  await openRail(page,viewport.width);await page.locator('.cc-rail [data-mail-folder="INBOX"]').click();await page.locator('.cc-row[data-mail-open]').nth(1).waitFor();
  assert.equal(await page.locator('.cc-row.unread').count(),2);await noOverflow(page,'inbox');

  await page.locator('.cc-row',{hasText:'Sommeraktion'}).click();const frame=page.frameLocator('[data-mail-frame]');await frame.locator('.hero').waitFor();
  assert.equal(await frame.locator('body').getAttribute('data-executed'),null,'scripts in mail never run');
  assert.ok(await page.locator('.cc-images-blocked').isVisible(),'blocked external images are announced');
  assert.equal(await frame.locator('.hero').evaluate(element=>getComputedStyle(element).fontSize),'22px','mail styles render inside the sandbox');
  await page.waitForFunction(()=>document.querySelector('[data-mail-frame]').getBoundingClientRect().height>=180);
  if(viewport.width<1000){assert.equal(await page.locator('.cc-list').isVisible(),false,'single column shows the reader only');}
  if(viewport.width<=760){
    // Die Leseleiste beginnt am oberen Rand der Karte und verdeckt den Nachrichtenkopf nicht.
    await page.evaluate(()=>window.scrollTo(0,0));
    const reader=await page.evaluate(()=>{const top=selector=>document.querySelector(selector).getBoundingClientRect();const card=top('.cc-reader'),bar=top('.cc-reader-bar'),head=top('.cc-message-head');return {gap:Math.round(bar.top-card.top),overlap:Math.round(bar.bottom-head.top),barH:Math.round(bar.height)};});
    t.diagnostic('reader bar '+tag+' '+JSON.stringify(reader));
    assert.ok(reader.gap<=2,'no empty space above the reader bar: '+reader.gap);assert.ok(reader.overlap<=1,'the bar does not cover the message head: '+reader.overlap);
  }
  await noOverflow(page,'reader');await f.screenshot('communication-reader-'+tag,{fullPage:false});
  if(viewport.width<1000){await page.locator('.cc-back').click();await page.locator('.cc-list').waitFor({state:'visible'});}

  await page.locator('.cc-row',{hasText:'Frage zur Politur'}).click();await page.locator('.cc-crm').waitFor();assert.match(await page.locator('.cc-crm').textContent(),/In Arbeit/);
  const layout=await geometry(page,'[data-mail-reply-all]');t.diagnostic('reply-all geometry '+tag+' '+JSON.stringify(layout));
  assert.ok(layout.reader.sw<=layout.reader.cw+1,'reader content fits its column without horizontal overflow');
  assert.equal(layout.mail.sl,0,'mail panes are not shifted sideways');
  await page.locator('[data-mail-reply-all]').click({timeout:10000});const compose=page.locator('#mailbox-compose');await compose.waitFor();
  assert.equal(await compose.locator('[name="cc"]').inputValue(),'partner@example.invalid');
  const box=await compose.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,'editor fits the viewport');
  await compose.locator('[data-compose-editor]').click();await page.keyboard.type('Gerne am Freitag.');await f.screenshot('communication-compose-'+tag,{fullPage:false});
  await page.locator('[data-mail-compose-close]').click();await page.locator('[data-compose-discard]').click();await compose.waitFor({state:'detached'});

  for(const section of ['orders','calendar']){await openRail(page,viewport.width);await page.locator(`.cc-rail [data-cc-section="${section}"]`).click();await page.locator(section==='orders'?'.cc-order-card':'.cc-day').first().waitFor();await noOverflow(page,section);}
  await f.screenshot('communication-calendar-'+tag,{fullPage:false});
  await openRail(page,viewport.width);await page.locator('.cc-rail [data-mail-notes]').click();await page.locator('#cc-note-body').fill('Rückruf vor Terminbestätigung');await page.locator('#mail-note-form [type="submit"]').click();
  const noteShown=await page.locator('.cc-note',{hasText:'Rückruf'}).waitFor({timeout:8000}).then(()=>true,()=>false);
  if(!noteShown){
    // Protokolliert Zustand von Formular, Statuszeile, Anfragen und Seitenfehlern für die Ursachenanalyse.
    const state=await page.evaluate(async()=>{const api=await (await fetch('/api/mailbox')).json(),form=document.querySelector('#mail-note-form'),active=document.activeElement;return {status:document.querySelector('[data-mailbox-message]')?.textContent,toast:document.querySelector('#toast')?.textContent,busy:document.querySelector('#mailbox-root')?.getAttribute('aria-busy'),notesApi:api.notes?.length,notesDom:document.querySelectorAll('.cc-note').length,body:form?.elements.body?.value,valid:form?.checkValidity(),active:active?.tagName+'#'+active?.id,section:document.querySelector('[data-cc]')?.dataset.section};});
    t.diagnostic('note diagnostics '+tag+' '+JSON.stringify({...state,requests:f.requests.filter(item=>item.path.startsWith('/api/mailbox')).slice(-8),errors:f.errors}));
  }
  assert.ok(noteShown,'saved note appears in the notes list');await noOverflow(page,'notes');
  assert.ok(!f.requests.some(item=>item.path.startsWith('/pixel')),'tracking pixel was never requested');assert.deepEqual(f.errors,[]);
});
