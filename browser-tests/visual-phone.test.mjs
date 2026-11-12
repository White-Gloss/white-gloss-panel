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
  assert.ok(filters.groupH.every(h => h >= 44) && filters.chipH >= 44, 'groups and status filters are 44px targets');
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
  // „Mehr“ ist ein Blatt von unten: volle Breite, am unteren Rand, Zeilen als 44-px-Ziele, kein zweites Menüsymbol oben.
  const sheet = await page.evaluate(() => {
    const box = el => el.getBoundingClientRect(), bar = document.querySelector('.sidebar.open'), r = box(bar), rows = [...bar.querySelectorAll('.nav:not([hidden]):not(.nav-primary) button, .nav:not([hidden]):not(.nav-primary) .navlink')], close = box(bar.querySelector('.sidebar-close'));
    return {left: Math.round(r.left), width: Math.round(r.width), bottomGap: Math.round(innerHeight - r.bottom), top: Math.round(r.top), radius: getComputedStyle(bar).borderTopLeftRadius, rowH: Math.min(...rows.map(row => Math.round(box(row).height))), rowFont: Math.min(...rows.map(row => parseFloat(getComputedStyle(row).fontSize))), rows: rows.length, close: Math.round(Math.min(close.width, close.height)), burger: getComputedStyle(document.querySelector('.topbar .mobile-menu')).display, noOverflow: document.documentElement.scrollWidth <= innerWidth};
  });
  log('sheet', sheet);
  assert.deepEqual([sheet.left, sheet.width, sheet.bottomGap], [0, 390, 0], 'the menu is a full-width sheet at the bottom edge');
  assert.ok(sheet.top >= 40, 'the page stays visible above the sheet: ' + sheet.top);
  assert.equal(sheet.radius, '22px');
  assert.ok(sheet.rows >= 3 && sheet.rowH >= 44 && sheet.rowFont >= 16, 'menu rows are readable 44px targets');
  assert.ok(sheet.close >= 44, 'close is a 44px target'); assert.equal(sheet.burger, 'none', 'no second menu button in the top bar'); assert.ok(sheet.noOverflow);
  await f.screenshot('ios-menu-390-dark', {fullPage: false});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.mobile-dock [data-click="menu"]').evaluate(el => el === document.activeElement), true, 'focus returns to the Mehr tab');
  // Gemeinsamer Eingang: lesbare Zeilen innerhalb des Bildschirms.
  await page.locator('.mobile-dock [data-view="inbox"]').click(); await page.locator('.unified-inbox-item').first().waitFor();
  const inbox = await page.evaluate(() => {
    const px = sel => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize), item = document.querySelector('.unified-inbox-item').getBoundingClientRect();
    return {title: px('.unified-inbox-header h1'), name: px('.unified-inbox-head strong'), preview: px('.unified-inbox-preview'), time: px('.unified-inbox-head time'), channel: px('.unified-inbox-channel'), itemH: Math.round(item.height), inside: item.left >= 0 && item.right <= innerWidth + .5, noOverflow: document.documentElement.scrollWidth <= innerWidth, search: Math.round(document.querySelector('[data-unified-search]').getBoundingClientRect().height), controlGap: Math.round(document.querySelector('[data-unified-filter]').getBoundingClientRect().top - document.querySelector('[data-unified-search]').getBoundingClientRect().bottom)};
  });
  log('inbox', inbox);
  assert.ok(inbox.title >= 26 && inbox.name >= 16 && inbox.preview >= 14 && inbox.time >= 12 && inbox.channel >= 11, 'inbox text uses readable sizes');
  assert.ok(inbox.itemH >= 60 && inbox.search >= 44, 'rows and search are comfortable targets');
  assert.ok(inbox.inside && inbox.noOverflow, 'the inbox stays inside the screen');
  assert.ok(inbox.controlGap >= 4 && inbox.controlGap <= 16, 'search and filter sit close together: ' + inbox.controlGap);
  // Tastaturfokus: Der Ring liegt innerhalb der abgerundeten Liste und wird nicht abgeschnitten.
  await page.locator('[data-unified-filter]').focus(); await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => { const item = document.activeElement, c = getComputedStyle(item); return {focused: item.matches('.unified-inbox-item'), offset: parseFloat(c.outlineOffset), width: parseFloat(c.outlineWidth), style: c.outlineStyle}; });
  log('inbox focus', ring);
  assert.ok(ring.focused && ring.style !== 'none' && ring.width >= 2 && ring.offset < 0, 'the focus ring is drawn inside the row: ' + JSON.stringify(ring));
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

test('back gesture returns to the previous screen and closes the menu sheet', async t => {
  const f = await browserFixture(t, {viewport: {width: 390, height: 844}, colorScheme: 'dark'}), {page} = f;
  const log = (step, data) => t.diagnostic('BACK ' + step + ' ' + JSON.stringify(data));
  const where = () => page.evaluate(() => ({hash: location.hash, title: document.querySelector('#content h1, #action-center-title')?.textContent.trim() ?? '', order: Boolean(document.querySelector('.order-tabs')), menu: document.querySelectorAll('.sidebar.open').length}));
  const until = check => page.waitForFunction(check, null, {timeout: 5000});
  page.setDefaultTimeout(10000);
  await f.seedOrder({status: 'In Arbeit'});
  await page.goto(origin); await page.locator('#action-center-title').waitFor();

  // Start -> Aufträge -> Auftrag, dann zweimal zurück.
  await page.locator('.mobile-dock [data-view="orders"]').click(); await page.locator('.order-table tbody tr').first().waitFor();
  await page.locator('.order-table tbody tr').first().click(); await page.locator('.order-tabs').waitFor();
  assert.match((await where()).hash, /^#auftrag=/);
  await page.goBack(); await until(() => location.hash === '#orders' && !document.querySelector('.order-tabs'));
  log('order->list', await where());
  assert.equal(await page.locator('.order-table tbody tr').count(), 1, 'back from an order shows the order list');
  await page.goBack(); await page.locator('#action-center-title').waitFor();
  log('list->start', await where());
  assert.equal((await where()).hash, '', 'back from the list returns to the start screen');

  // Der Knopf „Zurück“ im Auftrag verbraucht den Verlaufseintrag: danach führt eine Zurück-Geste direkt zum Start.
  await page.locator('.mobile-dock [data-view="orders"]').click(); await page.locator('.order-table tbody tr').first().click(); await page.locator('.order-tabs').waitFor();
  await page.locator('[data-click="back"]').click(); await until(() => location.hash === '#orders' && !document.querySelector('.order-tabs'));
  await page.goBack(); await page.locator('#action-center-title').waitFor();
  log('button+gesture', await where());
  assert.equal((await where()).hash, '', 'no dead back step after the Zurück button');

  // Blatt „Mehr“: Zurück schließt das Blatt und bleibt auf dem Bildschirm.
  await page.locator('.mobile-dock [data-view="orders"]').click(); await page.locator('.order-table tbody tr').first().waitFor();
  await page.locator('.mobile-dock [data-click="menu"]').click(); await page.locator('.sidebar.open').waitFor();
  await page.goBack(); await until(() => !document.querySelector('.sidebar.open'));
  log('menu closed by back', await where());
  assert.deepEqual([(await where()).hash, await page.locator('.order-table tbody tr').count()], ['#orders', 1], 'back closes the sheet and stays on the list');
  assert.equal(await page.locator('.mobile-dock [data-click="menu"]').getAttribute('aria-expanded'), 'false');

  // Mit Escape geschlossen bleibt kein toter Eintrag zurück.
  await page.locator('.mobile-dock [data-click="menu"]').click(); await page.locator('.sidebar.open').waitFor();
  await page.keyboard.press('Escape'); await until(() => !document.querySelector('.sidebar.open') && history.state?.wgLayer !== 'menu');
  await page.goBack(); await page.locator('#action-center-title').waitFor();
  assert.equal((await where()).hash, '', 'no dead back step after closing the sheet with Escape');

  // Ziel im Blatt gewählt: ein Schritt zurück führt zum Bildschirm davor.
  await page.locator('.mobile-dock [data-view="orders"]').click(); await page.locator('.order-table tbody tr').first().waitFor();
  await page.locator('.mobile-dock [data-click="menu"]').click(); await page.locator('.sidebar.open').waitFor();
  await page.locator('.sidebar [data-view="calendar"]').click(); await page.locator('.schedule-calendar').waitFor();
  assert.equal((await where()).hash, '#calendar');
  await page.goBack(); await until(() => location.hash === '#orders');
  await page.locator('.order-table tbody tr').first().waitFor();
  log('menu target->back', await where());
  assert.equal(await page.locator('.schedule-calendar').count(), 0, 'one back step leaves the chosen screen');

  // Vorwärts nach Zurück öffnet das Blatt wieder; das nächste Zurück schließt es sichtbar.
  await page.locator('.mobile-dock [data-click="menu"]').click(); await page.locator('.sidebar.open').waitFor();
  await page.goBack(); await until(() => !document.querySelector('.sidebar.open'));
  await page.goForward(); await page.locator('.sidebar.open').waitFor();
  assert.equal(await page.locator('.mobile-dock [data-click="menu"]').getAttribute('aria-expanded'), 'true', 'forward restores the open sheet');
  await page.goBack(); await until(() => !document.querySelector('.sidebar.open'));
  assert.equal((await where()).hash, '#orders');

  // Abgelehntes „Änderungen verwerfen?“: der Auftrag bleibt offen, und die Liste wird beim nächsten Zurück nicht übersprungen.
  let accept = false; const prompts = [];
  page.on('dialog', async dialog => { prompts.push(dialog.message()); if (accept) await dialog.accept(); else await dialog.dismiss(); });
  await page.locator('.order-table tbody tr').first().click(); await page.locator('.order-tabs').waitFor();
  await page.locator('#order-panel-source input[name="name"]').fill('Geändert');
  await page.goBack(); await until(() => /^#auftrag=/.test(location.hash) && history.state?.wgFrom === '#orders');
  log('refused discard', {...await where(), prompts: prompts.length});
  assert.equal(prompts.length, 1, 'leaving a changed form asks once');
  assert.equal(await page.locator('#order-panel-source input[name="name"]').inputValue(), 'Geändert', 'the edit survives a refused back');
  accept = true;
  await page.goBack(); await until(() => location.hash === '#orders' && !document.querySelector('.order-tabs'));
  assert.equal(await page.locator('.order-table tbody tr').count(), 1, 'the next confirmed back shows the list, not the screen before it');
  page.removeAllListeners('dialog');

  // In den Papierkorb: zurück zur Liste ohne toten Schritt, und Vorwärts öffnet den gelöschten Auftrag nicht mehr.
  await page.locator('.order-table tbody tr').first().click(); await page.locator('.order-tabs').waitFor();
  await page.locator('.order-more > summary').click(); await page.locator('[data-click="deleteOrder"]').click();
  await page.locator('#deleteorderform [type="submit"]').click();
  await until(() => location.hash === '#orders' && !document.querySelector('.order-tabs') && !history.state?.wgFrom?.startsWith('#auftrag'));
  await page.locator('#modal').waitFor({state: 'hidden'});
  await page.goForward(); await page.waitForTimeout(300);
  assert.equal((await where()).order, false, 'forward does not reopen the deleted order');
  if ((await where()).hash !== '#orders') await until(() => location.hash === '#orders');
  await page.goBack(); if ((await where()).hash === '#orders') await page.goBack();
  await page.locator('#action-center-title').waitFor();
  log('after delete', await where());

  // „Testbereich“ aus dem Blatt zeichnet neu und schließt es: danach bleibt kein unsichtbarer Eintrag zurück.
  await page.locator('.mobile-dock [data-view="orders"]').click(); await page.locator('#content h1').first().waitFor();
  await page.locator('.mobile-dock [data-click="menu"]').click(); await page.locator('.sidebar.open').waitFor();
  await page.locator('.sidebar [data-click="test"]').click();
  await until(() => !document.querySelector('.sidebar.open') && history.state?.wgLayer !== 'menu');
  await page.goBack(); await page.locator('#action-center-title').waitFor();
  assert.equal((await where()).hash, '', 'one back step after the test switch leaves the list');
  assert.deepEqual(f.errors, []);
});

