import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin} from './harness.mjs';

for(const width of [1366,390])test('monthly accounting workflow '+width,async t=>{
  const f=await browserFixture(t,{viewport:{width,height:900}}),p=f.page;
  await f.env.DB.prepare(`INSERT INTO accounting_bank_revisions(organization_id,account_iban,provider_id,sha256,status,side,amount_minor,currency,label,reference,settled_at,provider_updated_at,raw_json,received_at) VALUES('test','DE123456789','fixture','fixture','completed','credit',11900,'EUR','Muster GmbH','RG-2026-09','2026-09-18T10:00:00Z','2026-09-18T10:00:00Z','{}','2026-09-18T10:00:00Z')`).run();
  await p.goto(origin+'/buchhaltung?month=2026-09');await p.getByRole('heading',{name:'Muster GmbH · RG-2026-09'}).waitFor();
  await p.evaluate(()=>document.fonts.ready);
  const typography=await p.evaluate(()=>{const style=el=>{const c=getComputedStyle(el);return {font:c.fontFamily,size:parseFloat(c.fontSize),weight:c.fontWeight,height:el.getBoundingClientRect().height};};return {numbers:[...document.querySelectorAll('.books-stat strong')].map(style),links:[...document.querySelectorAll('.books-header a.smallbtn')].map(style)};});
  t.diagnostic('bookkeeping type roles '+width+' '+JSON.stringify(typography));
  assert.ok(typography.numbers.length===3&&typography.numbers.every(item=>/Syne/.test(item.font)&&item.weight==='800'&&item.size===(width<768?24:28)),'all three accounting figures use the highlighted numeric role');
  assert.ok(typography.links.length===2&&typography.links.every(item=>/Syne/.test(item.font)&&item.weight==='700'&&item.size===15&&item.height>=44),'header links remain readable button targets');
  assert.equal(await p.getByRole('heading',{name:'Monatsbuchhaltung',exact:true}).count(),1,'discretionary breaks preserve the heading name');
  await f.screenshot('buchhaltung-zahlungsabgleich-'+width);
  await p.getByRole('button',{name:'DATEV-Einstellungen',exact:true}).click();const settings=p.locator('form[data-action=settings]');
  for(const [label,value] of [['Beraternummer','1001'],['Mandantennummer','7'],['Sachkontenlänge','4'],['Beginn Wirtschaftsjahr','2026-01-01']])await settings.getByLabel(label,{exact:true}).fill(value);
  await settings.getByLabel('Kontenrahmen',{exact:true}).selectOption('03');await settings.getByLabel('Festschreibung beim DATEV-Import').selectOption('0');await settings.getByRole('checkbox').check();
  await settings.getByRole('button',{name:'Einstellungen speichern'}).click();await p.getByText('Änderung gespeichert und Finanzstand neu geprüft.',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Zahlungsabgleich',exact:true}).click();await p.getByText('Zahlung zuordnen oder Restbetrag klären',{exact:true}).click();
  const reconcile=p.locator('form[data-action=reconcile]');await reconcile.getByLabel('Begründung / Prüfnotiz').fill('Kontoauszug 09-2026 manuell geprüft');await reconcile.getByRole('button',{name:'Abgleich bestätigen'}).click();await p.getByText('Manuell geklärt',{exact:false}).waitFor();
  await p.getByRole('button',{name:'Buchungsfreigabe',exact:true}).click();await p.getByText('Buchungssatz prüfen und freigeben',{exact:true}).click();
  const posting=p.locator('form[data-action=resolve][data-kind=post]');await posting.getByLabel('Konto',{exact:true}).fill('1200');await posting.getByLabel('Gegenkonto',{exact:true}).fill('10000');await posting.getByLabel('Belegnummer',{exact:true}).fill('RG-2026-09');await posting.getByLabel('Begründung / Prüfnotiz').fill('Debitor und Bankkonto mit Kanzlei geprüft');await posting.getByRole('checkbox').check();await posting.getByRole('button',{name:'Buchung verbindlich freigeben'}).click();await p.getByText('Gebucht',{exact:true}).waitFor();
  await p.getByRole('button',{name:'Monatsabschluss & Export',exact:true}).click();const close=p.locator('form[data-action=close]');await close.getByLabel('Begründung / Prüfnotiz').fill('Kontoauszug und Belege vollständig geprüft');await close.getByRole('checkbox').check();await close.getByRole('button',{name:'Monat abschließen',exact:true}).click();await p.getByRole('button',{name:'DATEV-Stapel erstellen'}).waitFor();
  await p.getByRole('button',{name:'DATEV-Stapel erstellen'}).click();await p.locator('a[href^="/api/books/download?id="]').waitFor();
  await f.screenshot('buchhaltung-monatsabschluss-'+width);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'page must fit viewport');assert.deepEqual(f.errors,[]);assert.equal(f.requests.some(r=>r.status>=400),false);
});

test('monthly accounting fetch failure remains visible',async t=>{
  const f=await browserFixture(t);await f.page.route('**/api/books?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Finanzdaten momentan nicht verfügbar.'})}));
  await f.page.goto(origin+'/buchhaltung?month=2026-09');await f.page.getByRole('status').filter({hasText:'Finanzdaten momentan nicht verfügbar.'}).waitFor();assert.deepEqual(f.errors,[]);
});
