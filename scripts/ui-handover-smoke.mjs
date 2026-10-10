// Browser execution is restricted to the existing isolated Linux GitHub runner.
if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true')throw Error('UI-Prüfung ausschließlich auf dem isolierten Linux-GitHub-Runner.');
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {PanelDatabase,StaticAssets} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest,issueCustomerAccess} from '../server/auth.mjs';
import {getOrder} from '../src/worker.mjs';
import {COMPANY} from '../src/company.mjs';
import {signatureBytes} from '../tests/fixtures/signature.mjs';
import {createTestLetterhead} from '../tests/fixtures/letterhead.mjs';

const origin='https://panel.example.invalid',customer='synthetisch@example.invalid',files=new Map(),errors=[];
const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(COMPANY.email),CONFIG_KEY:Buffer.alloc(32,15).toString('base64'),DB:new PanelDatabase(':memory:'),ASSETS:new StaticAssets('dist/client'),BUCKET:{
  async put(id,bytes,options={}){files.set(id,{body:new Uint8Array(bytes),httpMetadata:options.httpMetadata});},
  async get(id){return files.get(id)??null;},async delete(id){files.delete(id);}
}};
globalThis.fetch=()=>{throw Error('External calls are forbidden in the isolated handover UI test');};
const app=await createApplication(env),ownerRaw=digest('TEST isolated handover operator');
await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(ownerRaw),COMPANY.email,Date.now()+86400000,Date.now()).run();
await createTestLetterhead(env);await mkdir('ui-evidence',{recursive:true});
const browser=await chromium.launch();

async function addOrder(label){
  const id=crypto.randomUUID(),offerToken=digest('TEST offer '+id),now=new Date().toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString();
  // This in-memory seed temporarily permits isolated PIN activation. It becomes
  // a synthetic test order before any handover, so no delivery jobs can exist.
  const order={id,wg:'TEST-UEBERGABE-'+label,version:1,status:'Preise prüfen',synthetic:false,createdAt:now,source:{name:'TEST · Kunde '+label,email:customer,vehicle:'TEST · Fahrzeug '+label},offerToken,offer:{services:'TEST · Reinigung',totalCents:10000,expiresAt},notes:[],payments:[]};
  await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action) VALUES(?,?,?,?,?,?,?)').bind(id,order.wg,order.status,JSON.stringify(order),now,'test','isolated handover UI fixture').run();
  await env.DB.prepare('INSERT INTO offer_tokens VALUES(?,?,?,0)').bind(digest(offerToken),id,expiresAt).run();
  return order;
}
async function contextFor(viewport,operator=false){
  const context=await browser.newContext({viewport,serviceWorkers:'block'});
  if(operator)await context.addCookies([{name:'__Host-wg-session',value:ownerRaw,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
  await context.route('**/*',async route=>{
    const request=route.request();assert.equal(new URL(request.url()).origin,origin,'External browser request is forbidden');
    const method=request.method(),response=await app.fetch(new Request(request.url(),{method,headers:await request.allHeaders(),...(!['GET','HEAD'].includes(method)?{body:request.postDataBuffer()}:{} )}));
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  return context;
}
function watch(page){page.on('pageerror',error=>errors.push(error.message));}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Visible content must fit its desktop or mobile viewport');}
async function nav(page,view){if(page.viewportSize().width<=760)await page.locator('[data-click=menu]').click();await page.locator('nav [data-view='+view+']').click();}
async function draw(page,selector){
  const canvas=page.locator(selector);await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert.ok(box);
  await page.mouse.move(box.x+box.width*.2,box.y+box.height*.5);await page.mouse.down();
  for(let point=1;point<=12;point++)await page.mouse.move(box.x+box.width*(.2+point*.045),box.y+box.height*(.5+(point%2?.12:-.12)));
  await page.mouse.up();
}
async function screenshot(page,name){await noOverflow(page);await page.screenshot({path:'ui-evidence/handover-'+name+'.png',fullPage:true});}
async function publish(page,order,kind,label){
  await nav(page,'handovers');
  await page.locator('[data-click='+ (kind==='intake'?'directHandoverIntake':'directHandoverReturn') +']').click();
  await page.locator('#directExistingForm [name=orderId]').selectOption(order.id);await page.locator('#directExistingForm [type=submit]').click();
  await page.locator('#handoverform').waitFor();
  assert.equal(await page.locator('[data-handover-mode=remote]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-handover-mode=present]').click();await page.locator('#protocolform').waitFor();
  await page.locator('[data-handover-mode=remote]').click();const form=page.locator('#handoverform');await form.waitFor();
  for(const [name,value] of Object.entries({directReason:'TEST · independently agreed handover',plate:'TEST-WG-1',at:'2026-10-09T14:00',location:'TEST · Stellplatz '+label,mileage:kind==='intake'?'12345':'12350',keys:'1',condition:'TEST · documented vehicle condition'}))await form.locator('[name='+name+']').fill(value);
  await form.locator('[name=photos]').setInputFiles({name:'TEST-condition.png',mimeType:'image/png',buffer:signatureBytes()});
  if(kind==='return'){
    await form.locator('[name=services]').fill('TEST · cleaning completed');await form.locator('[name=workComplete]').check();
    await form.locator('[name=keyLocation]').fill('TEST · vereinbartes Schlüsselfach '+label);
    await form.locator('[name=keyPhotoFile]').setInputFiles({name:'TEST-key-location.png',mimeType:'image/png',buffer:signatureBytes()});
  }
  await screenshot(page,label+'-operator-'+kind+'-form');await form.locator('[type=submit]').click();
  await page.locator('#handoverSignatureForm').waitFor();assert.equal(await page.locator('#customerSign').count(),0,'Only the operator signs during preparation');
  if(kind==='return')assert.equal(await page.locator('#modal .protocol-key-photo').count(),1,'The key location proof must be visible before operator signature');
  await draw(page,'#operatorSign');await page.locator('#handoverSignatureForm [name=confirmed]').check();await screenshot(page,label+'-operator-'+kind+'-review');
  await page.locator('#handoverSignatureForm [type=submit]').click();await page.locator('[data-click=handoverLink]').waitFor();
  const current=await getOrder(env,order.id);assert.equal(current.handovers[kind].status,'pending');assert.equal(current[kind],undefined);assert.equal(current.acceptance,undefined);
  await screenshot(page,label+'-operator-'+kind+'-pending');return current;
}
async function complete(page,context,order,kind,label){
  await page.goto(origin+'/kundenportal');const href='/protokoll/'+order.handovers[kind].token;
  await page.locator('a.handover-link[href="'+href+'"]').waitFor();await screenshot(page,label+'-customer-'+kind+'-portal');
  await page.locator('a.handover-link[href="'+href+'"]').click();await page.locator('#customerHandoverForm').waitFor();
  assert.equal(await page.locator('[alt="Unterschrift des Betriebsvertreters"]').count(),1);
  if(kind==='return'){
    const key=page.locator('.protocol-key-photo');await key.scrollIntoViewIfNeeded();await key.evaluate(image=>image.decode());
    assert.equal(await key.getAttribute('alt'),'Dokumentierter Ort der Schlüsselablage');
    await page.getByText('TEST · vereinbartes Schlüsselfach '+label,{exact:true}).waitFor();
  }
  await draw(page,'#handoverSignature');await page.locator('#handoverConfirmation').check();await screenshot(page,label+'-customer-'+kind+'-review');
  await page.locator('#customerHandoverForm [type=submit]').click();await page.getByText('Abgeschlossen · beide Unterschriften gespeichert',{exact:true}).waitFor();
  assert.equal(await page.locator('#customerHandoverForm').count(),0);await screenshot(page,label+'-customer-'+kind+'-completed');
  const current=await getOrder(env,order.id);assert.equal(current.handovers[kind].status,'completed');assert.equal(current.status,kind==='intake'?'In Arbeit':'Erledigt');
  await page.goto(origin+'/kundenportal');const document='/api/customer-portal/document?id='+order.id+'&kind='+kind;
  await page.locator('a[href="'+document+'"]').waitFor();
  const cookies=(await context.cookies()).map(cookie=>cookie.name+'='+cookie.value).join('; '),pdf=await app.fetch(new Request(origin+document,{headers:{cookie:cookies}}));
  assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');return current;
}

try{
  let personalPin;
  for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]] ){
    let order=await addOrder(label);
    if(!personalPin){const access=await issueCustomerAccess(env,customer,'/angebot/'+order.offerToken),activated=await app.fetch(new Request(origin+'/auth/redeem',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:new URL(access.url).searchParams.get('token'),pin:access.pin})}));assert.equal(activated.status,200);personalPin=access.pin;}
    order.synthetic=true;await env.DB.prepare("UPDATE orders SET data=?,synthetic=1,version=version+1,action='TEST flag before UI actions' WHERE id=?").bind(JSON.stringify(order),order.id).run();
    const operator=await contextFor(viewport,true),admin=await operator.newPage();watch(admin);await admin.goto(origin);
    assert.equal(await admin.locator('nav [data-view=protocols]').count(),1);assert.equal(await admin.locator('nav [data-view=handovers]').count(),1);
    await admin.locator('[data-click=test]').click();await nav(admin,'protocols');await admin.getByRole('heading',{name:'Fahrzeugprotokolle',exact:true}).waitFor();await screenshot(admin,label+'-legacy-menu');
    order=await publish(admin,order,'intake',label);
    const client=await contextFor(viewport),page=await client.newPage();watch(page);await page.goto(origin+'/auth/login?customer=1');
    await page.locator('#auth-email').fill(customer);await page.locator('#auth-pin').fill(personalPin);await page.getByRole('button',{name:'Mit PIN anmelden',exact:true}).click();await page.getByRole('heading',{name:'Mein Kundenpanel',exact:true}).waitFor();
    order=await complete(page,client,order,'intake',label);
    await admin.locator('[data-click=back]').click();await admin.locator('[data-click=refresh]').click();order=await publish(admin,order,'return',label);order=await complete(page,client,order,'return',label);
    assert.equal(order.acceptance,undefined);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM protocol_deliveries').first()).n,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM jobs').first()).n,0);
    await operator.close();await client.close();
  }
  assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile separate and original menus, onsite choice, direct remote intake and return, photos, operator-first signature, repeat PIN portal access, customer review/signature, key location proof and final PDF. Synthetic App.fetch fixtures only; no listener or external mail.');
}catch(error){for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:'ui-evidence/handover-failure-'+browser.contexts().indexOf(context)+'-'+context.pages().indexOf(page)+'.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser.close();env.DB.close();}
