import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../public/tokens.css', import.meta.url), 'utf8');

// Parses `--name:value;` pairs of the root block (dark) or of the prefers-color-scheme:light block (light).
export function parseTokens(source, mode) {
  const lightStart = source.indexOf('@media (prefers-color-scheme: light)');
  const scope = mode === 'light'
    ? (lightStart < 0 ? '' : source.slice(lightStart))
    : (lightStart < 0 ? source : source.slice(0, lightStart));
  const out = {};
  for (const m of scope.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const required = ['bg', 'surface', 'elevated', 'fg', 'muted', 'accent', 'gold', 'good', 'warn', 'danger', 'line', 'on-accent',
  'radius-s', 'radius-m', 'radius-l', 'shadow-1', 'shadow-2', 'glass', 'scrim', 'good-bg', 'warn-bg', 'danger-bg'];
const textTokens = ['fg', 'muted', 'accent', 'gold', 'good', 'warn', 'danger'];
const grounds = ['bg', 'surface', 'elevated'];

test('all required tokens exist in dark mode', () => {
  const dark = parseTokens(css, 'dark');
  for (const name of required) assert.ok(name in dark, `dark --${name}`);
});

test('light mode overrides the colour tokens', () => {
  const light = parseTokens(css, 'light');
  for (const name of ['bg', 'surface', 'elevated', 'fg', 'muted', 'accent', 'gold', 'good', 'warn', 'danger', 'line', 'on-accent'])
    assert.ok(name in light, `light --${name}`);
});

test('spec values are used verbatim', () => {
  const dark = parseTokens(css, 'dark'), light = parseTokens(css, 'light');
  const spec = {
    dark: {bg: '#0b0d10', surface: '#12161b', elevated: '#1a2027', fg: '#eef0f3', muted: '#9aa4b0', accent: '#d9dee5', gold: '#c9a96b', good: '#6fc3a0', warn: '#e0b45c', danger: '#ef8a84', 'on-accent': '#0b0d10'},
    light: {bg: '#f5f3ee', surface: '#ffffff', elevated: '#ece9e2', fg: '#14181d', muted: '#5b6470', accent: '#1b2530', gold: '#7a5f26', good: '#2f6b53', warn: '#7d5a12', danger: '#a63d38', 'on-accent': '#f5f3ee'}
  };
  for (const [name, value] of Object.entries(spec.dark)) assert.equal(dark[name].toLowerCase(), value, `dark --${name}`);
  for (const [name, value] of Object.entries(spec.light)) assert.equal(light[name].toLowerCase(), value, `light --${name}`);
});

for (const mode of ['dark', 'light']) {
  test(`${mode} text pairs reach 4.5:1`, () => {
    const tokens = parseTokens(css, mode);
    const merged = mode === 'light' ? {...parseTokens(css, 'dark'), ...tokens} : tokens;
    for (const t of textTokens) for (const g of grounds)
      assert.ok(contrast(merged[t], merged[g]) >= 4.5, `${mode} --${t} on --${g}: ${contrast(merged[t], merged[g]).toFixed(2)}`);
    assert.ok(contrast(merged['on-accent'], merged.accent) >= 4.5, `${mode} --on-accent on --accent`);
  });
}

test('declares colour-scheme and the accessibility media blocks', () => {
  assert.match(css, /color-scheme:\s*dark light/);
  assert.match(css, /@media \(prefers-color-scheme: light\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
});
