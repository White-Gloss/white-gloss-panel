# White Gloss Mein Panel

Privates Betriebspanel für Anfragen, manuelle Aufträge, Preisprüfung, Angebote,
Termine, Fahrzeugprotokolle und Kundenbetreuung.

Der vorhandene Quellcode läuft derzeit auf Sites. Dieses Repository enthält den
Code einschließlich Versionsverlauf und die Vorbereitung für einen eigenständigen
IONOS-Betrieb. **Die Umstellung auf IONOS ist noch nicht implementiert oder
veröffentlicht.**

- [Aktuelles privates Panel](https://white-gloss-mein-panel.info261616.chatgpt.site/)
- [IONOS und Google Einrichtung](docs/IONOS-und-Google.md)

## Aufbau

`src/worker.mjs` enthält die HTTP-Endpunkte und die Hintergrundprüfung.
`src/domain.mjs` prüft den Auftragsablauf; `src/schema.mjs` definiert SQLite-Tabellen
und Trigger. `public/` enthält die Oberfläche. Das aktuelle Build erzeugt einen
Sites-Worker und dessen statische Dateien, keinen eigenständigen Node-Server.

Zur Laufzeit werden Sites-Anmeldung, D1-Datenbank, R2-Dateispeicher und ein außerhalb
des Codes gespeicherter Verschlüsselungsschlüssel benötigt. Kundendaten und
Zugangsschlüssel gehören nicht in dieses Repository.

## Prüfungen ohne lokalen Website-Server

Node.js ab Version 22.23.2 und npm sind für die bestehenden Prüfungen geeignet.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Die Tests nutzen synthetische Daten und isoliertes SQLite. Der GitHub-Workflow
führt dieselben Prüfungen auf einem Linux-Runner aus. Er veröffentlicht nichts
und benötigt keine IONOS- oder Anbieterzugänge.

**Auf dem Rechner des Betreibers darf diese White-Gloss-App unter keinen Umständen
lokal gehostet werden.** Keine Dev-, Preview-, QA-, Docker-, Tunnel- oder statischen
Website-Server starten. Browserprüfungen erfolgen ausschließlich am erlaubten
veröffentlichten Stand.

## Betriebsstand

Der Ablauf und die manuelle Auswahl von Paketen, Extras und Abholung sind
implementiert. Die letzte private Sites-Veröffentlichung basiert auf
`56d73d76e60c0a6b3e4265e75ab29c3f1fda5459`.

Website-Schlüssel, dauerhafter Google-Kalenderzugang, Qonto und Nummernabgleich sowie
ein nachgewiesener unabhängiger Hintergrundlauf bleiben Einrichtungsaufgaben.
Echte Rechnungserstellung, Kalender-Synchronisierung und Angebotsversand sind
noch gesperrt. Ein bestandener Test oder ein GitHub-Upload beweist keinen
funktionierenden Anbieterzugriff oder IONOS-Betrieb.

`scripts/verify-live.mjs` ist eine frühere Prüfroutine mit schreibenden synthetischen
Aktionen. Sie darf nicht ohne gezielt erlaubten Prüfzugang und vorherige Prüfung
ihres Umfangs gegen eine laufende App ausgeführt werden.
