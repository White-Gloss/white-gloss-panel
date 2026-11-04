# Optik „Obsidian & Platin“

Stand: 04.11.2026. Gilt für alle Oberflächen: Vor-Ort-App, Panel, Monatsbuchhaltung, Kundenportal,
Kundenchat, Steuerberaterzugang und die Anmeldeseiten. Spec:
`docs/superpowers/specs/2026-11-04-obsidian-platin-alle-oberflaechen-design.md`.

## Aufbau

- `public/tokens.css` (zuerst geladen): alle Farben, Radien und Schatten als Variablen. Dunkel ist
  Standard, Hell folgt `prefers-color-scheme`. Dort werden neue Farben eingetragen, nirgends sonst.
- `public/surface.css` (zuletzt geladen): leitet die alten Variablen (`--ink`, `--blue`, `--wg-*` …) auf
  die Tokens um und enthält Komponentenregeln, Druckansicht und Bewegungsreduktion.
- `<html data-area="field|operator|customer|advisor">` wählt Bereichsregeln in `surface.css`.
- `public/motion.js`: Federn, Momentum-Projektion, Gummiband und Sheet-Geste (Dialoge auf dem Handy
  lassen sich am Kopf nach unten wegwischen; ohne Bewegungsreduktion, Schließen-Knopf bleibt).

## Regeln für neue Farben

- Keine festen Farbwerte (`#…`, `rgb()`) in den Stylesheets. `npm test` prüft das (`tests/design-colors`).
- Text und Hintergrund in einer Regel müssen in beiden Modi mindestens 3 : 1 erreichen
  (`tests/design-pairs`). Kontraste der Token-Werte: mindestens 4,5 : 1 (`tests/design-tokens`).
- Ausnahmen mit `/* keep: Grund */` in derselben Zeile, zum Beispiel die Lightbox oder das schwarze Video.
- Werkzeug für Altbestand: `node scripts/tokenize-colors.mjs public/datei.css`.

## Prüfung

- Lokal ohne Website-Server: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Browser (nur GitHub-Runner): `browser-tests/design.test.mjs` prüft jede Seite in Dunkel und Hell,
  Handy- und Desktop-Breite, mit Screenshots in `test-results/`.
- Service Worker der Vor-Ort-App: Cache `wg-vor-ort-v5`; neue Programmdateien müssen in `SHELL`
  (`public/sw.js`) stehen, sonst scheitert die Installation.
