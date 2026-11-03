# Communication Center

Stand: 03.11.2026. Ersetzt den bisherigen Bereich „E-Mail“ im Hauptpanel (Menü „Communication Center“).
Implementiert und mit synthetischen Daten getestet. Ein Live-Release ist damit **nicht** belegt (siehe unten).

## Aufbau

- **Übersicht (Startseite):** Kennzahlen (ungelesen, wichtig, laufende Aufträge, Termine heute, Entwürfe),
  ungelesene E-Mails, nächste Termine, laufende Aufträge, angeheftete/aktuelle Notizen.
- **E-Mail:** Posteingang, Ungelesen, Wichtig, Entwürfe, Gesendet, Archiv, Spam, Papierkorb und eigene Ordner.
- **CRM in der linken Navigation:** Laufende Aufträge, Kalender, Notizen; Absprung zu WhatsApp und Kunden.
- Die zuletzt genutzte Ansicht bleibt beim Wechsel in einen Auftrag und zurück erhalten.

## E-Mail

- Liste mit Initialen-Avatar, Absender, Betreff, zweizeiliger Vorschau, Zeit, Anhang, Markierung, CRM-Hinweis.
  Ungelesen: fette Schrift, Punkt und farbige Kante.
- Suche, Filter (Ungelesen, Markiert, Mit Anhang, CRM-Bezug) und Sortierung laufen **auf dem Server**,
  50 Nachrichten je Seite, weitere werden beim Scrollen nachgeladen. Suche findet auch Umlaute (Ä/Ö/Ü).
- Sammelaktionen: gelesen/ungelesen, wichtig, archivieren, löschen, verschieben (bis 200 E-Mails).
- Schnellaktionen beim Überfahren der Zeile (Desktop) sowie Tastenkürzel außerhalb von Eingabefeldern:
  `c` neu, `/` Suche, `j`/`k` nächste/vorige, `r` antworten, `a` allen antworten, `f` weiterleiten,
  `e` archivieren, `#`/Entf löschen, `s` wichtig, `u` gelesen/ungelesen, `Esc` schließen.
- Ordner, Papierkorb und Markierungen sind **Panel-Metadaten**. Das Postfach beim Anbieter bleibt unverändert;
  E-Mail-Nachweise werden nie gelöscht oder überschrieben.

## Sichere Darstellung

- HTML-Mails laufen in einer eigenen Seite `/api/mailbox/message/<id>/view` mit eigener CSP:
  `sandbox` ohne Skripte, `default-src 'none'`, nur Inline-Styles, Rahmen nur im eigenen Panel.
- Zusätzlich entfernt `server/mail-html.mjs` Skripte, Formulare, Fremdobjekte, Event-Handler und
  `javascript:`-Adressen. Links öffnen in einem neuen Tab mit `noopener noreferrer`.
- **Externe Bilder sind blockiert**, bis „Bilder anzeigen“ gewählt wird (Schutz vor Lesebestätigungs-Pixeln).
  Eingebettete Bilder (`cid:`) werden direkt angezeigt.
- Ältere Nachrichten wurden beim Empfang strenger bereinigt; dort fehlen externe Bilder dauerhaft.

## Antworten, Weiterleiten, Editor

- Antworten nutzt `Reply-To`, „Allen antworten“ übernimmt An/Cc ohne die eigene Adresse.
- Neue Antworten setzen `In-Reply-To` und `References`; die Unterhaltung erscheint im Lesebereich.
  Für vor diesem Stand empfangene Mails fehlt die Original-Message-ID, dort entfällt nur dieser Kopf.
- Editor: An, Cc, Bcc, Betreff, Fett/Kursiv/Unterstrichen, Listen, Zitat, Link, Formatierung entfernen.
  Eingefügter Text wird ohne Fremdformatierung übernommen. Versand als HTML plus Textfassung.
- Anhänge: PDF, JPG, PNG, WebP; max. 12 MB je Datei, 15 MB und 10 Dateien je E-Mail. Weiterleiten übernimmt
  archivierte Originalanhänge als Kopie, ohne neuen Beleg im Belegeingang.
- Entwürfe speichern Cc, Bcc, Formatierung und Anhänge. Nicht versendete Uploads ohne Entwurf werden nach
  drei Tagen bei der Wartung entfernt.
- Senden verlangt eine Bestätigung im Editor. Ein unklarer SMTP-Ausgang wird nie automatisch wiederholt.
- Korrektur-KI und KI-Antwortvorschlag arbeiten im Editor und übertragen erst nach ausdrücklicher Bestätigung.

## CRM-Verknüpfung

- Zuordnung ausschließlich über **exakt gespeicherte** E-Mail-Adressen (Kunde, Auftragsquelle) und feste
  Kunde-Auftrag-Verknüpfungen. Keine KI-Vermutung, keine automatische Datenänderung.
- Lesebereich zeigt Kunde, Fahrzeuge, Aufträge mit Status und Termin; direkt: Kundenakte, Auftrag, Notiz.
- Laufende Aufträge: Karten mit Status, Termin, nächstem Schritt; „E-Mail schreiben“ und „E-Mails“ zum Kunden.
- Kalender: 14-Tage-Leiste und Agenda aus den Auftragsterminen, laufende Aufträge ohne Termin, Absprung in
  den Monatskalender und ICS-Export.
- Notizen: schnell erfassen (Strg/⌘ + Enter), anheften, suchen, filtern; Verknüpfung mit Auftrag, Kunde, E-Mail.

## Bedienung auf Geräten

- ≥1400 px: drei Spalten. 1000–1399 px: Navigation als Schublade, Liste und Lesebereich nebeneinander.
- Bis 999 px: eine Spalte mit Zurück-Schaltfläche. Smartphone: Editor im Vollbild, große Touch-Ziele,
  16-px-Eingaben gegen iOS-Zoom, Safe-Area-Abstände.

## Datenmodell (nur additiv)

- `mail_messages`: `cc_json`, `bcc_json`, `reply_to_json`, `message_id_header`, `references_header`.
- `mail_drafts`: `cc`, `bcc`, `html_body`, `attachments_json`, `mode`.
- `mail_notes`: `customer_id`, `pinned`. Neue Tabelle `mail_uploads`. Index `mail_state_folder`.

## Offene Punkte

- Der IMAP-Abruf liest weiterhin nur den Posteingang (die letzten 50 je Abruf). Im Panel gesendete Mails
  werden nicht in den „Gesendet“-Ordner beim Anbieter kopiert.
- Avatare zeigen Initialen; externe Profilbilder werden aus Datenschutzgründen nicht geladen.

## Prüfungen und Veröffentlichung

- Tests: `tests/mailbox-features.test.mjs`, `tests/mailbox-center-ui.test.mjs`, bestehende Mailbox-Tests.
- Browser-Layoutprüfung `browser-tests/communication.test.mjs` läuft nur auf dem GitHub-Linux-Runner.
- Veröffentlichung: Der Hostinger-Releaseweg ist laut [Hostinger-Umzug](Hostinger-Umzug.md) noch nicht
  freigeschaltet. Dieser Stand ist daher **nicht live**, bis ein geprüfter Release nachgewiesen ist.
