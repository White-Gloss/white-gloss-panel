# White Gloss Mein Panel

Privates Betriebspanel für Anfragen, manuelle Aufträge, Preisprüfung, Angebote,
Termine, Fahrzeugprotokolle und Kundenbetreuung.

Das veröffentlichte Panel läuft derzeit privat auf Sites. Dieses Repository enthält
zusätzlich die eigenständige IONOS-Laufzeit mit Anmeldung, SQLite, privatem Fotospeicher,
Google-OAuth, Qonto-Rechnungsablauf und Zeitplänen. **Der neue IONOS-Dienst ist vorbereitet;
seine Aktivierung und die tatsächlichen Anbieterzugänge sind noch live zu prüfen.**

- [Aktuelles privates Panel](https://white-gloss-mein-panel.info261616.chatgpt.site/)
- [IONOS und Google Einrichtung](docs/IONOS-und-Google.md)

## Aufbau

`src/worker.mjs` enthält die HTTP-Endpunkte und die Hintergrundprüfung.
`src/domain.mjs` prüft den Auftragsablauf; `src/schema.mjs` definiert SQLite-Tabellen
und Trigger. `public/` enthält die Oberfläche. Das Build erzeugt einen Sites-Worker
und statische Dateien; `server/start.mjs` stellt separat die IONOS-Laufzeit bereit.

Sites nutzt seine Anmeldung, D1 und R2. Die IONOS-Laufzeit nutzt eigene persönliche
E-Mail-Anmeldelinks, serverseitige Sitzungen, SQLite und private Dateien außerhalb
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

Resend und Qonto sind im bisherigen privaten Panel hinterlegt; die neue IONOS-Laufzeit
prüft übertragene Zugänge erneut. Website-Schlüssel, dauerhafter Google-Kalenderzugang,
Nummernabgleich und ein nachgewiesener unabhängiger Hintergrundlauf bleiben
Einrichtungsaufgaben.
Echte Rechnungserstellung, Kalender-Synchronisierung und Angebotsversand sind
noch gesperrt. Ein bestandener Test oder ein GitHub-Upload beweist keinen
funktionierenden Anbieterzugriff oder IONOS-Betrieb.

`scripts/verify-live.mjs` ist eine frühere Prüfroutine mit schreibenden synthetischen
Aktionen. Sie darf nicht ohne gezielt erlaubten Prüfzugang und vorherige Prüfung
ihres Umfangs gegen eine laufende App ausgeführt werden.
