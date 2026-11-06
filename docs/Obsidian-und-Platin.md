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

## Stand 06.11.2026: Webseiten-Farben, Tag/Nacht-Schalter, Struktur

- **Dunkel wie die Webseite:** Hintergrund `#0e1218`, Flächen `#151d27` und `#202c3a`, Text `#f4f3ed` (am Screenshot der
  Webseite gemessen). Akzent bleibt Platin, Gold sparsam. Hell (Elfenbein) ist unverändert.
- **Tag/Nacht-Schalter:** Knopf oben rechts im Panel und in der Vor-Ort-App (`data-theme-toggle`). Ohne Wahl folgt die
  Anzeige dem Gerät; die Wahl wird im Browser gemerkt (`wg-theme`). `public/theme.js` läuft im `<head>` vor den
  Stylesheets (kein Aufblitzen). Das Panel navigiert über `closest('[data-view]')`: **kein** `data-view` auf Containern
  setzen (Bildschirmname steht in `data-screen`).
- **Abmelden** steht unten im Seitenmenü. Im Postfach entfällt die obere Suche (eigene Suche im Postfach).
- **Untere Leiste (Handy):** Start, Mail, Anfragen, Laufend, Mehr. Kalender und Finanzen liegen im Menü.
- **Benachrichtigungen außerhalb der App:** Der Server sendet nur allgemeine Hinweise (Website-Anfrage, Kundennachricht,
  WhatsApp, E-Mail). Der Service Worker (`public/sw.js`) zeigt sie nur an, wenn Text und Ziel in seiner Liste stehen. Ein
  Test (`tests/device-pwa.test.mjs`) prüft, dass jede Server-Meldung dort bekannt ist. Einrichten: Einstellungen oder
  Vor-Ort-Startseite, „App & Benachrichtigungen“. Auf dem iPhone funktioniert Web-Push nur bei installierter App
  (Zum Home-Bildschirm).
