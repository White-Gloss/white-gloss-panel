// Gemeinsame Hilfen der Design-Tests: Dateiliste, Token-Auflösung und Kontrast.
import {readFileSync} from 'node:fs';

// Dateien, in denen keine festen Farben stehen dürfen und deren Farbpaare geprüft werden.
// Jede Migrations-Aufgabe ergänzt ihre Dateien.
export const MIGRATED = ['style.css', 'enterprise.css', 'brand.css', 'communication.css', 'business.css', 'accounting.css'];

export const read = name => readFileSync(new URL('../../public/' + name, import.meta.url), 'utf8');

function pairs(source) {
  const out = {};
  for (const m of source.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)/g)) out[m[1]] = m[2].trim();
  return out;
}

export function tokenMap(mode) {
  const tokens = read('tokens.css'), cut = tokens.indexOf('@media (prefers-color-scheme: light)');
  const dark = pairs(tokens.slice(0, cut)), light = {...dark, ...pairs(tokens.slice(cut))};
  const surface = read('surface.css'), aliasPart = surface.slice(surface.indexOf(':root{'), surface.indexOf('}', surface.indexOf(':root{')));
  return {...(mode === 'light' ? light : dark), ...Object.fromEntries(Object.entries(pairs(aliasPart)).filter(([, v]) => v.startsWith('var(')))};
}

// Löst var(--name) über Aliase bis zu einem Hex-Wert auf; null, wenn nicht eindeutig (rgba, color-mix ...).
export function resolve(name, map, depth = 0) {
  const value = map[name];
  if (!value || depth > 6) return null;
  const v = /^var\(--([a-z0-9-]+)\)$/.exec(value);
  if (v) return resolve(v[1], map, depth + 1);
  return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
