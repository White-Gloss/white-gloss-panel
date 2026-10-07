# Persönlicher Zahlungseingang und separate Quittung

Betreiberanweisung vom 7. Oktober 2026: Eine Quittung entsteht ausschließlich
auf ausdrücklichen eigenen Auftrag. Die Bestätigung einer Bargeldzahlung soll
auf der Rechnung den Vermerk „Bar bezahlt“ ergeben.

## Bedienung

Der persönlich angemeldete Betreiber gibt Betrag, Zahlungszeitpunkt,
Zahlungsart und Originalbelegreferenz an. „Ich bestätige: Ich habe die Zahlung
in der angegebenen Höhe erhalten“ ist nicht vorausgewählt. Änderungen der
Zahlungsangaben setzen diese Bestätigung zurück. Erst „Zahlung erhalten“
speichert den Eingang. Kunden, Agenten, Rechnungsstatus und Anbieterabgleich
bestätigen keinen neuen Zahlungseingang.

Diese Aktion erstellt keine separate Quittung. Beim jeweiligen gespeicherten
Eingang kann der Betreiber anschließend ausdrücklich „Quittung erstellen“
wählen. Auftrag und Zeitpunkt werden getrennt auditiert. Erst danach erscheint
der zugehörige Download im Kundenportal. Ohne diesen Auftrag erzeugt auch ein
direkter PDF-Aufruf keine neue Quittung. Vorhandene unveränderliche Originale
bleiben erhalten. Eine Quittung wird nicht automatisch versendet.

## Vermerk auf der Rechnung

Der Vermerk basiert auf gespeicherten persönlichen Betreiberbestätigungen
im Zahlungsledger. Nur vollständige Barzahlung erlaubt „Bar bezahlt“.
Teilzahlungen und gemischte Zahlungsarten erhalten zutreffende andere Vermerke.
Ein bloßer Qonto-Status `paid` oder ein Belegupload genügt nicht.

Bei einer neuen Rechnung kommt der bestätigte Vermerk in den Qonto-Header,
bevor die Rechnung endgültig erstellt wird. Bereits endgültig ausgestellte
Rechnungen werden nicht überschrieben: Eine versionierte Rechnungskopie enthält
die unveränderten Originalseiten und anschließend den Zahlungs-Vermerk.
Rechnungsnummer und archiviertes Original bleiben erhalten; die Kopie ist
keine neue Rechnung und keine separate Quittung.

Der tatsächliche Qonto-PDF-Downloadhost muss in der technischen
IONOS-Konfiguration `QONTO_INVOICE_PDF_HOSTS` aus dem nachgewiesenen Originalabruf
gesetzt sein. Bis Original-PDF und Briefpapier verfügbar sind, ist die Ausgabe
der Rechnungskopie gesperrt. Ein solcher technischer Rückstand nimmt einen
bereits bestätigten Zahlungseingang nicht zurück und bucht ihn nicht erneut.
Ungeklärte Qonto-Schreibresultate werden nicht blind wiederholt.

## Grundlage und Prüfung

Die Qonto-Schnittstelle erlaubt einen Header bei der Erstellung und Änderungen
an einem Entwurf. Das Markieren als bezahlt ändert den Anbieterstatus und das
Zahlungsdatum; es belegt allein keinen sichtbaren Text „Bar bezahlt“ im PDF.

- [Qonto: Rechnung erstellen](https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/create-a-client-invoice)
- [Qonto: Rechnungsentwurf ändern](https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/update-a-client-invoice)
- [Qonto: Rechnung als bezahlt markieren](https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/mark-a-client-invoice-as-paid)
- [Qonto: Originalanhang abrufen](https://docs.qonto.com/api-reference/business-api/expense-management/attachments/retrieve-an-attachment)

Prüfungen verwenden ausschließlich synthetische Daten, Mock-Anbieterantworten
und serverfreie Datenbanken. Kein lokales Hosting und keine echten
Rechnungen, Zahlungen oder Kundenaktionen. Produktive Freigabe und tatsächliche
Qonto-PDF-Ausgabe bleiben getrennt vom Implementierungsnachweis.
