# Buchhaltung im Panel: Implementierungsstand

Stand: 18. Oktober 2026. Diese Datei beschreibt den Code, keinen veröffentlichten Dienst und keine steuerliche Freigabe.

Neu ergänzt: [Monatsbuchhaltung](Monatsbuchhaltung.md) mit manuellem Zahlungsabgleich, Buchungsfreigaben und Stornos, gespeicherten Monatsabschlüssen sowie DATEV-EXTF-Dateien. Kanzleidaten werden später manuell hinterlegt. Ein echter DATEV-Testimport steht aus.

## Derzeit implementiert

- Separater Bereich **Finanzen** mit Beleg-Inbox. Betreiber kann PDF, JPEG, PNG und WebP bis 12 MB hochladen; auf einem Mobilgerät kann der Kamera-Eingang ein Foto liefern. Jeder Eingang erhält eine eigene Kennung, Empfangszeit und SHA-256-Prüfsumme. Gleiche Datei-Inhalte werden als mögliche Dublette gezeigt, ohne Eingänge zu löschen.
- Originaldateien liegen in der privaten Dateiablage. Der Abruf ist nur mit Betreibersitzung möglich und prüft den Hash gegen den Datenbankeintrag. Datenbank-Trigger verhindern das Ändern oder Löschen von Belegmetadaten, Zuordnungsversionen und Ereignissen über die Anwendung.
- Zu einem Beleg lassen sich **manuelle Zuordnungsentwürfe** mit Kategorie, Zahlungsweg, Bruttobetrag, Datum, Partner und Notiz speichern. Eine spätere Korrektur wird als neue Version erfasst. Die Begriffe „Privatkunde/Dienstleistung“, „Privateinlage“, „Privatentnahme“ und „privat bezahlter Betriebsaufwand“ sind getrennt.
- Qonto-Bankumsätze lassen sich über den bereits geprüften Qonto-Zugang **lesend** und seitenweise abrufen. Die API-Antwort wird vollständig geprüft, bevor neue lokale Stände gespeichert werden. Wiederholte Antworten erzeugen keine Dublette; ein geänderter Qonto-Stand erhält eine neue unveränderliche Revision. Eingänge und Abbuchungen haben getrennte manuelle Kategorien. Ein ausgewählter Beleg kann als Verweis am Zuordnungsentwurf hängen. Eine veraltete Revision wird zur erneuten Prüfung angehalten. Der Testbereich lädt keine echten Bankdaten.

  Technische Schnittstelle: [Qonto Business API „List transactions“](https://docs.qonto.com/api-reference/business-api/transactions-statements/transactions/list-transactions). Ein produktiver Erstabgleich mit echten Qonto-Daten und Kontoauszügen steht noch aus.
- Das Profil hält Einzelunternehmen, EÜR, Regelbesteuerung, vom Betreiber bestätigte Istversteuerung und DATEV als Ziel fest. Ein offizieller Nachweis über die Istversteuerung liegt im vorliegenden Fragebogen nicht vor; das Profil kennzeichnet ihn als offen. Das künftige Steuerrücklagenkonto ist `OFF` und führt keine Überweisung aus.
- Die zusätzlich eingereichte ELSTER-Statusmitteilung bestätigt eine Berechtigung zum **Abruf von Bescheinigungen**. Sie ist keine Entscheidung über den Antrag auf Istversteuerung.
- Die vorhandene Qonto-Rechnungsstellung bleibt bestehen. Die neue Beleg-Inbox erstellt keine Rechnung, keine Journalbuchung, keine Steueranmeldung und keinen Überweisungsauftrag.

## Noch umzusetzen und fachlich abzunehmen

Offen bleiben insbesondere inkrementelle Qonto-Synchronisierung, Kassenbuch/TSE-Einstufung, automatische Kundenkarten-Verrechnung, eigene Panel-Rechnungen mit E-Rechnung und kontrolliertem Übergang von Qonto, DATEV-Testimport, KI-Extraktion und Vorschläge, WhatsApp-/E-Mail-Belegeingang, Steuerberichte sowie externe Sicherung mit geprüftem Restore. Eine Kategorie eines Belegs oder Bankumsatzes allein ist weiterhin kein freigegebener Buchungssatz; dafür ist die getrennte Buchungsfreigabe erforderlich.

Vor einer Umstellung braucht es mindestens den Nachweis beziehungsweise die fachliche Freigabe der Istversteuerung, das Kanzlei-Profil für SKR03 und DATEV, den Umschaltstichtag mit Qonto-Altbestand und offenen Posten sowie einen gesonderten Prüf- und Releaseweg. Ein Hash oder ein bestandener Test allein belegt keine GoBD-Konformität.

## Prüfungen

`npm run lint`, `npm run typecheck` und `npm test` können ohne Website-Server ausgeführt werden. Gezielt geprüft sind Zugriffstrennung, unveränderte Originalbytes, Erkennung veränderter Bytes, Dublettenhinweis, Entwurfsversionen, Konflikt bei veralteter Version, unvollständige Qonto-Paginierung, wiederholter Bankabgleich, Storno-Revisionen und die Bedienung des Finanzbereichs in der gebauten Oberfläche. Ein echter Qonto-Zugang wurde dabei nicht verwendet.
