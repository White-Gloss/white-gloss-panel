// Obsidian & Platin: jede Seite in Dunkel und Hell, Smartphone und Desktop. Nur auf dem Linux-GitHub-Runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {browserFixture,origin,customer} from './harness.mjs';

const pages = [
  {name: 'panel', path: '/', area: 'operator'},
  {name: 'vor-ort', path: '/vor-ort', area: 'field'},
  {name: 'buchhaltung', path: '/buchhaltung?month=2026-09', area: 'operator'},
  {name: 'kunde', path: '/kunde', area: 'customer', identity: customer},
  {name: 'kanzlei', path: '/kanzlei', area: 'advisor'}
];
const background = {dark: 'rgb(14, 18, 24)', light: 'rgb(245, 243, 238)'};
const viewports = [{width: 390, height: 844}, {width: 1366, height: 800}];

for (const scheme of ['dark', 'light']) for (const viewport of viewports) for (const spec of pages) {
  test(`design ${spec.name} ${scheme} ${viewport.width}px`, async t => {
    const f = await browserFixture(t, {viewport, colorScheme: scheme, ...(spec.identity ? {identity: spec.identity} : {})}), {page} = f;
    await page.goto(origin + spec.path);
    await page.waitForLoadState('networkidle');
    await page.evaluate(()=>document.fonts.ready);
    const typography=await page.evaluate(()=>({body:getComputedStyle(document.body).fontFamily,loaded:[...document.fonts].filter(font=>font.status==='loaded').map(font=>font.family.replace(/["']/g,''))}));
    assert.match(typography.body,/Plus Jakarta Sans/,'body uses the shared brand typeface');
    assert.ok(typography.loaded.includes('Syne')&&typography.loaded.includes('Plus Jakarta Sans'),'both owned font files are actually loaded');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.area), spec.area, 'data-area');
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), background[scheme], 'page background token');
    const result = await page.evaluate(() => {
      const parse = c => (c.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ground = el => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.9) return c; } return parse(getComputedStyle(document.documentElement).backgroundColor); };
      const bad = [];
      for (const el of document.querySelectorAll('h1,h2,h3,p,label,button,a,td,th,small')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || !el.textContent.trim()) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        const fg = parse(style.color), bg = ground(el), [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < 3) bad.push(`${el.tagName.toLowerCase()}.${el.className} "${el.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}`);
      }
      return {bad: bad.slice(0, 12), overflow: document.documentElement.scrollWidth > innerWidth};
    });
    assert.deepEqual(result.bad, [], 'readable text on its background');
    assert.equal(result.overflow, false, 'no horizontal overflow');
    await f.screenshot(`design-${spec.name}-${scheme}-${viewport.width}`);
    assert.deepEqual(f.errors, []);
  });
}
