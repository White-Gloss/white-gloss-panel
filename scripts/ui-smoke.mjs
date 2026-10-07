// Never run a browser or web server on the operator's computer.
if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true')throw Error('UI-Prüfung ausschließlich auf dem isolierten Linux-GitHub-Runner.');
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {PanelDatabase,StaticAssets} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {signatureBytes} from '../tests/fixtures/signature.mjs';
import {COMPANY} from '../src/company.mjs';
const origin='https://panel.example.invalid',files=new Map(),env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(COMPANY.email),CONFIG_KEY:Buffer.alloc(32,9).toString('base64'),DB:new PanelDatabase(':memory:'),ASSETS:new StaticAssets('dist/client'),BUCKET:{async put(id,bytes,opts){files.set(id,{body:new Uint8Array(bytes),httpMetadata:opts.httpMetadata});},async get(id){return files.get(id);},async delete(id){files.delete(id);}}};
const app=await createApplication(env),raw=digest('synthetic-owner-only');await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),COMPANY.email,Date.now()+3600000,Date.now()).run();
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));await context.addCookies([{name:'__Host-wg-session',value:raw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
// Fulfil all HTTP requests through App.fetch. There is no listening website server.
await context.route('**/*',async route=>{
  const request=route.request();if(new URL(request.url()).origin!==origin)throw Error('Unexpected external browser request');
  const headers=await request.allHeaders(),method=request.method(),body=request.postDataBuffer();
  const response=await app.fetch(new Request(request.url(),{method,headers,...(!['GET','HEAD'].includes(method)?{body}:{} )}));
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
});
await mkdir('ui-evidence',{recursive:true});
try{
  await page.goto(origin);await page.getByRole('heading',{name:'Heute erledigen'}).waitFor();
  await page.getByRole('button',{name:'Testbereich',exact:true}).click();
  await page.getByRole('button',{name:'Annahme direkt starten',exact:true}).click();
  const create=page.locator('#directCreateForm');await create.locator('[name=name]').fill('TEST · Übergabe');await create.locator('[name=vehicle]').fill('TEST · Fahrzeug');await create.locator('[name=email]').fill('synthetic@example.invalid');await create.locator('[name=plate]').fill('TEST 123');await create.getByRole('button',{name:'Annahme vorbereiten'}).click();
  await page.locator('#protocolform').waitFor();await page.screenshot({path:'ui-evidence/direct-intake.png',fullPage:true});
  for(const kind of ['intake','return']){
    if(kind==='return')await page.getByRole('tab',{name:'Rückgabe',exact:true}).click();
    const form=page.locator('#protocolform');if(kind==='intake')await form.locator('[name=directReason]').fill('TEST · spontan vorbeigebracht');
    await form.locator('[name=location]').fill('TEST · Betrieb');await form.locator('[name=mileage]').fill('12000');await form.locator('[name=keys]').fill('1');await form.locator('[name=condition]').fill('TEST · Zustand mit Foto festgehalten');
    if(kind==='return'){await form.locator('[name=services]').fill('TEST · Reinigung abgeschlossen');await form.locator('[name=workComplete]').check();}
    await form.locator('#protocolphotos').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:signatureBytes()});await form.getByRole('button',{name:'Protokoll anzeigen & persönlich unterschreiben'}).click();
    await page.locator('#modal').waitFor({state:'visible'});
    for(const id of ['customerSign','operatorSign']){const canvas=page.locator('#'+id);await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.move(box.x+20,box.y+50);await page.mouse.down();await page.mouse.move(box.x+120,box.y+75,{steps:12});await page.mouse.move(box.x+180,box.y+25,{steps:10});await page.mouse.up();}
    await page.locator('#signatureform [name=confirmed]').check();await page.getByRole('button',{name:'Protokoll verbindlich speichern',exact:true}).click();await page.locator('#modal').waitFor({state:'hidden'});if(kind==='return')await page.getByRole('tab',{name:'Rückgabe',exact:true}).click();await page.getByText('Bestätigtes '+(kind==='intake'?'Annahmeprotokoll':'Rückgabeprotokoll'),{exact:true}).waitFor();
  }
  await page.locator('[data-view=customers]').click();await page.getByRole('button',{name:'Kundenakte öffnen'}).click();await page.getByRole('heading',{name:'Aufträge, Pflege- und Schadenverlauf'}).waitFor();await page.screenshot({path:'ui-evidence/customer-file.png',fullPage:true});
  await page.getByText('Pflege / verwendete Produkte dokumentieren',{exact:true}).click();const care=page.locator('[data-file-care]');await care.locator('[name=product]').fill('TEST · Reiniger');await care.locator('[name=work]').fill('TEST · Innenraum');await care.getByRole('button',{name:'Zur Fahrzeughistorie hinzufügen'}).click();await page.getByText('TEST · Reiniger',{exact:true}).waitFor();
  // Seed an independently accepted synthetic order to exercise owner amendment UI.
  const id=crypto.randomUUID(),o={id,wg:'TEST-NACHTRAG',version:1,synthetic:true,status:'Termin verbindlich',source:{name:'TEST · Nachtrag',email:'synthetic@example.invalid',vehicle:'TEST · Wagen'},offer:{services:'Grundreinigung',totalCents:10000},acceptance:{at:new Date().toISOString()},appointment:{start:'2099-10-06T08:00:00Z',end:'2099-10-06T10:00:00Z'},notes:[],payments:[]};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,1)').bind(id,o.wg,o.status,JSON.stringify(o),new Date().toISOString(),'test','fixture').run();
  await page.goto(origin+'/?order='+id);await page.getByRole('tab',{name:'Nachträge',exact:true}).click();const amendment=page.locator('#amendmentform');await amendment.locator('[name=services]').fill('TEST · Tierhaare');await amendment.locator('[name=reason]').fill('TEST · Mehr Aufwand');await amendment.locator('[name=amount]').fill('25');await amendment.locator('[name=extraMinutes]').fill('45');await amendment.getByRole('button',{name:'Nachtrag zur Freigabe anlegen'}).click();await page.getByText('Status: Kundenfreigabe offen',{exact:true}).waitFor();await page.screenshot({path:'ui-evidence/amendment.png',fullPage:true});
  const saved=JSON.parse((await env.DB.prepare('SELECT data FROM orders WHERE id=?').bind(id).first()).data),customerRaw=digest('synthetic-customer-only');
  await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(customerRaw),'synthetic@example.invalid',Date.now()+3600000,Date.now()).run();
  await context.addCookies([{name:'__Host-wg-session',value:customerRaw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
  await page.goto(origin+'/angebot/'+saved.amendments[0].token);await page.getByRole('heading',{name:'Ihr Nachtrag zur Freigabe'}).waitFor();
  const signature=page.locator('#amendmentSignature');await signature.scrollIntoViewIfNeeded();const signatureBox=await signature.boundingBox();await page.mouse.move(signatureBox.x+30,signatureBox.y+30);await page.mouse.down();await page.mouse.move(signatureBox.x+160,signatureBox.y+70,{steps:20});await page.mouse.up();
  await page.locator('#amendmentAccept [name=obligation]').check();await page.getByRole('button',{name:'Nachtrag zahlungspflichtig freigeben'}).click();await page.getByRole('heading',{name:'Nachtrag freigegeben'}).waitFor();await page.screenshot({path:'ui-evidence/customer-amendment.png',fullPage:true});
  await context.addCookies([{name:'__Host-wg-session',value:raw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);await page.goto(origin);await page.getByRole('heading',{name:'Heute erledigen'}).waitFor();await page.getByRole('button',{name:'Testbereich',exact:true}).click();
  await page.locator('[data-view=overview]').click();await page.getByRole('heading',{name:'Heute erledigen'}).waitFor();await page.screenshot({path:'ui-evidence/today.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'ui-evidence/mobile-today.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Mobile page must not overflow');
  await page.getByRole('button',{name:'Menü öffnen'}).click();await page.getByRole('button',{name:'Einstellungen',exact:true}).click();await page.getByRole('heading',{name:'Handy-Benachrichtigungen'}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile overview, independent intake/return signatures, customer history, care records and amendment UI. No external messages or listening server.');
}catch(error){await page.screenshot({path:'ui-evidence/failure.png',fullPage:true});throw error;}
finally{await browser.close();env.DB.close();}
