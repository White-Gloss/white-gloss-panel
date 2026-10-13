# Qonto: Rechnungen, Quittungen und Mahnwesen

Betreiberentscheidung vom 13. Oktober 2026: Das Panel rechnet ausschließlich über **Qonto** ab.
Die bisherige Lexware-Anbindung ist entfernt. Zahlungsziel: **7 Tage**.

## Ablauf im Panel

1. Arbeit abschließen, Rückgabeprotokoll speichern → Status „Erledigt“.
2. Auftrag → **Zahlung & Rechnung** → **Abrechnen · Rechnung oder Quittung**.
   Bei unerwarteter Mehrarbeit zuerst **Rechnungspositionen bearbeiten**: Positionen,
   Beschreibungen und Bruttobeträge bearbeiten oder ergänzen, Grund und Kundenvereinbarung
   festhalten und **Entwurf speichern**. Dieser Schritt speichert nur im Panel; er erstellt
   keine Qonto-Rechnung und versendet keine E-Mail. Das unterschriebene Angebot bleibt unverändert.
3. Der Betreiber wählt und bestätigt ausdrücklich:
   - **Rechnung senden** – zahlbar in 7 Tagen. Fälligkeit = Rechnungsdatum + 7 Tage.
   - **Bereits bezahlt (Bar, Karte oder Überweisung)** – die Rechnung trägt den Vermerk
     „vollständig bezahlt … gilt zugleich als Quittung“, wird in Qonto als bezahlt markiert
     und die Zahlung wird im Auftrag erfasst (Status „Bezahlt“).
4. Rechnungskunde: vorhandenen Qonto-Kunden (gleiche E-Mail) wählen oder deutsche
   Rechnungsadresse eingeben. Umsatzsteuer: 19 %, 7 % oder 0 % (Kleinunternehmer, § 19 UStG).
5. Vorschau mit Positionen, Netto, Umsatzsteuer und geprüftem Bruttorechnungsbetrag prüfen,
   Häkchen setzen, ausstellen. Bei bearbeitetem Entwurf sind Angebotspreis und Änderungsgrund
   ebenfalls sichtbar. Änderungen setzen die Vorschaufreigabe zurück; ein veralteter Dialog
   oder zwischenzeitlich geänderter Entwurf kann keine Rechnung ausstellen.
6. Optional: PDF-Rechnung per E-Mail an den Kunden (Kopie an den Betreiber), Versand über den geprüften Resend-Absender.

## Technik und Schutz vor Fehlern

- **Rechnungsnummer = WG-Nummer** des Auftrags. Qonto lehnt doppelte Nummern ab → keine Doppelrechnung,
  auch nicht bei Zeitüberschreitung oder erneutem Klick. Ein abgebrochener Vorgang setzt beim erneuten
  Ausführen sicher fort (vorhandene Rechnung/Entwurf wird über die Nummer gefunden).
- Ablauf in Qonto: Kunde anlegen/prüfen → Rechnungsentwurf → **Summe prüfen** → endgültig ausstellen.
  Weicht die von Qonto berechnete Summe vom geprüften Rechnungsbetrag ab, wird ein in diesem
  Vorgang neu angelegter Entwurf gelöscht; es entsteht keine Rechnung. Vorhandene abweichende
  Qonto-Entwürfe werden ausschließlich mit der offiziellen Draft-PATCH-Funktion aktualisiert,
  ihre ID bleibt erhalten. Eine Aktualisierung wird vor der endgültigen Ausstellung erneut geprüft.
- Das unterschriebene Angebot, frühere Rechnungsentwürfe und ausgestellte Rechnungspositionen
  bleiben erhalten. Auftrag und Entwurf werden vor Anbieteränderungen erneut auf Änderungen geprüft.
- Nettopreise werden so übergeben, dass Netto + Umsatzsteuer exakt den geprüften Bruttopreis ergeben.
  Lehnt Qonto die Genauigkeit ab, folgt genau ein zweiter Entwurf mit centgenauen Preisen und erneuter Summenprüfung.
- Das Original-PDF von Qonto wird beim ersten Versand bzw. Download privat im Panel gespeichert
  (in Backups enthalten). Qonto erstellt das PDF wenige Sekunden nach dem Ausstellen; bis dahin wartet
  der Versand und läuft automatisch über den Hintergrundlauf (alle 15 Minuten) weiter.
- Mails nutzen Idempotenzschlüssel. Ein unklares Versandergebnis wird nie automatisch wiederholt.
- Testaufträge und gesperrte Kundenakten erreichen Qonto nie.

## Zahlungseingang

- Qonto ordnet eingehende Überweisungen mit der Rechnungsnummer im Verwendungszweck der Rechnung zu.
- Der Hintergrundlauf liest offene Rechnungen höchstens stündlich. Bei „bezahlt“ in Qonto:
  Zahlung wird im Auftrag erfasst (Überweisung, Quelle Qonto), Status „Bezahlt“, Mahnungen entfallen.
- Zahlung im Panel erfasst (z. B. nachträglich bar)? → Button **„In Qonto als bezahlt markieren“**.
- „Zahlstatus abgleichen“ prüft eine Rechnung sofort.

## Mahnwesen (ohne Gebühren)

| Stufe | Frühestens | Neue Frist |
| --- | --- | --- |
| Zahlungserinnerung | 3 Tage nach Fälligkeit | 7 Tage |
| 1. Mahnung | 14 Tage nach Fälligkeit, ≥ 7 Tage nach der Erinnerung | 7 Tage |
| 2. Mahnung (letzte) | 28 Tage nach Fälligkeit, ≥ 7 Tage nach der 1. Mahnung | 7 Tage |

- Automatisch nur mit Freigabe „Zahlungserinnerungen und Mahnungen … automatisch senden“
  (Einstellungen → Automatische Abläufe freigeben) sowie geprüftem und freigegebenem E-Mail-Versand.
- Ohne Freigabe zeigt der Auftrag die fällige Stufe; Versand per Klick „… jetzt senden“.
- Vor jeder Mahnung wird der Zahlstatus in Qonto gelesen. Bereits bezahlt → keine Mahnung.
- Nach der 2. Mahnung endet der automatische Ablauf. Weitere Schritte entscheidet der Betreiber.
- Keine Mahngebühren und keine Verzugszinsen werden automatisch berechnet.

## Kundenbereich

- Jede Rechnung erhält einen persönlichen Link `https://panel.white-gloss.de/rechnung/…` (400 Tage gültig).
- Der Kunde meldet sich mit der E-Mail-Adresse des Auftrags an und erhält Link + einmalige PIN.
- Angezeigt: Status, Positionen, Betrag, Fälligkeit, Bankverbindung, Verwendungszweck, PDF-Download
  und – solange offen – der Qonto-Link „Online ansehen und bezahlen“.
- Der Betreiber kopiert den Link im Auftrag („Kundenlink kopieren“).
- Ein Auftrag im Papierkorb hat gesperrte Rechnungslinks und pausierten Versand. Nach der
  Wiederherstellung bleiben diese alten Links gesperrt und Mails pausiert. Erst ausdrücklich
  angeforderter Rechnungsversand erstellt bei Bedarf einen neuen gültigen Rechnungslink;
  die Mail enthält niemals den gesperrten alten Link. Abgelaufene Links werden beim Versand
  ebenfalls erneuert.

## Storno und Neuausstellung

- Sobald Qonto die Rechnung ausgestellt hat, ist sie im Panel unveränderlich – auch wenn
  die E-Mail noch nicht versendet wurde. Die Oberfläche erklärt diesen Zustand ausdrücklich.
- Stornierung (Gutschrift) erfolgt in Qonto. Der Abgleich übernimmt den Status „Storniert“.
- Danach im Auftrag **„Neue Rechnung ausstellen“**: Nummer `WG-…-2` (fortlaufend), alte Rechnung bleibt
  im Verlauf, alter Kundenlink wird gesperrt, offene Mahnungen der alten Rechnung entfallen.

## Einrichtung (einmalig, durch den Betreiber)

1. Qonto → Einstellungen → Integrationen & Partnerschaften → **API-Schlüssel**: Login und Secret Key.
2. Qonto-Rechnungseinstellungen: Steuernummer bzw. USt-IdNr. und Firmenangaben hinterlegen
   (Pflichtangaben auf der Rechnung).
3. Panel → Einstellungen → **Qonto**: Login + Secret Key eintragen → „Qonto-Verbindung prüfen“
   (liest nur Organisation und Konten) → Zahlungskonto wählen → speichern.
4. „Vorhandene Qonto-Rechnungen abgleichen“ und den einmaligen WG-Nummernabgleich bestätigen.
5. Optional: Mahnwesen-Automatik freigeben.

Secret Key wird verschlüsselt gespeichert, nie angezeigt, nie in GitHub abgelegt.

## Offizielle Quellen

- [Qonto API-Schlüssel](https://docs.qonto.com/get-started/business-api/authentication/api-key)
- [Rechnung erstellen](https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/create-a-client-invoice)
- [Rechnung ausstellen (finalize)](https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/finalize-a-client-invoice)
- [Qonto-Rechnungsentwurf aktualisieren](https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/update-a-client-invoice)
- [Als bezahlt markieren](https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/mark-a-client-invoice-as-paid)
- [Kunden](https://docs.qonto.com/api-reference/business-api/clients/create-a-client)
- [Anhänge/PDF](https://docs.qonto.com/api-reference/business-api/expense-management/attachments/retrieve-an-attachment)
