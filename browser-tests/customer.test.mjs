// Genuine Linux CI only. Every request is routed to an isolated application in this process.
// No listener, production account, external provider, real message or customer upload is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserFixture,origin,customer} from './harness.mjs';
import {digest} from '../server/auth.mjs';
import {getOrder} from '../src/worker.mjs';
import {COMPANY} from '../src/company.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ypcAAAAASUVORK5CYII=','base64');
const viewports=[{width:390,height:740},{width:1366,height:768}];
async function draw(page,selector){
  const canvas=page.locator(selector);await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert.ok(box?.width>0&&box.height>0);
  await page.mouse.move(box.x+box.width*.12,box.y+box.height*.6);await page.mouse.down();await page.mouse.move(box.x+box.width*.35,box.y+box.height*.2,{steps:8});await page.mouse.move(box.x+box.width*.78,box.y+box.height*.65,{steps:12});await page.mouse.up();
}
async function noOverflow(page){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'customer page has no horizontal overflow');}
async function cachedCompletion(f,order){
  const at=new Date().toISOString(),invoiceId=randomUUID(),invoiceAsset=randomUUID(),signatureAsset=randomUUID(),bytes=Buffer.from('%PDF-1.7\nTEST · isolated cached invoice');
  const invoice={provider:'qonto',id:invoiceId,number:order.wg,status:'unpaid',issueDate:'2035-10-01',dueDate:'2035-10-08',totalCents:45625,vatBasisPoints:1900,mode:'invoice',lines:[{title:'Reinigung und vereinbarte Mehrarbeit',amountCents:45625}],payment:{beneficiary:'TEST · White Gloss',iban:'DE89370400440532013000'},url:'https://pay.qonto.com/invoices/synthetic'};
  const intake={business:{...COMPANY},wg:order.wg,customer:order.source.name,vehicle:order.source.vehicle,plate:order.source.plate,condition:'TEST · Dokumentierter Zustand',customerName:order.source.name,customerSignature:signatureAsset,operatorSignature:null,signedAt:at,savedAt:at,signedRemotely:true,photos:[],damages:[],paint:{readings:[]},checklist:{}};
  const updated={...order,status:'Erledigt',completedAt:at,invoice,intake};
  await f.env.DB.prepare("UPDATE orders SET status='Erledigt',version=version+1,data=? WHERE id=?").bind(JSON.stringify(updated),order.id).run();
  for(const [id,kind,mime,data] of [[invoiceAsset,'invoice','application/pdf',bytes],[signatureAsset,'signature','image/png',png]]){
    await f.env.BUCKET.put(id,data,{httpMetadata:{contentType:mime}});await f.env.DB.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').bind(id,order.id,kind,mime,digest(data),data.length,at).run();
  }
  await f.env.DB.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?)').bind(order.id,invoiceId,invoiceAsset,at).run();return updated;
}
async function send(page,text){
  await page.locator('#portal-chat textarea').fill(text);
  const sent=page.waitForResponse(response=>response.url().includes('/message')&&response.request().method()==='POST'&&response.status()===200);
  await page.locator('#portal-chat .chat-send').click();await sent;
  await page.waitForFunction(value=>document.querySelector('#portal-chat .chat-list')?.textContent.includes(value),text);
}

for(const viewport of viewports)test(`customer signs a proposed appointment and accesses own invoice and protocol PDFs at ${viewport.width}px`,async t=>{
  const f=await browserFixture(t,{viewport,identity:customer}),{page}=f,order=await f.seedOrder();
  await f.seedOrder({source:{name:'Other Customer',email:'foreign@example.invalid',vehicle:'FOREIGN SECRET'}});
  await page.goto(origin+'/kunde');await page.locator('[data-form="confirm"]').waitFor();assert.ok(!(await page.locator('body').textContent()).includes('FOREIGN SECRET'));
  await draw(page,'[data-form="confirm"] canvas');await page.locator('[data-form="confirm"] [name="confirmed"]').check();await page.locator('[data-form="confirm"] [type="submit"]').click();await page.locator('.portal-confirmed').waitFor();
  const accepted=await getOrder(f.env,order.id);assert.equal(accepted.status,'Termin verbindlich');assert.equal(accepted.appointment.confirmation.mode,'online');assert.ok(accepted.appointment.confirmation.signature);
  await cachedCompletion(f,accepted);await page.reload();await page.locator('.portal-invoice').waitFor();assert.match(await page.locator('.portal-invoice').textContent(),/456,25/);assert.match(await page.locator('.portal-invoice').textContent(),/Offen/);
  assert.equal(await page.getByRole('link',{name:'Online bezahlen'}).getAttribute('href'),'https://pay.qonto.com/invoices/synthetic');
  const links=await page.locator('.portal-docs a,.portal-invoice a[download]').evaluateAll(elements=>elements.map(element=>({url:element.getAttribute('href'),download:element.hasAttribute('download')})));assert.equal(links.length,3);
  for(const link of links){assert.ok(link.download);const response=await page.evaluate(async url=>{const r=await fetch(url),bytes=new Uint8Array(await r.arrayBuffer());return {status:r.status,type:r.headers.get('content-type'),prefix:new TextDecoder().decode(bytes.slice(0,5))};},link.url);assert.deepEqual(response,{status:200,type:'application/pdf',prefix:'%PDF-'});}
  await noOverflow(page);assert.deepEqual(f.errors,[]);
});

for(const viewport of viewports)test(`customer requests extras and a date change, sends chat photos per order and logs out at ${viewport.width}px`,async t=>{
  const f=await browserFixture(t,{viewport,identity:customer}),{page}=f,first=await f.seedOrder({status:'Termin verbindlich'}),second=await f.seedOrder({status:'Termin verbindlich',source:{name:'Erika Muster',email:customer,vehicle:'Audi A4',plate:'TEST-2',packageId:'premium',classId:'suv'}});
  await page.goto(origin+'/kunde#'+first.id);await page.locator('.portal-hero').waitFor();assert.match(await page.locator('.portal-hero').textContent(),/VW Golf/);
  await page.locator('.portal-extrasbox summary').click();await page.locator('[data-form="extras"] [value="tierhaar"]').check();await page.locator('[data-form="extras"] [name="note"]').fill('TEST · Hund fährt mit');await page.locator('[data-form="extras"] [type="submit"]').click();await page.locator('.portal-requests').waitFor();assert.match(await page.locator('.portal-requests').textContent(),/Tierhaarentfernung/);
  await page.locator('.portal-termin details summary').click();await page.locator('[data-form="termin"] [name="wish"]').fill('TEST · Lieber am Vormittag');await page.locator('[data-form="termin"] [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('.portal-termin')?.textContent.includes('liegt uns vor'));
  const requests=await f.env.DB.prepare('SELECT kind FROM portal_requests WHERE order_id=? ORDER BY kind').bind(first.id).all();assert.deepEqual(requests.results.map(row=>row.kind),['extras','termin']);assert.equal((await getOrder(f.env,first.id)).offer.totalCents,43625,'requests do not change the agreed price');
  await page.locator('[data-act="chat"]').click();await page.locator('#portal-chat textarea').waitFor();await send(page,'TEST · Nachricht zum VW');
  await page.locator('[data-order="'+second.id+'"]').click();await page.locator('[data-act="chat"]').click();await page.locator('#portal-chat textarea').waitFor();assert.ok(!(await page.locator('#portal-chat').textContent()).includes('Nachricht zum VW'));
  const chooser=page.waitForEvent('filechooser');await page.locator('[data-act="photo"]').click();await (await chooser).setFiles({name:'test-fahrzeug.png',mimeType:'image/png',buffer:png});await page.locator('.chat-pending .chat-chip').waitFor();await send(page,'TEST · Foto zum Audi');
  const message=await f.env.DB.prepare('SELECT t.order_id,(SELECT COUNT(*) FROM chat_attachments c WHERE c.message_id=m.id) AS files FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id WHERE m.body=?').bind('TEST · Foto zum Audi').first();assert.equal(message.order_id,second.id);assert.equal(message.files,1);assert.ok(f.requests.some(request=>request.method==='POST'&&/\/file$/.test(request.path)&&request.status===200));
  await noOverflow(page);await page.locator('[data-act="logout"]').click();await page.waitForURL(url=>url.pathname==='/auth/login');await page.locator('#auth-email').waitFor();assert.equal(await page.evaluate(async()=>fetch('/api/portal/me').then(r=>r.status)),401);assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM auth_sessions').first()).n,0);assert.deepEqual(f.errors,[]);
});

test('mobile customer accepts the offer and appointment with one real canvas signature',async t=>{
  const f=await browserFixture(t,{viewport:{width:390,height:740},identity:customer}),{page}=f,token='a'.repeat(64),expiresAt=new Date(Date.now()+86400000).toISOString();
  const order=await f.seedOrder({status:'Angebot offen',acceptance:null,offerToken:token,offer:{lines:[{id:'package',kind:'package',title:'TEST · Fahrzeugpflege',amountCents:43625}],services:'TEST · Fahrzeugpflege',totalCents:43625,pickupCents:0,createdAt:new Date().toISOString(),expiresAt}});
  await f.env.DB.prepare('INSERT INTO offer_tokens(hash,order_id,expires_at) VALUES(?,?,?)').bind(digest(token),order.id,expiresAt).run();
  await page.goto(origin+'/kunde');const action=page.locator('.portal-todo a[href="/angebot/'+token+'"]');await action.waitFor();assert.match(await action.textContent(),/Angebot & Termin/);assert.equal(await page.locator('[data-form="confirm"]').count(),0);await action.click();await page.locator('#customerOfferForm').waitFor();
  await draw(page,'#offerSignature');await page.locator('#offerObligation').check();await page.locator('#offerAppointment').check();await noOverflow(page);await page.locator('#customerOfferForm [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('h1')?.textContent.includes('Annahme ist gespeichert'));
  const saved=await getOrder(f.env,order.id);assert.equal(saved.status,'Termin verbindlich');assert.equal(saved.acceptance.signature,saved.appointment.confirmation.signature);assert.equal(f.files.size,1);assert.equal(f.requests.filter(request=>request.path==='/api/offer/'+token&&request.method==='POST').length,1);assert.deepEqual(f.errors,[]);
});
