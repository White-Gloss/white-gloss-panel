# Abschlussprüfung und Übergabe · 11.11.2026

Dieser Bericht beschreibt die geprüften Korrekturen und die Bedingungen für ihre
Veröffentlichung. Er bestätigt **keinen Abschluss aller strategischen Phasen**
des White-Gloss-Masterbriefings. Die endgültigen Typografie-Nachweise gehören
zum jeweiligen PR und dessen tatsächlich geprüftem Commit.

## Verifizierte Ausgangslage

| Bereich | Bestätigter Ausgangspunkt |
| --- | --- |
| Panel-Repository | [White-Gloss/white-gloss-panel](https://github.com/White-Gloss/white-gloss-panel), `main` = `9b2074e2448619ab34cde197d0ee5a8aa2ca3242` |
| Website-Repository | [White-Gloss/glanz-buchung-meister](https://github.com/White-Gloss/glanz-buchung-meister), `main` = `825ca7234817e75318b30fa66be37465383545a7` |
| Hosting | Hostinger; für Veröffentlichungen die aktuellen Repository-Workflows verwenden |
| Letzter sicher zugeordneter Website-Deploy | Commit `63eb588`, [Release-Lauf 42949783389](https://github.com/White-Gloss/glanz-buchung-meister/actions/runs/42949783389) |
| Bestätigter Panel-Release-Nachweis | [Release-Lauf 43008928439](https://github.com/White-Gloss/white-gloss-panel/actions/runs/43008928439) |

Diese Referenzen sind Ausgangsdaten dieser Prüfung. Vor einer Veröffentlichung
die aktuellen Heads, Release-Läufe und den tatsächlich laufenden Stand erneut
abgleichen. Ein grüner älterer Lauf bestätigt keinen späteren Commit.

## Konkrete Korrekturen und Nachweise

| Änderung | Beleg und Grenze |
| --- | --- |
| Fotoimport-Warteschlange und Protokollversand | [Panel #93](https://github.com/White-Gloss/white-gloss-panel/pull/93): gesperrte bzw. nicht mehr berechtigte Aufträge blockieren die begrenzte Warteschlange nicht dauerhaft. Aktuelle Freigaben werden weiterhin geprüft; unklare Anbieterresultate werden nicht erneut versendet. |
| Deutsche Bankstatus | Ebenfalls #93: „Vorgemerkt“, „Abgelehnt“, „Gebucht“, „Storniert“. |
| KI-Fotoaktion | [Panel #94](https://github.com/White-Gloss/white-gloss-panel/pull/94), abhängig von #93: Aktion nur für „Direkt im Panel“, „Website-Anfrage“ und „WhatsApp“. Chatbilder bleiben sichtbar. Bestehende Bestätigung und Serverrechte bleiben erhalten; kein zusätzlicher KI-Datenexport. |
| Firefox-Bildabbrüche | [Website #341](https://github.com/White-Gloss/glanz-buchung-meister/pull/341): bereits gestartete eigene Bildanfragen vor Menüschließen, Navigation und Kontextende abschließen. Die 15-Sekunden-Grenze und die Erfassung echter Netzwerkfehler bleiben erhalten. |
| Vollständig fehlgeschlagene Foto-Signierungen | [Website #342](https://github.com/White-Gloss/glanz-buchung-meister/pull/342), abhängig von #341: mindestens ein zulässiges Foto, aber keine verwendbare Signatur ergibt den vorhandenen HTTP-500-Fehlervertrag. Keine Fotos bleiben regulär leer; Teilerfolg bleibt erhalten. |
| Ausführbare Browser-CI | Offizielle, per Digest festgelegte Playwright-Container mit passenden Paketversionen ersetzen die belegbar ausgefallenen Ubuntu-Paketdownloads. Bestehende Tests und Fehlergrenzen bleiben erhalten. Eigene Website-Runner behalten ihren Installationsweg. |

**Bereits vollständig belegte Panel-Heads:**

- #93: `6bd3dc5cd7a381671f08efda4162d3276a676b42`,
  [CI 43039855950](https://github.com/White-Gloss/white-gloss-panel/actions/runs/43039855950):
  923/923 Code-Tests und 112/112 Browser-Tests; Lint, Typprüfung und Build erfolgreich.
- #94: `6618a0505ba873a2150d252ae67349a7b7598ea9`,
  [CI 43040559374](https://github.com/White-Gloss/white-gloss-panel/actions/runs/43040559374):
  vollständige Code- und Browserprüfung erfolgreich.

**Website-Prüfreferenzen dieses Berichts:**

- #341: `564041583a1d404f79f3751d83dcb052987890c5`,
  [CI 43042997156](https://github.com/White-Gloss/glanz-buchung-meister/actions/runs/43042997156).
- #342: `859d5c5054b270dc68f5040e4aa4e09bab9ce864`,
  [CI 43043054310](https://github.com/White-Gloss/glanz-buchung-meister/actions/runs/43043054310).

Diese Website-Referenzen sind keine Erfolgsbehauptung. Maßgeblich sind die
vollständigen Ergebnisse des finalen PR-Heads. Die gezielten Regressionen für
Bildabschluss (21) und Foto-Signierung (27) waren erfolgreich; sie ersetzen
nicht die vollständige CI. Die Draft-PRs lösten keine Veröffentlichung aus.

## Typografie und bewusst dokumentierte Entscheidungen

Die gemeinsame Gestaltung verwendet **Syne** für Überschriften, Navigation,
Buttons und hervorgehobene Zahlen sowie **Plus Jakarta Sans** für Fließtext
und Formulare. Details stehen in [Typografie-2026-11-11.md](Typografie-2026-11-11.md).

- Die Fonts werden lokal mit `font-display: swap` geladen. Fontdateien,
  Herkunft, feste Prüfsummen und OFL-Lizenzen sind dokumentiert. Der Vor-Ort-PWA-
  Cache enthält die beiden lokalen WOFF2-Dateien; Kunden- und API-Daten bleiben
  vom Shell-Cache ausgeschlossen.
- Die zusätzlich verlangten Google-Preconnect-/Stylesheet-Links sind wegen
  des Widerspruchs zur bestehenden Datenschutzaussage zurückgehalten. Diese
  Ladeentscheidung ist offen dokumentiert; externe Google-Links gelten nicht
  als umgesetzt. Die lokale Darstellung funktioniert unabhängig davon.
- Mobile Eingabefelder bleiben für iOS bei 16 px. Kleine Metatexte und
  Platzhalter verwenden auf dunklen Flächen das kontrastgerechte `#94a3b8`;
  helle Darstellung und Druck verwenden die vorhandenen semantischen Farben.
- Neue PDFs verwenden die neuen Fonts. Das bisherige Noto Sans bleibt als
  gezielter Fallback für fehlende Zeichen erhalten, damit zulässige Namen und
  Inhalte nicht verloren gehen. Zusammengehörige Zeichen einschließlich
  kombinierender Akzente bleiben in einem Graphem; Messung, Umbruch und
  Zeichnung verwenden dieselbe Fontauswahl. Das ist eine begründete Ausnahme
  von der rein optischen Entfernung früherer Fonts.
- Bereits gespeicherte PDF-Originale werden bytegleich ausgeliefert. Es gibt
  keine Bestandsmigration. Empfangene fremde E-Mails behalten ihre bisherige
  abgeschottete Darstellung und CSP.

## Umfang und getrennte Vorhaben

Die gemeinsame Auftragsgalerie erfüllt bereits die **50-MiB-Grenze** für Kunden
und Betrieb. Die **12-MiB-Grenze der Website-Anfrage** ist ein separater Vertrag;
sie wurde nicht pauschal geändert. Auch Beleg- und Nachrichtenlimits sind
eigenständige Grenzen.

Die separate [Panel-PR #92](https://github.com/White-Gloss/white-gloss-panel/pull/92)
zur Zurück-Geste bleibt eigenständig und darf nicht überschrieben werden.
WG-PRICE/Fotopreisautomatik und native Apps bleiben strategische Roadmap.
Die vorhandene KI-Fotoanalyse bestätigt keine automatische Preisberechnung.
Ein pauschaler Nachweis für jedes echte iOS-/Android-/Mac-/Windows-Gerät wird
aus Browser-CI nicht abgeleitet.

Die Website-Datenschutzerklärung in `src/routes/datenschutz.tsx` enthält
weiterhin Angaben zu IONOS und RO App. Diese Anbieter- und Empfängerangaben
müssen mit dem tatsächlichen Betrieb abgeglichen werden. Die Texte wurden
wegen der Vorgabe, bestehende Inhalte beizubehalten, nicht im Design-PR
umgeschrieben; Vertragsdaten oder nicht belegte Datenflüsse wurden nicht ergänzt.

## Verbindliche nächste Prüfung und Veröffentlichung

Die Freigabe erfolgt über **zwei Gesamt-PRs direkt gegen das jeweilige `main`**:
einen vollständigen Panel-Stand und einen vollständigen Website-Stand. Die
Typografie-Branches enthalten dafür bereits die jeweiligen Teilkorrekturen.
Die bisherigen Drafts bleiben nachvollziehbare Detailreviews; sie sind kein
Plan für sechs getrennte Merges. So löst das Panel keine mehrfachen
automatischen Teilveröffentlichungen aus.

1. Aktuelle Refs und Abhängigkeiten erneut lesen. Panel #94 baut auf #93 auf;
   Website #342 baut auf #341 auf. Diese geprüften Änderungen verlustfrei in
   den jeweiligen Gesamtstand übernehmen. Nach Änderungen an Basis oder Head
   erneut prüfen; das PR-Ziel der beiden finalen Gesamtstände ist `main`.
2. Für jeden finalen Head die vollständige echte Linux-CI auswerten. Zusätzlich
   Typografie in Chromium, Firefox und WebKit bei schmalen, mittleren und breiten
   Ansichten prüfen: geladene Fonts, Navigation, Überlauf, Eingabefelder und
   Preise. Browserstarts erfolgen ausschließlich in GitHub-CI, nicht über
   lokale Website- oder Vorschau-Server.
3. Neue synthetische PDFs unabhängig lesen und rendern. Gemischte lateinische,
   kyrillische und griechische Namen, kombinierende Akzente, lange Inhalte und
   Eurobeträge müssen erhalten bleiben. Die vorhandenen Inhalts-/Preisprüfungen
   sowie die Bytegleichheit gespeicherter Originale bleiben Prüfbedingungen.
4. Freigabe auf konkrete finale Commit-SHAs und ihre Nachweise beziehen.
   **Panel `main` veröffentlicht automatisch über den bestehenden Workflow.**
   Die Website wird manuell mit exakt geprüftem SHA und zuvor festgehaltenem
   vorherigem Release veröffentlicht. Danach Live-Releasekennung und die
   betroffenen Funktionen lesend kontrollieren.

Bis zu dieser konkreten Veröffentlichung dokumentiert dieser Arbeitsstand
**keinen Merge, kein Auto-Merge, kein Deployment und keinen Kundenversand**.
Die Prüfungen verwenden künstliche Daten und abgefangene Anbieteraufrufe.
Für spätere operative Auskünfte bleibt die verbundene White-Gloss-Panel-App
die maßgebliche Quelle; Repository-Fixtures und ältere Chats sind kein
aktueller Kunden- oder Auftragsstand.
