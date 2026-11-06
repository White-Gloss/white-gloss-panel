import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tokenize} from '../scripts/tokenize-colors.mjs';
import {MIGRATED} from './helpers/design.mjs';


const t = css => tokenize(css).css;

test('opaque white background becomes the surface token', () => {
  assert.equal(t('.a{background:#ffffff}'), '.a{background:var(--surface)}');
  assert.equal(t('.a{background:white}'), '.a{background:var(--surface)}');
});
test('dark text becomes --fg and borders become --line', () => {
  assert.equal(t('.a{color:#263142}'), '.a{color:var(--fg)}');
  assert.equal(t('.a{border:1px solid #e6e9ee}'), '.a{border:1px solid var(--line)}');
});
test('mid-grey text stays secondary, near-black text becomes primary', () => {
  assert.equal(t('.a{color:#627185}'), '.a{color:var(--muted)}');
  assert.equal(t('.a{color:#34404c}'), '.a{color:var(--fg)}');
  assert.equal(t('.a{border:1px solid #8ea1b6}'), '.a{border:1px solid var(--line)}');
});
test('dark fills pair with --on-accent text', () => {
  assert.equal(t('.a{background:#264c73;color:#fff}'), '.a{background:var(--accent);color:var(--on-accent)}');
});
test('status hues map to the status tokens', () => {
  assert.equal(t('.a{color:#ad534e}'), '.a{color:var(--danger)}');
  assert.equal(t('.a{background:#f9efed}'), '.a{background:var(--danger-bg)}');
  assert.equal(t('.a{color:#3a735b}'), '.a{color:var(--good)}');
  assert.equal(t('.a{color:#987644}'), '.a{color:var(--warn)}');
});
test('shadow colours keep their strength through color-mix', () => {
  assert.equal(t('.a{box-shadow:0 6px 24px #18253406}'), '.a{box-shadow:0 6px 24px color-mix(in srgb,var(--shadow-ink) 2%,transparent)}');
});
test('translucent light backgrounds keep their opacity', () => {
  assert.equal(t('.a{background:#ffffffed}'), '.a{background:color-mix(in srgb,var(--surface) 93%,transparent)}');
});
test('faint white overlays become a hairline of the text colour, not of the surface', () => {
  assert.equal(t('.a{background:#ffffff14}'), '.a{background:color-mix(in srgb,var(--fg) 8%,transparent)}');
  assert.equal(t('.a{background:rgba(255,255,255,.9)}'), '.a{background:color-mix(in srgb,var(--surface) 90%,transparent)}');
});
test('selectors that look like hex colours are left alone', () => {
  assert.equal(t('#add-form:hover{color:#fff}'), '#add-form:hover{color:var(--on-accent)}');
  assert.equal(t('a:hover #fab{margin:0}'), 'a:hover #fab{margin:0}');
});
test('lines marked keep are not touched', () => {
  const css = '.a{color:#fff}/* keep: Foto-Overlay */';
  assert.deepEqual(tokenize(css), {css, unmapped: []});
});
test('colours inside url() and pure black fills are reported, not guessed', () => {
  const svg = '.a{background:url("data:image/svg+xml;utf8,<svg fill=\'#264c73\'/>")}';
  assert.deepEqual(tokenize(svg).unmapped.map(u => u.value), ['#264c73']);
  assert.equal(tokenize(svg).css, svg);
  assert.deepEqual(tokenize('.a{background:#000}').unmapped.map(u => u.value), ['#000']);
});
test('tokenizing twice changes nothing', () => {
  const once = t('.a{background:#fff;color:#182534;border:1px solid #dde}');
  assert.equal(t(once), once);
});

for (const file of MIGRATED) {
  test(`${file} contains no raw colours`, () => {
    const {css, unmapped} = tokenize(readFileSync(new URL('../public/' + file, import.meta.url), 'utf8'));
    assert.deepEqual(unmapped, []);
    assert.equal(css, readFileSync(new URL('../public/' + file, import.meta.url), 'utf8'), `${file} still has replaceable colours`);
  });
}

test('focus outlines use the accent colour, not the faint hairline', () => {
  assert.equal(t('a:focus-visible{outline:2px solid #bfcee0}'), 'a:focus-visible{outline:2px solid var(--accent)}');
});
