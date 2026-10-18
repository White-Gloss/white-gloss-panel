import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PanelDatabase} from '../server/storage.mjs';
import {createApplication} from '../server/application.mjs';
import {digest} from '../server/auth.mjs';
import {datevFile,datevConfig,datevLine,DATEV_COLUMNS,windows1252} from '../server/datev.mjs';
const origin='https://panel.example.invalid',month='2026-09',config={advisor:'1001',client:'7',chart:'03',length:4,yearStart:'2026-01-01',locked:0};
async function fixture(t){
  const env={PANEL_ORIGIN:origin,OWNER_EMAIL_SHA256:digest('owner@example.invalid'),CONFIG_KEY:Buffer.alloc(32,4).toString('base64'),DB:new PanelDatabase(':memory:'),BUCKET:{get:async()=>null},ASSETS:{fetch:async()=>new Response('shell')}};
  t.after(()=>env.DB.close());t.mock.method(globalThis,'fetch',async()=>{throw Error('No provider writes or reads');});const app=await createApplication(env),cookie={};
  for(const role of ['owner','customer']){const raw=randomBytes(32).toString('hex');cookie[role]='__Host-wg-session='+raw;await env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),role+'@example.invalid',Date.now()+3600000,Date.now()).run();}
  const aid=randomUUID(),araw=randomBytes(32).toString('hex');cookie.advisor='__Host-wg-advisor='+araw;
  await env.DB.prepare('INSERT INTO advisor_accounts(id,company,email,enabled,revision,created_at,updated_at) VALUES(?,?,?,1,?,?,?)').bind(aid,'Kanzlei','advisor@example.invalid','r1','now','now').run();
  await env.DB.prepare('INSERT INTO advisor_sessions VALUES(?,?,?,?,?)').bind(digest(araw),aid,'r1',Date.now()+3600000,Date.now()).run();
  const call=(path='',body=undefined,role='owner',extra={})=>app.fetch(new Request(origin+'/api/books'+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie:cookie[role]??'',...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)}));
  const view=async (m=month)=>{const r=await call('?month='+m);assert.equal(r.status,200,await r.clone().text());return r.json();};
  const post=async(path,body,expected=200)=>{const state=await view(body.month??month),r=await call(path,{version:state.version,...body});assert.equal(r.status,expected,await r.clone().text());return r.json();};
  const bank=async({amount=11900,provider=randomUUID(),status='completed',settled='2026-09-18T10:00:00Z',side='credit'}={})=>{await env.DB.prepare(`INSERT INTO accounting_bank_revisions(organization_id,account_iban,provider_id,sha256,status,side,amount_minor,currency,label,reference,settled_at,provider_updated_at,raw_json,received_at) VALUES('org','DE123456789',?,?,?,?,?,'EUR','Muster','RG-1',?,'2026-09-18T10:00:00Z','{}','2026-09-18T10:00:00Z')`).bind(provider,randomUUID(),status,side,amount,settled).run();return (await view()).view.items.find(s=>s.kind==='bank'&&JSON.parse(s.key.slice(5))[2]===provider);};
  const order=async(total=11900,payments=[])=>{const id=randomUUID(),o={id,wg:'WG-'+id.slice(0,8),status:'Erledigt',source:{name:'Muster',email:'private@example.invalid'},invoice:{id:randomUUID(),number:'RG-1',issueDate:'2026-09-18',totalCents:total,status:'unpaid',currency:'EUR',token:'SECRET'},payments,offer:{totalCents:total},notes:[{note:'PRIVATE'}]};await env.DB.prepare('INSERT INTO orders(id,wg,status,data,updated_at,actor,action,synthetic) VALUES(?,?,?,?,?,?,?,0)').bind(id,o.wg,o.status,JSON.stringify(o),'2026-09-18T10:00:00Z','test','fixture').run();return o;};
  const excludeAll=async()=>{for(const s of (await view()).view.items){if(s.kind==='bank'&&s.remaining)await post('/reconcile',{sourceKey:s.key,sourceHash:s.hash,amount:s.remaining,note:'Extern gebuchter Altbestand'});await post('/resolve',{month,sourceKey:s.key,sourceHash:s.hash,kind:'exclude',note:'Bereits extern gebucht, Referenz Kanzlei 09-26'});}};
  return {env,app,call,view,post,bank,order,excludeAll,aid};
}
const sourceInput=s=>({sourceKey:s.key,sourceHash:s.hash});
const line={amount:11900,side:'S',account:'1200',counter:'10000',tax:'',date:'2026-09-18',reference:'RG-1',text:'Müller; "September"'};

test('bookkeeping is private, advisor read-only, CSRF protected and views redact operational data',async t=>{
  const f=await fixture(t);await f.order();
  for(const role of ['anonymous','customer'])assert.equal((await f.call('',undefined,role)).status,401);
  const read=await f.call('?month='+month,undefined,'advisor');assert.equal(read.status,200);const raw=await read.text();assert.ok(!raw.includes('SECRET')&&!raw.includes('PRIVATE')&&!raw.includes('private@example'));
  for(const route of ['/settings','/reconcile','/unmatch','/resolve','/reverse','/close','/reopen','/export'])assert.equal((await f.call(route,{},'advisor')).status,403);
  const v=await f.view();assert.equal((await f.call('/settings',{version:v.version,...config},'owner',{origin:'https://evil.invalid'})).status,403);
  await f.env.DB.prepare('UPDATE advisor_accounts SET enabled=0 WHERE id=?').bind(f.aid).run();assert.equal((await f.call('',undefined,'advisor')).status,401);
});
test('split and combined bank reconciliation uses existing payments, blocks overpayment/replay and cancels only newly created payments',async t=>{
  const f=await fixture(t),o=await f.order(),b=await f.bank({amount:15000}),v=await f.view();
  const input={version:v.version,...sourceInput(b),amount:6000,orderId:o.id,invoiceId:o.invoice.id,note:'Teilzahlung Kontoauszug geprüft'};
  assert.equal((await f.call('/reconcile',input)).status,200);assert.equal((await f.call('/reconcile',input)).status,409);
  await f.post('/reconcile',{...sourceInput(b),amount:6000,orderId:o.id,invoiceId:o.invoice.id,note:'Zweite Teilzahlung geprüft'},409);
  await f.post('/reconcile',{...sourceInput(b),amount:5900,orderId:o.id,invoiceId:o.invoice.id,note:'Restzahlung geprüft'});
  let state=await f.view();assert.equal(state.invoices[0].open,0);assert.equal(state.view.items.find(s=>s.key===b.key).remaining,3100);
  await f.post('/reconcile',{...sourceInput(b),amount:3100,note:'Privateinlage Restbetrag geprüft'});
  const matched=(await f.view()).view.items.find(s=>s.key===b.key).matches.find(m=>m.order_id);
  const saved=await f.env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first(),changed=JSON.parse(saved.data);changed.payments[0].amountCents++;
  await assert.rejects(()=>f.env.DB.prepare('UPDATE orders SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(changed),o.id).run(),/BOOK_PAYMENT_LOCKED/);
  await f.post('/unmatch',{id:matched.id,note:'Zuordnung war fehlerhaft'});state=await f.view();assert.equal(state.invoices[0].open,matched.amount);
  const payment={id:randomUUID(),amountCents:4000,at:'2026-09-18T10:00:00Z',method:'Überweisung'},o2=await f.order(4000,[payment]),b2=await f.bank({amount:4000});
  await f.post('/reconcile',{...sourceInput(b2),amount:4000,orderId:o2.id,invoiceId:o2.invoice.id,paymentId:payment.id,note:'Schon erfasste Zahlung abgeglichen'});
  const m2=(await f.view()).view.items.find(s=>s.key===b2.key).matches[0];await f.post('/unmatch',{id:m2.id,note:'Bankreferenz wird korrigiert'});
  assert.equal((await f.view()).invoices.find(i=>i.orderId===o2.id).paid,4000);
});
test('atomic snapshot guard rolls back concurrent reconciliation and does not leave orphan financial records',async t=>{
  const f=await fixture(t),o=await f.order(),b=await f.bank(),v=await f.view(),body={version:v.version,...sourceInput(b),amount:11900,orderId:o.id,invoiceId:o.invoice.id,note:'Bankabgleich manuell geprüft'};
  const results=await Promise.all([f.call('/reconcile',body),f.call('/reconcile',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM book_matches').first()).n,1);assert.equal((await f.view()).invoices[0].paid,11900);
});
test('closed period is immutable; repeat export is byte-identical; reopened correction exports only delta with general reversal',async t=>{
  const f=await fixture(t),b=await f.bank();await f.post('/settings',config);
  await f.post('/resolve',{month,...sourceInput(b),kind:'post',lines:[line],note:'Kontierung mit Kanzlei geprüft'});
  await f.post('/close',{month,note:'Vollständiger Monatsabschluss',complete:true},409);
  await f.post('/reconcile',{...sourceInput(b),amount:11900,note:'Kontoauszug vollständig geprüft'});
  await f.post('/close',{month,note:'Vollständiger Monatsabschluss',complete:true});
  const resolution=(await f.view()).view.items[0].resolution.id;
  await f.post('/reverse',{resolutionId:resolution,note:'Korrektur erforderlich'},409);
  const exported=await f.post('/export',{month}),download=await f.call('/download?id='+exported.id),bytes=Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.includes(Buffer.from([0xfc])),true);assert.ok(bytes.toString('latin1').startsWith('"EXTF";700;21;"Buchungsstapel";13;'));
  const again=await f.post('/export',{month});assert.equal(again.id,exported.id);assert.deepEqual(Buffer.from(await (await f.call('/download?id='+again.id)).arrayBuffer()),bytes);
  const meta=(await f.view()).view.exports[0];assert.equal(meta.sha256,createHash('sha256').update(bytes).digest('hex'));
  await f.post('/reopen',{month,note:'Kontierung nach Kanzleiprüfung korrigieren'});await f.post('/reverse',{resolutionId:resolution,note:'Falsches Gegenkonto korrigiert'});
  await f.post('/resolve',{month,...sourceInput(b),kind:'post',lines:[{...line,counter:'10001'}],note:'Richtiger Debitor bestätigt'});
  await f.post('/close',{month,note:'Korrigierter Monatsabschluss',complete:true});const second=await f.post('/export',{month});assert.notEqual(second.id,exported.id);
  assert.equal((await f.view()).view.exports.at(-1).entry_count,2);assert.equal((await f.env.DB.prepare('SELECT count(*) n FROM book_export_entries').first()).n,3);
  await assert.rejects(()=>f.env.DB.prepare('DELETE FROM book_entries').run(),/unveränderlich/);
  await assert.rejects(()=>f.env.DB.prepare("UPDATE book_periods SET snapshot='{}'").run(),/unveränderlich/);
});
test('provider revisions and late sources invalidate close and require explicit reconciliation/review again',async t=>{
  const f=await fixture(t),provider=randomUUID(),b=await f.bank({provider});await f.post('/settings',config);await f.excludeAll();await f.post('/close',{month,note:'Vollständiger Monatsabschluss',complete:true});
  await f.bank({provider,status:'reversed'});const state=await f.view();assert.equal(state.view.period.changed,true);assert.ok(state.view.problems.length);
  await f.post('/export',{month},409);await f.post('/reconcile',{...sourceInput(b),amount:1,note:'Veralteter Providerstand'},409);
  await f.post('/reopen',{month,note:'Rückbuchung von Qonto prüfen'});const m=state.view.items[0].matches[0];await f.post('/unmatch',{id:m.id,note:'Bankumsatz wurde zurückgebucht'});
  await f.post('/close',{month,note:'Rückbuchung vollständig geklärt',complete:true});
  await f.order();assert.equal((await f.view()).view.period.changed,true);
});
test('current month cannot close, mismatched sums/config and missing settings fail closed',async t=>{
  const f=await fixture(t),b=await f.bank();await f.post('/resolve',{month,...sourceInput(b),kind:'post',lines:[line],note:'Buchung ohne Konfiguration'},400);
  await f.post('/settings',config);await f.post('/resolve',{month,...sourceInput(b),kind:'post',lines:[{...line,amount:11899}],note:'Betrag stimmt nicht überein'},409);
  const current=new Date().toISOString().slice(0,7);await f.post('/close',{month:current,note:'Monat ist noch nicht beendet',complete:true},409);
  await f.post('/resolve',{month,...sourceInput(b),kind:'post',lines:[line],note:'Betrag vollständig geprüft'});
  await f.post('/settings',{...config,chart:'04'});await f.post('/reconcile',{...sourceInput(b),amount:11900,note:'Bankumsatz vollständig geprüft'});await f.post('/close',{month,note:'Falscher Kontenrahmen im Abschluss',complete:true},409);
});
test('DATEV contract: 31 header fields, 125 columns, CRLF, decimal cents, quoting, fiscal year and strict unsupported-character rejection',()=>{
  assert.equal(DATEV_COLUMNS.length,125);const entry={id:randomUUID(),data:line,reversal_of:null},bytes=datevFile(config,month,[entry],'2026-10-18T12:34:56.789Z'),csv=new TextDecoder('windows-1252').decode(bytes);
  const parse=s=>{const fields=[''];let quoted=false;for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){fields[fields.length-1]+='"';i++;}else quoted=!quoted;}else if(c===';'&&!quoted)fields.push('');else fields[fields.length-1]+=c;}assert.equal(quoted,false);return fields;};
  const lines=csv.split('\r\n');assert.equal(parse(lines[0]).length,31);assert.equal(lines[1].split(';').length,125);assert.equal(parse(lines[2]).length,125);assert.ok(lines[2].startsWith('119,00;"S";"EUR"'));assert.ok(lines[2].includes('"Müller; ""September"""'));assert.equal(lines.at(-1),'');
  assert.throws(()=>windows1252('🚗'),/Zeichen/);assert.throws(()=>datevLine({...line,reference:'RG.1'},config,month),/Belegnummer/);assert.throws(()=>datevLine({...line,tax:'49'},config,month),/BU/);assert.throws(()=>datevLine({...line,text:'bad\nline'},config,month),/Steuerzeichen/);
  assert.throws(()=>datevConfig({...config,advisor:'999'}),/Berater/);assert.throws(()=>datevFile(config,'2027-01',[entry],'2027-02-01T00:00:00.000Z'),/Wirtschaftsjahr/);
});
