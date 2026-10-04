# Terminwahl und Bestätigung

Bei neuen Angeboten gibt der Betreiber einen bis drei Termine mit Beginn, Dauer,
Übergabe und Ort vor. Die Vorschläge reservieren noch keinen Zeitraum. Preise,
Leistungen und Termine werden gespeichert, bevor der Angebotslink versendet wird.
Abholung wird aus belegten Buchungsdaten übernommen; bei unklaren Angaben muss der
Betreiber die Übergabe bewusst auswählen.

Der Kunde öffnet seinen persönlichen Angebotslink und meldet sich mit seiner PIN
an. Er wählt einen angebotenen Termin und unterschreibt Leistungen, Gesamtfestpreis
und diesen Termin zusammen. Wechselt er den Termin, wird die Unterschrift samt
Bestätigungsfeld zurückgesetzt. Eine bereits unterschriebene Vereinbarung kann der
Betreiber nicht mit dem früheren Formular zur Terminplanung überschreiben.

Der Server prüft Kundenzugang, aktuelle Angebotsversion, gewählten Vorschlag,
Unterschrift, zukünftigen Zeitraum und Verfügbarkeit. Auftrag, belegter Zeitraum,
Protokolleintrag und Bestätigungsmail werden gemeinsam gespeichert. Bei zwei
gleichzeitigen Annahmen überschneidender Termine wird nur eine gespeichert.
Bereits vorhandene Angebote ohne Terminwahl behalten ihren bisherigen Ablauf.

Nach erfolgreicher gemeinsamer Annahme wird die Terminbestätigung sofort über den
bisherigen geprüften und freigegebenen Resend-Zugang angefordert. Sie enthält den
unterschriebenen Termin, Übergabe, Ort, Leistungen und Preis. Eine Kopie geht an
die bestätigte Betreiberadresse. Der Versand benutzt einen dauerhaften Auftrag
und einen festen Idempotenzschlüssel. Wiederholte Annahmen erzeugen keine zweite
Mail. Ein ungeklärtes Anbieterergebnis wird nicht automatisch erneut versendet.
Eine vor Versand stornierte Vereinbarung erhält keine ausstehende Bestätigung.
Der bestehende Wartungslauf übernimmt noch nicht begonnene Versandaufträge.

Synthetische TEST-Aufträge versenden weiterhin keine E-Mails und erzeugen keine
externen Kalendertermine. Prüfungen von Auswahl, Unterschrift, Parallelannahme,
Storno und Versand arbeiten mit isolierten Daten und Anbieterattrappen ohne
lokalen Website-Server.

## Bewusster Transporttest auf IONOS

Der geschützte Linux-Administratorbefehl `send-appointment-test <32-stellige Hex-ID>`
prüft ausschließlich den echten Versand an die feste bestätigte Betreiberadresse.
Er nutzt denselben Mailrenderer und den vorhandenen geprüften Sender. Betreff und
Text kennzeichnen alle Inhalte deutlich als fiktiven TEST. Er legt keinen Auftrag,
Kalendertermin, Kundenzugang oder echte Unterschrift an. Eine vor Versand angelegte
rootgeschützte Quittung verhindert die Wiederholung derselben Test-ID. Bei einem
ungeklärten Ergebnis zuerst den Anbieterbestand prüfen, keine neue Test-ID zum
erneuten Senden verwenden.

Ein tatsächlicher Postfacheingang dieses Tests belegt den Betreiber-Transportweg.
Er ersetzt keinen Nachweis einer echten Kundenannahme oder der Zustellung an ein
anderes Kundenpostfach. Veröffentlichung und Live-Nachweise werden separat im
Prüfbericht festgehalten. Lexware bleibt von diesem Release ausgeschlossen.
