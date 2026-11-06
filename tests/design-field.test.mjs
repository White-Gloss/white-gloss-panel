// Vor-Ort-App (Bereich "field"): Bedienbarkeit am Smartphone, Fotozähler, Unterschrift und Service Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {protocolFormHTML, mountProtocolForm} from '../dist/client/protocol-form.js';

const read = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const style = read('style.css'), surface = read('surface.css');

test('bottom navigation and action bar respect the bottom safe area', () => {
  assert.match(style, /\.vo-dock\{[^}]*env\(safe-area-inset-bottom/);
  assert.match(style, /\.vo-bar\{[^}]*env\(safe-area-inset-bottom/);
});

test('field controls are 48px tall with 16px text', () => {
  assert.match(style, /\.vo button,\.vo a\.button,\.vo input,\.vo select,\.vo textarea\{[^}]*min-height:48px;font-size:16px/);
  assert.match(surface, /html\[data-area="field"\] button,\s*html\[data-area="field"\] a\.button\s*\{[^}]*min-height:48px/);
});

test('photo thumbnails keep a 96px touch size in the field area', () => {
  assert.match(surface, /html\[data-area="field"\] \.photos img\s*\{[^}]*min-width:\s*96px[^}]*min-height:\s*96px|html\[data-area="field"\] \.photos img\s*\{[^}]*min-height:\s*96px[^}]*min-width:\s*96px/);
});

test('active dock item carries the gold marker line', () => {
  assert.match(surface, /html\[data-area="field"\] \.vo-dock a\[aria-current=page\][^{]*\{[^}]*var\(--gold\)/);
});

test('signature field is large and the toast fades in smoothly', () => {
  assert.match(surface, /html\[data-area="field"\] \.signature\s*\{[^}]*min-height:\s*180px/);
  assert.match(surface, /html\[data-area="field"\] #toast\.visible\s*\{[^}]*animation:[^;}]*toast-in/);
  assert.match(surface, /@keyframes toast-in/);
});

test('the stored signature image stays white with a dark stroke (PDF)', () => {
  const source = read('signature.js');
  assert.match(source, /ctx\.fillStyle='#fff'/);
  const stroke = /ctx\.strokeStyle='(#[0-9a-f]{6})'/i.exec(source)[1];
  const [r, g, b] = [1, 3, 5].map(i => parseInt(stroke.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  assert.ok(0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2, 'stroke is dark');
});

test('service worker shell lists the design files and uses cache v5', () => {
  const source = read('sw.js'), shell = vm.runInNewContext(/const SHELL=(\[[^;]+\]);/.exec(source)[1]);
  for (const path of ['/tokens.css', '/surface.css', '/motion.js']) assert.ok(shell.includes(path), path);
  assert.match(source, /const CACHE='wg-vor-ort-v5'/);
});

test('photo counter shows new and kept photos out of 20', () => {
  const html = protocolFormHTML({kind: 'intake', order: {wg: 'WG-1', source: {name: 'Erika'}}, company: {}, protocol: {photos: ['a', 'b']}});
  const dom = new JSDOM('<body>' + html + '</body>'), doc = dom.window.document, form = doc.querySelector('form');
  mountProtocolForm(form);
  const out = form.querySelector('[data-photo-count]');
  assert.ok(out, 'counter element');
  assert.equal(out.textContent, '2/20');
  const input = form.querySelector('[data-photo-input]');
  Object.defineProperty(input, 'files', {value: [{}, {}, {}]});
  input.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  assert.equal(out.textContent, '5/20');
  form.querySelector('[name=keepPhoto]').checked = false;
  form.querySelector('[name=keepPhoto]').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
  assert.equal(out.textContent, '4/20');
});

test('both dialog helpers enable the sheet gesture', () => {
  for (const file of ['vor-ort.js', 'app.js']) {
    const source = read(file);
    assert.match(source, /import \{[^}]*enableSheet[^}]*\} from '\.\/motion\.js'/, file);
    assert.match(source, /enableSheet\(m,\{canClose:/, file);
  }
});

test('service worker shell contains every module the field app imports (offline start)', () => {
  const shell = vm.runInNewContext(/const SHELL=(\[[^;]+\]);/.exec(read('sw.js'))[1]);
  const dir = new URL('../dist/client/', import.meta.url), seen = new Set(), queue = ['vor-ort.js'];
  while (queue.length) {
    const file = queue.pop(); if (seen.has(file)) continue; seen.add(file);
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const m of source.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([^'"]+)['"]/g)) queue.push(m[1]);
  }
  const missing = [...seen].filter(file => !shell.includes('/' + file));
  assert.deepEqual(missing, []);
});

test('the mail folder toggle uses its own icon, not a second hamburger', () => {
  assert.match(read('mailbox.js'), /data-cc-rail aria-label="Ordner und Bereiche öffnen" aria-expanded="\$\{railOpen\}">\$\{icon\('inbox'\)\}/);
});

test('service worker shell lists every script and stylesheet the field page loads', () => {
  const shell = vm.runInNewContext(/const SHELL=(\[[^;]+\]);/.exec(read('sw.js'))[1]);
  const html = read('vor-ort.html');
  const assets = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map(m => m[1]);
  assert.ok(assets.includes('/theme.js'));
  assert.deepEqual(assets.filter(path => !shell.includes(path)), []);
});
