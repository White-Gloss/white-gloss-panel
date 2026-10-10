# Acht Erweiterungen des bestehenden White-Gloss-Panels

## Ausgangspunkt und Geltungsbereich

Die gezielte Bestandsprüfung vom 10. Oktober 2026 fand Kundenakten, Fahrzeuge,
Preisprüfung, persönliche Angebotsannahme, bestätigte Termine, Nachträge,
Fahrzeugprotokolle, Kunden-PIN, Portalnachrichten und einen optionalen
OpenAI-Zugang bereits vor. Diese Abläufe und derselbe Datenbestand werden erweitert.

Basis ist `3791e761bfc1978f31185694aeb17d4116fc46e5` auf
`feat/panel-assistent-aufgaben`. Vier öffentlich ausgelieferte Paneldateien
stimmten mit dieser Basis überein. `main` enthält einen abweichenden, älteren
Lexware-Entwurf und wurde nicht als Betriebsbasis verwendet. Die neue Arbeit
liegt auf `feat/acht-panel-erweiterungen-20261010`.

Die Umsetzung folgt 11 → 12 → 13 → 17 → 27 → 29 → 33 → 39.
Alle neuen Datentabellen werden additiv in derselben SQLite-Datei angelegt und
von der bestehenden Datenbanksicherung erfasst. Originalbilder und signierte
Dokumente bleiben erhalten. Diese Erweiterung aktiviert weder einen neuen
Nachrichtenkanal noch externe Partnerbeauftragungen.

## 11 · Bildberichte und getrennte Bildrechte

Unter **Auftrag → Bildbericht** werden vorhandene Fotos nach Leistung,
Motiv und Vorher/Nachher sortiert. Der Betreiber bestätigt die tatsächlich
erledigten Leistungen. Vorschläge aus abgeschlossenen Arbeitsschritten oder
dem Rückgabeprotokoll bleiben bearbeitbar und benötigen diese Bestätigung.

Der interne Bericht, seine ausdrückliche Kundenfreigabe und Werberechte sind
getrennt. Werberechte gelten für einzelne Bilder und Zwecke (Website,
soziale Medien, Druck), mit Datum und Nachweis. Ein Widerruf sperrt weitere
Werbeexporte. Eine Auftragsunterschrift ersetzt keine Werbeeinwilligung.

Die Kennzeichenmaske erzeugt aus dem Original eine neue PNG-Datei mit
geschwärzten Bildbereichen, ohne Metadaten. Der Betreiber prüft genau diese
Vorschau und bestätigt sie vor dem Export. Original, Ausgabe-Hash,
Maskenkoordinaten und Freigabe bleiben nachvollziehbar. Der Fahrzeugzustand
wird nicht durch KI bearbeitet. Der Kundenbericht und sein PDF verwenden die
ausdrücklich ausgewählten Kundenbilder; das PDF stellt Motive paarweise dar.

## 12 · Terminerinnerungen und Vorbereitung

Unter **Auftrag → Termin → Terminerinnerung & Vorbereitung** werden
E-Mail, Vorlauf (1–168 Stunden), Vorbereitungstext und dokumentierte
Empfängerfreigabe konfiguriert. Eine Vorschau zeigt Termin, Ort, vereinbarte
Leistungen und Hinweise. Sie speichert und versendet nichts.

Nur bestätigte Termine werden erinnert. Änderungen, Widerruf und Absage
werden erneut geprüft. Versandaufträge sind pro bestätigtem Termin
dedupliziert. Laufende oder ungewisse Versandversuche werden nicht blind
wiederholt. „Vom Anbieter angenommen“ bedeutet keine nachgewiesene Zustellung.

Bestätigte Alttermine behalten ihren bisherigen 72-Stunden-Ablauf, solange
keine individuelle Einstellung existiert. Sobald ein Auftrag die neuen
Einstellungen verwendet, gilt ausschließlich dieser Ablauf, auch wenn er
deaktiviert wurde. Der Hintergrundlauf verschickt höchstens fünf neue
Erinnerungen pro Durchgang. Neue Kanäle werden nicht eingerichtet.

## 13 · Geschützter Kundenbereich

Der vorhandene **Kundenbereich unter `/kundenportal`** zeigt zum jeweiligen
Auftrag Angebot, tatsächlich bestätigten Termin, offene Nachträge,
freigegebenen Bildbericht, Kundenstatus, Nachrichten und Originalbelege.
Interne Notizen, Einkaufspreise und Bildrechte-Nachweise gehören nicht zum
Kundendatensatz. Die persönliche Anmeldung mit E-Mail und PIN bleibt bestehen.

Unter **Auftrag → Kundenzugang** bestätigt der Betreiber die tatsächliche
Abholbereitschaft und einen optionalen Kundenhinweis. Arbeitsabschluss allein
setzt diesen Status nicht. Die Freigabe kann ausdrücklich zurückgenommen
werden; ein bereits übergebenes Fahrzeug wird nicht erneut abholbereit.

Hier werden auch konkrete Angebots-, Nachtrags- und Übergabelinks begrenzt
oder widerrufen. Neue Übergabelinks gelten 30 Tage. Bestandslinks bleiben
funktionsfähig und können nachträglich begrenzt werden. Angebotsfristen dürfen
nicht über ihre ursprüngliche Gültigkeit verlängert werden. Ablauf/Widerruf
sperrt den Link einschließlich der darüber zugänglichen Bilder, löscht aber
keinen Originalbeleg im persönlich angemeldeten Kundenbereich.

Lesen eines Links führt weder Annahme noch Freigabe aus. Die gemeinsame
Zugriffsprüfung gilt zusätzlich für direkte Dokument- und Bildabrufe. Schreib-
und Signaturwege prüfen die Rechte im Speicherabschluss erneut, damit ein
zwischenzeitlicher Widerruf oder Kundenwechsel nicht übergangen wird.

## Prüfung und Veröffentlichung

Die Entwicklung und isolierte App.fetch-/SQLite-Prüfungen starten keinen
Website-Server. Browserprüfungen sind ausschließlich für den vorhandenen
Linux-GitHub-Runner zugelassen. Testdaten sind synthetisch, Anbieterzugriffe
gemockt. Echte Kundenmails, Rechnungen und Zahlungen dienen nicht als Tests.

Die Pixelmaskierung benötigt die fest versionierte Laufzeitbibliothek `sharp`.
Der bestehende IONOS-Panel-Installer installiert die gesperrten
Produktionsabhängigkeiten mit deaktivierten Paketskripten und prüft die
Bildverarbeitung, bevor aktive Dienste oder Timer verändert werden. Dafür
werden npm-Zugang zum Paketregister und das zum Linux-System passende
vorgefertigte Paket benötigt. Ein fehlgeschlagener Vorabtest aktiviert nichts.

Eine Veröffentlichung erfordert die ausdrückliche Freigabe des konkreten
geprüften Commits und Pakets. Der vorhandene separate Panel-Installer,
Sicherung, Prüfsumme und Rücksetzweg bleiben verbindlich. Die Hauptwebsite
wird nicht ersetzt. Grünes CI und ein Paket sind kein Live-Nachweis.

Vor einer Freigabe müssen alle acht Punkte, die Regressionsprüfungen sowie
die verbleibenden Geräte- und Anbieternachweise im Abnahmebericht stehen.
Der Stand dieses Dokuments beschreibt Code und Bedienung, keine Aktivierung.
