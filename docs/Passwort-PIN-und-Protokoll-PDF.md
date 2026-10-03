# Betreiberzugang, Kunden-PIN und unterschriebene Protokolle

Der IONOS-Betreiberzugang verwendet E-Mail und Passwort. Das erste Passwort
und ein vergessenes Passwort werden erst nach einem persönlichen E-Mail-Link
festgelegt. Die Bestätigung muss höchstens zehn Minuten alt sein. Änderungen
benötigen das bisherige Passwort oder eine frische E-Mail-Bestätigung. Alle
anderen Betreiber-Sitzungen und noch offenen Betreiber-Links werden dabei
ungültig. Das persönliche Passwort gibt ausschließlich der Betreiber ein.

Passwörter haben 15 bis 128 Zeichen. Gespeichert werden ausschließlich ein
zufälliges 32-Byte-Salt und ein scrypt-Ergebnis mit N=131072, r=8, p=1. Pro
Prozess sind höchstens zwei Hash-Berechnungen gleichzeitig möglich. Login-
und Änderungsversuche sind pro E-Mail und IP dauerhaft in SQLite begrenzt.
Die Konfiguration und `/api/state` enthalten keine Passwortwerte.

Kunden erhalten ihren persönlichen Link und eine sechsstellige einmalige
PIN in derselben E-Mail. In der ersten Angebotsmail gilt der Zugang bis zu
24 Stunden und höchstens bis zum Angebotsende. Ein neu angeforderter Zugang
gilt zehn Minuten. Fünf falsche PINs sperren diesen Link. Ein Link kann nur
einmal verwendet werden. Die PIN steht niemals in der URL und wird nur als
HMAC mit dem geschützten Konfigurationsschlüssel gespeichert. Das ist eine
zusätzliche Eingabebestätigung im selben E-Mail-Kanal, keine zweite
Authentifizierungsquelle. Kunden erhalten keinen Betreiberzugang.

Die Betriebsdaten stammen aus dem am 3. Oktober 2026 geprüften Impressum:
White Gloss Detailing, Lars Hägele, Arnistal 27, 72160 Horb am Neckar,
0152 33540284, info@white-gloss.de. Sie gehören zum angezeigten und durch
beide Unterschriften bestätigten Protokoll; bestätigte Protokolle werden
nicht nachträglich auf neue Stammdaten umgeschrieben.

Annahme und Rückgabe speichern das bestätigte Protokoll und genau einen
Versandauftrag gemeinsam in einer Datenbanktransaktion. Nach dem Speichern
werden PDF und Versand unmittelbar ausgeführt. Der Kunde erhält das PDF
im Anhang mit CC an die bestätigte Betreiberadresse. Das PDF enthält
Betriebsdaten, Übergabeangaben, Fahrzeugzustand, gegebenenfalls ausgeführte
Leistungen/offene Punkte, beide Unterschriften, Zustandsfotos und den
Protokollnachweis. Originalfotos bleiben unverändert privat gespeichert.
Große Bilder und WebP erhalten zusätzlich eine PDF-Vorschau; auch deren
IDs gehören zum unterschriebenen Protokoll. PDF-Downloads sind nur dem
Betreiber zugänglich. Die vorhandene Datensicherung umfasst auch PDF-Dateien.

Ein Fehler vor der Anbieteranfrage bleibt als ausstehender Versand sichtbar
und kann im unabhängigen IONOS-Hintergrundlauf erneut ausgeführt werden.
Ein ungeklärtes Ergebnis nach der Anbieteranfrage bleibt gesperrt und wird
nie automatisch erneut versendet. Eine Resend-ID bestätigt die Annahme
durch den Anbieter; sie beweist allein keinen Posteingang beim Empfänger.
Tests verwenden nur isolierte Daten und einen simulierten E-Mail-Anbieter.
Testprotokolle lösen keine Kundenmails aus und erhalten eine sichtbare
TEST-Markierung im PDF.

Die PDF-Bibliothek wird beim Build für Node 22 paketiert. Auf IONOS sind
keine zusätzlichen Laufzeitpakete und kein neuer Port erforderlich. Die
Sites-Kopie verwendet weiter ihren eigenen geschützten Sites-Zugang; die
Passwort-/PIN-/PDF-Funktionen gehören zur separaten IONOS-Laufzeit.

Quellen:

- [White Gloss Impressum](https://white-gloss.de/impressum)
- [OWASP Passwortspeicherung](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [PDF-LIB](https://pdf-lib.js.org/)
- [Resend E-Mail-API und Anhänge](https://resend.com/docs/api-reference/emails/send-email)
- [Noto Sans Regular](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf), OFL-Lizenz in `assets/fonts/OFL.txt`.
