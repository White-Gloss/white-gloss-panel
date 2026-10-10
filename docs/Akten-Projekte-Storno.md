# Kundenakten, Projektkorrekturen und Dokumentstorno

Stand der Implementierung: 9. Oktober 2026. Veröffentlichung und Live-Prüfung
werden separat nachgewiesen. Diese Dokumentation behauptet keinen Release.

## Kunden anlegen, sperren und löschen

Die Kundenansicht bietet eine Akte ohne Auftrags-, Fahrzeug-, Preis- oder
Terminpflicht. Das Formular und der Panel-Assistent verwenden dieselbe
Speicherprimitive, Dublettenprüfung und dauerhafte Wiederholungskennung.
Speicherung wird erst nach bestätigtem Datenbankergebnis gemeldet.

In einer Kundenakte öffnet „Kundenakte löschen, sperren oder Stammdaten
anonymisieren“ zunächst eine Vorschau. Sie nennt konkrete Fahrzeuge, WG-Aufträge
und Dokumente sowie Anzahl der Dateien, Nachrichten, Aufgaben und
Kalenderverknüpfungen. Versionen und Verknüpfungen werden vor und innerhalb der
Transaktion erneut geprüft. Eine inzwischen geänderte Vorschau ist unbrauchbar.
Dabei werden konkrete IDs, Versionen und Zuordnungen von Aufgaben und Terminen
verglichen; gleichbleibende Anzahlen allein gelten nicht als Nachweis. Laufender
oder ungeklärter Versand wird mit WG-Nummer und Versandart angezeigt und muss vor
Sperrung, Anonymisierung oder Storno geklärt werden. Noch nicht gestartete
Versandaufträge werden mit der Sperre atomar abgebrochen.
Aufbewahrte Terminvorschläge und kundenbestätigte Terminänderungen werden als
eigene Belege mit ihrem Zustand aufgeführt. Neue Aufträge und Sperrungen prüfen
einander innerhalb der Schreibtransaktion. Eine parallel neu eingegangene Anfrage
erzwingt eine neue Vorschau; eine bereits gespeicherte Sperre verhindert die neue
Anlage. Kunden-/Fahrzeugzuordnungen erhöhen die Auftragsversion; eine veraltete
Zuordnung oder Stammdatenänderung kann keine parallele Sperre umgehen.

- **Endgültig löschen** ist für eine eigenständige Akte ohne verknüpfte Aufträge,
  Aufgaben oder Kalendereinträge möglich. Ihre Fahrzeugstammdaten werden ebenfalls
  entfernt. Änderungsbelege enthalten danach keine vorherigen Kontaktfelder.
- **Sperren** bewahrt den Originalbestand. Neue operative Schritte,
  Kundenkommunikation und Finanzaktionen werden verhindert. Archivansicht,
  Originaldownload und begründete interne Nachweise bleiben möglich. Eine
  aufgehobene Sperre braucht einen dokumentierten Grund; eine Anonymisierung
  lässt sich nicht auf diesem Weg zurücknehmen.
- **Stammdaten anonymisieren** entfernt Name, Adresse, Telefon, E-Mail und freie
  Hinweise aus den Kunden- und Fahrzeugstammdaten und redigiert alte
  Stammdaten-Audits. Verknüpfte Originalanfragen, signierte Dokumente,
  Änderungsnachweise und erforderliche Belege werden gesperrt aufbewahrt.
  Dies ist ausdrücklich **keine vollständige Anonymisierung des Bestands**.
  Gehashte Kontaktmerkmale verhindern ein unbemerktes Wiederanlegen oder
  Importieren derselben gesperrten Identität. Der geschützte Datenbestand und
  bestehende Sicherungen können weiterhin personenbezogene Originale enthalten.

Die Löschvorschau nennt den Aufbewahrungsgrund. Eine pauschale Frist für alle
Kunden oder alle Unterschriften wird nicht gesetzt. Verknüpfte Originalbestände
werden nicht automatisch nach einem errechneten Jahrestag gelöscht: Dokumentart,
relevanter Fristbeginn, offene Steuerverfahren und offene Ansprüche müssen im
Einzelfall geklärt sein. Eine erweiterte Freigabe zur vollständigen Archivlöschung
ist hier nicht implementiert.

Die Sicherung bleibt Teil des vorhandenen Betriebskonzepts. Es erfolgt keine
unkontrollierte Einzeländerung historischer Backups. Bei Wiederherstellung sind
Sperr-/Löschvermerke aus dem aktuellen Änderungsnachweis erneut anzuwenden.

## Projektangaben und Arbeitsschritte

„Projektangaben und Arbeitsschritte bearbeiten“ ist in jeder Phase verfügbar,
auch bei abgeschlossenen und bezahlten Vorgängen. Aktuelle interne Angaben
stehen in `order.projectDetails`; ursprüngliche Anfrage, Versandempfänger und
unterschriebene Inhalte bleiben identisch. Interne Arbeitsschritte besitzen IDs,
Bezeichnung, Notiz und Erledigungsstand. Schritte können ergänzt, korrigiert,
entfernt und wieder geöffnet werden. Jede Speicherung benötigt einen Grund und
speichert vorherigen und neuen Inhalt mit Zeitpunkt, Benutzer und Version.

Die Bearbeitung verändert weder Prozessstatus noch Preis, Kundenannahme,
Zahlung, Termin oder signierten Arbeitsabschluss. Preisprüfung und zusätzliche
beauftragte Leistungen verwenden weiterhin die bestehenden Preis- und
Nachtragsabläufe. Die Oberfläche benennt diese Abgrenzung ausdrücklich.
Die zusätzliche Datenschutzsperre gilt unabhängig von der Projektphase:
Projektstammdaten einer gesperrten oder anonymisierten Akte werden nicht erneut
befüllt; begründete interne Aktennotizen bleiben möglich.

## Unveränderliche Dokumente und Ersatz

Der vorhandene tatsächliche Ablauf verbindet bei neuen Angeboten Preis,
Leistungen und gewählten Termin in einer gemeinsamen Kundenunterschrift.
Eine bestätigte Abholung ist Teil dieser Vereinbarung. Ein angenommener Nachtrag
enthält eine eigene Kundenunterschrift und wirkt auf den vereinbarten Gesamtpreis.
Annahme und Rückgabe benötigen weiterhin Zustandsfoto, beide persönlichen
Unterschriften und bei Rückgabe bestätigten Arbeitsabschluss.
Der zusätzlich im Produktionszweig vorhandene Ablauf für abwesende Kunden
(`docs/Fahrzeuguebergabeprotokoll.md`) wurde ebenfalls geprüft: Bereits die
bereitgestellte Betriebsunterschrift fixiert die Fassung. Solche offenen
`handovers` werden in der Vorschau als Dokumente aufgeführt. Ein Storno bewahrt
die Fassung und widerruft die zugehörigen Handover-Tokens; der Betreiber kann
keine persönliche Kundenbestätigung ersetzen.

Die neue Aktion speichert einen **zusätzlichen Stornovermerk** mit Grund,
Zeitpunkt, Benutzer, ursprünglicher Version und Inhaltshash. Der Originalinhalt
wird niemals überschrieben oder aus dem Archiv entfernt.

- Vor Arbeitsbeginn kann ein angenommenes Angebot, bestätigter Holservice oder
  angenommener Nachtrag nur durch Storno der gesamten Vereinbarung aufgehoben
  werden. Der vorhandene Stornoübergang wird verwendet, der belegte Termin
  freigegeben, Angebotslinks widerrufen und noch ausstehender Versand gesperrt.
  Es wird keine Stornogebühr berechnet und keine Nachricht versendet.
- Nach Arbeitsbeginn bzw. Rechnung oder Zahlung kann dieser Weg keine
  abgewickelte Vereinbarung finanziell rückabwickeln. Die Oberfläche nennt den
  Grund; eine passende Abrechnungskorrektur muss im vorhandenen Rechnungsweg
  vorgenommen werden. Insbesondere werden Zahlungen nicht entfernt.
- Ein signiertes Protokoll kann einen Stornovermerk erhalten. Der ursprüngliche
  Prozess- und Zahlungsstand bleibt erhalten und operative Folgeschritte werden
  gesperrt. Das Original-PDF bleibt ein Archivbeleg; der Storno ist getrennt im
  Panel und Kundenportal erkennbar.
- Ein Ersatz erzeugt einen neuen verknüpften Entwurf mit eigener WG-Nummer.
  Er kopiert Kontakt-/Fahrzeugangaben, aber keine Preise, Kundenfreigaben,
  Unterschriften, Termine oder Zahlungen. Eine nötige neue Unterschrift wird im
  vorhandenen persönlichen Freigabeablauf eingeholt. Wiederholtes Anlegen
  liefert denselben Ersatzvorgang zurück.

Die dokumentierte Kundenabstimmung bleibt nach diesem Stornovorgang offen.
Ein interner Storno wird nicht als zugestellte Kundennachricht dargestellt.

## Sicherheit und Nachweise

`server/records-lifecycle.mjs` enthält den Owner-geschützten Endpunkt
`/api/records-lifecycle`. Schreibzugriffe prüfen Herkunft, JSON, Eingabegrenzen,
Version und konkrete Bestätigung bei Löschung/Storno. Änderungen und Audit
liegen atomar in derselben SQLite-Transaktion. Ein verlorener Versionsvergleich
führt zum Rollback aller zugehörigen Änderungen.

`tests/records-lifecycle.test.mjs` prüft ausschließlich fiktive Daten in einer
SQLite-Datenbank im Arbeitsspeicher: konkrete Löschvorschau, Stammdatenreduktion,
Berechtigungen, Herkunft, unveränderliche bezahlte Projekte und Signaturen,
Storno, neuer Ersatzentwurf und konkurrierende Speicherung. Es wird kein Server
gestartet und es werden keine Anbieter angesprochen.

## Geprüfte Primärquellen

Am 9. Oktober 2026 direkt gelesen:

- [§ 147 AO](https://www.gesetze-im-internet.de/ao_1977/__147.html): differenzierte
  Dokumentarten und Aufbewahrungsfristen, Fristbeginn am Jahresende und mögliche
  steuerliche Verlängerung. Kein pauschaler Löschtermin je Kunde.
- [§ 14b UStG](https://www.gesetze-im-internet.de/ustg_1980/__14b.html):
  Rechnungskopien grundsätzlich acht Jahre ab Jahresende; die AO bleibt relevant.
- [DSGVO, Art. 17 und 18](https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX%3A32016R0679):
  Löschung, Ausnahmen bei gesetzlicher Pflicht und Rechtsansprüchen sowie
  Einschränkung der Verarbeitung. Die technische Sperre bestätigt keine
  individuelle rechtliche Bewertung des gesamten Kundenbestands.
