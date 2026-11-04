// Prüft pro Seite in Ladereihenfolge aller Stylesheets: derselbe Selektor darf nicht Text- und Hintergrundfarbe
// aus verschiedenen Dateien so kombinieren, dass der Kontrast unter 3:1 fällt (Dunkel und Hell).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tokenMap, resolve, contrast, MIGRATED} from './helpers/design.mjs';

const pages = ['index', 'vor-ort', 'bookkeeping', 'kunde', 'chat', 'advisor'];
const read = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const sheets = html => [...html.matchAll(/<link rel="stylesheet" href="\/([^"]+)">/g)].map(m => m[1]);

for (const page of pages) {
  test(`${page}.html: text and background of one selector stay readable across all stylesheets`, () => {
    const maps = {dark: tokenMap('dark'), light: tokenMap('light')}, seen = new Set(), problems = [];
    const bySelector = {};
    for (const file of sheets(read(page + '.html'))) {
      if (!MIGRATED.includes(file) && !['surface.css', 'tokens.css'].includes(file)) continue;
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}@;][^{}]*)\{([^{}]*)\}/g)) {
        for (const selector of m[1].split(',').map(x => x.trim().replace(/\s+/g, ' '))) {
          const entry = bySelector[selector] ??= {};
          for (const d of m[2].split(';')) {
            const i = d.indexOf(':'); if (i < 0) continue;
            const prop = d.slice(0, i).trim(), value = d.slice(i + 1).trim();
            if (prop === 'color') entry.color = [value, file];
            if (prop === 'background' || prop === 'background-color') entry.bg = [value, file];
          }
        }
      }
    }
    for (const [selector, e] of Object.entries(bySelector)) {
      if (!e.color || !e.bg) continue;
      const t = /^var\(--([a-z0-9-]+)\)/.exec(e.color[0])?.[1], b = /^var\(--([a-z0-9-]+)\)/.exec(e.bg[0])?.[1];
      if (!t || !b) continue;
      for (const mode of ['dark', 'light']) {
        const ft = resolve(t, maps[mode]), fb = resolve(b, maps[mode]);
        if (ft && fb && contrast(ft, fb) < 3 && !seen.has(selector + mode)) {
          seen.add(selector + mode);
          problems.push(`${mode} ${selector}: ${t} (${e.color[1]}) on ${b} (${e.bg[1]}) = ${contrast(ft, fb).toFixed(2)}`);
        }
      }
    }
    assert.deepEqual(problems, []);
  });
}

test('links inside own chat bubbles use the on-accent colour', () => {
  assert.match(read('chat.css'), /\.chat-msg\.mine \.chat-text a\{[^}]*color:var\(--on-accent\)/);
});
