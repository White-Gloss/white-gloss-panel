# Manueller WhatsApp-Testversand

Der Betreiber kann in Einstellungen → WhatsApp nach einer erfolgreichen
Verbindungsprüfung eine einzelne Nachricht der festen Meta-Testvorlage
`hello_world` (`en_US`) vorbereiten. Vor dem Senden zeigt das Panel die konfigurierte
Absendernummer und Phone Number ID. Der Betreiber trägt seine eigene Testnummer
im internationalen Format ein und bestätigt den einmaligen Versand ausdrücklich.
Bei Metas Testnummer muss der Empfänger zuvor in Meta freigeschaltet sein.

Der Testbereich sendet keine echten Nachrichten. Kunden und Steuerberater können
den Endpunkt nicht verwenden. Es werden keine Aufträge oder Kunden angelegt und
keine automatischen Antworten, Seriennachrichten oder Buchungsnachrichten ausgelöst.

## Versandnachweis

`POST /api/whatsapp/test-send` benötigt eine Betreiber-Sitzung, denselben Ursprung,
JSON, eine eindeutige UUID, die aktuelle geprüfte Phone Number ID, eine internationale
Empfängernummer und `confirmed: true`. Vorlage, Sprache und Meta-Endpunkt sind fest.

Eine Datenbankreservierung schützt vor Doppelklicks, parallelen Anforderungen,
Neustarts und unklaren Providerantworten. Zwischen neuen Versuchen liegen mindestens
60 Sekunden. Derselbe Request wird niemals erneut an Meta gesendet. Ist seine
Annahme bereits gespeichert, liefert eine Wiederholung nur dieses vorhandene
Ergebnis. Ein ausstehender oder unklarer Versuch bleibt gesperrt.

Das Versandprotokoll enthält einen HMAC-Fingerprint, die Absender-ID, Zeitpunkte,
den Status und gegebenenfalls Metas Nachrichten-ID. Es speichert weder den
Zugangsschlüssel noch die Empfängernummer im Klartext. Eine erfolgreiche
API-Antwort bedeutet **von Meta angenommen**, nicht **zugestellt**. Der Empfang
muss separat auf dem Zielgerät geprüft werden. Bei unklarem Ausgang nicht erneut
senden, bevor der tatsächliche Empfang geprüft wurde.

Eine laufende Verbindungsprüfung kann inzwischen geänderte Zugangsdaten nicht
nachträglich als geprüft markieren oder mit einem alten Fehler überschreiben.
Ein fehlgeschlagener Verbindungstest entfernt die alte grüne Anzeige im Panel.

## Grenze dieser Änderung

Die Funktion liefert den realen Versand aus dem Panel für einen Meta-Testnachweis.
Sie erteilt keine Meta-Berechtigungen und ersetzt weder App Review noch eine
abgeschlossene Registrierung der geschäftlichen Telefonnummer. Ein temporärer
Meta-Testzugang bleibt zeitlich begrenzt. Die parallele Nutzung der Business-App
(Coexistence), ihre Historien-/Kontakt-Synchronisierung und ausgehende
Business-App-Echos sind damit noch nicht vollständig implementiert.

Für Review-Aufnahmen nur eigens freigegebene Testnummern verwenden, Geheimnisse
ausblenden und keine Kundenverläufe zeigen. Reviewer benötigen einen getrennten
Zugang ohne produktive Kunden- und Finanzdaten; das normale Betreiberkonto ist
dafür nicht geeignet.
