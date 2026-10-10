// Browser verification is restricted to the existing isolated Linux CI runner.
if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true')throw Error('UI-Prüfung ausschließlich auf dem isolierten Linux-GitHub-Runner.');
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {PanelDatabase,StaticAssets} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {signatureBytes} from '../tests/fixtures/signature.mjs';
const origin='https://panel.example.invalid',owner='owner@example.invalid',customer='customer@example.invalid',files=new Map();
const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),ASSETS:new StaticAssets('dist/client'),BUCKET:{async put(id,bytes,opts){files.set(id,{body:new Uint8Array(bytes),httpMetadata:opts.httpMetadata});},async get(id){return files.get(id);},async delete(id){files.delete(id);}}};
const app=await createApplication(env),raw=digest('eight-features-owner');
await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
const id=crypto.randomUUID(),at=new Date().toISOString(),o={id,wg:'TEST-ACHT',version:1,synthetic:true,status:'Preise prüfen',source:{name:'TEST · Bericht',email:customer,vehicle:'TEST · Fahrzeug',plate:'TEST 123',package:'Innenpflege'},notes:[],payments:[],createdAt:at};
await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,1)').bind(id,o.wg,o.status,JSON.stringify(o),at,'test','fixture').run();
for(let i=0;i<2;i++){const asset=crypto.randomUUID(),bytes=signatureBytes();await env.BUCKET.put(asset,bytes,{httpMetadata:{contentType:'image/png'}});await env.DB.prepare("INSERT INTO assets VALUES(?,?,'photo','image/png',?,?,?)").bind(asset,id,digest(bytes),bytes.length,at).run();}
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'__Host-wg-session',value:raw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
const routeApplication=async route=>{const req=route.request();assert.equal(new URL(req.url()).origin,origin,'No external requests in synthetic UI test');const method=req.method(),body=req.postDataBuffer(),response=await app.fetch(new Request(req.url(),{method,headers:await req.allHeaders(),...(!['GET','HEAD'].includes(method)?{body}:{})}));await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});};
await context.route('**/*',routeApplication);
await mkdir('ui-evidence',{recursive:true});
try{
  await page.goto(origin+'/?order='+id);await page.getByRole('tab',{name:'Bildbericht',exact:true}).click();
  const edit=page.locator('[data-report-edit]'),images=edit.locator('[data-report-image]');await images.first().waitFor();
  for(let i=0;i<2;i++){const entry=images.nth(i);await entry.locator('[name=selected]').check();await entry.locator('[name=phase]').selectOption(i?'after':'before');await entry.locator('[name=motif]').fill('Vordersitze');await entry.locator('[name=customerVisible]').check();}
  await edit.locator('[name=completedServices]').fill('TEST · Sitze gereinigt');await edit.locator('[name=completionConfirmed]').check();await edit.locator('[name=customerReleased]').check();await edit.locator('[name=customerReleaseConfirmed]').check();await edit.getByRole('button',{name:'Bericht und Kundenfreigabe speichern'}).click();
  await page.getByRole('heading',{name:'Ergebnisbericht · TEST-ACHT'}).waitFor();await page.screenshot({path:'ui-evidence/eight-11-report-desktop.png',fullPage:true});
  await page.getByText('Gesonderte Werbefreigaben verwalten',{exact:true}).click();const grant=page.locator('[data-report-grant]');await grant.locator('[name=consentDate]').fill('2026-10-01');await grant.locator('[name=evidence]').fill('TEST · gesonderte Bildfreigabe für die Website');await grant.locator('[name=explicitConsent]').check();await grant.getByRole('button',{name:'Werbefreigabe dokumentieren'}).click();
  await page.locator('[data-report-revoke]').waitFor({state:'attached'});
  await page.getByText('Kennzeichenmaskierung prüfen & Werbebilder exportieren',{exact:true}).click();const assetId=await page.locator('[data-report-image]').first().getAttribute('data-report-image');await page.locator('[data-mask-asset]').selectOption(assetId);await page.locator('[data-mask-none]').check();await page.locator('[data-mask-generate]').click();await page.locator('[data-mask-approve] [name=reviewed]').check();await page.locator('[data-mask-approve] button').click();
  await page.getByRole('link',{name:/für Website als geprüftes PNG exportieren/}).waitFor({state:'attached'});
  await page.getByText('Kennzeichenmaskierung prüfen & Werbebilder exportieren',{exact:true}).click();await page.getByRole('link',{name:/für Website als geprüftes PNG exportieren/}).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'ui-evidence/eight-11-report-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Report must fit mobile viewport');
  // 12: accepted synthetic appointment; configuring a reminder never sends it.
  const appointment={id:crypto.randomUUID(),start:new Date(Date.now()+72*3600000).toISOString(),end:new Date(Date.now()+74*3600000).toISOString(),duration:120,delivery:'Kunde bringt',location:'TEST · vereinbarter Übergabeort'},offer={services:'TEST · Innenraumaufbereitung',totalCents:19000};
  const appointmentOrder={...o,status:'Termin verbindlich',appointment,offer,acceptance:{at,appointmentOptionId:appointment.id,snapshotHash:'synthetic-proof',snapshot:{appointment,offer}}};
  await env.DB.prepare("UPDATE orders SET data=?,status=?,version=version+1,action='Synthetic appointment fixture' WHERE id=?").bind(JSON.stringify(appointmentOrder),appointmentOrder.status,id).run();
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/?order='+id);await page.getByRole('tab',{name:'Termin',exact:true}).click();
  const reminder=page.locator('#appointment-reminders');await reminder.locator('[name=leadHours]').fill('36');await reminder.locator('[name=evidence]').fill('TEST · Erinnerung mit der Kundin vereinbart');await reminder.locator('[name=preparationReviewed]').check();await reminder.locator('[name=communicationApproved]').check();await reminder.locator('[name=enabled]').check();await reminder.locator('[data-preview]').click();await page.waitForFunction(()=>document.querySelector('#appointment-reminders [data-preview-text]')?.textContent.includes('TEST · vereinbarter Übergabeort'));
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/appointment-reminders?')&&r.request().method()==='GET'),reminder.getByRole('button',{name:'Einstellungen speichern',exact:true}).click()]);await page.waitForFunction(()=>document.querySelector('#appointment-reminders [name=leadHours]')?.value==='36'&&document.querySelector('#appointment-reminders [name=enabled]')?.checked);
  assert.equal(JSON.parse((await env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(id).first()).data).appointmentReminder.leadHours,36);
  await page.screenshot({path:'ui-evidence/eight-12-reminder-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'ui-evidence/eight-12-reminder-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Reminder must fit mobile viewport');
  // 13: customer sees released content, and pickup readiness requires the owner action.
  const latest=JSON.parse((await env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(id).first()).data);latest.status='In Arbeit';
  await env.DB.prepare("UPDATE orders SET data=?,status=?,version=version+1,action='Synthetic work fixture' WHERE id=?").bind(JSON.stringify(latest),latest.status,id).run();
  const customerRaw=digest('eight-features-customer');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(customerRaw),customer,Date.now()+3600000,Date.now()).run();
  const customerContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await customerContext.addCookies([{name:'__Host-wg-session',value:customerRaw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);await customerContext.route('**/*',routeApplication);
  const portalPage=await customerContext.newPage();portalPage.on('pageerror',error=>errors.push(error.message));await portalPage.goto(origin+'/kundenportal');await portalPage.getByRole('heading',{name:'Ergebnisbericht · TEST-ACHT',exact:true}).waitFor();assert.equal(await portalPage.getByText('Abholbereit',{exact:true}).count(),0);
  await page.goto(origin+'/?order='+id);await page.getByRole('tab',{name:'Kundenzugang',exact:true}).click();const pickup=page.locator('[data-customer-access-pickup]');await pickup.locator('[name=instructions]').fill('TEST · Fahrzeug persönlich geprüft; Abholung vereinbaren.');await pickup.locator('[name=released]').check();await pickup.locator('[name=confirmed]').check();
  await Promise.all([page.waitForResponse(r=>r.url().includes('/api/customer-access?')&&r.request().method()==='POST'),pickup.getByRole('button',{name:'Abholstatus speichern'}).click()]);
  await portalPage.reload();await portalPage.getByText('Abholbereit',{exact:true}).waitFor();await portalPage.screenshot({path:'ui-evidence/eight-13-customer-mobile.png',fullPage:true});assert.equal(await portalPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Customer portal must fit mobile viewport');
  await portalPage.setViewportSize({width:820,height:1180});await portalPage.screenshot({path:'ui-evidence/eight-13-customer-tablet.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: report, image rights, reviewed export, configured reminder and protected customer portal; synthetic data, no listener, no external dispatch.');
}catch(error){await page.screenshot({path:'ui-evidence/eight-failure.png',fullPage:true});throw error;}
finally{await browser.close();env.DB.close();}
