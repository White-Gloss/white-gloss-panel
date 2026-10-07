# Hauptwebsite: vorbereitete Panel-Verfügbarkeit

Status: in der isolierten Panel-Arbeitskopie vorbereitet und serverfrei geprüft.
Diese Dateien wurden nicht in einen vorhandenen Website-Checkout geschrieben und
sind nicht veröffentlicht. Ein Website-PR und dessen CI sind eigene Nachweise.

## Geprüfte Ausgangsdateien

Am 7. Oktober 2026 über den GitHub-Connector auf dem Standardzweig `main` von
`White-Gloss/glanz-buchung-meister` gelesen:

| Datei | GitHub-Blob-SHA |
| --- | --- |
| `src/routes/api.availability.ts` | `77c58347517acbd2688b0943aa04f826ed9c2f49` |
| `src/components/configurator.tsx` | `2695ece0fddd5b01ced4e56d4e0386d12826ab96` |
| `src/lib/booking-slot-availability.ts` | `ab77cdf76993eb49f26fdc5e5df02df1c200737d` |
| `src/lib/booking-time.ts` | `530490a0df512f1021d44393d4ddaa101c96b689` |
| `src/lib/bitrix-calendar.ts` | `cae4e9c05baede87a68a8fefac4b19aa85769227` |
| `package.json` | `1847d95a1057026692f1148d4f1cd402ebd2ef3e` |

Der geprüfte Panel-Modus liefert bisher `windows: []` und `requestOnly: true`.
Damit kommen manuelle Panel-Sperren nicht in der öffentlichen Terminauswahl an.
Der bestehende `requestedSlotBusy`-Helper behandelt einen Zeitraum erst als voll,
wenn beide Ressourcen belegt sind. Der aktuelle Konfigurator verwendet selbst
`busyWindows.some` mit der vorläufigen vollständigen Paketdauer. Die vorbereitete
Antwort erfüllt beide bestehenden Verbraucher.

## Vorbereitete Änderung

Die Dateien unter diesem Ordner behalten ihre Repository-Zielpfade:

- `src/lib/panel-calendar.ts`: liest ausschließlich den festen HTTPS-Endpunkt
  `https://panel.white-gloss.de/api/calendar/availability`. Keine Zugangsdaten,
  Cookies, Weiterleitungen oder fremden Kalenderzugänge. Ein Websitebereich mit
  bis zu 93 inklusiven Tagen wird in höchstens drei Abfragen mit maximal 31 Tagen
  geteilt; das Panel-Enddatum bleibt exklusiv.
- `src/routes/api.availability.ts`: ersetzt nur im bestehenden Panel-Modus die
  leere Fensterliste. Der bisherige Ratenbegrenzer und das Antwortformat bleiben
  bestehen. `requestOnly: true` bleibt ausdrücklich erhalten: Die Website nimmt
  Wünsche entgegen; sie bestätigt und reserviert weiterhin keinen Termin.
- `src/components/configurator.tsx`: Keramik wird entsprechend der Betreiberwahl
  ohne feste Uhrzeit angefragt. Auch eine früher gespeicherte Uhrzeit wird bei
  einer neuen Keramik-Anfrage nicht übermittelt. Preise, Texte anderer Pakete,
  Originalbilder, Uploads, Einwilligungen und Wiederholungs-/Idempotenzablauf
  bleiben erhalten.
- `src/lib/panel-calendar.test.ts`: acht serverfreie Prüfungen.
- `package.json`: ausschließlich Ergänzung dieses Tests am Ende des bestehenden
  expliziten Testbefehls; keine Abhängigkeitsänderung.

Der Adapter prüft Zeitzone, exakten Bereich, vollständige und geordnete Tage,
gültige UTC-/Offset-Zeitpunkte, 08:30–18:00-Grenzen auf Sekundenebene,
überschneidungsfreie erlaubte/freie Fenster und Widersprüche zu Belegungen.
Unvollständige, fehlerhafte, übergroße oder nicht erreichbare Antworten erzeugen
keine Freigabe. Die Route antwortet mit 503; die bestehende Oberfläche ermöglicht
dann nur eine Anfrage ohne feste Uhrzeit. Es gibt keine leere erfolgreiche
Fensterliste als Fehlerfallback.

Das Komplement der verifizierten freien Fenster innerhalb jedes vollständigen
Berliner Tages wird für Ressourcen 1 und 2 blockiert. Somit sperren manuelle
Belegungen, geschlossene Wochenenden und Zeiten außerhalb 08:30–18:00 beide
bestehenden Kapazitäten. Berliner Tage bei der Zeitumstellung behalten ihre
tatsächlichen 23 beziehungsweise 25 Stunden. Private Titel, Notizen, Namen und
IDs werden nicht in das Websiteformat übernommen.

Keramik hat im unveränderten `booking-time.ts` eine vorläufige Dauer von 1920
Minuten. Diese Dauer wird nicht eigenmächtig geändert. Deshalb ist eine feste
Zeitwahl für diese Anfrage ausgesetzt; die spätere konkrete Arbeitszeit wird
persönlich durch den Betreiber geprüft und vereinbart.

## Prüfungen und Veröffentlichungsfolge

Bestanden:

- `node --experimental-strip-types --test src/lib/panel-calendar.test.ts` in
  dieser isolierten vorbereiteten Dateistruktur: 8/8.
- Standalone-TypeScript-Typprüfung für Helper und Tests.
- Syntax/Transpilation von Route und Konfigurator über esbuild, ohne Serverstart.
- Panel-Kalendertests: 11/11. Bestehende Terminannahmetests nach Anpassung eines
  Testdatums auf einen regulären Freitag: 23/23.

Vor einem Website-Commit aktuelle Zweigspitze und Ausgangsdateien erneut prüfen;
bei abweichenden Dateien Änderungen gezielt neu anwenden. Der Panel-Release muss
zuerst den einzelnen anonymen GET-Endpunkt mit ausschließlich realen
Zeitintervallen anbieten. Betreiber-/Kundendaten und schreibende Kalenderwege
bleiben geschützt. Ein Website-PR braucht die vollständigen vorgesehenen
Repositoryprüfungen zusätzlich zu diesen isolierten Tests.

Produktive Panel- und Websiteaktivierung erfolgen erst nach ausdrücklicher
Betreiberfreigabe, jeweils über ihren getrennten freigegebenen IONOS-Weg. Danach
ohne echte Kundenaktionen live prüfen: anonymisierte Panelantwort, tatsächliche
Websitefenster, angezeigte Sperrungen auf Smartphone/Desktop und unverbindliche
Keramik-Anfrage ohne Uhrzeit. Der Live-Nachweis ist derzeit offen.
