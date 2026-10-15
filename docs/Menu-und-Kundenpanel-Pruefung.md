# Menü, Gestaltung und erneute Funktionsprüfung

## Umsetzung

Das feste Betreiber-Seitenmenü hat nun bei jeder Bildschirmgröße eine eigene
vertikale Scrollfläche. Seine Inhalte dürfen nicht durch Flex-Schrumpfung
zusammengedrückt werden. Dadurch bleiben die unteren Menüpunkte und die
Vor-Ort-App auch auf niedrigen Desktopbildschirmen, bei größerer Schrift und
auf kleinen Mobilbildschirmen erreichbar.

Die Gestaltung übernimmt die belegten Farben und selbst gehosteten Barlow-
Schriften der veröffentlichten Website: dunkle Navigation und Kopfbereiche,
Chromakzente und geradere Konturen. Die Formulare und Dokumentansichten
behalten gut lesbare Arbeitsflächen. Die lokale Schriftlizenz liegt bei.

## Durch Regressionen belegte Korrekturen

- Separate Terminunterschriften im Kundenportal prüfen den Kalender vor der
  Signaturspeicherung erneut. Konflikte und Kalenderausfälle hinterlassen
  keine bestätigte Buchung oder Signaturdatei; eine spätere Wiederholung bleibt möglich.
- Verspätete Chatantworten und Fehler eines zuvor ausgewählten Auftrags können
  den aktuellen Auftrag nicht mehr verändern. Wiederholtes Antippen während
  der Chatöffnung startet keine doppelten Anfragen.
- Vorbereitete Dokumentmails an eine inzwischen korrigierte Kundenadresse
  werden gestoppt. Das unveränderte PDF bleibt für manuelles Teilen verfügbar.
- Auch Chat-Einladungen und Kundenbenachrichtigungen prüfen die Adresse
  unmittelbar vor dem Versand erneut, wenn sie während der Vorbereitung geändert wurde.
- Korrekturen eines Zahlungsdatums verwenden dieselbe Zukunftsgrenze wie
  das ursprüngliche Erfassen einer Zahlung.
- Bei vor der Speicherung abgelehnten Signaturaktionen werden neue,
  ungebundene Dateien entfernt. Bereits gespeicherte Signaturen bleiben erhalten.

## Prüfumfang

| Bereich | Synthetische Prüfungen |
| --- | --- |
| Kundenanmeldung | Persönlicher Link und PIN, Ablauf, Fehlversuche, einmalige Einlösung, fremde Konten, widerrufene Zugänge, Betreiberpasswort und Wiederherstellung |
| Kundenportal | Eigene Aufträge und Auftragswechsel, Status/Leistungen/Preise, Extras als Anfrage, Terminwünsche, schreibgeschützte Betreibervorschau |
| Unterschriften | Angebot und Termin gemeinsam, separater Termin, geänderter/veralteter Termin, Kalenderkonflikt/-ausfall, parallele Wiederholung, geschützte Annahme-/Rückgabe- und Ersatzprotokolle |
| Dokumente/Rechnungen | Eigene PDF-Zugriffe, Rechnungsbetrag und Zahlstatus, unveränderter unterschriebener Stand, Rechnungskorrektur vor Versand, fremde/revokierte Zugriffe, unklarer Versand und Anbieterfehler |
| Nachrichten | Auftragsbezogener Chat, verspätete Antworten, Mehrfachöffnung, Versand- und Zugriffsgrenzen, Anhänge mit synthetischen Daten |
| Betreiber | Auftrag anlegen/bearbeiten, wiederherstellbares Löschen, Unterschriftsschutz/Ersetzung, Termine, Rechnungsentwurf und Mehrarbeit, Zahlungen/Korrekturen, Mischrechner, Einstellungen und Anbieterfreigaben |
| Layout | Echte Chromium-Prüfungen auf dem Linux-GitHub-Runner: Desktopmenü bei geringer Höhe, mobile/Querformat-Menüs, vergrößerte Schrift, sichtbare Ziele, Tastaturschließen und Fokus; Kundenportal auf Desktop/Mobil |

Die vollständige Node-Prüfung läuft mit `npm test` ohne Website-Server.
`npm run test:browser` ist ausschließlich auf dem echten Linux-GitHub-Runner
freigegeben und nutzt abgefangene Browseranfragen an eine speicherinterne
Anwendung. Es wird kein HTTP-Listener und kein Website-Server gestartet.
Die CI speichert Browser-Screenshots als `panel-browser-evidence`.
Die Sperre darf lokal nicht durch vorgetäuschte Umgebungsvariablen umgangen werden.

Auf dem Betreiberrechner werden nur veröffentlichte IONOS-Seiten im Browser
geprüft. Echte Kundensignaturen, Mails, Rechnungen, Nachrichten und Uploads
gehören nicht zur Testdurchführung. Externe Anbieter werden in den
fachlichen Tests kontrolliert simuliert. Ein erfolgreicher Test oder PR ist
noch kein Nachweis einer IONOS-Veröffentlichung.
