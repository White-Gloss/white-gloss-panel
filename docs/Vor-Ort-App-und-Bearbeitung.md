# Vor-Ort-App, Kundenstamm und Bearbeitung

Stand: 11. Oktober 2026. Dieser Stand beschreibt den Code. Live verfügbar ist er erst nach einem
eigenen, freigegebenen IONOS-Release mit Live-Nachweis.

## Vor-Ort-App (Web-App für Android)

- Adresse: `https://panel.white-gloss.de/vor-ort`, Anmeldung mit dem bestehenden Betreiberzugang.
- Installation: In Chrome auf dem Android-Handy „App installieren“ wählen. Die App startet dann im
  Vollbild mit eigenem Symbol. Der Google Passwortmanager füllt die Anmeldung per Fingerabdruck aus.
- Sofort-Buchung in vier Schritten: Kunde suchen oder neu anlegen → Fahrzeug wählen oder anlegen →
  Paket, Extras und Zuschlag für Mehraufwand → Unterschrift des Kunden auf dem Handy und Start.
  Kunde, Preis, Unterschrift und Termin „ab sofort“ werden in einer einzigen Datenbanktransaktion
  gespeichert. Danach öffnet sich direkt das Annahmeprotokoll.
- Auftragsansicht mit Anrufen, WhatsApp, Navigation, Annahme- und Rückgabeprotokoll, Zahlung in Euro
  und PDF teilen über das Android-Teilen-Menü.
- Testmodus in der App: synthetische Aufträge mit TEST-Nummern, kein Versand.
- Der Service Worker speichert ausschließlich Programmdateien. Kundendaten, API-Antworten und
  Anmeldeseiten werden nie zwischengespeichert. Buchungen und Unterschriften brauchen Verbindung.

Am Laptop bleibt das Panel (`/`) die vollständige Oberfläche. Beide nutzen dieselben Daten.

## Alles bearbeitbar, keine Pflichtfelder

- Kein Formular verlangt Pflichtangaben. Eingegebene Werte werden weiterhin auf gültige Form geprüft
  (z. B. Kilometerstand, Euro-Beträge, Fotos gehören zum Auftrag).
- Anfrageangaben, Preise, Termin (auch rückwirkend oder „jetzt“, auch entfernen), Protokolle,
  Zahlungen und der Status sind in jedem Schritt änderbar. Der Status lässt sich als Admin direkt
  setzen; Grund und frühere Fassungen bleiben im Verlauf.
- Zahlungen werden in Euro erfasst und können korrigiert oder storniert werden. Die bisherige
  Angabe bleibt in der Zahlung gespeichert. Anzahlungen vor Abschluss sind möglich.
- Weiterhin unverändert: WG-Nummernabgleich vor dem ersten echten Auftrag, Überschneidungsprüfung
  der Termine, Lexware-Rechnung erst nach Abschluss mit ausdrücklicher Prüfung, Versand nur nach
  Freigabe.

## Unterschriebene Dokumente

- Ein vom Kunden unterschriebenes Angebot oder Protokoll wird nie geändert.
- Änderungen entstehen als **Ersatzdokument**. Es ersetzt das unterschriebene Dokument erst, wenn
  der Kunde es unterschreibt:
  - vor Ort auf dem Gerät des Betreibers, oder
  - über einen persönlichen Link `/dokument/…` (Anmeldung mit E-Mail und einmaliger PIN, wie beim
    Angebot). Der Link kann per WhatsApp geteilt oder im IONOS-Panel per E-Mail versendet werden.
- Das Ersatzdokument nennt ausdrücklich, welches Dokument es ersetzt („Ersetzt das am … unterschriebene
  Dokument“). Das PDF, die Versandmail und die Kundenseite zeigen diesen Vermerk.
- Frühere Fassungen bleiben vollständig im Verlauf erhalten. Nicht unterschriebene Dokumente sind
  frei bearbeitbar.
- Ein unterschriebenes Ersatzprotokoll wird mit Kunden-E-Mail und Versandfreigabe erneut als PDF
  versendet. Ohne E-Mail-Adresse wird nichts versendet; das PDF lässt sich teilen.

## Preise und Kundentexte

- Bei jedem Preis steht: „Stellt sich der Aufwand vor Ort als höher heraus, kann sich der Preis nach
  Absprache mit dem Kunden noch ändern.“ (Angebot, Vor-Ort-Annahme, Ersatzangebot, manuelle Anfrage.)
- Die Widerrufsbelehrung wird in den Einstellungen unter „Kundentexte“ eingetragen. Ohne Text wird
  kein Abschnitt angezeigt. Der Wortlaut ist vom Betreiber bzw. rechtlich zu prüfen.
- Bei der Annahme werden Zahlungspflicht, Wunsch nach sofortigem Beginn und Anzeige der
  Widerrufsbelehrung als eigene Bestätigungen gespeichert. Das Häkchen zum sofortigen Beginn ist nie
  vorab gesetzt und lautet: „Ich verlange ausdrücklich, dass White Gloss vor Ablauf der Widerrufsfrist
  mit der Ausführung beginnt. Mir ist bekannt, dass mein Widerrufsrecht bei vollständiger
  Vertragserfüllung erlischt.“ Der bestätigte Wortlaut und der angezeigte Belehrungstext werden mit
  der Annahme gespeichert.
- Der Belehrungstext wird mit seinen Absätzen angezeigt.

## Auftragsbestätigung

Nach jeder Annahme (vor Ort, online oder als unterschriebenes Ersatzangebot) entsteht eine
Auftragsbestätigung als PDF: Betrieb, Kunde, Fahrzeug, Leistungen, Festpreis, Preishinweis, Art und
Zeitpunkt der Annahme, die bestätigten Erklärungen, die Unterschrift sowie Widerrufsbelehrung und
Muster-Widerrufsformular im angezeigten Wortlaut. Mit Kunden-E-Mail und Versandfreigabe wird sie
automatisch versendet (Kopie an die Betreiberadresse). Ohne E-Mail lässt sie sich im Panel und in der
Vor-Ort-App herunterladen oder über „Teilen“ (z. B. WhatsApp) übergeben.

## Kundenstamm

- Kunden und Fahrzeuge (Kennzeichen, Marke, Modell, Farbe, Baujahr, FIN, Fahrzeugklasse) mit Suche
  nach Name, Telefon, E-Mail und Kennzeichen.
- Neue Aufträge werden automatisch einem Kunden zugeordnet (gleiche E-Mail oder Telefonnummer) oder
  legen ihn an. Bestehende Aufträge werden ohne Änderung der Aufträge nachträglich verknüpft.
- **Kunden, Fahrzeuge und Aufträge werden nie gelöscht.** Die Datenbank verweigert das Löschen.
  Änderungen an Kundendaten bleiben im Verlauf.

## Fahrzeugprotokoll

Zusätzlich zu Kennzeichen, Zeit, Ort, Kilometerstand, Schlüsseln, Zustand und Fotos:

- Lackschichtdicke: bis zu 5 Messwerte pro Bauteil in µm, Messgerät, Auswertung (Ø, min, max) mit
  Hinweis auf mögliche Nachlackierung oder dünnen Lack. Richtwert Werkslack etwa 80–180 µm.
- Schäden über eine Fahrzeugskizze (Bereich antippen) mit Art, Größe, Beschreibung und Foto.
- Verschmutzungsgrad innen und außen, Tank- bzw. Ladestand, Checkliste (Wertsachen, Warnleuchten,
  besprochene Vorschäden, Wasser und Strom vor Ort).
- Fotos direkt mit der Kamera; Bilder bis 15 MB werden unverändert gespeichert, größere vor dem
  Hochladen verkleinert.

## Prüfungen

`npm test` baut zuerst den Client und prüft dann Domäne, Server, Laufzeit und Oberfläche. Die
UI-Tests (`tests/ui.test.mjs`) laden die gebauten Seiten in jsdom und leiten jede Anfrage direkt an
die Serverlogik mit einer Datenbank im Speicher weiter. Es wird kein Website-Server gestartet.
Browserprüfungen erfolgen weiterhin ausschließlich am freigegebenen, veröffentlichten Stand.
