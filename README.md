# White Gloss Mein Panel

Privates Betriebspanel für Anfragen, manuelle Aufträge, Preisprüfung, Angebote,
Termine, Fahrzeugprotokolle, Kundenbetreuung und direkten Kundenchat.

Im aktuellen Quellstand ergänzen ein getrennter Bereich für Kundenanfragen,
laufende Aufträge und Finanzen sowie ein freischaltbarer B2B-Firmenbereich die
bestehenden Abläufe. Der Finanzbereich besitzt einen ersten Belegeingang und
manuelle Zuordnungsentwürfe; eine vollständige Buchhaltung ist noch im Aufbau.

Das eigene Panel läuft seit 22.10.2026 auf Hostinger (Details und offene Punkte: [Hostinger-Umzug](docs/Hostinger-Umzug.md)). Der alte IONOS-Server ist nur noch Rückfall. Dieses Repository enthält
die eigenständige Laufzeit mit Anmeldung, SQLite, privatem Fotospeicher,
Google-OAuth, Qonto-Rechnungsablauf mit Mahnwesen und Kundenbereich sowie Zeitplänen und den bisherigen privaten Sites-Worker.
Jede Änderung benötigt einen eigenen geprüften Release und einen Live-Nachweis. Ein automatischer Releaseweg für Hostinger ist noch nicht eingerichtet (siehe Hostinger-Umzug).

- [Eigenes Panel](https://panel.white-gloss.de/)
- [Bisherige private Sites-Kopie](https://white-gloss-mein-panel.info261616.chatgpt.site/)
- [IONOS und Google Einrichtung](docs/IONOS-und-Google.md)
- [Passwort, Kunden-PIN und Protokoll-PDF](docs/Passwort-PIN-und-Protokoll-PDF.md)
- [Qonto: Rechnungen, Quittungen und Mahnwesen](docs/Qonto-Rechnungen-und-Mahnwesen.md)
- [Vor-Ort-App, Kundenstamm und Bearbeitung](docs/Vor-Ort-App-und-Bearbeitung.md)
- [Kundenchat mit Fotos, Videos und PDFs](docs/Kundenchat.md)
- [Angebot, Termin, Mischrechner und mobile Bedienung](docs/Angebot-Termin-und-Mischrechner.md)
- [Kundenportal mit B2B-Firmenbereich](docs/Kundenportal.md)
- [Buchhaltung: genauer Implementierungsstand](docs/Buchhaltung-Implementierungsstand.md)

## Aufbau

`src/worker.mjs` enthält die HTTP-Endpunkte und die Hintergrundprüfung.
`src/domain.mjs` prüft den Auftragsablauf; `src/customers.mjs` führt Kunden und Fahrzeuge;
`src/schema.mjs` definiert SQLite-Tabellen und Trigger. `public/` enthält das Panel (`index.html`)
und die installierbare Vor-Ort-Web-App (`vor-ort.html`, `/vor-ort`). Das Build erzeugt einen Sites-Worker
und statische Dateien; `server/start.mjs` stellt separat die IONOS-Laufzeit bereit.

Sites nutzt seine Anmeldung, D1 und R2. Die IONOS-Laufzeit nutzt Betreiberpasswörter,
persönliche E-Mail-Bestätigung zur Einrichtung/Wiederherstellung, Kundenlinks mit
einmaliger PIN, serverseitige Sitzungen, SQLite und private Dateien außerhalb
des Webroots. Alle Geheimnisse liegen außerhalb des Codes. Kundendaten,
Fotos und Zugangsschlüssel gehören nicht in dieses Repository.

## Prüfungen ohne lokalen Website-Server

Node.js ab Version 22.23.2 und npm sind für die bestehenden Prüfungen geeignet.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
node --check dist/server/index.js
```

Die Tests nutzen synthetische Daten und isoliertes SQLite. Die UI-Tests laden die gebauten
Seiten in jsdom und rufen die Serverlogik direkt im Prozess auf; es wird kein Server gestartet. Der GitHub-Workflow
führt dieselben Prüfungen auf einem Linux-Runner aus. Für den Hauptbranch folgt
nach erfolgreichen Code- und Browserprüfungen die automatische Veröffentlichung
über den separaten IONOS-Paneldienst. Dieser Releasejob benötigt die einmalig
eingerichteten IONOS-Zugänge; die Prüfjobs benötigen keine Anbieterzugänge.
Einrichtung und Live-Nachweise: [IONOS und Google](docs/IONOS-und-Google.md#direkte-veröffentlichung-nach-codeänderungen).

**Auf dem Rechner des Betreibers darf diese White-Gloss-App unter keinen Umständen
lokal gehostet werden.** Keine Dev-, Preview-, QA-, Docker-, Tunnel- oder statischen
Website-Server starten. Browserprüfungen erfolgen ausschließlich am erlaubten
veröffentlichten Stand.

## Betriebsstand

Der Ablauf, geschützte Buchungsfotos und die manuelle Auswahl sowie Anpassung von
Paketen, Extras und Abholung sind implementiert. Die private Sites-Veröffentlichung
und der separate IONOS-Release müssen jeweils ihrem tatsächlich veröffentlichten
Commit zugeordnet werden.

Website, Resend und Google wurden in der getrennten IONOS-Installation verbunden.
Rechnungen laufen über Qonto (Rechnung mit 7 Tagen Zahlungsziel oder Quittung, Mahnwesen, Zahlungsabgleich, Kundenbereich).
Kunden haben unter `/kunde` ein eigenes Kundenportal mit Status, Termin, Dokumenten, Rechnung, Chat und Zusatzleistungs-Anfragen (siehe `docs/Kundenportal.md`).
Der Qonto-Zugang und die neue IONOS-Veröffentlichung benötigen
eigene tatsächliche Nachweise. Der unabhängige Dienst und die Timer sind installiert. Der vollständige
historische WG-Nummernabgleich bleibt eine gesonderte Voraussetzung für echte neue
Aufträge und Rechnungen. Betriebsdaten, Zugangsprüfungen und Freigaben gehören zur
geschützten Installation, nicht in GitHub. Ein bestandener Test oder GitHub-Upload
beweist weder einen neuen Live-Release noch eine tatsächliche Kundenzustellung.

`scripts/verify-live.mjs` ist eine frühere Prüfroutine mit schreibenden synthetischen
Aktionen. Sie darf nicht ohne gezielt erlaubten Prüfzugang und vorherige Prüfung
ihres Umfangs gegen eine laufende App ausgeführt werden.
