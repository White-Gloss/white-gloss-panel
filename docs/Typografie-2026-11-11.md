# Gemeinsame Typografie für das White-Gloss-Panel

Umsetzung des Betreiberauftrags vom 09.11.2026, am 11.11.2026 bestätigt.
Dieser Stand ist eine lokale, noch nicht veröffentlichte Vorbereitung.

## Inventar und Zuordnung

Die sechs Seiten `/`, `/vor-ort`, `/kunde`, `/chat`, `/buchhaltung` und `/kanzlei`
sowie Betreiberanmeldung, Passwort, Kundenkonto und MCP-OAuth nutzen dieselben
lokalen Fontdateien. Die verbindliche Typografie steht am Ende von `surface.css`;
die vorhandene Reihenfolge der Stylesheets bleibt erhalten.

| Rolle | Schrift | Größe Desktop / unter 768 px | Gewicht |
| --- | --- | --- | --- |
| H1 / Seitentitel | Syne | 46 / 33 px | 800 |
| H2 | Syne | 32 / 25 px | 700 |
| H3 | Syne | 21 / 19 px | 700 |
| H4–H6 / Abschnittstitel ohne Heading-Element | Syne | 19 px | 700 |
| Hervorgehobene Preise / Kennzahlen | Syne | 28 / 24 px | 800 |
| Navigation | Syne, Versalien | 16 px | 700 |
| Buttons / Menüauswahl | Syne | 15 px | 700 |
| Feldlabels | Syne, Versalien, 1,5 px Laufweite | 12 px | 700 |
| Statusbadges | Syne, Versalien, 1 px Laufweite | 11 px | 700 |
| Hero / Einleitung | Plus Jakarta Sans | 18 / 16 px | 400 |
| Fließtext / Details / Listen | Plus Jakarta Sans | 16 / 15 px | 400 |
| Meta / Hinweise | Plus Jakarta Sans | 13,5 px | 400 |
| Formularfelder | Plus Jakarta Sans | 15 / 16 px | 500 |
| Tabellen | Plus Jakarta Sans, Zahlen in Syne | 14 px | 400–500; Zahlen 800 |
| Rechtstexte / Footer | Plus Jakarta Sans | 12 px | 400 |

H1 hat Zeilenhöhe 1,15 und −0,5 px Laufweite, H2 Zeilenhöhe 1,25.
Fließtext verwendet 1,625, Einleitungen 1,55, Rechtstext 1,45.
Die sichtbare Startseitenüberschrift `#action-center-title` ist ein Seitentitel.
Sie erhält die H1-Darstellung, auch wenn die bestehende Dokumentstruktur sie als
H2 unter einer visuell verborgenen H1 führt.

Zahlen werden über vorhandene fachliche Klassen wie `.money`, `.stat .value`,
`.portal-price` und `[data-price-total]` angesprochen. Es gibt keine Suche oder
Ersetzung von Ziffern in Kundentexten. Kompakte Tabellenbeträge bleiben lesbar in
der Tabellenzeile; nur hervorgehobene Preise und Kennzahlen erhalten 28/24 px.

## Bewusste Kompatibilitätsentscheidungen

- Mobile Formularfelder bleiben 16 px, damit iOS beim Fokus nicht automatisch
  hineinzoomt. Diese minimale Abweichung vom 15-px-Formularmaß ist abgestimmt.
- Footer und Platzhalter verwenden auf dunklen Flächen `#94a3b8`. Das zunächst
  genannte `#64748b` erreicht bei kleiner Schrift nicht genügend Kontrast.
  Helle Flächen und Druck verwenden vorhandene dunkle semantische Farben.
- Checkbox-/Radio-Erklärungen sind Fließtext; die eigentlichen Feldlabels sind
  die kleinen Syne-Versalien. Inhaltswerte in Feldern bleiben normal geschrieben.
- Die fünf mobilen Navigationsziele bleiben erhalten. Breite Syne-Beschriftungen
  werden deutsch getrennt. Icongrößen und vorhandene Touchflächen bleiben. Die
  Leiste erhält 96 px Mindesthöhe, unter 361 px Breite 112 px, damit die
  Beschriftungen Platz haben und der Inhalt weiterhin oberhalb der Leiste endet.
- Die neue Vor-Ort-Shell `wg-vor-ort-v6` speichert beide vollständigen variablen
  WOFF2-Fonts. Kundendaten, API-Antworten und Anmeldeseiten werden weiterhin nicht
  im Service Worker gespeichert.
- Ausgehende eigene HTML-Mails enthalten die neuen Schriftfamilien und verweisen
  für Webfonts ausschließlich auf den konfigurierten HTTPS-Panel-Ursprung.
  Mailclients, die Webfonts unterdrücken, verwenden den generischen Sans-Fallback.
- Empfangene fremde E-Mails behalten ihre abgeschottete Darstellung samt CSP.
  Deren Inhalt oder historische Schriftangaben werden nicht umgeschrieben.
- Neue PDFs betten statische Fontinstanzen ein. Bestehende gespeicherte,
  unterschriebene PDF-Dateien werden bytegleich ausgeliefert; keine Migration
  oder erneute Erzeugung alter Originale findet statt. PDF-Abstände bleiben.
- Die bisherige Unicode-Abdeckung bleibt erhalten: Fehlt einem neuen Hauptfont
  ein tatsächlich benötigtes Graphem, wird ausschließlich dieser zusammenhängende
  Textteil mit dem bisherigen Noto Sans ausgegeben. Kyrillische und griechische
  Namen sowie kombinierende Akzente bleiben erhalten. Breitenmessung und Ausgabe
  verwenden dieselbe Fontauswahl. Zeichen, die bereits dem bisherigen Font fehlten,
  behalten das vorherige Verhalten; es gibt keine neue Fehlersperre oder Änderung
  der gespeicherten Namen. Dieser technische PDF-Fallback ist die begründete
  Ausnahme vom vollständigen Entfernen alter Hauptschriften.

## Quelle und Lizenzen

Gemeinsam mit der Website verwendete Quelle:
`google/fonts` Commit `c30b221beb0c1da59d563feb91ec8656a1fa972a`.

- Syne Version 2.200, Gewichtsbereich 400–800.
- Plus Jakarta Sans Version 2.071, Gewichtsbereich 400–800.
- Vollständige variable WOFF2-Dateien: zusammen 121.188 Bytes.
- PDF-Instanzen: Jakarta 400, Syne 700 und 800; mit korrekten PostScript-Namen.
- Unicode-Fallback: bisheriger Noto Sans 2.008, 2.840 Codepoints, unverändert aus
  `White-Gloss/white-gloss-panel@9b2074e2448619ab34cde197d0ee5a8aa2ca3242`.
- `assets/fonts/source-manifest.json` enthält Originalquellen, Ableitung und
  SHA-256-Prüfsummen. Die beiden OFL-Lizenzen werden im Client und PDF-Paket
  mitgeliefert. Der PDF-Fallback hat seine zusätzliche ursprüngliche OFL-Lizenz.
  Der PDF-Build prüft alle vier Fontdateien auf ihre festen Hashes.
- Frühere Barlow-, Inter- und Georgia-Einbindungen und deren Fontdateien sind
  aus den eigenen laufenden Oberflächen entfernt; Noto ist kein Hauptfont mehr. Ältere
  Planungsdokumente beschreiben historische Stände und ändern diese Zuordnung nicht.

## Offene Ladeentscheidung und Prüfung

Der heutige Auftrag nennt zusätzlich Google-Fonts-Preconnect und -Stylesheet in
jedem eigenen HTML-Head. Die veröffentlichte Website-Datenschutzerklärung sagt
jedoch vor einem Google-Maps-Klick keine Verbindung zu Google zu. Deshalb sind
externe Google-Font-Links und entsprechende CSP-Erweiterungen in diesem Stand
zurückgehalten. Die lokalen Fonts sind vollständig funktionsfähig. Die konkrete
Auflösung dieses Widerspruchs ist vor einer externen Einbindung nötig.

Die Regressionen prüfen an synthetischen Daten die anonyme Fontauslieferung,
tatsächlich eingebettete PDF-Familien, unveränderte PDF-Originale und die getrennte
E-Mail-Sandbox sowie gemischte internationale Namen und lange mehrsprachige Texte
einschließlich kombinierender Akzente. Die bestehenden Linux-Browserprüfungen bleiben erhalten; ergänzte
Prüfungen kontrollieren tatsächliches Laden, Schriftrollen und Überlauf mit
Chromium, Firefox und WebKit bei 320, 768 und 1440 px. Lokale Website-Server und
lokale Browser-Testserver bleiben gemäß `AGENTS.md` ausgeschlossen. Browser- und
Releaseergebnisse sind erst durch den jeweiligen erfolgreichen GitHub-Lauf belegt.
