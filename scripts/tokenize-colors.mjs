// Ersetzt feste Farben in CSS durch Design-Tokens aus public/tokens.css.
// Aufruf: node scripts/tokenize-colors.mjs public/datei.css [weitere.css]
// Zeilen mit einem Kommentar `/* keep: Grund */` bleiben unberührt. Nicht eindeutige Farben werden gemeldet.
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const NAMED = {white: '#ffffff', black: '#000000'};
const COLOR = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/g;

function parse(value) {
  const v = value.toLowerCase();
  if (NAMED[v]) return parse(NAMED[v]);
  if (v.startsWith('#')) {
    let h = v.slice(1);
    if (h.length <= 4) h = [...h].map(c => c + c).join('');
    const n = i => parseInt(h.slice(i, i + 2), 16);
    return {r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1};
  }
  const m = /^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/.exec(v);
  return m ? {r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4]} : null;
}

function lum({r, g, b}) {
  const [x, y, z] = [r, g, b].map(c => c / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * x + 0.7152 * y + 0.0722 * z;
}
function chroma({r, g, b}) { return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; }
function hue({r, g, b}) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function family(c) {
  const h = hue(c);
  if (h >= 330 || h < 20) return 'danger';
  if (h < 75) return 'warn';
  if (h < 170) return 'good';
  return 'accent';
}

const TEXT = new Set(['color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color']);
const SHADOW = new Set(['box-shadow', 'text-shadow', 'filter', 'drop-shadow']);
const kind = prop => /^outline/.test(prop) ? 'focus' : TEXT.has(prop) ? 'text' : prop.startsWith('background') ? 'bg' : /^(border|column-rule)/.test(prop) ? 'line'
  : SHADOW.has(prop) ? 'shadow' : null;
const pct = a => Math.round(a * 100);
const mix = (token, a) => `color-mix(in srgb,var(--${token}) ${pct(a)}%,transparent)`;

// Liefert einen Token-Ausdruck oder {reason}, wenn die Farbe nicht eindeutig zugeordnet werden kann.
function pick(prop, c) {
  const k = kind(prop);
  if (!k) return {reason: `Eigenschaft ${prop || '?'} unbekannt`};
  const L = lum(c), fam = family(c);
  // Kräftige Farben (Chroma > 0,15) und zart getönte Hellflächen in Status-Tönen zählen als farbig.
  const colorful = chroma(c) > 0.15 || (L > 0.8 && chroma(c) >= 0.03 && fam !== 'accent'), f = colorful ? fam : null;
  if (k === 'focus') return 'var(--accent)'; // Fokusrahmen immer gut sichtbar
  if (k === 'shadow') return c.a < 1 ? mix('shadow-ink', c.a) : 'var(--shadow-ink)';
  if (c.a < 1) {
    if (k === 'line') return 'var(--line)';
    if (k === 'text') return mix(colorful ? f : L > 0.5 ? 'on-accent' : 'fg', c.a);
    if (colorful) return mix(f === 'accent' ? 'accent' : f, c.a);
    if (L < 0.1) return 'var(--scrim)';
    if (L > 0.9 && c.a <= 0.35) return mix('fg', c.a); // zarte Aufhellung = Haarlinie in der Textfarbe
    return mix(L > 0.9 ? 'surface' : 'elevated', c.a);
  }
  if (k === 'text') {
    if (L > 0.8) return 'var(--on-accent)';
    if (colorful) return `var(--${f})`;
    return L < 0.09 ? 'var(--fg)' : 'var(--muted)';
  }
  if (k === 'line') {
    if (colorful) return f === 'accent' ? (L < 0.09 ? 'var(--accent)' : 'var(--line)') : (L > 0.7 ? 'var(--line)' : `var(--${f})`);
    return L < 0.09 ? 'var(--accent)' : 'var(--line)';
  }
  // Hintergründe
  if (colorful) return L > 0.8 ? (f === 'accent' ? 'var(--elevated)' : `var(--${f}-bg)`) : `var(--${f})`;
  if (L < 0.02) return {reason: 'reines Schwarz'};
  if (L > 0.97) return 'var(--surface)';
  if (L > 0.88) return 'var(--bg)';
  if (L > 0.25) return 'var(--elevated)';
  return 'var(--accent)';
}

// Bereiche aller url(...)-Angaben, damit Farben in eingebetteten Grafiken nicht geraten werden.
function urlRanges(css) {
  const ranges = [];
  for (const m of css.matchAll(/url\(\s*/g)) {
    const from = m.index + m[0].length, quote = css[from];
    const close = quote === '"' || quote === "'" ? css.indexOf(quote, from + 1) : from - 1;
    const end = css.indexOf(')', close + 1);
    ranges.push([m.index, end < 0 ? css.length : end + 1]);
  }
  return ranges;
}

export function tokenize(css) {
  const unmapped = [];
  const lineStarts = [0];
  for (let i = 0; i < css.length; i++) if (css[i] === '\n') lineStarts.push(i + 1);
  const lineOf = i => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= i) lo = m; else hi = m - 1; } return lo; };
  const lineText = n => css.slice(lineStarts[n], lineStarts[n + 1] ?? css.length);
  const urls = urlRanges(css);
  let out = '', last = 0;
  for (const m of css.matchAll(COLOR)) {
    const i = m.index, end = i + m[0].length;
    if (/\/\*\s*keep:/.test(lineText(lineOf(i)))) continue;
    // Auswahlregeln: nach dem Treffer folgt „{“ vor „;“ oder „}“.
    const k = css.slice(end).search(/[;{}]/);
    if (k >= 0 && css[end + k] === '{') continue;
    const start = Math.max(css.lastIndexOf(';', i), css.lastIndexOf('{', i), css.lastIndexOf('}', i));
    const decl = css.slice(start + 1, i), colon = decl.indexOf(':');
    const report = reason => unmapped.push({line: lineOf(i) + 1, value: m[0], reason});
    if (urls.some(([a, b]) => i >= a && i < b)) { report('innerhalb von url()'); continue; }
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).replace(/\/\*[\s\S]*?\*\//g, '').trim().toLowerCase();
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(prop)) continue;
    const c = parse(m[0]);
    if (!c) { report('Farbformat nicht lesbar'); continue; }
    const result = pick(prop, c);
    if (typeof result !== 'string') { report(result.reason); continue; }
    out += css.slice(last, i) + result; last = end;
  }
  return {css: out + css.slice(last), unmapped};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failed = false;
  for (const file of process.argv.slice(2)) {
    const result = tokenize(readFileSync(file, 'utf8'));
    writeFileSync(file, result.css);
    console.log(`${file}: ${result.unmapped.length} nicht zugeordnet`);
    for (const u of result.unmapped) console.log(`  Zeile ${u.line}: ${u.value} (${u.reason})`);
    if (result.unmapped.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
