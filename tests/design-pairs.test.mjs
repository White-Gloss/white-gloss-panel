// Prüft in jeder Regel, die Text- und Hintergrundfarbe als Token setzt, den Kontrast in Dunkel und Hell.
import test from 'node:test';
import assert from 'node:assert/strict';
import {MIGRATED, read, tokenMap, resolve, contrast} from './helpers/design.mjs';

const MIN = 3; // Mindestkontrast für Text in Regeln mit eigenem Hintergrund (großer Text); Fließtext wird in tokens.test geprüft.

function rules(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}@;][^{}]*)\{([^{}]*)\}/g)) out.push({selector: m[1].trim().replace(/\s+/g, ' '), body: m[2]});
  return out;
}
const decl = (body, prop) => {
  for (const d of body.split(';')) {
    const i = d.indexOf(':');
    if (i > 0 && d.slice(0, i).trim() === prop) return d.slice(i + 1).trim();
  }
  return null;
};
const firstVar = value => /var\(--([a-z0-9-]+)\)/.exec(value ?? '')?.[1] ?? null;

for (const file of MIGRATED) {
  test(`${file}: text and background tokens in one rule keep contrast in dark and light`, () => {
    const maps = {dark: tokenMap('dark'), light: tokenMap('light')}, problems = [];
    for (const {selector, body} of rules(read(file))) {
      const text = decl(body, 'color'), bgValue = decl(body, 'background') ?? decl(body, 'background-color');
      if (!text || !bgValue || /^(inherit|currentColor)/i.test(text)) continue;
      const t = /^var\(--([a-z0-9-]+)\)$/.exec(text)?.[1], b = firstVar(bgValue);
      if (!t || !b || /color-mix|rgba?\(/.test(bgValue)) continue;
      for (const mode of ['dark', 'light']) {
        const ft = resolve(t, maps[mode]), fb = resolve(b, maps[mode]);
        if (ft && fb && contrast(ft, fb) < MIN) problems.push(`${file} [${mode}] ${selector}: ${t} on ${b} = ${contrast(ft, fb).toFixed(2)}`);
      }
    }
    assert.deepEqual(problems, []);
  });
}
