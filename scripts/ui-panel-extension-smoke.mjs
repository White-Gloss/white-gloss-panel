// This browser verification only runs on the existing isolated GitHub Linux runner.
if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true')throw Error('UI-Prüfung ausschließlich auf dem isolierten Linux-GitHub-Runner.');
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {PanelDatabase,StaticAssets} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
const origin='https://panel.example.invalid',owner='owner@example.invalid',token=digest('extension-fixture-session'),id=crypto.randomUUID();
const env={DB:new PanelDatabase(':memory:'),ASSETS:new StaticAssets('dist/client'),PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest(owner),CONFIG_KEY:Buffer.alloc(32,17).toString('base64'),BUCKET:{async get(){return null;}}};
const app=await createApplication(env),at=new Date().toISOString(),order={id,wg:'TEST-EXTENSIONS',synthetic:true,source:{name:'TEST Projektkunde',email:'project@example.invalid',vehicle:'TEST Fahrzeug'},status:'Preise prüfen',notes:[],payments:[],createdAt:at};
await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(token),owner,Date.now()+3600000,Date.now()).run();
await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,1)').bind(id,order.wg,order.status,JSON.stringify(order),at,'test','synthetic fixture').run();
const browser=await chromium.launch(),errors=[];await mkdir('ui-evidence',{recursive:true});
const noOverflow=async page=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Layout must fit viewport');
const calendarRead=(page,from)=>page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/calendar/month'&&response.request().method()==='GET'&&(!from||url.searchParams.get('from')===from);});
async function calendarDate(page,day){
  const [response]=await Promise.all([calendarRead(page,day),(async()=>{const field=page.locator('[data-booking-date]');await field.fill(day);await field.press('Tab');})()]);assert.equal(response.status(),200,await response.text());
  await page.waitForFunction(value=>document.querySelector('[data-booking-entry] [name=start]')?.value.startsWith(value),day);
}
async function calendarWrite(page,action,day,trigger){
  const [response,reload]=await Promise.all([
    page.waitForResponse(response=>new URL(response.url()).pathname==='/api/calendar/action'&&response.request().method()==='POST'&&response.request().postDataJSON()?.action===action),
    calendarRead(page,day),trigger()
  ]);
  const result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));assert.equal(reload.status(),200,await reload.text());
  // A successful HTTP response precedes the client's redraw; wait for its fresh empty editor too.
  await page.waitForFunction(()=>document.querySelector('[data-booking-entry] [name=title]')?.value===''&&!document.querySelector('[data-booking-cancel-edit]'));
  return result;
}
async function calendarPrivateCRUD(page,label){
  const day=label==='desktop'?'2099-12-01':'2099-12-03',movedDay=label==='desktop'?'2099-12-02':'2099-12-04',title='TEST Kalender '+label,changedTitle=title+' geändert';
  await calendarDate(page,day);assert.equal(await page.locator('#booking-calendar').getAttribute('data-synthetic'),'true');
  const form=page.locator('[data-booking-entry]');
  await form.locator('[name=title]').fill(title);await form.locator('[name=kind]').selectOption('appointment');await form.locator('[name=start]').fill(day+'T10:00');await form.locator('[name=end]').fill(day+'T11:30');await form.locator('[name=note]').fill('TEST private Erstnotiz '+label);await form.locator('[name=orderId]').selectOption(id);
  const created=(await calendarWrite(page,'saveEntry',day,()=>form.locator('[type=submit]').click())).entry;
  assert.equal(created.synthetic,1);assert.equal(created.order_id,id);assert.ok(created.customer_id);assert.ok(created.vehicle_id);assert.equal(created.version,1);
  const open=()=>page.locator('[data-booking-edit="'+created.id+'"]').click();
  await open();await page.waitForFunction(value=>document.querySelector('[data-booking-entry] [name=title]')?.value===value,title);
  assert.equal(await form.locator('[name=start]').inputValue(),day+'T10:00');assert.equal(await form.locator('[name=end]').inputValue(),day+'T11:30');assert.equal(await form.locator('[name=orderId]').inputValue(),id);
  await form.locator('[name=title]').fill(changedTitle);await form.locator('[name=note]').fill('TEST geprüfte Notiz '+label);
  const edited=(await calendarWrite(page,'saveEntry',day,()=>form.locator('[type=submit]').click())).entry;
  assert.equal(edited.id,created.id);assert.equal(edited.version,2);assert.equal(edited.title,changedTitle);assert.equal(edited.note,'TEST geprüfte Notiz '+label);
  await open();await page.waitForFunction(value=>document.querySelector('[data-booking-entry] [name=title]')?.value===value,changedTitle);assert.equal(await form.locator('[name=note]').inputValue(),'TEST geprüfte Notiz '+label);
  await form.locator('[data-booking-shift="1"]').click();assert.equal(await form.locator('[name=start]').inputValue(),movedDay+'T10:00');assert.equal(await form.locator('[name=end]').inputValue(),movedDay+'T11:30');
  assert.equal((await env.DB.prepare('SELECT start FROM calendar_entries WHERE id=?').bind(created.id).first()).start,edited.start,'Moving the form must not write before save');
  const moved=(await calendarWrite(page,'saveEntry',day,()=>form.locator('[type=submit]').click())).entry;
  assert.equal(moved.version,3);assert.equal(moved.start,movedDay+'T09:00:00.000Z');assert.equal(moved.end,movedDay+'T10:30:00.000Z');
  await page.locator('[data-booking-edit="'+created.id+'"]').waitFor({state:'detached'});await calendarDate(page,movedDay);await open();
  await page.waitForFunction(value=>document.querySelector('[data-booking-entry] [name=title]')?.value===value,changedTitle);
  assert.equal(await form.locator('[name=start]').inputValue(),movedDay+'T10:00');assert.equal(await form.locator('[name=end]').inputValue(),movedDay+'T11:30');
  const [historyResponse]=await Promise.all([page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/calendar/history'&&url.searchParams.get('id')===created.id;}),page.locator('[data-booking-history="'+created.id+'"]').click()]);
  assert.equal(historyResponse.status(),200);const history=(await historyResponse.json()).history;assert.equal(history.length,3);assert.equal(history[0].before.start,edited.start);assert.equal(history[0].after.start,moved.start);
  await page.getByRole('heading',{name:'Änderungsverlauf',exact:true}).waitFor();await noOverflow(page);await page.screenshot({path:'ui-evidence/calendar-private-edit-move-'+label+'.png',fullPage:true});
  const remove=()=>page.locator('[data-booking-delete="'+created.id+'"]');await remove().click();
  await page.getByRole('button',{name:'Löschen endgültig bestätigen',exact:true}).waitFor();const warning=form.locator('[role=alert]');assert.ok((await warning.textContent()).includes(changedTitle));assert.ok((await warning.textContent()).includes(movedDay));
  assert.ok(await env.DB.prepare('SELECT id FROM calendar_entries WHERE id=?').bind(created.id).first(),'First delete click only previews affected entry');
  await page.locator('[data-booking-cancel-delete]').click();assert.equal(await remove().textContent(),'Löschen');assert.ok(await env.DB.prepare('SELECT id FROM calendar_entries WHERE id=?').bind(created.id).first(),'Cancelling deletion preserves the entry');
  await remove().click();await page.getByRole('button',{name:'Löschen endgültig bestätigen',exact:true}).waitFor();await calendarWrite(page,'deleteEntry',movedDay,()=>remove().click());
  await page.locator('[data-booking-edit="'+created.id+'"]').waitFor({state:'detached'});assert.equal(await env.DB.prepare('SELECT id FROM calendar_entries WHERE id=?').bind(created.id).first(),null);assert.ok(await env.DB.prepare('SELECT id FROM orders WHERE id=?').bind(id).first(),'Deleting a private linked entry preserves its project');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM calendar_entry_history WHERE entry_id=?').bind(created.id).first()).n,4);assert.equal(await page.locator('[data-booking-error]').textContent(),'');await noOverflow(page);await page.screenshot({path:'ui-evidence/calendar-private-deleted-'+label+'.png',fullPage:true});
}
try{
  for(const [label,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
    const context=await browser.newContext({viewport,serviceWorkers:'block'});await context.addCookies([{name:'__Host-wg-session',value:token,url:origin,secure:true,httpOnly:true,sameSite:'Lax'}]);
    await context.route('**/*',async route=>{const request=route.request();assert.equal(new URL(request.url()).origin,origin,'No external service allowed');const method=request.method(),response=await app.fetch(new Request(request.url(),{method,headers:await request.allHeaders(),...(!['GET','HEAD'].includes(method)?{body:request.postDataBuffer()}:{} )}));await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?order='+id);await page.getByRole('tab',{name:'Projekt bearbeiten',exact:true}).click();assert.equal(await page.locator('[data-click=test]').getAttribute('aria-pressed'),'true','The synthetic deep-linked project must select the shared test scope for tasks, customers and calendar');await page.locator('#project-records summary').filter({hasText:'Projektangaben und Arbeitsschritte bearbeiten'}).click();
    const project=page.locator('[data-project-records]');await project.locator('[name=title]').fill('TEST Arbeitsplan '+label);await project.locator('[name=reason]').fill('TEST Korrektur der internen Arbeitsplanung');await project.locator('[data-add-step]').click();await project.locator('[data-step-title]').last().fill('TEST Endkontrolle '+label);await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/records-lifecycle')&&r.request().method()==='POST'&&r.status()===200),project.locator('[type=submit]').click()]);await page.locator('#project-records > details:not([open]) > summary').filter({hasText:'Projektangaben und Arbeitsschritte bearbeiten'}).click();assert.equal(await page.locator('[data-project-records] [name=title]').inputValue(),'TEST Arbeitsplan '+label);await noOverflow(page);await page.screenshot({path:'ui-evidence/project-edit-'+label+'.png',fullPage:true});
    if(viewport.width<1400)await page.locator('#task-disclosure > summary').click();
    await page.getByRole('button',{name:'Aufgabe anlegen',exact:true}).click();const task=page.locator('[data-task-form]');await task.locator('[name=title]').fill('TEST Kontrolle '+label);await task.locator('[name=dueDate]').fill('2020-01-01');await task.locator('[name=priority]').selectOption('high');await task.locator('[type=submit]').click();await page.getByText('TEST Kontrolle '+label,{exact:true}).waitFor();await page.locator('[data-task-filter=overdue]').click();await page.getByText('TEST Kontrolle '+label,{exact:true}).waitFor();await noOverflow(page);await page.screenshot({path:'ui-evidence/tasks-'+label+'.png',fullPage:true});
    await page.getByText('TEST Kontrolle '+label,{exact:true}).click();await page.locator('[data-task-form] [name=body]').fill('TEST Nachprüfung');await page.locator('[data-task-form] [type=submit]').click();await page.getByText('TEST Nachprüfung',{exact:true}).waitFor();
    await page.locator('.wg-task').filter({hasText:'TEST Kontrolle '+label}).getByRole('button',{name:'Erledigen',exact:true}).click();await page.locator('[data-task-filter=done]').click();await page.getByText('TEST Kontrolle '+label,{exact:true}).waitFor();
    await page.locator('.wg-assistant-toggle').click();const assistant=page.locator('[data-assistant-form]');await assistant.locator('[name=message]').fill('Kunde anlegen\nName: TEST Chatkunde '+label+'\nE-Mail: chat-'+label+'@example.invalid\nTelefon: +49 000 1234567'+(label==='desktop'?'1':'2'));await assistant.locator('[type=submit]').click();await page.locator('.wg-assistant-log').getByText('Kunde dauerhaft gespeichert: TEST Chatkunde '+label+'.',{exact:false}).waitFor();await noOverflow(page);await page.screenshot({path:'ui-evidence/assistant-create-'+label+'.png',fullPage:true});await page.locator('[data-assistant-close]').click();
    if(viewport.width<760)await page.locator('[data-click=menu]').click();await Promise.all([calendarRead(page),page.locator('[data-view=calendar]').click()]);await page.locator('[data-booking-entry]').waitFor();
    await Promise.all([calendarRead(page),page.locator('[data-booking-view=week]').click()]);await page.locator('[data-booking-view=week][aria-pressed=true]').waitFor();await page.locator('.booking-week-grid').waitFor();await noOverflow(page);await page.screenshot({path:'ui-evidence/calendar-week-'+label+'.png',fullPage:true});
    await Promise.all([calendarRead(page),page.locator('[data-booking-view=day]').click()]);await page.locator('[data-booking-view=day][aria-pressed=true]').waitFor();await page.locator('.booking-week-grid').waitFor({state:'detached'});await noOverflow(page);await calendarPrivateCRUD(page,label);
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM customer_files WHERE json_extract(data,'$.email') LIKE 'chat-%@example.invalid'").first()).n,2);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM panel_tasks').first()).n,2);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM calendar_entries').first()).n,0);console.log('PASS: project edit, work steps, task CRUD transitions/overdue view, assistant persisted customer, day/week calendar and linked private appointment create/open/edit/move/confirmed delete with retained audit on desktop/mobile; synthetic App.fetch only.');
}catch(error){for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:'ui-evidence/panel-extension-failure.png',fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();env.DB.close();}
