# Panel-Assistent und Aufgaben

Die Erweiterung verwendet die vorhandene persönliche Betreiberanmeldung und dieselbe
private SQLite-Datenbank. Kundenkonten, gefälschte Identitätsheader und Anfragen von
fremden Ursprüngen erhalten keinen Zugriff auf die Betreiberwerkzeuge.

## Bedienung

- **Assistent** ist über die schwebende Schaltfläche auf jeder Betreiberansicht
  erreichbar. Der Chat bleibt ausschließlich im Arbeitsspeicher des geöffneten
  Browsers und wird bei Neuladen, Leeren oder Wechsel des Testbereichs verworfen.
- Lokal möglich: `Übersicht`, `offene Aufgaben`, `überfällige Aufgaben`, `Suche Name`
  sowie Auswahl einer konkreten Kundenakte, eines Projekts oder einer Aufgabe.
  Fehlende Belege werden ausdrücklich benannt. Eine lokale Textbearbeitung korrigiert
  Abstände und Zeichensetzung und ist entsprechend gekennzeichnet.
- Freie Fragen und sprachliche Textüberarbeitung benötigen den optionalen Anbieter
  unter **Einstellungen**. Er bleibt ohne Einrichtung deaktiviert. Jede Übertragung
  benötigt zusätzlich das Häkchen im Chat. Übertragen werden nur die konkrete
  Eingabe und genau die ausgewählte Akte. Keine weitere Akte, Signatur, Bilddatei,
  Zugangstoken oder rohen Website-Daten. Gesperrte und anonymisierte Akten stehen
  nicht als KI-Kontext zur Verfügung. KI-Antworten bleiben gekennzeichnete Entwürfe
  und haben keinerlei Schreibwerkzeuge. Ein eingerichteter Zugang und erfolgreiches
  Anbieterergebnis müssen im Betrieb separat geprüft werden.
- **Kunde anlegen** kann vor oder nach kopierten Kontaktdaten stehen. Am eindeutigsten
  sind `Name:`, `E-Mail:`, `Telefon:`, `Adresse:` und `Notiz:`. Nur der Name ist Pflicht,
  vorhandene E-Mail und Telefonnummer werden auf Plausibilität geprüft. Speichern
  erfolgt bei eindeutigen Angaben unmittelbar. Widersprüche erzeugen eine gezielte
  Rückfrage. Eindeutig vorhandene Daten öffnen/bestätigen die unveränderte Akte.
  Bei identischem Namen und abweichenden Kontaktdaten ist eine konkrete
  `Abgrenzung: ...` möglich und wird protokolliert. Gesperrte Identitäten können
  auf diesem Weg nicht umgangen werden, auch nach Stammdatenanonymisierung.
- **Aufgabe anlegen: Material prüfen** erstellt direkt eine Aufgabe. Optional folgen
  `Fällig: 2026-10-12`, `Priorität: hoch` und `Notiz: ...`. Vorhandene offene Aufgaben
  gleichen Inhalts werden bestätigt. Präzise Aufträge mit einer echten Aufgaben-ID
  erlauben `Aufgabe erledigen: ID`, `Aufgabe wieder öffnen: ID` und
  `Aufgabe löschen: ID`. Alle Aktionen bleiben auf den aktiven Datenbereich begrenzt.
- Die **Aufgaben-Spalte** bietet Anlegen, Bearbeiten, Erledigen, Wiederöffnen und
  Löschen, getrennte Ansichten für offene, überfällige und erledigte Aufgaben sowie
  optionale Verknüpfungen zu Kunde, Fahrzeug, Projekt und privatem Kalendereintrag.
  Fälligkeiten sind Kalendertage in `Europe/Berlin`. Das Löschen einer Aufgabe wird
  konkret bestätigt und verändert keine verknüpften Stammdaten oder Kundenzusagen.

## Speicherung und Schutz

`customer_create_requests` und `task_requests` halten Wiederholungskennungen
dauerhaft fest. Kundenidentitäten sowie ein Index offener Aufgaben schützen zusätzlich
vor gleichzeitigen Doppelanlagen. Eine verlorene HTTP-Antwort ist kein Anlass zur
erneuten Ausführung. Eine geänderte Eingabe benötigt eine neue Kennung.
Aufgaben verwenden Versionskontrolle; veraltete Änderungen erhalten HTTP 409.

`file_audit` dokumentiert die Kundenanlage einschließlich einer Abgrenzung.
`task_audit` enthält Zeitpunkt, Akteur und Vorher-/Nachher-Zustand aller Aufgabenaktionen.
Gelöschte Aufgaben verlassen die Bedienansicht, ihr Änderungsnachweis bleibt erhalten.
Beim Löschen eines privaten Kalendereintrags entfernt ein atomarer Datenbanktrigger
die Referenz, erhöht die Aufgabenversion und ergänzt den Auditnachweis. Die Aufgabe
bleibt bestehen; ein zuvor geöffnetes Formular muss neu geladen werden.

Keine Assistentenaktion bestätigt Angebote, unterschreibt Protokolle, verbucht
Zahlungen, versendet Kundenmails oder verändert einen verbindlichen Kundentermin.
Diese Schritte verwenden weiterhin ihre vorhandenen geschützten Bedienabläufe.

## Prüfung und Grenzen

`node --test tests/assistant-tasks.test.mjs` prüft synthetische SQLite-Daten und echte
`App.fetch`-Aufrufe ohne Website-Server: Sitzungsrechte, Ursprung, Testdatentrennung,
Kundenparser, Pflichtfelder, Dubletten und Homonyme, anonymisierte Sperridentitäten,
Konkurrenz/Wiederholung, Aufgabenänderungen, Kalenderreferenzen, Audit und
unbelegte Antworten. Die Anbieterprüfung hat eigene gemockte Tests.

Diese lokalen Prüfungen sind kein Veröffentlichungs- oder Live-Nachweis. Vor einer
Betriebsfreigabe sind der vorgesehene IONOS-Release und der veröffentlichte
Desktop-/Mobilablauf einschließlich tatsächlich eingerichteter KI separat zu prüfen.
Es wurden für diese Tests weder echte Kundendaten noch echte Nachrichten verwendet.
