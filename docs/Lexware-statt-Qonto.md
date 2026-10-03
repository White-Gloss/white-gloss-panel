# Lexware Office ersetzt Qonto

Betreiberentscheidung vom 3. Oktober 2026: Im eigenen White-Gloss-Panel soll ausschließlich Lexware Office Rechnungen und den lesenden Rechnungs-/Zahlstatus führen.

## Ablauf

1. Kundenanfrage, Begutachtung, bestätigte Leistungen und der Bruttofestpreis bleiben im Panel.
2. Erst nach abgeschlossenem Auftrag und vollständigem Rückgabeprotokoll wird eine Schlussrechnung angeboten.
3. Der Betreiber wählt den passenden vorhandenen Lexware-Kunden oder prüft eine vollständige neue deutsche Rechnungsanschrift. Eine neue Kundenanlage benötigt dieselbe ausdrückliche Rechnungsfreigabe.
4. Die Vorschau zeigt die bestätigten Einzelpositionen, den Bruttofestpreis und die ausdrücklich geprüfte Steuer. Eingabeänderungen nehmen die Freigabe zurück; eine veraltete Auftragsansicht wird abgewiesen.
5. Nach Freigabe legt das Panel genau eine fertige Lexware-Rechnung an. Der API-Ablauf erstellt vorher keinen zweiten Rechnungsentwurf.
6. Original-PDF und Lexware-Rechnungsnummer erscheinen beim Auftrag. Die WG-Nummer bleibt die eigene Auftragsreferenz.
7. Rechnungs-/Zahlungsänderungen aus Lexware werden nach ausdrücklicher Aktivierung über signierte Änderungsmeldungen übernommen. Ein Anbieterstatus ersetzt keinen tatsächlichen Zahlungsnachweis im Panel.

## Einrichtung

Erforderlich ist Lexware Office XL mit Public API. Den Schlüssel ausschließlich geschützt unter Einstellungen → Lexware Office speichern; nicht im Chat, GitHub oder Bericht. Verwaltung: https://app.lexware.de/addons/public-api.

Die lesende Kontoprüfung bestätigt Betrieb, Organisation und Rechnungsfunktion. Vor der ersten echten Rechnung muss der bisherige WG-Buchungs-/Rechnungsbestand weiterhin nachweisbar abgeglichen sein. Ein neuer Lexware-Nummernkreis hebt diese Voraussetzung nicht auf.

Der Änderungsabgleich verwendet den festen HTTPS-Endpunkt https://panel.white-gloss.de/api/lexware/webhook. Eine explizite Betreiberfreigabe im Einstellungsdialog registriert ausschließlich die vorgesehenen Rechnungs-/Zahlungsereignisse. Signatur und Organisation werden geprüft; unbekannte Rechnungen lösen keine beliebigen Anbieterabrufe aus. Zustandsänderungen werden dauerhaft gespeichert und geordnet verarbeitet. Regelmäßiges Abfragen des gesamten Lexware-Bestands ist nicht vorgesehen.

## Erhalt alter Daten

Aktive Qonto-Anmeldungen, API-Aufrufe, Einstellungen und Rechnungserstellung entfallen im neuen Code. Historische Rechnungsreferenzen und alte Auftrags-/Versandjobs bleiben gespeichert. Eine bereits zugeordnete Rechnung oder ein ungeklärter früherer Rechnungsvorgang sperrt die Neuanlage. Alte Qonto-Rechnungen werden nicht als neue Lexware-Rechnungen kopiert.

Bestehende verschlüsselte Altzugänge in einer vorhandenen Datenbank werden nicht ausgegeben oder benutzt. Diese Codeumstellung kündigt kein Qonto-Konto und ändert keine Bankverbindung.

## Besonderheiten und Fehlerbehandlung

Lexware vergibt die Rechnungsnummer selbst. Ein per API erstellter Entwurf verbraucht bereits eine Nummer; ein zweiter POST würde eine weitere Rechnung erzeugen. Daher lokale Vorschau und nach persönlicher Prüfung genau eine Erstellung mit finalize=true.

Keine automatische Wiederholung einer Kunden-/Rechnungsanlage nach Timeout, fehlender Ergebnis-ID oder HTTP 504. Ein dauerhafter Vorgang speichert Anbieter, Organisation, Kunde, Referenz und geprüfte Rechnungsdaten. Der lesende Abgleich prüft Anbieter-ID, Referenz, Betrieb, Kunde, Währung, Steuern, Einzelpositionen und Bruttosumme. Abweichungen bleiben sichtbar gesperrt.

Die API-Aufrufe sind auf höchstens zwei pro Sekunde begrenzt; Schlüssel werden nicht über Weiterleitungen gesendet. PDF und JSON besitzen Größenbegrenzungen. PDF-Abruf ist privat und nur im Betreiberzugang verfügbar. Der aktuelle geprüfte Ablauf ist auf deutsche Standardrechnungen begrenzt. XRechnung-Vorschau-PDFs werden nicht als echte E-Rechnung versendet.

TEST-Aufträge senden keine Kunden-/Rechnungsanlage an Lexware. Diese Umstellung versendet keine Rechnungsmail automatisch; sie erhält den bisherigen Rechnungsumfang. Die getrennte automatische PDF-Mail nach unterschriebener Annahme/Rückgabe bleibt bestehen.

## Veröffentlichung und Nachweise

Implementierung, lokale serverlose Tests, GitHub-CI, IONOS-Aktivierung und tatsächliche Kontoprüfung werden separat bestätigt. Ein Build oder hochgeladenes Archiv ist noch keine aktive Verbindung. Der bisherige Live-Release bleibt bis zum nachgewiesenen eigenen Panel-Update maßgeblich.

Die Hauptwebsite, deren Buchungssystem und vorhandene Dokumente werden nicht geändert. Kein lokaler White-Gloss-Server wird gestartet.

## Offizielle Quellen

- [Lexware Office Public API und XL-Voraussetzung](https://www.lexware.de/funktionen/public-api/)
- [Kontoprüfung, Kontakte, Rechnungen, PDF, Zahlungsstatus und Signaturen](https://developers.lexware.io/docs/)
- [Rechnungsnummern und Rechnungsstatus](https://developers.lexware.io/cookbooks/invoices/)
- [API-Schlüssel und ereignisbasierter Änderungsabgleich](https://developers.lexware.io/cookbooks/public-api/)

