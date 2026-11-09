# Buchungsablauf und E-Mails – 09.11.2026

Entwicklungsstand auf Basis Panel `1b5b3b3` und Website `db305e3`. Noch kein Release-Nachweis für diese Änderungen.

## Befund

- Die Website legt eine Eingangsmail an. Der Panel-Import legte zusätzlich eine automatische Kontoeinladung an. Die gleiche zusätzliche Mail konnte bei manueller Kunden- oder Auftragsanlage entstehen.
- Die Website legte bei identischer Betriebs- und Kundenadresse beide Empfängerrollen als getrennte E-Mails an.
- Die Upload-Fehleranzeige bot trotz gespeicherter Anfrage „Neue Anfrage beginnen“ an. Der Klick löschte die Wiederholungssicherung und ermöglichte eine weitere Buchung samt Eingangsmail.
- WG-68 aus dem Screenshot ist eine Website-Referenz. Die gezielte Panel-Abfrage lieferte keinen passenden Datensatz. Aus dem Screenshot ist die tatsächliche Ursache des Upload-Transportfehlers nicht bestimmbar. Es wurde kein Zugriff auf echte Kundenpostfächer oder Uploads vorgenommen.

## Überarbeiteter Ablauf

| Anlass | Nachricht an den Kunden |
| --- | --- |
| Website-Anfrage | Eine freundliche Eingangsmail, ohne PDF. Wunschtermin bleibt unverbindlich. Link zum Kundenbereich ist enthalten. |
| Kunden-/Auftragsanlage oder Import | Keine zusätzliche automatische Kontoeinladung. Alte Einladungseinträge bleiben erhalten und werden nicht abgearbeitet. |
| Konto einrichten / Passwort vergessen | Einmalcode nur nach ausdrücklicher Anforderung. Vorhandene Konten und sichere Link-/PIN-Zugänge bleiben nutzbar. |
| Angebot nach Prüfung | Eine Angebotsmail mit persönlichem Link/PIN. Angebot und genannter Termin werden gemeinsam unterschrieben. |
| Unterschrift | Eine Auftragsbestätigung pro Annahmefassung, mit den vorhandenen Dokumenten. |
| Vor dem Termin | Vorhandene 72-Stunden-Erinnerung pro bestätigter Terminversion. Kurzfristige Bestätigung erzeugt keine sofortige zusätzliche Erinnerung. |
| Annahme/Rückgabe | Je unterschriebenem Protokoll die vorhandene dokumentbezogene Mail. |
| Rechnung | Vorhandene Rechnungs-/Quittungsmail; Zahlungsziel und Beträge bleiben unverändert. |
| Nach Abschluss | Bewertungsbitte weiterhin nach sieben Tagen und nur mit Einwilligung. |

Eingang, Angebot, Konto-Code, ausdrückliche Portaleinladung, Dokumentanschreiben, Erinnerung, Rechnung und Bewertungsbitte sprechen den Kunden freundlich und mit Sie an. Sicherheitsfristen, Unterschriften, dokumentbezogene Deduplizierung und die Sperre automatischer Neuversuche bei unklarem Versand bleiben erhalten.

## Prüfungen

Reproduktion vor dem Fix: vier Paneltests wiesen je eine unerwünschte Konto-Mail nach; ein Websitefall wies zwei E-Mails an dieselbe Adresse nach. Nach dem Fix bestanden 18 fokussierte Panel- und 13 Websiteprüfungen. Vollständige Prüf- und Browserergebnisse werden in den zugehörigen PRs mit Commit referenziert.

Keine echte Buchung, Kundenmail, Kundenunterschrift, Rechnung, Zahlung oder Kundendatei wurde als Test ausgelöst. Die zugrunde liegende Foto-Transportstörung ist weiterhin getrennt zu diagnostizieren; dieser Fix verhindert daraus entstehende neue Anfragen und zusätzliche E-Mails.
