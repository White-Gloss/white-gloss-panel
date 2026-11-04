import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loginPage} from '../server/auth.mjs';

const areas = {
  'vor-ort.html': 'field', 'index.html': 'operator', 'bookkeeping.html': 'operator',
  'kunde.html': 'customer', 'chat.html': 'customer', 'advisor.html': 'advisor'
};

function stylesheets(html) {
  return [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"|<link[^>]+href="([^"]+)"[^>]*rel="stylesheet"/g)].map(m => m[1] ?? m[2]);
}

for (const [file, area] of Object.entries(areas)) {
  test(`${file} loads tokens.css first, surface.css last and declares data-area="${area}"`, () => {
    const html = readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
    const sheets = stylesheets(html);
    assert.equal(sheets[0], '/tokens.css', 'first stylesheet');
    assert.equal(sheets.at(-1), '/surface.css', 'last stylesheet');
    assert.match(html, new RegExp(`<html[^>]*data-area="${area}"`));
  });

  test(`${file} offers a dark and a light theme-color when it has one`, () => {
    const html = readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
    const metas = [...html.matchAll(/<meta name="theme-color"[^>]*>/g)].map(m => m[0]);
    if (!metas.length) return;
    assert.ok(metas.some(m => m.includes('(prefers-color-scheme: dark)') && m.includes('#0b0d10')), 'dark');
    assert.ok(metas.some(m => m.includes('(prefers-color-scheme: light)') && m.includes('#f5f3ee')), 'light');
  });
}

test('login page loads the tokens before and surface after the old styles', async () => {
  const html = await loginPage().text();
  assert.deepEqual(stylesheets(html), ['/tokens.css', '/style.css', '/brand.css', '/surface.css']);
  assert.match(html, /<html[^>]*data-area="operator"/);
});

test('password page source loads the tokens before and surface after the old styles', () => {
  const source = readFileSync(new URL('../server/password-auth.mjs', import.meta.url), 'utf8');
  const line = source.split('\n').find(l => l.includes('White Gloss · Passwort'));
  assert.deepEqual(stylesheets(line), ['/tokens.css', '/style.css', '/brand.css', '/surface.css']);
  assert.match(line, /<html[^>]*data-area="operator"/);
});
