# High-End-Optik „Obsidian & Platin“ für alle Oberflächen

Stand: 04.11.2026. Status: vom Betreiber freigegeben (04.11.2026), Umfang auf alle Oberflächen erweitert.
Die Veröffentlichung ist davon nicht erfasst und braucht eine eigene ausdrückliche Freigabe.

## Ziel

Alle Oberflächen sollen sich auf Smartphone, Mac, Windows, iOS und Android wie eine hochwertige,
native App anfühlen. Die Werkstatt-Nutzung am Smartphone (Übergabe, Fotos, Unterschrift) hat Vorrang.
Grundlage sind die Regeln des Skills `apple-design` (Reaktion ohne Verzögerung, 1:1-Berührung,
unterbrechbare Federbewegung, Materialien mit Tiefe, größenabhängige Typografie, Bewegungsreduktion).

## Geltungsbereich

Betreiberentscheidung vom 04.11.2026: Die neue Optik gilt **überall**. Die Vor-Ort-App hat die höchste
Priorität und kommt zuerst.

**Enthalten (alle sechs Seiten):**

- `public/vor-ort.html` (Vor-Ort-App unter `/vor-ort`), zuerst
- `public/index.html` (Panel unter `/`)
- `public/bookkeeping.html` (Monatsbuchhaltung)
- `public/kunde.html` (Kundenportal) und `public/chat.html` (Kundenchat), beide sehen echte Kunden
- `public/advisor.html` (Steuerberaterzugang)

**Warum Vorsicht trotzdem nötig ist:** `style.css`, `brand.css`, `chat.css`, `business.css` und
`enterprise.css` werden von mehreren Bereichen gemeinsam geladen. Eine Änderung dort wirkt in allen
Bereichen. Darum wird jede dieser Dateien gegen alle sie ladenden Seiten geprüft.

## Technische Lösung

1. **`public/tokens.css`** (neu). Enthält alle Designwerte als CSS-Variablen auf `:root`. Sie wird als
   erste Stylesheet-Datei in allen sechs Seiten geladen.
2. **`public/surface.css`** (neu). Enthält die gemeinsamen Komponentenregeln der neuen Optik
   (Karten, Leisten, Schaltflächen, Felder, Plaketten, Bewegung). Sie wird als letzte Datei geladen.
3. **Seitenbereich über `<html data-area="…">`** mit den Werten `field` (Vor-Ort), `operator`
   (Panel, Buchhaltung), `customer` (Kundenportal, Kundenchat) und `advisor`. Bereichsspezifische
   Abweichungen stehen unter dem jeweiligen Attribut.
4. **Bestehende Dateien bleiben gültig.** Die alten Variablen (`--ink`, `--blue`, `--wg-*`, `--line`,
   `--muted` und weitere) zeigen auf die neuen Tokens. Feste Farbwerte werden durch Tokens ersetzt.
   Dateien, die nur ein Bereich lädt, werden direkt umgestellt; gemeinsame Dateien werden
   umgestellt und danach in jedem Bereich geprüft.
5. **Vor-Ort-Service-Worker.** `public/sw.js` erhält die neuen Dateien in `SHELL` und einen neuen
   Cache-Namen (`wg-vor-ort-v5`), damit die App auch offline vollständig startet.
6. **`theme-color`** passt sich dem Modus an (zwei `meta`-Einträge mit `media`).

## Farben

Dunkel ist der Standard, Hell folgt automatisch über `prefers-color-scheme`. Die Werte sind per
Kontrastberechnung (WCAG) geprüft; alle Textpaare erreichen mindestens 4,5 : 1.

| Token | Dunkel | Hell |
| --- | --- | --- |
| `--bg` | `#0b0d10` | `#f5f3ee` |
| `--surface` | `#12161b` | `#ffffff` |
| `--elevated` | `#1a2027` | `#ece9e2` |
| `--fg` | `#eef0f3` (17,0 : 1 auf `--bg`) | `#14181d` (16,1 : 1) |
| `--muted` | `#9aa4b0` (7,7 : 1) | `#5b6470` (5,4 : 1) |
| `--accent` (Platin) | `#d9dee5` (14,4 : 1) | `#1b2530` (14,0 : 1) |
| `--gold` (nur sparsam: aktive Markierung, feine Linien, Hervorhebung) | `#c9a96b` (8,7 : 1) | `#7a5f26` (5,4 : 1) |
| `--good` | `#6fc3a0` | `#2f6b53` |
| `--warn` | `#e0b45c` | `#7d5a12` |
| `--danger` | `#ef8a84` | `#a63d38` |
| `--line` | Platin mit 14 % Deckkraft | Graphit mit 12 % Deckkraft |

Text auf der primären Schaltfläche (Platin) nutzt `--bg` (14,4 : 1).

Zusätzlich: `prefers-contrast: more` erzeugt klar abgegrenzte Ränder, `prefers-reduced-transparency:
reduce` ersetzt Glasflächen durch geschlossene Flächen.

## Typografie

- Barlow bleibt (selbst gehostet, keine neue Schriftdatei nötig).
- Überschriften groß: negatives Tracking (ca. −0,02 em) und enge Zeilenhöhe (ca. 1,1).
- Fließtext: Tracking ca. 0, Zeilenhöhe ca. 1,5. Kleine Beschriftungen: leicht positives Tracking.
- Größen in `rem`, damit die Schrifteinstellung des Geräts die Oberfläche mitskaliert.
- Zahlen (Preise, Summen) mit tabellarischen Ziffern (`font-variant-numeric: tabular-nums`).

## Komponenten

- **Karten und Listen:** Radius 14 bis 20 px (statt 4 bis 6 px), feine Linie, ruhiger Schatten; größere
  Flächen wirken dicker (stärkerer Schatten).
- **Kopfleiste und untere Leiste:** Glasschicht mit `backdrop-filter`, Inhalt scrollt darunter; Kante
  als feiner Verlauf statt harter Linie. Nie zwei helle Glasflächen übereinander.
- **Schaltflächen:** Mindestgröße 48 px; Rückmeldung beim Drücken (nicht erst beim Loslassen).
- **Eingabefelder:** 16 px Schrift (verhindert das Zoomen auf iOS), klarer Fokusring in Platin.
- **Statusplaketten:** Gedämpfte Töne aus den Status-Tokens, nie reine Signalfarben.
- **Sicherheitsabstände:** `env(safe-area-inset-*)` an Kopf, Fuß und Seiten für iPhone und Android.

## Vor-Ort-App (Priorität A)

- **Buchungsschritte** mit durchgehendem Fortschrittsband und ruhigen Übergängen zwischen den Schritten.
- **Fotos:** Raster mit großen Berührungsflächen, Vorschau mit Zurück-Geste, klare Zähleranzeige
  (höchstens 20 Fotos, wie bisher).
- **Unterschrift:** Größeres Feld, dunklerer Strich in der Platin-Optik des Rahmens; Löschen mit
  deutlich erreichbarer Schaltfläche. Die gespeicherte PNG-Datei bleibt wie bisher (weißer Grund,
  dunkler Strich), damit das Protokoll-PDF unverändert bleibt.
- **Untere Leiste:** Aktive Position mit Platin-Markierung und feiner Goldlinie.
- **Bestätigungen:** Erfolgsmeldung (Toast) mit sanfter Federbewegung; keine neue Bestätigungsabfrage.

## Bewegung und Gesten

- Federbewegung nur über `transform` und `opacity`; die Zeitwerte folgen dem Skill (Standard ohne
  Überschwingen, leichtes Nachfedern nur nach einer Wischgeste).
- Schubladen und Sheets: Verfolgung des Fingers 1:1 mit `setPointerCapture`, Unterbrechung jederzeit
  möglich, Zielposition aus der Loslass-Geschwindigkeit.
- Keine Verzögerung der Eingabe: Rückmeldung bei `pointerdown`.
- `prefers-reduced-motion: reduce` ersetzt Bewegung durch kurze Überblendung.
- Gesten sind eine Ergänzung. Jede Funktion bleibt zusätzlich per Schaltfläche erreichbar.

## Plattformübergreifend

- Prüfung auf iOS Safari und Android Chrome (Berührung), Mac Safari und Windows Edge/Chrome
  (Zeiger und Tastatur).
- `backdrop-filter` mit Rückfall auf eine geschlossene Fläche, wo es nicht unterstützt wird.
- Tastaturbedienung und sichtbarer Fokus bleiben auf Desktop erhalten.

## Prüfung

- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Neuer Test: Alle sechs Seiten laden `tokens.css` zuerst und `surface.css` zuletzt und setzen ein
  gültiges `data-area`.
- Neuer Test: Jedes Textpaar der Token-Tabelle erreicht mindestens 4,5 : 1.
- Service-Worker-Test: `SHELL` enthält die neuen Dateien, der Cache-Name ist erhöht.
- Vorhandene Tests, die Pfade und Dateien prüfen, bleiben grün.
- Browserprüfung: `npm run test:browser` läuft nur auf dem Linux-GitHub-Runner (siehe `AGENTS.md`).
  Screenshots aller sechs Seiten werden mit synthetischen Daten dort erzeugt.
- Es wird kein Website-Server auf dem Rechner des Betreibers gestartet.

## Veröffentlichung

Dieses Vorhaben steht nicht in `docs/Roadmap.md`. Die Selbstfreigabe vom 03.11.2026 gilt deshalb nicht.
Ein Merge auf `main` veröffentlicht über den Job `Hostinger panel release`. Merge und Veröffentlichung
erfolgen nur nach ausdrücklicher Freigabe des Betreibers. Ich arbeite auf dem Branch
`claude/charming-volta-sh008z` und eröffne eine Pull-Request.

## Nicht-Ziele

- Keine Änderung der Geschäftslogik, der Preise, der Texte, der Rechtsabläufe oder der Datenbank.
- Kein neues Framework, keine neue Schriftart-Datei.
- Keine Entfernung von `premium.*`/`agency.css` (Roadmap V8, eigenes Vorhaben).

## Umsetzungsreihenfolge (innerhalb eines Branches)

1. Tokens, Bereichsattribut, Test der Begrenzung.
2. Vor-Ort-App komplett (Buchung, Fotos, Unterschrift, Leiste).
3. Panel (Übersicht, Listen, Auftragsdetail, Kommunikation).
4. Monatsbuchhaltung.
5. Kundenportal und Kundenchat.
6. Steuerberaterzugang.
7. Bewegung, Barrierefreiheit, Service Worker, Gesamtprüfung.

Jeder Schritt wird einzeln geprüft, bevor der nächste beginnt.
