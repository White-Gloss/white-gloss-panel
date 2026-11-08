# WG-AUTH-001 + WG-UX-005 – Entwicklungsabnahme

Stand 08.11.2026. **Draft PR #68, kein Produktivrelease.** Basis: `b081585` einschließlich der zwischenzeitlichen WhatsApp-Erweiterung aus PR #67. Produktivdaten, DNS, Server und Kundenpostfächer wurden nicht verändert. Alle Versandtests verwenden `.invalid`-Adressen und simulierte Anbieter.

## Ergebnis

| Bereich | Verhalten im Entwicklungsstand |
| --- | --- |
| Kundenkonto | E-Mail-Code → verifizierte Passwortvergabe → dauerhafte Anmeldung mit E-Mail und Passwort. Code allein eröffnet keine Sitzung. |
| Einrichtung | Neue manuelle Kunden / neue Aufträge einschließlich Website-Import schreiben atomar einen Einladungseintrag. Ein Eintrag pro normalisierter E-Mail; keine Bestandsaktionen oder Testkunden. |
| Versand | Vorhandene Resend-Konfiguration und Freigaben erforderlich. Maintenance verarbeitet die Einträge; keine Provideranfrage im GET oder im Code-Anforderungsrequest. Unklare Resultate werden nicht automatisch erneut versendet. |
| Passwort vergessen | Separater Code mit Credential-Version; atomarer Passwortwechsel widerruft alle bisherigen Sitzungen und ausstehenden Legacy-Anmeldegrants. |
| Geräte | Mehrere unabhängige Sitzungen; normal 1 Tag maximal / 4 Stunden inaktiv, ausdrücklich privates Gerät 30 Tage. Kontoexistenz ist unabhängig von der Sitzungslaufzeit. |
| Kundenakte | Bestehende Kunden-/Fahrzeugdaten plus Aufträge, bestätigte Termine bzw. klar bezeichnete Vorschläge, Dokumentnachweise, Fotos, offene Wünsche, Wiedervorlagen, interne Notizen und Verlauf. |
| Kommunikation | Kundenchat, Transaktionsmail-Jobs, archivierte E-Mails und ausdrücklich zugeordnete WhatsApp-Mediennachrichten. Filter nach Auftrag; interne Notizen getrennt. |
| E-Mail-Zuordnung | Optional expliziter Auftrag in Editor und Entwurf. Empfänger muss zur aktuellen Auftragsadresse passen. Zuordnung wird atomar mit dem Versandnachweis gespeichert. |
| Bewusster Versand | Bestätigung nennt Kanal, Kunde/Auftrag, An/Cc/Bcc, Betreff und Anhangsnamen. Änderungen nach Vorschau erfordern erneute Bestätigung. Letzte synchrone Auftragsprüfung unmittelbar vor SMTP. |
| Zustellstatus | SMTP-/API-Annahme wird als Anbieterannahme angezeigt. Unbekannt, fehlgeschlagen, angefordert und im Chat gespeichert bleiben unterschiedliche Zustände. Keine erfundene Zustellbestätigung. |

## Sicherheits- und Migrationsentscheidung

Bestehende Authentifizierung erweitert, kein neues Identitätssystem. Ein Konto pro exakt normalisierter E-Mail. Kein Zusammenführen nach Name, Kennzeichen oder Telefonnummer. Kundenportal und Originaldokumente prüfen weiterhin die eigene Auftrags-E-Mail; interne Kundenakten dürfen ausschließlich Betreiber lesen. Bestehende Angebots-/Protokoll-/Chatlinks bleiben kompatibel. Auch die frühere reine Worker-Kundenverwaltung funktioniert weiter; nur die Standalone-Laufzeit lädt das neue Gesamtmodell.

Passwörter: vorhandenes scrypt mit zufälligem Salt (`N=131072`, `r=8`, `p=1`), niemals Klartext. 15–128 Zeichen, Passwortmanager und Einfügen erlaubt. Zeitlich begrenzte Codes HMAC-geschützt, Versandpayload bis zur Verarbeitung verschlüsselt und vor Provideraufruf entfernt. Fünf Codeversuche, fünf Anforderungen pro E-Mail/Stunde sowie zusätzliche IP-Limits. Gleichzeitige Verifikation/Passwortvergabe per atomarem Zustands-/Versionsvergleich. Setup-Cookie ist HttpOnly/Secure/SameSite=Strict und kein allgemeines Login. Login-Cookie bleibt HttpOnly/Secure/SameSite=Lax. Origin-Prüfung und neutrale Anforderungsantworten.

Additiv: `auth_customer_codes`, `auth_customer_invites`, `auth_customer_remembered`, `mail_order_links`, `mail_drafts.order_id`. Vorhandene Credential-, Session- und Kundentabellen bleiben maßgeblich. Beim Schemaaufbau entstehen **keine** Bestands-Einladungen. Kein Backfill. Diese Schemaänderungen wurden nur in kurzlebigen Testdatenbanken ausgeführt.

Rollback eines später separat freizugebenden Releases: vorheriges Codeartefakt wiederherstellen, additive Tabellen unangetastet lassen. Keine alten Passwörter oder widerrufenen Sitzungen aus Backups zurückspielen. Erst die Kompatibilität des Zielartefakts mit bestehenden Credential-Versionen nachweisen. Kein Rollback wurde produktiv ausgeführt.

## Nachweise

- Gesamte GitHub-Prüfkette: Node 22, `npm ci`, lint, typecheck, Code-/Integrationstests, Build, Bundle-Syntax und vorhandene Shell-/sudoers-Prüfungen. Exakte finale SHA, Joblinks und Testzahlen stehen in PR #68.
- Fokussierte Tests reproduzierten zunächst fehlende Implementierung und danach die echte Sitzungslaufzeitabweichung. Beide wurden vor grüner Abnahme behoben. Zusätzliche Tests prüfen parallele Grants, abgelaufene Setup-Cookies, Groß-/Kleinschreibung beim Rate-Limit und Sperren vor Versand.
- Integration: Betreibergrenze, zwei Aufträge mit gleicher E-Mail, unveränderte Chat-Lesestände/Audit beim Öffnen, deduplizierte Wünsche, private Notizen, Empfängerabweichung, Entwurfszuordnung, idempotenter SMTP-Versand und gesperrter Auftrag.
- Echte Chromium-Tests ausschließlich auf dem Linux-GitHub-Runner, ohne lokalen Webserver. Browserfixture führt Requests im Prozess aus; externe Anbieter sind gesperrt oder für diesen Test explizit simuliert.
- Kundenkonto: sechs Zustände auf 390/1440 px in Hell/Dunkel. Kundenakte: 320/390/768/1440 px in Hell/Dunkel, Auftragsfilter, kein horizontaler Überlauf, keine Browserfehler. E-Mail-Bestätigung: 390/1440 px in Hell/Dunkel, Inhaltsänderung nach Vorschau ohne Versand, anschließender expliziter Versand an den Testadapter.
- Bildschirmnachweise im CI-Artefakt `panel-browser-evidence`, Präfixe `AUTH001-*` und `UX005-*`. Screenshots der Konto- und Kundenaktenansichten wurden geöffnet und visuell geprüft; dieser Sichtnachweis ist unabhängig von bloßen Teststatusmeldungen.

## Bewusst erhaltene Grenzen

- Kein Merge, Deployment, produktiver Codeversand oder End-to-End-Test mit echten Kunden. Reale Mailzustellung und produktive Migration benötigen eine separate Freigabe.
- Keine Zusage physischer Safari/iOS-/Android-/Mac-/Windows-Tests oder vollständiger Screenreader-Abnahme. Nachgewiesen sind Chromium-Layouts und bestehende Regressionstests.
- WhatsApp bleibt das vorhandene System. Freie, nicht ausdrücklich einem Auftrag zugeordnete Chats werden nicht nach Telefonnummer geraten. Archivierte E-Mails ohne feste Zuordnung sind kundenbezogen und ausdrücklich „Auftrag nicht zugeordnet“.
- Die Akte ist eine begrenzte Übersicht (500 Aufträge, 100 Nachrichten je Quelle, 100 Verlaufseinträge). Originale bleiben in Auftrag/Postfach. Sie ersetzt kein vollständiges Kommunikationsarchiv und verändert beim Öffnen keine Lesestände.
- Unverändert offen aus WG-QA-004: produktive 50-MiB-Proxygrenze und HEIC. Rechtliche Texte/Datenschutzerklärung zum dauerhaften Kundenkonto benötigen Fachprüfung; es wird keine Rechtsfreigabe behauptet.

Referenzen: [Plan und Sicherheitsanalyse](plans/2026-11-08-wg-auth-001-ux-005.md), [Kundenportal](Kundenportal.md), [Draft PR #68](https://github.com/White-Gloss/white-gloss-panel/pull/68).
