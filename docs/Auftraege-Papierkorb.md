# Aufträge löschen und wiederherstellen

„Auftrag löschen“ verschiebt den Auftrag in den Papierkorb. Der Betreiber kann
ihn dort wiederherstellen und seine aufbewahrten Originale weiterhin lesen.
Eine dauerhafte Entfernung gibt es nicht. Die bestehende Datenbanksperre gegen
das physische Löschen von Aufträgen bleibt erhalten.

## Erhaltene Unterlagen

Kundenstamm, Fahrzeuge, Auftrag, WG-Nummer, unterschriebene Dokumente und ihre
früheren Fassungen, Rechnungen, Zahlungen, Fotos und Chatnachrichten bleiben
gespeichert. Löschung und Wiederherstellung schreiben jeweils eine neue
Auftragsversion und einen Eintrag im Änderungsverlauf.

Gelöschte Aufträge erscheinen nicht mehr in den normalen Arbeitslisten,
Kundenaufträgen, Chatlisten oder im Kalenderexport. Der Papierkorb ist
ausschließlich für den Betreiber zugänglich. Änderungen und Kommunikation zum
gelöschten Auftrag sind gesperrt, bis er wiederhergestellt wurde.

## Links, Versand und Termine

Beim Löschen werden bestehende Angebots-, Dokument-, Rechnungs- und Chatlinks
gesperrt. Noch nicht gesendete vorbereitete Versandaufträge mit dem Zustand
„queued“ oder „failed“ pausieren; ihre bisherigen Details bleiben gespeichert.
Der lokale Termin wird freigegeben. Das Löschen ändert keinen externen
Google-Termin und storniert keine Qonto-Rechnung oder Zahlung.
Bereits an Anbieter übergebene Aktionen werden nicht rückgängig gemacht.

Eine aktive oder ungeklärte Anbieteraktion („pending“, „unknown“ oder „draft“)
verhindert die Löschung. Zuerst muss das Anbieterergebnis lesend geprüft werden.
Eine Datenbankprüfung schützt auch davor, dass eine solche Aktion erst während
des Löschens startet.

Beim Wiederherstellen muss der gespeicherte Termin weiterhin frei sein. Eine
Überschneidung lehnt die gesamte Wiederherstellung ab; der Auftrag bleibt im
Papierkorb.

Bisherige Kundenlinks bleiben nach dem Wiederherstellen gesperrt. Vorbereiteter
Versand wird nicht automatisch wiederholt; der Betreiber kann den passenden
Versand ausdrücklich erneut freigeben. Neue fällige Abläufe folgen den
bestehenden Einstellungen und Freigaben.

## Prüfung

`tests/order-trash.test.mjs` prüft ausschließlich synthetische Aufträge gegen
SQLite im Speicher. Es startet keinen Server und löst keine echten
Kundenanfragen, Mails oder Anbieteränderungen aus. Geprüft werden insbesondere
Originalerhalt, Kundenzugriff, Hintergrundlauf, Terminüberschneidungen,
ungeklärte Anbieteraktionen und gleichzeitige Änderungen.
