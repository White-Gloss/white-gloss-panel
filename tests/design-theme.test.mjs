// Tag/Nacht-Schalter, Abmelden im Menü, Suche im Postfach, fünf Einträge in der unteren Leiste.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {loginPage} from '../server/auth.mjs';

const read = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
const pages = ['index.html', 'vor-ort.html', 'bookkeeping.html', 'kunde.html', 'chat.html', 'advisor.html'];

for (const page of pages) test(`${page} loads theme.js in the head, before the stylesheets`, () => {
  const html = read(page), head = html.slice(0, html.indexOf('</head>'));
  const script = head.indexOf('<script src="/theme.js"></script>'), sheet = head.indexOf('<link rel="stylesheet"');
  assert.ok(script > -1, 'theme.js script tag');
  assert.ok(script < sheet, 'theme.js runs before the first stylesheet (no flash of the wrong theme)');
});

test('login pages load theme.js too', async () => {
  assert.match(await loginPage().text(), /<script src="\/theme\.js"><\/script>/);
  assert.match(readFileSync(new URL('../server/password-auth.mjs', import.meta.url), 'utf8'), /<script src="\/theme\.js"><\/script>/);
});

function boot({saved = null, prefersLight = false, body = '<button data-theme-toggle></button>'} = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0e1218"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f3ee"></head><body>${body}</body></html>`, {runScripts: 'outside-only', url: 'https://panel.example.invalid/'});
  const w = dom.window;
  w.matchMedia = query => ({matches: /light/.test(query) ? prefersLight : !prefersLight, addEventListener() {}});
  if (saved) w.localStorage.setItem('wg-theme', saved);
  w.eval(read('theme.js'));
  return w;
}

test('a saved choice is applied immediately', () => {
  assert.equal(boot({saved: 'dark'}).document.documentElement.dataset.theme, 'dark');
  assert.equal(boot({saved: 'light'}).document.documentElement.dataset.theme, 'light');
});
test('an invalid saved value is ignored and the device decides', () => {
  assert.equal(boot({saved: 'neon'}).document.documentElement.dataset.theme, undefined);
});
test('the toggle switches day and night against what is shown now, and remembers it', () => {
  const night = boot({prefersLight: false});
  night.document.querySelector('[data-theme-toggle]').click();
  assert.equal(night.document.documentElement.dataset.theme, 'light');
  assert.equal(night.localStorage.getItem('wg-theme'), 'light');
  night.document.querySelector('[data-theme-toggle]').click();
  assert.equal(night.document.documentElement.dataset.theme, 'dark');
  const day = boot({prefersLight: true});
  day.document.querySelector('[data-theme-toggle]').click();
  assert.equal(day.document.documentElement.dataset.theme, 'dark');
});
test('the toggle button announces the action and the browser colour follows the choice', () => {
  const w = boot({saved: 'light'});
  const button = w.document.querySelector('[data-theme-toggle]');
  assert.match(button.getAttribute('aria-label'), /Nacht/);
  assert.deepEqual([...w.document.querySelectorAll('meta[name=theme-color]')].map(m => m.content), ['#f5f3ee', '#f5f3ee']);
  button.click();
  assert.match(button.getAttribute('aria-label'), /Tag/);
  assert.deepEqual([...w.document.querySelectorAll('meta[name=theme-color]')].map(m => m.content), ['#0e1218', '#0e1218']);
});
test('toggle buttons added later still work (delegated click)', () => {
  const w = boot({body: ''});
  w.document.body.insertAdjacentHTML('beforeend', '<button data-theme-toggle></button>');
  w.document.querySelector('[data-theme-toggle]').click();
  assert.ok(w.document.documentElement.dataset.theme);
});

const app = read('app.js'), voSource = read('vor-ort.js'), enterprise = read('enterprise.css'), surface = read('surface.css');

test('panel top bar has the day/night toggle and no logout button', () => {
  const top = app.slice(app.indexOf('<header class="topbar"'), app.indexOf('</header>', app.indexOf('<header class="topbar"')));
  assert.match(top, /data-theme-toggle/);
  assert.doesNotMatch(top, /data-click="logout"/);
});
test('logout lives at the bottom of the side menu', () => {
  const footer = app.slice(app.indexOf('<footer><strong>White Gloss Detailing'), app.indexOf('</footer>', app.indexOf('<footer><strong>White Gloss Detailing')));
  assert.match(footer, /data-click="logout"/);
});
test('field app top bar has the toggle', () => {
  assert.match(voSource, /data-theme-toggle/);
});
test('the mobile dock has five entries and no more', () => {
  const nav = app.slice(app.indexOf('function mobileNavigation'), app.indexOf('let menuOpener'));
  const items = [...nav.matchAll(/\['([a-z]+)','[a-z]+','([^']+)'\]/g)].map(m => m[2]);
  assert.deepEqual(items, ['Start', 'Mail', 'Chat', 'Aufträge']);
  assert.match(nav, /<span>Mehr<\/span>/);
  assert.match(enterprise, /\.mobile-dock\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/);
  assert.doesNotMatch(enterprise, /\.mobile-dock\{grid-template-columns:repeat\(7/);
});
test('the mail view hides the top search because the mailbox has its own', () => {
  // Nicht data-view: Das Panel navigiert über closest('[data-view]'), ein solches Attribut auf <main> würde jeden Klick im Inhalt zur Navigation machen.
  assert.match(app, /<main class="workspace" data-screen="\$\{esc\(view\)\}">/);
  assert.doesNotMatch(app, /<main[^>]*data-view=/);
  assert.match(surface, /\.workspace\[data-screen="mailbox"\] \.topbar \.search\s*\{[^}]*display:\s*none/);
});
test('the theme toggle swaps sun and moon with the theme', () => {
  assert.match(surface, /\.theme-toggle \.ico-moon\s*\{[^}]*display:\s*none/);
  assert.match(surface, /:root\[data-theme="light"\] \.theme-toggle \.ico-sun\s*\{[^}]*display:\s*none/);
  assert.match(surface, /:root\[data-theme="light"\] \.theme-toggle \.ico-moon\s*\{[^}]*display:\s*(inline|block|inline-block|inline-flex|flex)/);
});
