import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const surface = read('surface.css');

const aliases = {
  '--ink': '--fg', '--blue': '--accent', '--pale': '--elevated', '--red': '--danger', '--app-shadow': '--shadow-1',
  '--wg-bg': '--bg', '--wg-canvas': '--bg', '--wg-surface': '--surface', '--wg-paper': '--surface',
  '--wg-elevated': '--elevated', '--wg-fg': '--fg', '--wg-ink': '--fg', '--wg-copy': '--fg',
  '--wg-muted': '--muted', '--wg-subtle': '--muted', '--wg-line': '--line', '--wg-rule': '--line',
  '--wg-accent': '--accent', '--wg-chrome': '--accent', '--wg-chrome-soft': '--elevated',
  '--wg-success': '--good', '--wg-success-bg': '--good-bg', '--wg-warning': '--warn', '--wg-warning-bg': '--warn-bg',
  '--wg-error': '--danger', '--wg-error-bg': '--danger-bg'
};

test('every legacy variable family points to a token', () => {
  for (const [legacy, token] of Object.entries(aliases))
    assert.match(surface, new RegExp(legacy + '\\s*:\\s*var\\(' + token + '\\)'), `${legacy} -> ${token}`);
});

test('style.css no longer redefines the colliding token names on :root', () => {
  const style = read('style.css');
  for (const m of style.matchAll(/:root\{([^}]*)\}/g))
    for (const name of ['--muted', '--line', '--good', '--warn'])
      assert.equal(new RegExp('(^|;)\\s*' + name + '\\s*:').test(m[1]), false, `style.css :root defines ${name}`);
});

test('page background and text come from the tokens', () => {
  assert.match(surface, /:root\s*\{[^}]*background:\s*var\(--bg\)[^}]*color:\s*var\(--fg\)|:root\s*\{[^}]*color:\s*var\(--fg\)[^}]*background:\s*var\(--bg\)/);
});

test('print block forces the light values on white', () => {
  const print = /@media print\s*\{([\s\S]*?)\n\}/.exec(surface);
  assert.ok(print, 'print block');
  for (const hex of ['#ffffff', '#14181d']) assert.ok(print[1].toLowerCase().includes(hex), hex);
});

test('reduced motion removes transitions, animations and transforms', () => {
  const block = /@media \(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(surface);
  assert.ok(block, 'reduced-motion block');
  assert.match(block[1], /transition/);
  assert.match(block[1], /animation/);
});

test('glass bars fall back to a closed surface without backdrop-filter', () => {
  assert.match(surface, /@supports not \(\(?backdrop-filter:\s*blur\(1px\)\)?\)/);
  assert.match(surface, /backdrop-filter:\s*blur\(/);
});

test('inputs use 16px text and controls keep 48px touch height', () => {
  const rule = /input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),\s*select,\s*textarea\s*\{([^}]*)\}/.exec(surface);
  assert.ok(rule, 'input rule');
  assert.match(rule[1], /font-size:\s*16px/);
  assert.match(rule[1], /min-height:\s*48px/);
  assert.match(surface, /button,\s*a\.button\s*\{[^}]*min-height:\s*48px/);
});

test('uses safe-area insets and tabular numbers', () => {
  assert.match(surface, /env\(safe-area-inset-bottom/);
  assert.match(surface, /font-variant-numeric:\s*tabular-nums/);
});

test('operator area styles the sidebar, mobile dock and action centre', () => {
  assert.match(surface, /html\[data-area="operator"\] \.sidebar\s*\{[^}]*background:\s*var\(--bg\)/);
  assert.match(surface, /html\[data-area="operator"\] \.mobile-dock [^{]*\{[^}]*var\(--gold\)/);
  assert.match(surface, /html\[data-area="operator"\] \.action-center[^{]*\{[^}]*border-radius:\s*var\(--radius-m\)/);
});
