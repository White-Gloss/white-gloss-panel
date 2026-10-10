# Kalender und Buchungsregeln

Umgesetzt in der isolierten Arbeitskopie, nicht veröffentlicht. Kein lokaler
Website-Server wurde gestartet.

Der Betreiberkalender liest sämtliche Belegungen im ausgewählten Monatsbereich,
unabhängig von der 300-Aufträge-Grenze der Übersicht. Die Tagesansicht zeigt freie
Zeitfenster, angenommene Aufträge und private manuelle Termine oder Blockierungen.
Eigene Einträge brauchen weder Kundenkonto noch Auftrag; Anlegen, Ändern und
Löschen erzeugen einen dauerhaften Kalenderaudit. Veraltete Änderungen werden über
Eintragsversionen abgelehnt.

Kundenbuchungen liegen vollständig zwischen 08:30 und 18:00 Uhr in Europe/Berlin.
Maximal 570 Minuten können in einem Tag liegen. Sommer- und Winterzeit werden
über die tatsächlich gültige Berliner Ortszeit umgerechnet. Nicht existierende
oder doppeldeutige Zeiten werden abgelehnt. Samstag und Sonntag bleiben gesperrt,
bis der Betreiber genau diesen Tag oder einzelne Zeitfenster freigibt. Mehrere
Freigabefenster dürfen sich nicht überschneiden; eine Dienstleistung muss in ein
einzelnes Fenster passen. Leere Fenster sperren den Tag wieder. Bestehende
unterschriebene Termine werden dadurch nicht geändert oder aufgehoben.

Manuelle Einträge und verbindliche Auftragsbuchungen teilen dieselbe atomare
Kapazitätsprüfung. SQLite-Trigger verhindern Überschneidungen in beiden Richtungen
auch bei gleichzeitigen Schreibversuchen. Termine direkt hintereinander sind
zulässig. Bei einer Wochenendsperre zwischen Vorprüfung und Buchungstransaktion
verhindert ein zusätzlicher Trigger die Annahme mit einer veralteten Freigabe.
Auftrag, Unterschrift, Belegung und Bestätigungsmail-Auftrag bleiben gemeinsam
transaktional geschützt. Terminvorschläge reservieren weiterhin keine Kapazität.

Synthetische Aufträge, manuelle Testeinträge und Testfreigaben bilden einen
getrennten Kapazitätsbereich. Sie blockieren echte Kunden weder im Kalender noch
in der Verfügbarkeit. Öffentliche Verfügbarkeitsantworten enthalten ausschließlich
Zeitfenster und Belegungszeiten, keine Namen, Titel, Notizen, Auftrags- oder
Eintrags-IDs und keine Testdaten.

API im Panel:

- `GET /api/calendar/month?from=YYYY-MM-DD&to=YYYY-MM-DD`: Betreiberansicht,
  Enddatum exklusiv, höchstens 62 Tage; `test=true` wählt den Testbereich.
- `POST /api/calendar/action`: Betreiberaktionen `saveEntry`, `deleteEntry` und
  `setDayRule` mit der jeweils aktuellen Version.
- `GET /api/calendar/availability?from=YYYY-MM-DD&to=YYYY-MM-DD&duration=30`:
  öffentlich lesbare anonymisierte reale Verfügbarkeit; Enddatum exklusiv.
  Dieser einzelne GET-Endpunkt ist für die Hauptwebsite auch ohne Kundensitzung
  erreichbar. Betreiberansicht und schreibende Kalenderwege bleiben geschützt.

Die angezeigte Verfügbarkeit stammt aus der lokalen Panel-Datenbasis. Der
bisherige zusätzliche Google-Belegungscheck vor Kundenannahme bleibt erhalten;
externe Kalenderänderungen werden nicht automatisch als Auftragsvereinbarung
übernommen. Die Hauptwebsite braucht eine separate, geprüfte Integration dieser
Panel-Verfügbarkeit. Ein grüner Panel-Test allein beweist diese Verbindung nicht.

Serverfreie Nachweise: `tests/booking-calendar.test.mjs` enthält 11 Prüfungen
für Zeitgrenzen, Sommer-/Winterzeit, Freigabe und erneute Sperrung, private
Verfügbarkeitsdaten, veraltete Änderungen, parallele Einträge, parallele
Kundenannahme und Blockierung, Rücknahme einer Freigabe während der Annahme,
Testdatentrennung und Monatsabfrage außerhalb der Übersicht. Alle 11 bestehen;
gezielte ESLint-Prüfung und TypeScript-Typprüfung bestehen ebenfalls.

Offen vor Abnahme: Veröffentlichung nach Betreiberfreigabe, Live-Prüfung auf
IONOS, Smartphone-/Desktop-Browserprüfung am veröffentlichten Stand sowie
Aktivierung und Live-Nachweis der Hauptwebsite-Verbindung.
