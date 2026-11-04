# Betreiberbereich: High-End-Optik „Obsidian & Platin“

Stand: 04.11.2026. Status: Entwurf zur Prüfung durch den Betreiber. Es wird nichts umgesetzt und nichts
veröffentlicht, bevor dieser Entwurf freigegeben ist.

## Ziel

Der Betreiberbereich soll sich auf Smartphone, Mac, Windows, iOS und Android wie eine hochwertige,
native App anfühlen. Die Werkstatt-Nutzung am Smartphone (Übergabe, Fotos, Unterschrift) hat Vorrang.
Grundlage sind die Regeln des Skills `apple-design` (Reaktion ohne Verzögerung, 1:1-Berührung,
unterbrechbare Federbewegung, Materialien mit Tiefe, größenabhängige Typografie, Bewegungsreduktion).

## Geltungsbereich

**Enthalten (Betreiberbereich):**

- `public/index.html` (Panel unter `/`)
- `public/vor-ort.html` (Vor-Ort-App unter `/vor-ort`)
- `public/bookkeeping.html` (Monatsbuchhaltung)

**Nicht enthalten, bleibt optisch unverändert:**

- `public/kunde.html` und `public/chat.html` (Kundenportal und Kundenchat; echte Kunden sehen sie)
- `public/advisor.html` (Steuerberaterzugang)

Annahme des Entwurfs: „mein Bereich“ des Betreibers bedeutet genau diese drei Seiten. Abweichungen
bitte bei der Prüfung nennen.

**Warum eine technische Begrenzung nötig ist:** `style.css`, `brand.css`, `chat.css`, `business.css`
und `enterprise.css` werden vom Betreiberbereich und vom Kundenportal gemeinsam geladen. Würden diese
Dateien global umgefärbt, änderte sich das Kundenportal mit.

## Technische Lösung

1. **`public/tokens.css`** (neu). Enthält alle Designwerte als CSS-Variablen. Alle Regeln gelten nur
   unterhalb von `html[data-area="operator"]`.
2. **`public/operator.css`** (neu). Enthält die Komponentenregeln der neuen Optik, ebenfalls nur
   unterhalb von `html[data-area="operator"]`. Es wird nach den bestehenden Dateien geladen.
3. **`<html data-area="operator">`** in `index.html`, `vor-ort.html` und `bookkeeping.html`. Das
   Kundenportal und der Steuerberaterzugang setzen das Attribut nicht und laden die neuen Dateien nicht.
4. **Bestehende Dateien bleiben gültig.** Die alten Variablen (`--ink`, `--blue`, `--wg-*`) werden im
   Betreiberbereich auf die neuen Tokens umgeleitet. Feste Farbwerte in den Dateien des Betreiberbereichs
   werden durch Tokens ersetzt, soweit sie nur dort wirken. Gemeinsam genutzte Dateien werden nicht
   verändert, sondern im Betreiberbereich überschrieben.
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
- Neuer Test: Der Betreiberbereich lädt `tokens.css` und `operator.css`; Kundenportal, Kundenchat und
  Steuerberater laden sie **nicht** und setzen `data-area` nicht.
- Neuer Test: Jedes Textpaar der Token-Tabelle erreicht mindestens 4,5 : 1.
- Service-Worker-Test: `SHELL` enthält die neuen Dateien, der Cache-Name ist erhöht.
- Vorhandene Tests, die Pfade und Dateien prüfen, bleiben grün.
- Browserprüfung: `npm run test:browser` läuft nur auf dem Linux-GitHub-Runner (siehe `AGENTS.md`).
  Screenshots der Betreiberseiten werden mit synthetischen Daten dort erzeugt.
- Es wird kein Website-Server auf dem Rechner des Betreibers gestartet.

## Veröffentlichung

Dieses Vorhaben steht nicht in `docs/Roadmap.md`. Die Selbstfreigabe vom 03.11.2026 gilt deshalb nicht.
Ein Merge auf `main` veröffentlicht über den Job `Hostinger panel release`. Merge und Veröffentlichung
erfolgen nur nach ausdrücklicher Freigabe des Betreibers. Ich arbeite auf dem Branch
`claude/charming-volta-sh008z` und eröffne eine Pull-Request.

## Nicht-Ziele

- Keine Änderung der Geschäftslogik, der Preise, der Texte, der Rechtsabläufe oder der Datenbank.
- Keine Änderung am Kundenportal, am Kundenchat und am Steuerberaterzugang.
- Kein neues Framework, keine neue Schriftart-Datei.
- Keine Entfernung von `premium.*`/`agency.css` (Roadmap V8, eigenes Vorhaben).

## Umsetzungsreihenfolge (innerhalb eines Branches)

1. Tokens, Bereichsattribut, Test der Begrenzung.
2. Vor-Ort-App komplett (Buchung, Fotos, Unterschrift, Leiste).
3. Panel (Übersicht, Listen, Auftragsdetail, Kommunikation).
4. Monatsbuchhaltung.
5. Bewegung, Barrierefreiheit, Service Worker, Gesamtprüfung.

Jeder Schritt wird einzeln geprüft, bevor der nächste beginnt.
