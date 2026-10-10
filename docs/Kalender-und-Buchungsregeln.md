# Kalender und Buchungsregeln

Die Erweiterungen vom 9. Oktober 2026 sind in der isolierten Arbeitskopie
umgesetzt. Ihr Veröffentlichungs- und Live-Prüfstand wird gesondert im
Abschlussbericht geführt. Kein lokaler Website-Server wurde gestartet.

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

Serverfreie Nachweise: `tests/booking-calendar.test.mjs` enthält 19 Prüfungen
für Zeitgrenzen, Sommer-/Winterzeit, Freigabe und erneute Sperrung, private
Verfügbarkeitsdaten, veraltete Änderungen, parallele Einträge, parallele
Kundenannahme und Blockierung, Rücknahme einer Freigabe während der Annahme,
Testdatentrennung und Monatsabfrage außerhalb der Übersicht. Ergänzt sind Aktenlinks,
vollständige Änderungsschnappschüsse, Tag/Woche/Monat über Jahres- und DST-Grenzen,
persönliche Kundenfreigabe, Wiederholung, Fremdkontensperre, erneute Belegungsprüfung,
gleichzeitige Rücknahme und Zustimmung sowie gesperrte Akten und stornierte
Dokumente. Alle 19 bestehen;
gezielte ESLint-Prüfung und TypeScript-Typprüfung bestehen ebenfalls.

Offen vor Abnahme: Veröffentlichung nach Betreiberfreigabe, Live-Prüfung auf
IONOS, Smartphone-/Desktop-Browserprüfung am veröffentlichten Stand sowie
Aktivierung und Live-Nachweis der Hauptwebsite-Verbindung.

## Bedienung der erweiterten Ansichten

Tag, Woche und Monat sowie eine Datumwahl stehen direkt im Kalender. Die Pfeile
wechseln jeweils einen Tag, eine Woche oder einen Monat; „Heute“ bleibt in der
gewählten Ansicht. Private Einträge werden über „Öffnen / bearbeiten“ geladen.
Beginn und Ende können geändert oder mit den Tag-/Wochenknöpfen verschoben
werden. Erst „Änderung speichern“ übernimmt die Verschiebung. Löschen zeigt
zunächst Titel und Zeitraum; ein zweiter ausdrücklicher Klick bestätigt es.

Kunde, Fahrzeug und Projekt sind optionale Verknüpfungen. Die Zuordnung wird gegen
die echten Akten-IDs und den Testbereich geprüft, auch innerhalb der
Schreibtransaktion. Ein Projektbezug allein ändert keine Kundenzusage. Gesperrte
oder anonymisierte Kunden erhalten keine neuen Verknüpfungen. Bereits verknüpfte
private Einträge bleiben für interne Korrekturen und Löschung bearbeitbar.
`calendar_entry_links` enthält die Verknüpfungen; `calendar_entry_history` hält
vorherige und neue Eintragsversion einschließlich Zuordnung, Zeitpunkt und
Betreiberrolle fest. Diese Details können über „Änderungsverlauf“ gelesen werden;
frühere Bestandsänderungen bekommen keine erfundenen Schnappschüsse.

## Persönlich freigegebene Terminänderung

Der bisherige Ablauf erlaubt eine persönliche gemeinsame Unterschrift unter
Angebot und ausgewählten Termin. Einen späteren Abstimmungsablauf gab es nicht.
Die Erweiterung ergänzt deshalb einen gesonderten, ausdrücklich als Terminänderung
bezeichneten Vorgang im bestehenden persönlichen Kundenpanel:

1. Im Kalender den verbindlichen Kundentermin öffnen. Neuer Beginn, neues Ende
   und Änderungsgrund bilden einen unveränderlichen Vorschlag.
2. Der bisherige Termin bleibt reserviert. Der Vorschlag reserviert die neue Zeit
   noch nicht. Es wird keine Nachricht automatisch versendet. Die bestehende
   Projektnachrichtenfunktion kann für eine ausdrücklich beauftragte Abstimmung
   verwendet werden.
3. Nur der persönlich angemeldete Kunde des ursprünglichen Auftrags sieht und
   bestätigt seinen konkreten Vorschlag. Er kann ihn stattdessen mit Grund
   ablehnen. Der Betreiber darf einen offenen Vorschlag mit Grund zurückziehen,
   aber keine Kundenfreigabe stellvertretend abgeben.
4. Bei Zustimmung werden Auftragsversion, Vorschlag und ursprünglicher Termin
   erneut geprüft, anschließend Kapazität, Zeitfenster und vorhandener externer
   Kalendercheck. Auftrag, Reservierung und persönlicher Freigabenachweis werden
   gemeinsam atomar gespeichert. Alte ausstehende Bestätigungs-/Erinnerungsjobs
   werden für den alten Termin storniert. Ein altes oder fremdes Konto kann
   den Termin nicht ändern; gleichzeitig zurückgezogene Vorschläge ebenfalls nicht.

`calendar_adjustments` und `order.appointmentRevisions` dokumentieren alten und
neuen Termin, Grund, Vorschlagszeit, Ersetzungszeit, persönlich angemeldete
Kundenidentität und den Hash des angezeigten Vorschlags. Die ursprüngliche
Annahme, Unterschrift, Preise und Protokolle bleiben erhalten. Die Freigabe ist
eine explizite persönliche Zustimmung im angemeldeten Kundenpanel; sie wird nicht
als neue handschriftliche Unterschrift bezeichnet. Bestätigte Hol-/Bringart und
Übergabeadresse sowie Arbeitsdauer dürfen in diesem Ablauf nicht verändert werden.
Für diese Inhalte gelten Stornierung und geprüfter Ersatzvorgang.

Nach Fahrzeugannahme, bei gesperrten Akten oder stornierten Originaldokumenten
ist keine rückwirkende Terminverschiebung möglich. Frühere Belege und der
Terminänderungsverlauf bleiben für beide Seiten sichtbar. Der vorhandene
Google-Abgleich arbeitet mit dem neuen Termin-Schnappschuss; ein erfolgreicher
Kalenderabgleich oder Kundennachricht wird nicht allein aus der lokalen Speicherung
abgeleitet.

Zusätzliche geschützte Endpunkte:

- `GET /api/calendar/history?id=…`: Betreiber, Vorher-/Nachher-Schnappschüsse.
- `GET /api/calendar/adjustments?orderId=…`: Betreiber oder exakt zugehöriger Kunde.
- `POST /api/calendar/adjustments`: Betreiber `propose`/`withdraw`; Kunde
  `accept`/`decline`. Gleicher Ursprung, JSON, aktuelle Versionen und bei Annahme
  Hash des angezeigten Vorschlags sind Pflicht. Keine zusätzlichen Kontorechte.
