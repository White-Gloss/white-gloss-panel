# White Gloss Mein Panel

Privates Betriebspanel für Anfragen, manuelle Aufträge, Preisprüfung, Angebote,
Termine, Fahrzeugprotokolle und Kundenbetreuung.

Das eigene Panel läuft auf IONOS unter panel.white-gloss.de. Dieses Repository enthält
die eigenständige Laufzeit mit Anmeldung, SQLite, privatem Fotospeicher,
Google-OAuth, Qonto-Rechnungsablauf und Zeitplänen sowie den bisherigen privaten Sites-Worker.
Jede Änderung benötigt einen eigenen geprüften IONOS-Release und einen Live-Nachweis.

- [Eigenes Panel](https://panel.white-gloss.de/)
- [Bisherige private Sites-Kopie](https://white-gloss-mein-panel.info261616.chatgpt.site/)
- [IONOS und Google Einrichtung](docs/IONOS-und-Google.md)
- [Passwort, Kunden-PIN und Protokoll-PDF](docs/Passwort-PIN-und-Protokoll-PDF.md)
- [Mischverhältnisrechner](docs/Mischrechner.md)
- [Terminwahl, gemeinsame Unterschrift und Bestätigungsmail](docs/Terminwahl-und-Bestaetigung.md)
- [Panel-Erweiterung: Assistent, Akten, Kalender und Aufgaben](docs/Panel-Erweiterung-2026-10-09.md)

## Aufbau

`src/worker.mjs` enthält die HTTP-Endpunkte und die Hintergrundprüfung.
`src/domain.mjs` prüft den Auftragsablauf; `src/schema.mjs` definiert SQLite-Tabellen
und Trigger. `public/` enthält die Oberfläche. Das Build erzeugt einen Sites-Worker
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

Die Tests nutzen synthetische Daten und isoliertes SQLite. Der GitHub-Workflow
führt dieselben Prüfungen auf einem Linux-Runner aus. Er veröffentlicht nichts
und benötigt keine IONOS- oder Anbieterzugänge.

**Auf dem Rechner des Betreibers darf diese White-Gloss-App unter keinen Umständen
lokal gehostet werden.** Keine Dev-, Preview-, QA-, Docker-, Tunnel- oder statischen
Website-Server starten. Browserprüfungen erfolgen ausschließlich am erlaubten
veröffentlichten Stand.

## Betriebsstand

Der Ablauf, geschützte Buchungsfotos und die manuelle Auswahl sowie Anpassung von
Paketen, Extras und Abholung sind implementiert. Die private Sites-Veröffentlichung
und der separate IONOS-Release müssen jeweils ihrem tatsächlich veröffentlichten
Commit zugeordnet werden.

Website, Resend, Qonto und Google wurden in der getrennten IONOS-Installation
verbunden. Der unabhängige Dienst und die Timer sind installiert. Der vollständige
historische WG-Nummernabgleich bleibt eine gesonderte Voraussetzung für echte neue
Aufträge und Rechnungen. Betriebsdaten, Zugangsprüfungen und Freigaben gehören zur
geschützten Installation, nicht in GitHub. Ein bestandener Test oder GitHub-Upload
beweist weder einen neuen Live-Release noch eine tatsächliche Kundenzustellung.

`scripts/verify-live.mjs` ist eine frühere Prüfroutine mit schreibenden synthetischen
Aktionen. Sie darf nicht ohne gezielt erlaubten Prüfzugang und vorherige Prüfung
ihres Umfangs gegen eine laufende App ausgeführt werden.
