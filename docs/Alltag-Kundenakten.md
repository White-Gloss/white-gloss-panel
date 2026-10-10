# Alltag, Nachträge und direkte Fahrzeugübergabe

Diese Erweiterung verwendet ausschließlich den bestehenden Panelbestand. RO App,
Bitrix und Lexware werden nicht eingebunden. Veröffentlichung erfolgt auf dem
Produktionszweig `feat/angebot-terminwahl` über den vorhandenen Panel-Installer.

## Bedienung

- **Heute erledigen** priorisiert Versandprobleme, fällige Wiedervorlagen,
  heutige/überfällige Annahmen und Rückgaben. Preisprüfungen, offene
  Kundenunterschriften und Nachträge bleiben sichtbar. Wiedervorlagen können im
  Auftrag als erledigt dokumentiert werden.
- **Nachträge** im Auftrag enthalten zusätzliche Leistungen, Grund, Bruttopreis
  und zusätzliche Arbeitszeit. Der Originalpreis und die Originalunterschrift
  bleiben unverändert. Der Betreiber kann einen offenen Nachtrag per E-Mail
  versenden oder zurückziehen. Der Kunde erhält Link und einmalige PIN zusammen,
  sieht bisherigen Preis, Zusatzpreis und neuen Gesamtpreis und unterschreibt
  selbst. Erst diese Freigabe zählt bei Zahlung und Rechnung mit. Termine werden
  dadurch nicht verschoben. Offene Nachträge blockieren den Arbeitsabschluss bis
  zur Freigabe, Rücknahme oder Ablauf. Ein bereits unterschriebener Nachtrag kann
  nicht gelöscht oder überschrieben werden.
- **Kunden** bündelt alle vorhandenen Aufträge, auch außerhalb der bisherigen
  300-Aufträge-Startansicht. Dieselbe E-Mail bildet eine Kundenakte; ohne E-Mail
  bleiben Aufträge getrennt. Fahrzeuge werden nur mit dokumentiertem Kennzeichen
  automatisch zusammengefasst. Der Betreiber kann eine Zuordnung ausdrücklich
  korrigieren. Kontakt- und Fahrzeugstammdaten ändern keine Originalanfragen,
  bestehenden Versandempfänger oder unterschriebenen Dokumente. Produkte,
  Beschichtungen und Pflegehinweise werden beim betreffenden Auftrag ergänzt.
  Vorher-/Nachher-Fotos und Zustandsbeschreibungen stammen aus den Protokollen.
- **Annahme direkt starten / Rückgabe direkt starten** unter Übersicht und
  Fahrzeugprotokolle verwendet einen vorhandenen Auftrag oder legt Kunde und
  Fahrzeug ohne Paket-, Preis- oder Terminpflicht an. Auch eine einzelne Rückgabe
  ohne digitales Annahmeprotokoll ist möglich. Der Anlass wird im signierten
  Protokoll und PDF vermerkt. Zustandsfoto, beide persönlichen Unterschriften und
  ausdrücklicher Arbeitsabschluss bei Rückgabe bleiben Pflicht. PDF-Versand an
  Kunden mit Betreiberkopie nutzt dieselbe dauerhafte Versandwarteschlange.
  Ohne bestätigte Preisvereinbarung bleiben Rechnung und Zahlung gesperrt.
- **Einstellungen → Handy-Benachrichtigungen** verbindet jedes Gerät separat nach
  Browserfreigabe. Auf iPhone/iPad aus der Home-Bildschirm-App aktivieren. Ein
  eigener Testknopf fordert eine Meldung an; nur die sichtbare Meldung am Gerät
  bestätigt Empfang. Geräte können einzeln widerrufen werden. Meldungen enthalten
  keine Kundennamen oder Fotos, sondern einen geschützten Link zum Auftrag.

## Betrieb und Sicherheit

Die neuen Tabellen liegen in derselben privaten SQLite-Datei und sind Bestandteil
der bestehenden Sicherung. Aktenänderungen besitzen Versionskontrolle und Audit.
Auftragsdokumente bleiben unverändert. Nachtragslinks benutzen die bestehende
persönliche Kundenanmeldung und sind sieben Tage gültig; eine PIN gilt höchstens
24 Stunden und kann einmal eingelöst werden. Fremde Konten und Betreiber können
keine Kundenfreigabe unterschreiben.

Push verwendet die offizielle Bibliothek
[web-push](https://github.com/web-push-libs/web-push), verschlüsselte
Geräteabonnements und einen verschlüsselten privaten VAPID-Schlüssel. Nur die
Push-Dienste von Google, Mozilla und Apple sind zugelassen. Ereignisse und
Zustellungen sind dedupliziert; abgelaufene Geräte werden entfernt. Der Timer
prüft Push jede Minute, bestehende Anbieterläufe weiterhin ungefähr alle 15
Minuten. Neue Website-Anfragen erscheinen nach dem vorhandenen Importlauf.
Der Service Worker speichert keine Kundendaten oder HTTP-Antworten zwischen.

## Prüfung

`npm test` enthält isolierte App.fetch-/SQLite-Prüfungen zu Nachtragsfreigabe,
Konkurrenz und Idempotenz, direkten signierten Protokollen inklusive PDF und
gemocktem Mailversand, Kundenakten, Zahlungsbeträgen sowie Push-Schutz und
Zustellwiederholungen. Keine echten Kunden oder Nachrichten werden verwendet.

`scripts/ui-smoke.mjs` ist ausdrücklich auf Linux-GitHub-Actions beschränkt.
Chromium erhält alle Seiten über App.fetch-Routen mit synthetischer SQLite im
Arbeitsspeicher; es wird auch dort kein Website-Server gestartet. Der Ablauf
prüft Desktop/Mobil, direkte Annahme und Rückgabe mit zwei Zeichnungen,
Kundenhistorie, Pflegeeintrag und Nachtragsformular und erzeugt Screenshots.
Lokales Hosting bleibt verboten.
