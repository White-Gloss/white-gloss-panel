# Obsidian & Platin für alle Oberflächen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle sechs Seiten und die serverseitigen Anmeldeseiten erhalten die Optik „Obsidian & Platin“ (Dunkel Standard, Hell automatisch), die Vor-Ort-App zuerst und mit Gesten-/Bewegungsverhalten nach dem Skill `apple-design`.

**Architecture:** `public/tokens.css` (neu, zuerst geladen) definiert nur die neuen Tokens. `public/surface.css` (neu, zuletzt geladen) leitet alle alten Variablen auf die Tokens um und enthält die gemeinsamen Komponentenregeln sowie bereichsabhängige Regeln über `html[data-area]`. Feste Farben in den bestehenden CSS-Dateien werden per Skript auf Tokens umgestellt; ein Test hält den Stand fest. `public/motion.js` (neu) liefert reine Bewegungsfunktionen und ein Bottom-Sheet-Verhalten.

**Tech Stack:** Vanilla CSS/JS (Module), Node 22 `node:test`, jsdom, esbuild-Build (`scripts/build.mjs` kopiert alles aus `public/`), Playwright nur auf dem GitHub-Runner.

**Spec:** `docs/superpowers/specs/2026-11-04-obsidian-platin-alle-oberflaechen-design.md`

## Global Constraints

- Kein Website-Server auf dem Rechner des Betreibers (kein Dev-, Preview-, Docker- oder Tunnel-Server). `npm run test:browser` läuft nur auf dem GitHub-Runner (`AGENTS.md`).
- Prüfbefehle: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `node --check dist/server/index.js`.
- **Nicht mergen und nicht veröffentlichen** ohne ausdrückliche Freigabe des Betreibers. Ein Merge auf `main` löst `Hostinger panel release` aus. Arbeit auf Branch `claude/charming-volta-sh008z`, Pull-Request #48.
- Keine Änderung an Geschäftslogik, Preisen, Texten, Rechtsabläufen, API oder Datenbank.
- Kein neues Framework, keine neue Schriftdatei; Barlow (`/barlow-latin*.woff2`) bleibt.
- Dunkel ist Standard; Hell über `@media (prefers-color-scheme: light)`. Alle Text-/Hintergrundpaare mindestens 4,5 : 1 (WCAG AA).
- Token-Werte (dunkel / hell): `--bg` `#0b0d10` / `#f5f3ee`; `--surface` `#12161b` / `#ffffff`; `--elevated` `#1a2027` / `#ece9e2`; `--fg` `#eef0f3` / `#14181d`; `--muted` `#9aa4b0` / `#5b6470`; `--accent` `#d9dee5` / `#1b2530`; `--gold` `#c9a96b` / `#7a5f26`; `--good` `#6fc3a0` / `#2f6b53`; `--warn` `#e0b45c` / `#7d5a12`; `--danger` `#ef8a84` / `#a63d38`; `--line` Platin 14 % / Graphit 12 % Deckkraft. Ergänzungen dieses Plans (nicht in der Spec-Tabelle): `--on-accent` `#0b0d10` / `#f5f3ee`, Radien `--radius-s` 10 px, `--radius-m` 14 px, `--radius-l` 20 px.
- Schaltflächen und Eingaben mindestens 48 px hoch; Eingabeschrift mindestens 16 px (iOS-Zoom); `env(safe-area-inset-*)` an Kopf, Fuß, Seiten.
- Bewegung nur über `transform` und `opacity`; `prefers-reduced-motion: reduce` → kurze Überblendung; `prefers-reduced-transparency: reduce` → geschlossene Flächen; `prefers-contrast: more` → klare Ränder.
- Nach jedem Task: `git add` der geänderten Dateien, Commit mit Endzeilen `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_01V6rGc76uXa4mg569jbgqHf`; Push erst nach Task 11.

## Review Focus

- **Dunkel-Reste:** Eine weiß codierte Karte/Eingabe mit heller Schrift (oder umgekehrt) macht Text unlesbar. Erwartet: keine festen Farben mehr in migrierten Dateien (Task 4, 6–9).
- **Druck und PDF-Ansichten:** Angebot, Rechnung und Dokumentseiten werden gedruckt/als PDF gespeichert. Erwartet: Druck immer hell auf Weiß (Task 2).
- **Service Worker:** Fehlt eine neue Datei in `SHELL`, schlägt die Installation fehl („Programmdatei fehlt“) und die Vor-Ort-App startet offline nicht mehr. Erwartet: alle neuen Dateien in `SHELL`, Cache `wg-vor-ort-v5` (Task 5).
- **iOS-Zoom und Sicherheitsabstände:** Eingabe unter 16 px zoomt auf iPhone; fehlende Safe-Area verdeckt die untere Leiste. Erwartet: Regeln vorhanden (Task 5).
- **Unterschrift im PDF:** Die gespeicherte PNG-Unterschrift muss weißer Grund + dunkler Strich bleiben, sonst wird das Protokoll-PDF unlesbar. Erwartet: `signature.js` füllt weiß, Strich bleibt dunkel (Task 5).

---

### Task 1: Tokens und Kontrasttest

**Files:**
- Create: `public/tokens.css`
- Test: `tests/design-tokens.test.mjs`

**Interfaces:**
- Produces: CSS-Variablen auf `:root` (siehe Global Constraints) plus `--shadow-1`, `--shadow-2`, `--glass`, `--scrim`, `--good-bg`, `--warn-bg`, `--danger-bg`, `color-scheme: dark light`. Test-Hilfen `parseTokens(css, mode)` und `contrast(hexA, hexB)` liegen im Testfile.

- [ ] **Step 1: Failing test schreiben.** `design-tokens.test.mjs` liest `public/tokens.css`. Tests: (a) `all required tokens exist in dark and light` (Liste aus Global Constraints inkl. `--on-accent`); (b) `dark text pairs reach 4.5:1` für `--fg`/`--muted`/`--accent`/`--gold`/`--good`/`--warn`/`--danger` auf `--bg`, `--surface`, `--elevated` und `--on-accent` auf `--accent`; (c) dasselbe für Hell; (d) `light mode is a prefers-color-scheme media block`; (e) `contains reduced-transparency and contrast blocks`. Kontrastformel: WCAG relative Luminanz.
- [ ] **Step 2: Test laufen lassen.** `node --test tests/design-tokens.test.mjs` → FAIL (Datei fehlt).
- [ ] **Step 3: `public/tokens.css` anlegen.** `:root` dunkel; `@media (prefers-color-scheme: light){:root{…}}` hell; `@media (prefers-reduced-transparency: reduce){:root{--glass:var(--surface)}}`; `@media (prefers-contrast: more){:root{--line:…klar…}}`. Status-Hintergründe mit Rückfall-Zeile vor `color-mix(in srgb, …)`.
- [ ] **Step 4: Test laufen lassen.** Erwartet: alle PASS. Schlägt ein Paar unter 4,5 fehl, Wert minimal anpassen und die Abweichung im Commit nennen.
- [ ] **Step 5: Commit** `Tokens für Obsidian & Platin mit Kontrasttest`.

### Task 2: surface.css mit Alias-Schicht und Grundkomponenten

**Files:**
- Create: `public/surface.css`
- Test: `tests/design-surface.test.mjs`

**Interfaces:**
- Consumes: Tokens aus Task 1.
- Produces: Auf `:root` (später als alle Altdateien geladen) die Zuordnung alter Variablen → Tokens: `--ink,--wg-ink,--wg-fg`→`--fg`; `--muted,--wg-muted,--wg-subtle,--wg-copy`→`--muted`; `--line,--wg-line,--wg-rule`→`--line`; `--wg-rule-strong`→`--line` stärker; `--blue,--wg-accent,--steel,--lacquer,--cc-accent`→`--accent`; `--pale,--wg-chrome-soft,--wg-elevated`→`--elevated`; `--wg-paper,--wg-surface`→`--surface`; `--wg-bg,--wg-canvas,--wg-chrome`→`--bg`; `--good,--wg-success`→`--good`; `--warn`→`--warn`; `--red,--wg-error`→`--danger`; `--wg-success-bg,--wg-warning-bg`→`--good-bg`,`--warn-bg`. Außerdem `:root{background:var(--bg);color:var(--fg)}`, Grundregeln für `button, a.button, input, select, textarea, .card, dialog`, `@media print{:root{…helle Werte…}}`, Reduktions-Blöcke.

- [ ] **Step 1: Failing test.** `maps every legacy variable family to a token` (liest `surface.css`, prüft jede Zuordnung oben), `print block forces light values`, `reduced-motion block removes transforms`, `inputs are at least 16px and controls 48px`.
- [ ] **Step 2: Laufen lassen** → FAIL.
- [ ] **Step 3: `surface.css` schreiben.** Alias-Schicht zuerst, dann Komponenten nach Spec („Komponenten“): Radien aus Tokens, Glasleiste per `backdrop-filter` mit `@supports not (backdrop-filter:blur(1px))`-Rückfall auf `--surface`, Fokusring in `--accent`, `font-variant-numeric: tabular-nums` für `.money, .vo-total, td.num`. Typografie: Überschriften `letter-spacing:-.02em; line-height:1.1`, Fließtext Zeilenhöhe 1.5, Größen in `rem`.
- [ ] **Step 4: Laufen lassen** → PASS.
- [ ] **Step 5: Commit** `surface.css: Alias-Schicht und Grundkomponenten`.

### Task 3: Seiten und Anmeldeseiten verdrahten

**Files:**
- Modify: `public/index.html`, `public/vor-ort.html`, `public/bookkeeping.html`, `public/kunde.html`, `public/chat.html`, `public/advisor.html`, `server/auth.mjs:96`, `server/password-auth.mjs:80`
- Test: `tests/design-wiring.test.mjs`

**Interfaces:**
- Consumes: `tokens.css`, `surface.css`.
- Produces: `<html lang="de" data-area="field|operator|customer|advisor">`; `tokens.css` als erstes, `surface.css` als letztes `<link rel="stylesheet">`; zwei `<meta name="theme-color">` mit `media="(prefers-color-scheme: dark)"` (`#0b0d10`) und `light` (`#f5f3ee`) wo bisher eins steht.

- [ ] **Step 1: Failing test.** Pro Seite: erstes Stylesheet ist `/tokens.css`, letztes `/surface.css`, `data-area` gleich Tabelle (`vor-ort`→field, `index`+`bookkeeping`→operator, `kunde`+`chat`→customer, `advisor`→advisor). Für `loginPage()` aus `server/auth.mjs` und die Seite in `server/password-auth.mjs`: Antworttext enthält beide Links in dieser Reihenfolge.
- [ ] **Step 2: Laufen lassen** → FAIL.
- [ ] **Step 3: Seiten ändern.** Attribut und Links setzen; in den Serverseiten nur die Link-Zeile und das Attribut ändern, keine Logik.
- [ ] **Step 4: Laufen lassen** → PASS. Danach `npm test` komplett: bestehende Tests, die Seitenköpfe prüfen (`tests/ui.test.mjs` u. a.), müssen grün bleiben; sonst Erwartung dort anpassen.
- [ ] **Step 5: Commit** `Alle Seiten laden tokens.css und surface.css`.

### Task 4: Farbmigration-Werkzeug und style.css

**Files:**
- Create: `scripts/tokenize-colors.mjs`, `scripts/color-map.json`
- Modify: `public/style.css`
- Test: `tests/design-colors.test.mjs`

**Interfaces:**
- Produces: `node scripts/tokenize-colors.mjs <datei.css>` → ersetzt feste Farben (`#rgb[a]`, `#rrggbb[aa]`, `rgb()`, `rgba()`, `hsl()`) durch `var(--token)`, schreibt die Datei, listet nicht zuordenbare Farben mit Zeilennummer, Exit-Code 1 solange welche übrig sind. Zeilen mit Kommentar `/* keep: Grund */` bleiben unberührt. `scripts/color-map.json`: `{ "#hex": "--token" }` für eindeutige Fälle. Regeln für nicht eingetragene Farben nach CSS-Eigenschaft und Helligkeit L: `color`: L>0.8→`--on-accent`, L<0.35→`--fg`, sonst `--muted`; `background*`: L>0.97→`--surface`, L>0.88→`--bg`, 0.5<L≤0.88→`--elevated`, sonst `--elevated`; `border*`/`outline*`/`box-shadow` mit Farbe→`--line`; kräftig gesättigte Farbtöne (Sättigung>0.15) werden **nicht** automatisch ersetzt, sondern gemeldet und manuell dem Status-/Akzentton zugeordnet.
- Test `design-colors.test.mjs` exportiert `MIGRATED=['style.css',…]` (wächst pro Task) und prüft: keine Treffer von `/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i` außerhalb von `/* keep: … */`-Zeilen.

- [ ] **Step 1: Failing test.** `style.css has no raw colors` (MIGRATED enthält zunächst nur `style.css`); `tokenize-colors maps #ffffff on background to --surface` und `reports saturated colors without replacing them` (zwei Mini-CSS-Strings über exportierte Funktion `tokenize(css) → {css, unmapped:[{line,value}]}`).
- [ ] **Step 2: Laufen lassen** → FAIL.
- [ ] **Step 3: Skript implementieren** (Funktion `tokenize` exportieren, CLI-Teil darunter). Eine Zeile Ansatz: Deklarationen mit Regex auf `property:value;` zerlegen, Farbe je Eigenschaft nach Regel oben ersetzen.
- [ ] **Step 4: `node scripts/tokenize-colors.mjs public/style.css` ausführen.** Gemeldete gesättigte Farben (Blau/Grün/Gelb/Rot) von Hand auf `--accent`/`--good`/`--warn`/`--danger` bzw. `--*-bg` setzen oder in `color-map.json` aufnehmen und erneut ausführen, bis Exit-Code 0.
- [ ] **Step 5: Tests laufen lassen** (`npm test`) → PASS. Visuelle Prüfung der Karten/Listen später auf dem Runner (Task 11).
- [ ] **Step 6: Commit** `Farbmigration: Werkzeug und style.css`.

### Task 5: Vor-Ort-App (Priorität)

**Files:**
- Modify: `public/surface.css` (Bereich `html[data-area="field"]`), `public/style.css` (nur Vor-Ort-Regeln `.vo*`, Zeilen 38–54 und 138–160 zusammenführen, Duplikate entfernen), `public/signature.js`, `public/sw.js`, `public/vor-ort.js`
- Test: `tests/design-field.test.mjs`, `tests/device-pwa.test.mjs` (SHELL-Erwartung erweitern)

**Interfaces:**
- Consumes: Tokens, `motion.js` (Task 10 liefert; hier nur CSS und Struktur).
- Produces: `SHELL` enthält `/tokens.css`, `/surface.css`, `/motion.js`; `CACHE='wg-vor-ort-v5'`.

- [ ] **Step 1: Failing tests.** `design-field.test.mjs`: (a) `vo dock respects bottom safe area` (CSS enthält `env(safe-area-inset-bottom)` bei `.vo-dock` und `.vo-bar`); (b) `field inputs use 16px` ; (c) `buttons keep min-height 48px`; (d) `signature background stays white and stroke dark` (liest `signature.js`, erwartet `fillStyle='#fff'`-Zeile und Strichfarbe mit Luminanz < 0.2); (e) `photo grid thumbs are at least 96px`. In `device-pwa.test.mjs` die Pfadliste um `/tokens.css`,`/surface.css`,`/motion.js` erweitern und `CACHE='wg-vor-ort-v5'` prüfen.
- [ ] **Step 2: Laufen lassen** → FAIL.
- [ ] **Step 3: Umsetzen.** Untere Leiste (`.vo-dock`) mit Glas, aktive Position `--accent` + 2-px-Linie `--gold`; Buchungsschritte (`.vo-booking-steps`) als durchgehendes Band; Foto-Raster mit großen Berührungsflächen und Zähler „x/20“ (Anzeige, Grenze 20 unverändert); Unterschriftsfeld größer (`min-height:180px`), Rahmen in `--line`, Zeichnung bleibt wie im Test; Erfolgs-Toast mit sanftem Einblenden (nur `transform`/`opacity`); Rückmeldung beim Drücken per `:active`. `style.css`: doppelte `.vo*`-Regeln zusammenführen.
- [ ] **Step 4: Service Worker** `SHELL` und Cache-Name anpassen.
- [ ] **Step 5: Laufen lassen** (`npm test`) → PASS, `npm run lint`, `npm run typecheck` → ok.
- [ ] **Step 6: Commit** `Vor-Ort-App: Obsidian & Platin, Foto- und Unterschriftsfluss`.

### Task 6: Panel (index.html): enterprise.css, brand.css, communication.css, business.css, accounting.css

**Files:**
- Modify: `public/enterprise.css`, `public/brand.css`, `public/communication.css`, `public/business.css`, `public/accounting.css`, `public/surface.css` (Bereich `operator`)
- Test: `tests/design-colors.test.mjs` (MIGRATED erweitern)

**Interfaces:**
- Consumes: `tokenize-colors.mjs`.

- [ ] **Step 1: Failing test.** `MIGRATED` um die fünf Dateien erweitern → FAIL.
- [ ] **Step 2: Je Datei Skript ausführen**, gemeldete Farben manuell zuordnen. `brand.css`: die alten `--wg-*`-Definitionen bleiben als Alias nur, wenn `surface.css` sie nicht schon abdeckt; sonst entfernen.
- [ ] **Step 3: Panel-Feinschliff** in `surface.css` unter `html[data-area="operator"]`: Seitenleiste als `--bg`, Kopfleiste Glas, mobile Leiste (`.mobile-dock`) wie Vor-Ort-Leiste, Auftragslisten und Handlungszentrale mit Radius `--radius-m`.
- [ ] **Step 4: `npm test`, `npm run lint`** → PASS.
- [ ] **Step 5: Commit** `Panel: Farbmigration und Bereichsregeln`.

### Task 7: Monatsbuchhaltung

**Files:**
- Modify: `public/bookkeeping.css`, `public/surface.css` (Bereich `operator`, `.books-*`)
- Test: `tests/design-colors.test.mjs`

- [ ] **Step 1:** `MIGRATED` um `bookkeeping.css` ergänzen → FAIL.
- [ ] **Step 2:** Skript ausführen, Reste von Hand; Tabellen (`td.num`) tabellarische Ziffern, Zahlen rechtsbündig.
- [ ] **Step 3:** `npm test` → PASS. **Step 4: Commit** `Monatsbuchhaltung in Obsidian & Platin`.

### Task 8: Kundenportal und Kundenchat

**Files:**
- Modify: `public/kunde.css`, `public/chat.css`, `public/surface.css` (Bereich `customer`), `public/kunde.js` und `public/kunde-chat.js` nur falls feste Farben in Inline-Stilen vorkommen
- Test: `tests/design-colors.test.mjs`

- [ ] **Step 1:** `MIGRATED` um `kunde.css`, `chat.css` ergänzen → FAIL.
- [ ] **Step 2:** Skript ausführen, Reste von Hand. Kundenseiten bleiben freundlich lesbar: gleiche Tokens, aber Bereichsregel `customer` nutzt `--surface`-Karten mit größerem Zeilenabstand.
- [ ] **Step 3:** Inline-Farben in `kunde.html`/`chat.html`-Stilen und den zugehörigen JS-Dateien per `grep -nE "#[0-9a-f]{3,6}|rgb"` finden und auf `var(--…)` umstellen.
- [ ] **Step 4:** `npm test` → PASS (insb. `tests/chat-ui.test.mjs`, `tests/business-portal.test.mjs`). **Step 5: Commit** `Kundenportal und Kundenchat in Obsidian & Platin`.

### Task 9: Steuerberaterzugang

**Files:**
- Modify: `public/advisor.css`, `public/surface.css` (Bereich `advisor`)
- Test: `tests/design-colors.test.mjs`, `tests/advisor-ui.test.mjs`

- [ ] **Step 1:** `MIGRATED` um `advisor.css` ergänzen → FAIL.
- [ ] **Step 2:** Skript ausführen; Tabellen und Prüflisten mit Tokens.
- [ ] **Step 3:** `npm test` → PASS. **Step 4: Commit** `Steuerberaterzugang in Obsidian & Platin`.

### Task 10: Bewegung und Gesten (`motion.js`)

**Files:**
- Create: `public/motion.js`
- Modify: `public/vor-ort.js` (Funktion `modal()` nutzt `attachSheet`), `public/app.js` (Panel-Dialog, gleiche Nutzung), `public/surface.css`
- Test: `tests/motion.test.mjs`

**Interfaces:**
- Produces:
  - `project(velocity: number, decelerationRate = 0.998): number` → `(velocity/1000)*rate/(1-rate)`.
  - `rubberband(overshoot: number, dimension: number, constant = 0.55): number` → `(o*d*c)/(d+c*|o|)`.
  - `nearestSnap(position: number, snaps: number[]): number`.
  - `springStep(state:{value:number,velocity:number}, target:number, dt:number, opts:{damping:number,response:number}): {value:number,velocity:number}`.
  - `attachSheet(dialog: HTMLElement, opts:{onClose:()=>void, reduceMotion?:boolean}): () => void` (Rückgabe: Abmelden). Verfolgt den Finger 1:1 per Pointer Events mit `setPointerCapture`, ermittelt Loslass-Geschwindigkeit aus den letzten Punkten, wählt Ziel (offen/zu) per `nearestSnap(position + project(velocity), [0, höhe])`, animiert per `requestAnimationFrame` mit `springStep` (Standard `damping:1`, nach Wisch `0.8`, `response:0.35`), unterbrechbar. Bei `reduceMotion` nur Überblendung. Schaltflächen-Schließen bleibt.

- [ ] **Step 1: Failing tests.** `project(1000)` ≈ 499; `project(0) === 0`; `rubberband(0,500)===0` und `rubberband(100,500)<100` und wächst monoton; `nearestSnap(60,[0,100])===100`; `springStep` konvergiert: nach 2 s mit `damping:1,response:0.35` Abstand zum Ziel < 0.5 und nie über das Ziel hinaus; mit `damping:0.8` überschwingt mindestens einmal. `attachSheet` in jsdom: simulierter Zug (Ereignisse als `Event` mit `clientY`, `pointerId`) von 0 auf 300 mit hoher Geschwindigkeit ruft `onClose` auf; kleiner Zug ohne Geschwindigkeit nicht; mit `reduceMotion` setzt kein `transform`.
- [ ] **Step 2: Laufen lassen** → FAIL.
- [ ] **Step 3: Implementieren** wie in Interfaces; keine Bibliothek.
- [ ] **Step 4: Einbinden** in `vor-ort.js` (`modal`) und `app.js` (Dialog-Öffnung); Mobil (≤ 720 px) als unteres Sheet, Desktop zentriert ohne Zug.
- [ ] **Step 5: Laufen lassen** (`npm test`, `npm run lint`, `npm run typecheck`) → PASS.
- [ ] **Step 6: Commit** `Bewegung: Federn, Momentum-Projektion und Sheet-Geste`.

### Task 11: Gesamtprüfung, Browsertests, Dokumentation, Push

**Files:**
- Modify: `browser-tests/*.test.mjs` (je eine Hell/Dunkel-Prüfung), `docs/Vor-Ort-App-und-Bearbeitung.md`, `README.md` (Verweis), `docs/Roadmap.md` (neue Zeile „Obsidian & Platin“, Stand „in Prüfung“)

- [ ] **Step 1:** In `browser-tests/` für Panel, Kundenportal und Advisor je einen Test ergänzen: Seite mit `colorScheme:'dark'` und `'light'` öffnen und prüfen, dass `getComputedStyle(body).backgroundColor` zum Token passt und der Seitentext nicht denselben Farbwert wie der Hintergrund hat. Lokal **nicht** ausführen (Runner-Regel); Syntax mit `node --check` prüfen.
- [ ] **Step 2:** Dokumentation aktualisieren (Optik, Tokens, Ablauf zum Hinzufügen neuer Farben nur über Tokens).
- [ ] **Step 3: Vollprüfung:** `npm run lint && npm run typecheck && npm test && npm run build && node --check dist/server/index.js` → alle ohne Fehler.
- [ ] **Step 4: Commit und Push** `git push -u origin claude/charming-volta-sh008z`. PR #48 existiert; ihre Beschreibung auf „Spec + Umsetzung“ aktualisieren (`update_pull_request`). **Nicht mergen.**
- [ ] **Step 5:** CI auf PR #48 abwarten; Fehler zuerst reproduzieren und beheben. Dem Betreiber getrennt berichten: implementiert, getestet (lokal / Runner), **nicht** veröffentlicht, **nicht** live geprüft.

## Self-Review (Stand beim Schreiben)

- **Spec-Abdeckung:** Farben/Kontrast (1), Alias-Schicht/Komponenten/Typografie/Druck (2), Seiten/Bereichsattribut/theme-color (3), Migration (4, 6–9), Vor-Ort/Foto/Unterschrift/Leiste/Service Worker (5), Bewegung/Gesten (10), Tests/Doku/Veröffentlichungsregel (11).
- **Abweichung von der Spec:** Die Spec nennt `tokens.css` „mit allen Regeln“; der Plan legt die Alias-Schicht in `surface.css`, weil sie nach den Altdateien laden muss, um deren `:root`-Werte zu überschreiben.
- **Typkonsistenz:** `tokenize`, `MIGRATED`, `attachSheet`, `project`, `rubberband`, `nearestSnap`, `springStep` sind in den Tasks einheitlich benannt.
