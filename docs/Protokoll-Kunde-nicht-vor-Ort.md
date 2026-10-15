# Annahme und Rückgabe bei abwesendem Kunden

Der bestehende Vor-Ort-Ablauf bleibt erhalten. Eine fehlende Kundenunterschrift aktiviert keinen Fernablauf.

1. Im Annahme- oder Rückgabeprotokoll ausdrücklich **Kunde nicht vor Ort · selbst unterschreiben** wählen. Das funktioniert auch in der Vor-Ort-App.
2. Die angezeigte Fassung prüfen, die Abwesenheit bestätigen und als Betrieb unterschreiben. Bis zu diesem Schritt wird keine Unterschriftsanfrage gespeichert. Danach bleibt die Fassung zunächst für den Kunden gesperrt.
3. **Im Kundenpanel bereitstellen & Link erstellen** wählen oder **Per E-Mail mit PIN senden** ausdrücklich bestätigen. Erst dies gibt die Fassung frei. Es wird durch das bloße Speichern der Betriebsunterschrift keine E-Mail versendet.
4. Der zugeordnete Kunde öffnet seinen persönlichen Zugang, sieht Protokoll, Fotos und Betriebsunterschrift und unterschreibt selbst. Bis dahin lautet der Zustand **Vom Betrieb unterschrieben – Kundenunterschrift ausstehend**.
5. Nach der Kundenunterschrift steht das abgeschlossene PDF mit beiden Unterschriften zur Verfügung. Die bestehende automatische PDF-Zustellung bleibt an die vorhandenen Versandfreigaben gebunden.

## Fassungen und Nachweise

- Die Betriebsunterschrift ist an den angezeigten Entwurf und dessen Inhalts-Hash gebunden. Sie wird nicht als Kundenunterschrift verwendet.
- Die Kundenunterschrift ergänzt dieselbe unveränderte Fassung; der ursprüngliche Hash und der Betriebszeitpunkt bleiben erhalten. Ein zusätzlicher Hash bindet die kundenseitig angezeigte Anfrage.
- Änderungen brauchen **Neue Fassung erstellen**, eine neue Betriebsunterschrift und eine neue Freigabe. Die vorherige Anfrage bleibt im Verlauf, ihr Link verliert die Gültigkeit.
- Ein bereits vom Kunden unterschriebenes Original wird erst durch ein neu unterschriebenes Ersatzprotokoll ersetzt.
- Kundenzugang, Bildprüfung, Ablauf und Widerruf der vorhandenen Dokumentlinks bleiben bestehen. Öffnen, E-Mail-Übergabe und Zustellung sind keine Unterschrift.
- Bereits vorhandene unsignierte Erstanfragen werden nicht rückwirkend als vom Betrieb unterschrieben behandelt. Für erneute Bereitstellung oder Fernunterschrift muss der Betrieb ausdrücklich eine neue Fassung unterschreiben. Gewöhnliche bestehende Korrekturprotokolle bleiben kompatibel.

## E-Mail-Zustellung prüfen

In **Kundenakte & Status → Anbieterresultat lesend prüfen** werden auch vorhandene Resend-Aufträge mit dem bisherigen Status `sent` abgefragt. Das Ergebnis unterscheidet Übergabe an Resend, Annahme durch den empfangenden Mailserver, Verzögerung, Rückweisung und Empfängersperre. Bei mehreren Empfängern beweist ein letztes Anbieterereignis nicht die Zustellung an jeden Einzelnen.

Die Prüfung liest ausschließlich bestehende Nachrichten. Sie verschickt keine neue E-Mail und hebt keine Sperre auf. Bestätigte bestehende Versandaufträge bleiben gegen Wiederholung gesperrt; ein zuvor ungeklärter, eindeutig zugeordneter Versand kann aufgelöst werden. Eine fehlerhafte Kundenadresse muss manuell geklärt werden. Ob eine angenommene Nachricht im Posteingang oder Spamordner liegt, kann der Anbieterstatus nicht beweisen.

## Prüfung und Betrieb

Serverfreie Tests prüfen beide Protokollarten, die ausdrückliche Auswahl, getrennte Freigabe, Vor-Ort-Regressionsschutz, Signatur- und Bildbindung, fremde Kundenzugriffe, veraltete und geänderte Fassungen, konkurrierende Unterschriften, PDF-Nachweise sowie den Mailabgleich ohne Doppelversand. Die bestehenden Browserprüfungen laufen ausschließlich in GitHub CI. Lokal wird kein White-Gloss-Server gestartet.

Es werden weder Produktionsdaten migriert noch DNS-Einstellungen, Kundenadressen oder Anbietersperren automatisch geändert. Die Veröffentlichung erfolgt getrennt über den freigegebenen Panel-Releaseweg.
