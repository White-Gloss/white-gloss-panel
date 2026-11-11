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

  // Der Aufgaben-Knopf sitzt in der Kopfleiste und schwebt nicht mehr über dem Inhalt.
  const tasks = await page.evaluate(() => {
    const pill = document.querySelector('.topbar .mobile-task'), bar = document.querySelector('.topbar').getBoundingClientRect();
    if (!pill) return null;
    const r = pill.getBoundingClientRect();
    return {w: Math.round(r.width), h: Math.round(r.height), inBar: r.top >= bar.top && r.bottom <= bar.bottom, position: getComputedStyle(pill).position};
  });
  log('tasks', tasks);
  assert.ok(tasks, 'tasks button is part of the top bar');
  assert.deepEqual([tasks.w, tasks.h, tasks.inBar], [44, 44, true], 'tasks button is a 44px target inside the bar');
  assert.notEqual(tasks.position, 'fixed');
  // Tab-Leiste: fünf gleich breite Ziele, Beschriftung mindestens 11 px, aktiv über die Tönungsfarbe statt über einen Kasten.
  const dock = await page.evaluate(() => [...document.querySelectorAll('.mobile-dock > button')].map(b => { const r = b.getBoundingClientRect(), c = getComputedStyle(b); return {w: Math.round(r.width), h: Math.round(r.height), font: parseFloat(c.fontSize), bg: c.backgroundColor, current: b.getAttribute('aria-current') === 'page', color: c.color}; }));
  log('dock', dock);
  assert.ok(dock.every(b => b.h >= 44 && b.w >= 44 && b.font >= 11), 'every tab is a 44px target with a readable label');
  assert.ok(dock.every(b => b.bg === 'rgba(0, 0, 0, 0)'), 'no box behind a tab');
  assert.equal(dock.filter(b => b.current).length, 1); assert.notEqual(dock.find(b => b.current).color, dock.find(b => !b.current).color, 'the active tab has its own tint');
  assert.equal(await page.locator('.content .heading-brand').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height > 0).length), 0, 'no company line above the title on phones');
  const title = await page.evaluate(() => { const h = document.querySelector('#action-center-title'); return h ? parseFloat(getComputedStyle(h).fontSize) : null; });
  if (title !== null) assert.ok(title >= 28, 'the start title uses the large title size: ' + title);
  await f.screenshot('ios-start-390-dark', {fullPage: false});
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const clearance = await page.evaluate(() => {
    const top = document.querySelector('.mobile-dock').getBoundingClientRect().top;
    const last = [...document.querySelectorAll('.content *')].filter(el => el.getBoundingClientRect().height > 0 && getComputedStyle(el).position !== 'fixed').reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0);
    return {dockTop: Math.round(top), contentBottom: Math.round(last)};
  });
  log('clearance', clearance);
  assert.ok(clearance.contentBottom <= clearance.dockTop, 'last content ends above the tab bar');
  await page.locator('.mobile-dock [data-view="orders"]').click(); await page.locator('#content h1').first().waitFor();
  await page.locator('[data-order-group="requests"]').click();
  // Filterleiste: vier Gruppen als eine Auswahlleiste in einer Reihe, Statusfilter vollständig sichtbar, nichts seitlich abgeschnitten.
  const filters = await page.evaluate(() => {
    const box = el => el.getBoundingClientRect(), bar = document.querySelector('.toolbar'), groups = [...document.querySelectorAll('.order-groups button')], chips = [...document.querySelectorAll('.order-filters button, .order-filters summary')].filter(el => box(el).width > 0);
    return {rows: new Set(groups.map(b => Math.round(box(b).top))).size, groupH: groups.map(b => Math.round(box(b).height)), fits: groups.concat(chips).every(b => b.scrollWidth <= b.clientWidth + 1 && box(b).left >= 0 && box(b).right <= innerWidth + .5), chipH: Math.min(...chips.map(b => Math.round(box(b).height))), barScroll: bar.scrollWidth <= bar.clientWidth + 1, active: groups.filter(b => b.getAttribute('aria-pressed') === 'true').length};
  });
  log('filters', filters);
  assert.equal(filters.rows, 1, 'the four groups share one row at 390px');
  assert.ok(filters.groupH.every(h => h >= 40) && filters.chipH >= 40, 'groups and status filters are comfortable targets');
  assert.ok(filters.fits && filters.barScroll, 'no filter is cut off and the bar does not scroll sideways');
  assert.equal(filters.active, 1);
  await f.screenshot('ios-requests-390-dark', {fullPage: false});
  await page.locator('[data-order-group="active"]').click();
  // Auftragsliste: Zeile mit Name, Preis und Pfeil; der Pfeil bleibt ein beschrifteter Knopf mit 44 px.
  const row = await page.evaluate(() => {
    const tr = document.querySelector('.order-table tbody tr'); if (!tr) return null;
    const open = tr.querySelector('button.smallbtn').getBoundingClientRect(), r = tr.getBoundingClientRect(), name = tr.querySelector('td .sub').getBoundingClientRect(), price = tr.querySelector('td.money').getBoundingClientRect();
    return {inside: r.left >= 0 && r.right <= innerWidth + .5, openW: Math.round(open.width), openH: Math.round(open.height), label: tr.querySelector('button.smallbtn').textContent.trim(), nameFont: parseFloat(getComputedStyle(tr.querySelector('td .sub')).fontSize), sameLine: Math.abs(name.top - price.top) < 12, radius: getComputedStyle(tr).borderTopLeftRadius, noOverflow: document.documentElement.scrollWidth <= innerWidth};
  });
  log('row', row);
  assert.ok(row, 'the running order is listed');
  assert.ok(row.inside && row.noOverflow, 'the row stays inside the screen');
  assert.ok(row.openW >= 44 && row.openH >= 44, 'the arrow is a 44px target');
  assert.equal(row.label, 'Öffnen', 'the arrow keeps its accessible name');
  assert.ok(row.nameFont >= 17 && row.sameLine, 'name and price share the first line');
  assert.equal(row.radius, '0px', 'rows are lines of one group, not single cards');
  await f.screenshot('ios-active-390-dark');
  await page.locator('.mobile-dock [data-click="menu"]').click(); await page.locator('.sidebar.open').waitFor();
  await f.screenshot('ios-menu-390-dark', {fullPage: false});
  await page.keyboard.press('Escape');
  // Gemeinsamer Eingang: lesbare Zeilen innerhalb des Bildschirms.
  await page.locator('.mobile-dock [data-view="inbox"]').click(); await page.locator('.unified-inbox-item').first().waitFor();
  const inbox = await page.evaluate(() => {
    const px = sel => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize), item = document.querySelector('.unified-inbox-item').getBoundingClientRect();
    return {title: px('.unified-inbox-header h1'), name: px('.unified-inbox-head strong'), preview: px('.unified-inbox-preview'), time: px('.unified-inbox-head time'), channel: px('.unified-inbox-channel'), itemH: Math.round(item.height), inside: item.left >= 0 && item.right <= innerWidth + .5, noOverflow: document.documentElement.scrollWidth <= innerWidth, search: Math.round(document.querySelector('[data-unified-search]').getBoundingClientRect().height)};
  });
  log('inbox', inbox);
  assert.ok(inbox.title >= 26 && inbox.name >= 16 && inbox.preview >= 14 && inbox.time >= 12 && inbox.channel >= 11, 'inbox text uses readable sizes');
  assert.ok(inbox.itemH >= 60 && inbox.search >= 44, 'rows and search are comfortable targets');
  assert.ok(inbox.inside && inbox.noOverflow, 'the inbox stays inside the screen');
  await f.screenshot('ios-inbox-390-dark', {fullPage: false});

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
