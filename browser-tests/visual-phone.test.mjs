// Handy-Layout (390 px, Dunkel): Start-Knöpfe, Aufgaben-Knopf und kompakter Mail-Kopf. Nur auf dem GitHub-Runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserFixture, origin, customer, owner} from './harness.mjs';
import {ingestMessage} from '../server/mailbox.mjs';

const mail = Buffer.from(`From: Erika Muster <${customer}>\r\nTo: ${owner}\r\nSubject: Frage zur Politur\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGuten Tag, wann passt der Termin?`);

test('phone layout: equal header buttons, content clear of the tasks button, compact mail header', async t => {
  const f = await browserFixture(t, {viewport: {width: 390, height: 844}, colorScheme: 'dark'}), {page} = f;
  const log = (step, data) => t.diagnostic('PHONE ' + step + ' ' + JSON.stringify(data));
  page.setDefaultTimeout(10000);
  await f.seedOrder({status: 'In Arbeit'});
  await ingestMessage(f.env, mail, {folder: 'INBOX', uid: 1, uidValidity: 'phone'});
  await page.goto(origin); await page.locator('#content h1').first().waitFor();

  const buttons = await page.evaluate(() => {
    const card = document.querySelector('.overview-shell .action-center .card-title');
    if (!card) return null;
    const box = card.getBoundingClientRect();
    return [...card.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return {t: b.textContent.trim().slice(0, 14), h: Math.round(r.height), inside: r.right <= innerWidth + 0.5 && r.left >= -0.5}; }).concat([{t: 'card', h: Math.round(box.height), inside: true}]);
  });
  log('buttons', buttons);
  if (buttons) {
    const heights = new Set(buttons.filter(b => b.t !== 'card').map(b => b.h));
    assert.equal(heights.size, 1, 'header buttons share one height: ' + [...heights]);
    assert.ok(buttons.every(b => b.inside), 'header buttons stay inside the screen');
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const clearance = await page.evaluate(() => {
    const pill = document.querySelector('.mobile-task');
    if (!pill) return {pill: false};
    const top = pill.getBoundingClientRect().top;
    const last = [...document.querySelectorAll('.content *')].filter(el => el.getBoundingClientRect().height > 0 && getComputedStyle(el).position !== 'fixed').reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0);
    return {pill: true, pillTop: Math.round(top), contentBottom: Math.round(last)};
  });
  log('clearance', clearance);
  if (clearance.pill) assert.ok(clearance.contentBottom <= clearance.pillTop, 'last content ends above the tasks button');

  await page.goto(origin + '/#mailbox'); await page.locator('.cc-head').waitFor();
  // Der kompakte Kopf gilt im Mail-Bereich: erst den Posteingang öffnen (Start des Postfachs ist die Übersicht).
  await page.locator('[data-cc-rail]').click(); await page.locator('.cc-rail [data-mail-folder="INBOX"]').click(); await page.locator('.cc-row[data-mail-open]').first().waitFor();
  const head = await page.evaluate(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).display !== 'none'; };
    const conn = document.querySelector('.cc-connection');
    return {headings: [...document.querySelectorAll('.cc-head h1')].filter(visible).length, kicker: [...document.querySelectorAll('.cc-head .eyebrow')].filter(visible).length, connectionWidth: conn ? Math.round(conn.getBoundingClientRect().width) : null, toggleIcon: document.querySelector('.cc-rail-toggle svg')?.outerHTML.length ?? 0};
  });
  log('mail-head', head);
  assert.equal(head.headings, 0, 'the folder title is shown once, in the list card');
  assert.equal(head.kicker, 0, 'no kicker line on phones');
  if (head.connectionWidth !== null) assert.ok(head.connectionWidth < 70, 'connection chip is only a dot: ' + head.connectionWidth);
  await f.screenshot('visual-phone-mail', {fullPage: false});
  assert.deepEqual(f.errors, []);
});

test('day/night toggle switches, remembers the choice and the bar has five entries', async t => {
  const f = await browserFixture(t, {viewport: {width: 390, height: 844}, colorScheme: 'dark'}), {page} = f;
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  page.setDefaultTimeout(10000);
  await page.goto(origin); await page.locator('#content h1').first().waitFor();
  assert.equal(await bg(), 'rgb(14, 18, 24)', 'night follows the device by default');
  assert.equal(await page.locator('.mobile-dock > button').count(), 5, 'five entries in the bottom bar');
  assert.ok(await page.locator('.topbar [data-theme-toggle]').isVisible(), 'toggle visible in the top bar');
  assert.equal(await page.locator('.topbar [data-click="logout"]').count(), 0, 'no logout button in the top bar');
  await page.locator('.topbar [data-theme-toggle]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  assert.equal(await bg(), 'rgb(245, 243, 238)', 'day shows the ivory ground');
  await page.reload(); await page.locator('#content h1').first().waitFor();
  assert.equal(await bg(), 'rgb(245, 243, 238)', 'the choice survives a reload without flashing');
  await page.locator('.topbar [data-theme-toggle]').click();
  assert.equal(await bg(), 'rgb(14, 18, 24)', 'and back to night');
  await page.goto(origin + '/#mailbox'); await page.locator('.cc-head').waitFor();
  assert.equal(await page.locator('.topbar .search').isVisible(), false, 'the mailbox has its own search, the top one is hidden');
  assert.equal(await page.locator('.topbar [data-theme-toggle]').isVisible(), true);
  assert.deepEqual(f.errors, []);
});
