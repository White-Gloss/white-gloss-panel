# Bestandsaufnahme des Betriebspanels

Stand: 03.11.2026. Grundlage: Code auf `main` (`999a667`), Dokumentation, Tests und
GitHub-Läufe. Jede Aussage nennt die Stelle im Code oder die Quelle. Nicht Geprüftes ist als
offen markiert. Die Reihenfolge der Aufgaben steht in der [Roadmap](Roadmap.md).

## Prüfbasis

- 6 Seiten: `/`, `/vor-ort`, `/kunde`, `/chat`, `/buchhaltung`, `/kanzlei`. Oberfläche ohne Framework.
- Eigene Node-22-Laufzeit (`server/start.mjs`), SQLite mit 88 Tabellen (`src/schema.mjs` und
  `server/*.mjs`). Aufträge liegen als JSON in `orders.data`.
- Prüfungen ohne Website-Server: lint, typecheck, `npm test`, build, `node --check`.
  Browserprüfungen laufen nur auf dem GitHub-Runner.
- Im Cloud-Container scheitert `tests/deploy-installer.test.mjs` nur, weil er als `root` läuft.
  Der Installer lehnt `root` absichtlich ab. Als normaler Benutzer ist der Test grün.
- Ein Merge auf `main` wird automatisch veröffentlicht (Job „Hostinger panel release“, siehe
  [Hostinger-Umzug](Hostinger-Umzug.md)).

## Bereiche

### Dashboard („Übersicht“)
- **Stand:** Handlungszentrale „Heute zu erledigen“ (`public/action-center.mjs`, PR #39),
  Kennzahl „Zahlungen · Monat“, Arbeitsvorrat nach Dringlichkeit, Systemleiste.
- **Stärken:** Liest nur, ein Klick öffnet den passenden Auftragsbereich.
- **Schwächen:** Wiedervorlagen ließen sich nicht abhaken; behoben mit „Wiedervorlage erledigen“
  ([Handlungszentrale](Handlungszentrale.md)). Fällige Mahnstufen fehlen (Roadmap V7).

### Navigation
- **Stand:** 23 Menüpunkte in 4 Gruppen (`menus`, `navigationSections` in `public/app.js`).
  Mobile Leiste: Kalender, Start, Anfragen, Laufend, Finanzen, Mehr.
- **Stärken:** Gruppen merken ihren Zustand, Tastatur und Fokus sind geprüft.
- **Schwächen:** Kundenanfragen, Laufende und Alle Aufträge zeigen dieselbe Tabelle mit anderem
  Filter (`table()`). „Nachrichten“ fehlt in der mobilen Leiste (V3, V5).

### Kunden
- **Stand:** Karten mit Suche, Kundenakte als Fenster mit Fahrzeugen und Aufträgen
  (`customersPage`, `customerModal`). Tabellen `customers`, `vehicles`, `customer_orders`.
- **Stärken:** Löschen per Trigger gesperrt, Versionen, Anrufen/WhatsApp/Navigation.
- **Schwächen:** Keine eigene Kundenseite, kein Umsatz und keine offenen Posten je Kunde.

### Fahrzeuge
- **Stand:** Teil der Kundenakte. Protokolle mit Lackschichtdicke, Schadensskizze und Fotos
  (`public/protocol-form.js`).
- **Schwächen:** Keine Behandlungshistorie je Fahrzeug.

### Anfragen
- **Stand:** Website-Import (`website_inbox`), WhatsApp-Übernahme, manuell, Vor-Ort-Sofortbuchung.
- **Stärken:** Prüfung und Dublettenschutz (`website_id UNIQUE`).
- **Schwächen:** Die Liste hat keine Spalte für das Alter einer Anfrage.

### Angebote
- **Stand:** Preisprüfung mit Katalog, Link mit PIN, gemeinsame Unterschrift für Angebot und
  Termin, Ersatzangebote. 14 Tage gültig, danach automatisch „Abgelaufen“ (`src/domain.mjs`).
- **Stärken:** Unterschriebene Fassungen bleiben unverändert.
- **Schwächen:** Kein Nachfassen vor Ablauf außer dem Hinweis 48 h vorher (V6).

### Termine
- **Stand:** Monatskalender, Google-Abgleich, Vorschlag und Bestätigung, Erinnerung 72 h vorher.
- **Stärken:** Trigger `no_overlap_*` verhindert Überschneidungen in der Datenbank.
- **Hinweis:** Der Trigger verbietet jede Überschneidung. Für einen Betrieb ohne Mitarbeiter
  passt das (Betreiberantwort 03.11.2026).

### Aufträge
- **Stand:** 10 Status, serverseitige Logik (`transition`), Versionen, Änderungsprotokoll,
  Papierkorb, Testbereich.
- **Schwächen:** Ablauf-Leiste, Reiter und Feld „Arbeitsschritt“ bilden drei Navigationsebenen.
  Der Kundenchat liegt unter „Weitere Aktionen“ (V2). Der Text „Nächster Schritt“ steht in
  `src/domain.mjs`, `public/app.js` und im ungenutzten `public/premium.js` (V8).

### Rechnungen
- **Stand:** Qonto, Nummer = WG-Nummer, Summenprüfung, Mehrarbeitsentwurf, Kundenlink.
- **Stärken:** Schutz vor Doppelrechnung und Doppelversand.
- **Schwächen:** Das Rechnungsregister zeigt „unpaid“ statt „Offen“ (V12).

### Zahlungen
- **Stand:** Bar, Karte, Überweisung; korrigieren und stornieren (`cancelledAt`); Qonto-Abgleich.
- **Stärken:** Überzahlungsschutz, Verlauf bleibt erhalten.

### Mahnwesen
- **Stand:** 3 Stufen ohne Gebühren, automatisch nur mit Freigabe (`server/qonto-billing.mjs`).
- **Schwächen:** Die fällige Stufe wird nur beim Öffnen eines Auftrags berechnet
  (`invoiceInfo` in `orderDetail`). Eine Sammelliste fehlt (V7).

### Kommunikation
- **Stand:** Kundenchat, WhatsApp Business API, Communication Center für E-Mail (PR #41,
  [Details](Communication-Center.md)), vorbereitete Hermes-Leseintegration
  ([Details](Hermes-Integration.md)), Web-Push.
- **Schwächen:** Kein gemeinsamer Posteingang über alle Kanäle (V3).

### Aufgaben
- **Stand:** Kein eigenes Aufgabenmodul. Wiedervorlagen sind Notizen mit Datum (`notes[].followUp`).
- **Behoben:** Wiedervorlagen lassen sich abhaken (`followUpDone`).
- **Offen:** Aufgaben ohne Auftrag.

### Mitarbeiter
- **Stand:** Nicht vorhanden. Rollen sind Betreiber, Kunde und Kanzlei.
- **Entscheidung:** Kein Bedarf (Betreiberantwort 03.11.2026, Roadmap V4 entfallen).

### Kundenportal
- **Stand:** `/kunde` mit Link und PIN, Status, Unterschriften, Termin, Extras, Chat,
  Dokumente, Rechnung, Bewertung, B2B-Bereich (`server/portal.mjs`).
- **Schwächen:** Ein neuer Terminvorschlag erzeugt keine Kundenmail. Die Doku zum Datenschutz
  nennt noch „IONOS“ als Speicherort ([Kundenportal](Kundenportal.md), [Kundenchat](Kundenchat.md)).

### Finanzen
- **Stand:** 7 Unterpunkte plus `/buchhaltung` (Abgleich, Buchungsfreigabe, Monatsabschluss,
  DATEV) und `/kanzlei`.
- **Stärken:** Revisionssicher angelegt (Trigger, Hash-Prüfung).
- **Offen:** Kanzleiprofil fehlt, deshalb sind Abschluss und Export gesperrt. DATEV-Testimport ausstehend.

## Betrieb und Sicherheit

- **Datensicherung:** Täglich nach `/var/lib/white-gloss-panel` auf demselben VPS
  (`deploy/white-gloss-panel-backup.service`, `RestrictAddressFamilies=AF_UNIX`). Laut Betreiber
  sind Hostinger-Sicherungen aktiv. Umfang und Wiederherstellung sind ungeprüft (V13).
- **Server-Härtung:** Laut [Hostinger-Umzug](Hostinger-Umzug.md) vom 25.10.2026 sind SSH per
  Passwort und offene Ports von KI-Containern offen. Aktueller Stand ungeprüft.
- **Tote Dateien:** `premium.js`, `premium.css` und `agency.css` lädt keine Seite mehr
  (seit `1c3faab`). `scripts/deploy-hostinger.sh` prüft sie beim Release noch (V8).
