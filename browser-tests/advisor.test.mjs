import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {browserFixture,origin,owner,customer} from './harness.mjs';
import {digest} from '../server/auth.mjs';

test('owner manually manages accountant access with visible one-time link and immediate revocation',async t=>{
  const f=await browserFixture(t),{page}=f;await page.goto(origin+'/kanzlei');
  await page.getByLabel('Kanzleiname').fill('Musterkanzlei · Testdaten');
  await page.getByLabel('Persönliche E-Mail-Adresse',{exact:true}).fill('kanzlei@example.invalid');
  await page.getByRole('button',{name:'Zugang und Einrichtungslink erstellen'}).click();
  await page.locator('.activation-link').waitFor();assert.match(await page.locator('.activation-link').inputValue(),/\/kanzlei#einrichten=[a-f0-9]{64}$/);
  assert.match(await page.locator('#activation-result').textContent(),/keine Einladung versendet/);
  // One-time setup credentials are never stored in the screenshot artifact.
  await page.locator('.activation-link').evaluate(el=>el.value='Einrichtungslink · nur synthetische Testdaten');
  await f.screenshot('steuerberater-verwaltung-desktop');
  page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Zugang sperren',exact:true}).click();
  await page.getByText('Gesperrt',{exact:true}).waitFor();
  assert.equal((await f.env.DB.prepare('SELECT enabled FROM advisor_accounts').first()).enabled,0);assert.deepEqual(f.errors,[]);
});

for(const viewport of [{width:1366,height:850},{width:390,height:844}])test(`accountant enrolls, comments and proposes without operator actions at ${viewport.width}x${viewport.height}`,async t=>{
  const f=await browserFixture(t,{viewport,identity:customer}),{page}=f,raw=randomBytes(32).toString('hex');
  await f.env.DB.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(digest(raw),owner,Date.now()+3600000,Date.now()).run();
  const response=await f.app.fetch(new Request(origin+'/api/advisor/accounts',{method:'POST',headers:{origin,cookie:'__Host-wg-session='+raw,'Content-Type':'application/json'},body:JSON.stringify({action:'create',company:'Musterkanzlei · Testdaten',email:'kanzlei@example.invalid'})}));
  assert.equal(response.status,200);const access=await response.json();
  const id=randomUUID(),bytes=Buffer.from('%PDF-1.7\nSynthetischer Testbeleg\n%%EOF');f.files.set(id,{body:bytes});
  await f.env.DB.prepare('INSERT INTO accounting_documents VALUES(?,?,?,?,?,?,?,?)').bind(id,0,'Reiniger Oktober · Musterbeleg.pdf','application/pdf',digest(bytes),bytes.length,'2026-10-18T10:00:00.000Z','PANEL').run();
  await page.goto(access.activationUrl);await page.getByLabel('Persönliche E-Mail-Adresse',{exact:true}).fill('kanzlei@example.invalid');
  await page.getByLabel('Neues Passwort (mindestens 15 Zeichen)',{exact:true}).fill('Ein sehr langer synthetischer Testsatz!');
  await page.getByLabel('Passwort wiederholen',{exact:true}).fill('Ein sehr langer synthetischer Testsatz!');
  await page.getByRole('button',{name:'Zugang einrichten',exact:true}).click();await page.getByRole('heading',{name:'Belege',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Zugänge verwalten',exact:true}).count(),0);
  await page.getByText('Kommentare',{exact:true}).click();await page.getByLabel('Neuer Kommentar').fill('Bitte Lieferantenanschrift prüfen.');
  await page.getByRole('button',{name:'Kommentar speichern'}).click();await page.getByText('Bitte Lieferantenanschrift prüfen.',{exact:true}).waitFor();
  await page.getByText('Zuordnung vorschlagen',{exact:true}).click();await page.getByLabel('Kategorie',{exact:true}).selectOption('CLEANING_SUPPLIES');
  await page.getByLabel('Betrag brutto in Euro',{exact:true}).fill('119,00');await page.getByRole('button',{name:'Vorschlag zur Prüfung speichern'}).click();
  await page.locator('#advisor-message').filter({hasText:'Vorschlag gespeichert.'}).waitFor();
  await page.getByRole('button',{name:'Vorschläge',exact:true}).click();await page.getByText('Wartet auf Betreiberprüfung',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Als Zuordnungsentwurf übernehmen'}).count(),0);
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) n FROM accounting_classifications').first()).n,0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  await f.screenshot('steuerberater-vorschlaege-'+viewport.width);
  await page.getByRole('button',{name:'Belege',exact:true}).click();await page.getByRole('heading',{name:'Belege',exact:true}).waitFor();await f.screenshot('steuerberater-belege-'+viewport.width);
  await page.getByRole('button',{name:'Abmelden',exact:true}).click();await page.getByRole('button',{name:'Anmelden',exact:true}).waitFor();assert.deepEqual(f.errors,[]);
});
