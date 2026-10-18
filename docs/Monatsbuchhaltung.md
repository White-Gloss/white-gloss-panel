# Zahlungsabgleich, Monatsabschluss und DATEV

Implementierung vom 18. Oktober 2026. Veröffentlichung und Liveprüfung werden im jeweiligen Releaseprotokoll gesondert belegt.

## Einstieg und Rechte

Im Panel unter **Finanzen → Zahlungsabgleich · Monatsabschluss · DATEV** öffnen. Die neue Ansicht liegt unter `/buchhaltung`. Der Betreiber bestätigt alle Änderungen. Persönliche Kanzleizugänge können den Finanzstand, Journal, Abschlussnachweise und bereits erstellte DATEV-Dateien lesen. Ihre bisherigen Kommentar- und Zuordnungsvorschläge bleiben im Kanzleibereich verfügbar.

Keine Zugangsdaten werden vorgegeben: Beraternummer, Mandantennummer, SKR03/SKR04, Sachkontenlänge, Wirtschaftsjahresbeginn und gewünschte DATEV-Festschreibung werden vom Betreiber später manuell eingetragen. Ohne vollständige Angaben sind Buchungsfreigabe, Abschluss und Export gesperrt. Der Zahlungsabgleich funktioniert unabhängig davon.

## Zahlungsabgleich

1. Qonto-Umsätze in der bestehenden Finanz-Inbox lesend synchronisieren. Die Monatsansicht verwendet die vollständig übernommenen lokalen Stände; sie ruft selbst keinen Anbieter auf.
2. Monat wählen und einen gebuchten EUR-Umsatz öffnen. Eine Rechnungsnummer im Verwendungszweck wird als möglicher Treffer gekennzeichnet; sie bewirkt keine automatische Zuordnung.
3. Rechnung und Betrag prüfen. Eine schon im Auftrag erfasste Überweisung auswählen, damit keine zweite Zahlung entsteht. Andernfalls wird nach Bestätigung eine Überweisung im bestehenden Auftrag erfasst. Teilzahlungen und Aufteilungen einer Sammelzahlung sind möglich.
4. Andere Geschäftsvorfälle, Gebühren, Einlagen oder Restbeträge mit nachvollziehbarer Begründung klären. Das erzeugt keine Rechnungszahlung.

Der Abgleich begrenzt jede Aufteilung auf den verbleibenden Bankbetrag und jede neue Rechnungszahlung auf den offenen Rechnungsbetrag. Änderungen werden atomar samt Auftragsversion gespeichert. Ein bereits abgeglichener Zahlungsbetrag, Zeitpunkt oder Zahlungsweg lässt sich im alten Auftragsformular nicht still verändern. Beim Lösen einer Zuordnung wird nur eine durch diesen Abgleich neu erfasste Zahlung storniert; eine vorher vorhandene Zahlung bleibt bestehen. Bankänderungen und Rückbuchungen müssen erneut geprüft werden.

Es entstehen weder Überweisungen noch Anbieterrechnungen durch diese Endpunkte. Bestehende, separat konfigurierte Qonto- und Mahnabläufe bleiben erhalten. Bar-/Kartenzahlungen werden weiterhin im bestehenden Auftrag erfasst; ein Karten-Sammelumsatz ist kein automatischer Einzelrechnungsnachweis.

## Buchungsfreigabe

Belege, Rechnungen einschließlich Historie, erfasste Zahlungen und Bankbewegungen sind eigene Nachweise. Jede relevante Quelle eines Monats benötigt eine bestätigte Kontierung oder eine **begründete Ausnahme**. Zugehörige Rechnung, Beleg, Zahlung und Bankumsatz dürfen nicht mehrfach als Erlös/Aufwand gebucht werden. In Ausnahmen den Bezug auf den bereits gebuchten Nachweis bzw. den extern gebuchten Altbestand festhalten.

Konten, Gegenkonto, Soll/Haben, einfacher BU-Schlüssel, Belegnummer, Datum und Text werden manuell geprüft. Aufteilungen bis zwölf Zeilen müssen zusammen genau den Quellbetrag ergeben. Kategorien aus der Inbox werden nicht zu Steuerkonten umgedeutet. Der Ablauf unterstützt EUR und einfache Buchungen, nicht Fremdwährung, BU49 oder EU-/Reverse-Charge-Felder. Solche Fälle fachlich extern bearbeiten und mit konkretem Bezug dokumentieren; Fremdwährungs-Bankumsätze blockieren den internen Abgleich/Abschluss.

Freigegebene Zeilen sind unveränderlich. Korrekturen erzeugen Generalumkehr-Zeilen und eine neue Freigabe. Ein neuer Quellstand macht eine alte Freigabe prüfpflichtig. Offene Kanzleivorschläge blockieren den Abschluss für die betroffenen Quellen.

## Monatsabschluss und Korrektur

Ein Abschluss ist erst nach dem letzten Kalendertag des Monats möglich. Der Betreiber bestätigt die Vollständigkeit von Kontoauszügen, Bar-/Kartenzahlungen und Belegen ausdrücklich. Das Programm prüft nur den erfassten Bestand und kann fehlende, noch nie eingelesene Unterlagen nicht erkennen. Offene Kundenrechnungen sind zulässig und werden zum Monatsende berechnet: später ausgestellte Rechnungen und spätere Zahlungen zählen nicht in den Stichtagsbestand. Bei historisch unklarem Stornodatum oder späteren Zahlungskorrekturen muss der Betreiber den offenen Stichtagsbetrag und einen konkreten Nachweis manuell hinterlegen. Guthaben werden dabei negativ eingegeben.

Der Abschluss enthält einen unveränderlichen Snapshot mit Quellen, Freigaben, Buchungen, Abgleichen, offenen Posten, DATEV-Profil und SHA-256. Journal und Abgleich des Monats sind danach gesperrt. Eingänge und externe Statusabgleiche werden weiter angenommen; nachträgliche finanzielle Änderungen werden als Abweichung sichtbar und sperren einen neuen Export. Eine begründete Wiederöffnung hält den vorherigen Abschluss vollständig fest. Nach Prüfung und erneutem Abschluss folgt ein eigener Nachweis.

## DATEV-Datei

Der Betreiber erstellt den Stapel erst aus einem unveränderten Abschluss. Der Download verwendet EXTF, Header 700, Buchungsstapel Version 13, 31 Headerfelder, 125 Datenspalten, Semikolon, CRLF, Dezimalkomma und Windows-1252 ohne BOM. Nicht darstellbare Zeichen, ungültige Belegnummern, falsches Wirtschaftsjahr und unpassende Kontenlängen werden abgewiesen. Die gewünschte Festschreibung ist ausdrücklich wählbar; das ist von der internen Periodensperre getrennt.

Jede gespeicherte Datei hat einen festen Namen und Hash. Wiederholter Download liefert dieselben Bytes. Nach Wiederöffnung enthält ein neuer Export ausschließlich noch nicht exportierte Buchungen einschließlich notwendiger Stornos. Original-/Stornopaare, die nie exportiert wurden, bleiben nur im Journal. Bei einer Profilkorrektur nach einem Export erhält die Rücknahme einen Stapel mit dem ursprünglichen Profil und die Ersatzbuchung einen getrennten Stapel mit dem korrigierten Profil. Beraternummer, Mandant und Kontenrahmen stehen zur Unterscheidung im Dateinamen. Alte Dateien niemals erneut importieren; die Korrekturstapel mit der Kanzlei den jeweiligen bisherigen Importen zuordnen. Export-ID und Buchungs-ID bleiben nachvollziehbar. Es erfolgt kein automatischer DATEV-Upload und keine automatische Importbestätigung.

Originalbelege werden separat im bisherigen geschützten Beleg-/Rechnungsbereich heruntergeladen. Die EXTF-Datei enthält keine PDF-Dateien oder erfundenen DATEV-Beleglinks. Der erste technische und fachliche Import in eurem DATEV-Mandat ist mit der Kanzlei noch zu prüfen; diese Implementierung ist keine DATEV-Zertifizierung oder Aussage über vollständige GoBD-Konformität.

Offizielle Grundlagen (abgerufen 18.10.2026):

- [Header](https://developer.datev.de/de/file-format/details/datev-format/format-description/header)
- [Buchungsstapel](https://developer.datev.de/de/file-format/details/datev-format/format-description/booking-batch)
- [Dateiaufbau und Muster](https://developer.datev.de/de/file-format/details/datev-format/format-description/sample-data)

## Technische Grenzen und Nachweise

Bestehende Daten werden nicht umgeschrieben. Neun ergänzende Tabellen speichern nur neue Vorgänge. Der Datenbankvergleich über Quellenrevisionen und Auftragsversionen schützt jeden atomaren Schreibvorgang gegen Änderungen während der Prüfung. Bis 10.000 Datensätze je gelesener Tabelle werden vollständig verarbeitet; bei Überschreitung wird ausdrücklich abgebrochen, niemals still gekürzt. Dies ist kein unbegrenztes Großmandanten-Journal.

Serverlose Tests prüfen Rechte, CSRF, Teilzahlungen, bestehende Zahlungen, Überzahlung, parallele Bestätigung, Storno, unveränderliche Abschlüsse, Quelländerungen, DATEV-Struktur und identische/differenzielle Exporte. Die echten Desktop-/Mobil-Browserabläufe laufen ausschließlich im vorhandenen Linux-GitHub-Runner. Keine lokalen Webserver oder echten Kundentransaktionen werden für Prüfungen gestartet.
