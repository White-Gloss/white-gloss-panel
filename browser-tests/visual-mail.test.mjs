// Communication Center in Dunkel und Hell: Kontrast jedes Textes, Mail-Rahmen, Editor und KI-Dialog.
// Nur auf dem Linux-GitHub-Runner. Messwerte stehen als Diagnosezeilen "MAILDESIGN ..." im Testprotokoll.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserFixture, origin, customer, owner} from './harness.mjs';
import {ingestMessage} from '../server/mailbox.mjs';

const plain = subject => Buffer.from(`From: Erika Muster <${customer}>\r\nTo: ${owner}\r\nCc: partner@example.invalid\r\nSubject: ${subject}\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Sat, 17 Oct 2026 10:00:00 +0200\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGuten Tag, wann passt der Termin für die Politur?\r\n\r\nViele Grüße\r\nErika`);
const rich = Buffer.from(`From: Newsletter <news@example.invalid>\r\nTo: ${owner}\r\nSubject: Sommeraktion Newsletter\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Fri, 16 Oct 2026 08:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><head><style>.hero{padding:24px;background:#eef3f7;font-size:22px}table td{padding:8px}</style></head><body><div class="hero">Sommeraktion</div><table><tr><td>Politur</td><td>ab 99 €</td></tr></table><p>Ein langer Absatz mit Inhalt.</p><a href="https://shop.example.invalid/">Zum Shop</a></body></html>\r\n`);
// Mail ohne eigene Farben: erbt Schrift- und Hintergrundfarbe der Anzeige.
const bare = Buffer.from(`From: Werkstatt <werkstatt@example.invalid>\r\nTo: ${owner}\r\nSubject: Kurzmitteilung\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Thu, 15 Oct 2026 09:00:00 +0200\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hallo, Ihr Fahrzeug ist fertig.</p><ul><li>Lack gereinigt</li><li>Innenraum gesaugt</li></ul>\r\n`);

// Misst den Kontrast jedes sichtbaren Textes unterhalb von `root` gegen seinen tatsächlichen Hintergrund.
async function contrastReport(page, root) {
  return page.evaluate(root => {
    const parse = c => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ground = el => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return [255, 255, 255]; };
    const bad = [];
    let checked = 0;
    for (const el of document.querySelector(root)?.querySelectorAll('*') ?? []) {
      if (el.tagName === 'IFRAME' || el.closest('iframe')) continue;
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
      const fg = parse(s.color), bg = ground(el), [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x), ratio = (hi + 0.05) / (lo + 0.05);
      checked++;
      if (ratio < 4.5) bad.push({r: Math.round(ratio * 100) / 100, el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''), t: el.textContent.trim().slice(0, 20)});
    }
    return {checked, bad: bad.sort((a, b) => a.r - b.r).slice(0, 14)};
  }, root);
}
async function noOverflow(page, label) { assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' has no horizontal overflow'); }

for (const scheme of ['dark', 'light']) for (const viewport of [{width: 1366, height: 800}, {width: 390, height: 844}]) {
  test(`mail views ${scheme} ${viewport.width}px are readable`, async t => {
    const f = await browserFixture(t, {viewport, colorScheme: scheme}), {page} = f, tag = `${scheme}-${viewport.width}`, log = (step, data) => t.diagnostic('MAILDESIGN ' + tag + ' ' + step + ' ' + JSON.stringify(data));
    await page.addInitScript(() => { try { localStorage.setItem('wg-cc-images', 'off'); } catch { /* optional */ } });
    page.setDefaultTimeout(10000);
    await ingestMessage(f.env, plain('Frage zur Politur'), {folder: 'INBOX', uid: 1, uidValidity: 'visual'});
    await ingestMessage(f.env, rich, {folder: 'INBOX', uid: 2, uidValidity: 'visual'});
    await ingestMessage(f.env, bare, {folder: 'INBOX', uid: 3, uidValidity: 'visual'});
    await page.goto(origin); await page.locator('#content h1').first().waitFor();
    await page.evaluate(async owner => { const response = await fetch('/api/mailbox/settings', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: owner, displayName: 'White Gloss', imapHost: 'imap.example.invalid', imapPort: 993, imapSecure: true, smtpHost: 'smtp.example.invalid', smtpPort: 465, smtpSecure: true, username: owner, password: 'synthetic-browser-secret'})}); if (!response.ok) throw Error(await response.text()); }, owner);
    await page.goto(origin + '/#mailbox'); await page.locator('.cc-head h1').waitFor(); await page.locator('.cc-kpi').first().waitFor();
    const problems = [];
    const check = async (step, root) => { const report = await contrastReport(page, root); log(step, report); for (const item of report.bad) if (item.r < 3) problems.push(`${step}: ${item.el} "${item.t}" ${item.r}`); };

    await check('home', '.cc'); await noOverflow(page, 'home'); await f.screenshot('visual-mail-home-' + tag, {fullPage: false});
    if (viewport.width < 1400 && !(await page.locator('.cc').evaluate(el => el.classList.contains('cc-rail-open')))) await page.locator('[data-cc-rail]').click();
    await check('rail', '.cc'); await page.locator('.cc-rail [data-mail-folder="INBOX"]').click(); await page.locator('.cc-row[data-mail-open]').nth(2).waitFor();
    await check('list', '.cc'); await noOverflow(page, 'list'); await f.screenshot('visual-mail-list-' + tag, {fullPage: false});

    for (const subject of ['Sommeraktion', 'Kurzmitteilung']) {
      await page.locator('.cc-row', {hasText: subject}).click();
      const frame = page.frameLocator('[data-mail-frame]'); await frame.locator('p, .hero').first().waitFor();
      const inner = await frame.locator('body').evaluate(body => {
        const parse = c => (c.match(/[\d.]+/g) ?? []).map(Number), lum = ([r, g, b]) => [r, g, b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const fg = parse(getComputedStyle(body).color), bg = parse(getComputedStyle(body.ownerDocument.documentElement).backgroundColor), [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        return {ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fg: getComputedStyle(body).color, bg: getComputedStyle(body.ownerDocument.documentElement).backgroundColor, font: getComputedStyle(body).fontSize + ' ' + getComputedStyle(body).fontFamily.slice(0, 24)};
      });
      log('frame ' + subject, inner); if (inner.ratio < 7) problems.push(`frame ${subject}: mail text ${inner.ratio}`);
      await check('reader ' + subject, '.cc'); await noOverflow(page, 'reader ' + subject);
      await f.screenshot('visual-mail-reader-' + subject + '-' + tag, {fullPage: false});
      if (viewport.width < 1000) { await page.locator('.cc-back').click(); await page.locator('.cc-list').waitFor({state: 'visible'}); }
    }

    await page.locator('.cc-row', {hasText: 'Frage zur Politur'}).click(); await page.locator('.cc-crm').waitFor();
    await check('reader plain', '.cc'); await f.screenshot('visual-mail-plain-' + tag, {fullPage: false});
    await page.locator('[data-mail-reply-all]').click(); const compose = page.locator('#mailbox-compose'); await compose.waitFor();
    await compose.locator('[data-compose-editor]').click(); await page.keyboard.type('Gerne am Freitag, bite um Bestätigung.');
    await check('compose', '#mailbox-compose'); await f.screenshot('visual-mail-compose-' + tag, {fullPage: false});
    const ai = compose.locator('[data-assistant-start]');
    assert.ok(await ai.isVisible(), 'AI correction button is visible in the editor'); log('ai-button', {text: (await ai.textContent()).trim(), disabled: await ai.isDisabled()});
    await ai.click(); const dialog = page.locator('dialog.assistant-confirm'); await dialog.waitFor();
    await check('ai-dialog', 'dialog.assistant-confirm'); await f.screenshot('visual-mail-ai-' + tag, {fullPage: false});
    await dialog.locator('[data-assistant-cancel]').first().click();
    assert.deepEqual(problems, [], 'texts below 3:1 contrast');
    assert.deepEqual(f.errors, []);
  });
}
