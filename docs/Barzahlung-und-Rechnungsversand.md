# Barzahlung aus separater Kasse übernehmen

Betreiberentscheidung vom 7. Oktober 2026: Neustart mit separater Kasse;
das Panel übernimmt deren bereits vorhandene Zahlungsbelege.

Die Barzahlung wird zuerst in der separaten Kasse erfasst. Der persönlich
angemeldete Betreiber öffnet danach den abgeschlossenen Auftrag und wählt
„Barzahlung · Kassenbeleg übernehmen“. Er trägt Kassenquelle, vorhandene externe
Belegnummer, tatsächlichen Betrag und Zahlungszeitpunkt ein und wählt den
Originalbeleg als PDF, JPEG, PNG oder WebP (höchstens 5 MB). Für Barzahlungen
werden Betrag und Zeitpunkt bewusst nicht vorgegeben.

Erst die persönliche Bestätigung, dass der Betrag wirklich erhalten und
bereits in der separaten Kasse erfasst ist, und „Kassenbeleg übernehmen ·
Rechnung versenden“ übernehmen die Zahlung. Der Server verlangt einen
unveränderten, diesem Auftrag zugeordneten Originalbeleg. Kassenquelle,
Referenz, Dateiprüfsumme, Zahlungszeitpunkt und Übernahmezeit bleiben gespeichert.
Derselbe Beleg oder dieselbe externe Referenz derselben Kasse dürfen nicht
noch einmal angerechnet werden. Das Panel erzeugt keine Kassenbelegnummer und
nimmt keine freie Erstaufzeichnung von Barzahlungen vor.

Bei vollständig bar bezahltem Festpreis wird die zugehörige Rechnung mit
„Bar bezahlt“ an die im Auftrag gespeicherte Kundenadresse versendet. Fehlt
noch eine Rechnung, öffnet das Panel die Prüfung der Rechnungsangaben. Der
Betreiber prüft Kundenadresse, Zahlungskonto, tatsächlichen Steuersatz und
Leistungen. Nach der ausdrücklich beauftragten Rechnungsanlage folgt der
Versand mit Zahlungsstatus. Rechnungserstellung erzeugt keinen Zahlungseingang.
Teilzahlungen und gemischte Zahlungsarten ergeben keinen falschen Vollbarvermerk.

Original-Kassenbelege und bereits ausgestellte Originalrechnungen bleiben
unverändert. Die Rechnungskopie enthält den Zahlungsstatus auf der aus der
bereitgestellten Qonto-PDF abgeleiteten White-Gloss-Vorlage im Format DIN A4.
Für eine neue Rechnung wird der belegte Barzahlungsvermerk bereits im
Qonto-Entwurf gesetzt. Der Originalbeleg ist im Zahlungsbereich abrufbar.

Eine zusätzliche Quittung entsteht ausschließlich durch den weiteren Auftrag
„Quittung erstellen“. Die Belegübernahme fordert keine separate Quittung an.
Eine neue Panel-Quittung ersetzt den ursprünglichen Kassenbeleg nicht.

Bestätigter Versand wird nicht wiederholt. Bei einem Fehler vor dem Versand
kann der Betreiber „Rechnung mit Barzahlungsvermerk senden“ erneut auswählen.
Bei unklarer Anbieterantwort bleibt ein zweiter Versand gesperrt. Die übernommene
Zahlung bleibt bei einem Rechnungs- oder Versandfehler gespeichert; der
tatsächliche Zustand wird angezeigt.

Preisannahme, vollständige Rückgabe, persönliche Anmeldung, Versionsprüfung,
Duplikat- und Überzahlungssperre bleiben erforderlich. Alte Originalaufzeichnungen
werden nicht umgeschrieben oder nochmals als neue Zahlung übernommen.

## Systemabgrenzung

Dieser Ablauf dokumentiert die nachgelagerte Übernahme externer Zahlungsbelege.
Das Panel hat keine eigene TSE-Anbindung, keinen eigenen Kassenabschluss und
keine freie Barzahlungs-Erstaufnahme. Eine allgemeine TSE-Ausnahme oder eine
Prüfung der separaten Kasse wird damit nicht behauptet. Maßgeblich sind deren
tatsächlicher Betrieb und die geltenden Anforderungen. Die Betreiberentscheidung
allein ersetzt keine gesetzlich erforderliche Absicherung der externen Kasse.

Grundlagen: [BMF-Fragen zur Kassenfunktion](https://www.bundesfinanzministerium.de/Content/DE/FAQ/FAQ-steuergerechtigkeit-belegpflicht.html),
[Aufzeichnung und Nachvollziehbarkeit, § 146 AO](https://www.gesetze-im-internet.de/ao_1977/__146.html),
[Aufbewahrung, § 147 AO](https://www.gesetze-im-internet.de/ao_1977/__147.html).
