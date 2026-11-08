# WG-QA-004 – Praxis- und Sicherheitsprüfung

Prüfdatum: 07.11.2026 (Europe/Berlin). Basis: `edaac91a49f66b4df2b1d2f371f0c16e4d1e8756`, PR #65. main und öffentliche `/healthz`-Antwort erneut identisch geprüft; HTTP 200 / `ok`, `x-panel-commit` entspricht dieser Basis. Öffentliche Prüfung um 03:36 Uhr deutscher Zeit. Die Login-Seite wurde zusätzlich lesend bei 1440×900 und 390×844 geprüft: Felder/Buttons sichtbar, keine sichtbaren Fehler oder Überbreite; keine Anmeldung oder Eingabe.

## Grenzen und Belegstufen

**Bestanden** bedeutet nur den ausdrücklich genannten Testumfang. Serverfreie Anwendungstests verwenden synthetische Aufträge, SQLite im Speicher und simulierte Anbieter. Browserprüfungen laufen ausschließlich im echten Linux-GitHub-Runner gegen dieselbe isolierte Anwendung. Kein lokaler Website-, Preview- oder Tunnelserver. Kein produktiver Kunden-Upload, Versand, Auftrag, Rechnung oder Datenänderung.

Vorhandener Release-Nachweis: [42324642961](https://github.com/White-Gloss/white-gloss-panel/actions/runs/42324642961), 729/729 Code-Tests, 89/89 Browserfälle. [Browserartefakt](https://github.com/White-Gloss/white-gloss-panel/actions/runs/42324642961/artifacts/13554951130). Vorherige visuelle Prüfung der bytegleichen PR-Version dokumentiert in PR #65. Der finale neue QA-Head, neue Lauf und Screenshotbewertung werden im QA-Draft mit exakten IDs ergänzt; keine implizite Livefreigabe.

## QA-Matrix

| ID | Konkreter Akzeptanzfall | Status / Beleg | Praxisgrenze |
| --- | --- | --- | --- |
| A01 | Einladung nur bewusst, pro Auftrag/Adresse einmal | Bestanden: `tests/providers.test.mjs`, explicit portal invitations | echte Zustellung nicht prüfbar |
| A02 | Kundenlogin nur eigene Adresse; Link + PIN; abgelaufen/falsch/verbraucht abweisen | Bestanden: `tests/password-pin.test.mjs`, `auth-compat.test.mjs`, `portal.test.mjs` | kein produktiver Login ausgelöst |
| A03 | Stunden, Komma, halbe/individuelle Werte, Ende und DST | Bestanden: `tests/appointment-hours.test.mjs`, `calendar.test.mjs`, FLOW003-Browserfälle | physische Geräte offen |
| A04 | Eine Angebots-/Terminunterschrift; alte Fassung/PDF geschützt; Konflikte vor Signaturspeicherung | Bestanden: `tests/combined-offer.test.mjs`, sieben Fälle inkl. paralleler Annahme und Kalenderkonflikt | echte Signatur nicht angefordert |
| A05 | „Termin passt nicht“ bleibt Wunsch, Chat gezielt öffnen; gesperrten Chat nicht reaktivieren | Bestanden: `tests/portal.test.mjs`, `portal-ui.test.mjs` | echte Kundenkommunikation ausgeschlossen |
| B01 | 72h nur nach rechtzeitiger echter Terminbestätigung, nicht Status allein | Bestanden: `tests/workflow.test.mjs` dueJobs / timely confirmation | Schedulerlauf und Mailzustellung live nicht provoziert |
| B02 | Terminversion, Neustart, unbekanntes Providerresultat und Wiederholung ohne Doppelversand | Bestanden: `tests/providers.test.mjs`, `workflow.test.mjs` | Anbietersimulation, kein realer Versand |
| B03 | Bring-/Abhol-/Abwesenheitswunsch ändert keine Preise oder unterschriebene Buchung | Bestanden: `tests/portal.test.mjs` handover preference | keine operative Vereinbarung getestet |
| B04 | Kontaktlose Übergabe braucht Zustimmung, Ort und Signatur; Widerruf nur eigener unverbrauchter Fassung | Bestanden: `tests/portal.test.mjs`, `portal-ui.test.mjs` | rechtliche Fachprüfung separat |
| B05 | Terminänderung entwertet vorherige Erlaubnis, bewahrt Historie; Betriebsunterschrift sperrt Widerruf | Bestanden: `tests/workflow.test.mjs`, `portal.test.mjs`; Code `handoverView`/`uebergabe`/Widerruf | tatsächliche Fahrzeugübergabe nicht prüfbar |
| C01 | Zustandsfelder optional, fehlend nicht „mängelfrei“; Rückgabe unabhängig von Annahme | Bestanden: `tests/workflow.test.mjs`, `order-workspace.test.mjs`, bestehende Auftragsbrowserfälle | keine produktiven Protokolle geändert |
| C02 | Eigene/fremde Aufträge, private Legacy-Bilder, Signaturen/Belege/Vorschauen strikt getrennt | Bestanden: `tests/portal.test.mjs` shared gallery / pagination; Code `server/order-media.mjs` | keine Kundendaten abgerufen |
| C03 | Originale bis exakt 52.428.800 Bytes, Oversize/ungeeignete Formate abweisen | Bestanden: `tests/portal.test.mjs` tatsächliche gültige 50-MiB-PNG über beide Rollen; `order-media.test.mjs` | vollständiger HTTP-/Proxyweg live nicht prüfbar |
| C04 | Originalbytes erhalten; Vorschau getrennt; paralleler Retry erzeugt ein Original | Bestanden: `tests/portal.test.mjs` parallel gallery retries | reale Kamera-/EXIF-Darstellung offen |
| C05 | 26 Bilder über 24er-Pagination vollständig; Abschnittfilter; nur Betreiber darf Metadaten ändern, stale revision 409 | Bestanden: `tests/portal.test.mjs` | große reale Galerien/Last nicht getestet |
| C06 | Abbruch während aktivem Originalupload | Bestanden: neuer serverfreier UI-Test | kein Rückgängigmachen bereits serverseitig gespeicherter Bilder versprochen |
| C07 | Abbruch/Verlassen während Vorschauerzeugung stoppt weitere Originale | **Fehlgeschlagen auf Releasebasis**, isoliert korrigiert: neue UI-Tests, drei relevante rote Assertions, danach 4/4 grün | noch nicht produktiv behoben |
| C08 | Filter/Pagination ersetzen kein aktives Uploadformular | **Fehlgeschlagen auf Releasebasis**, isoliert korrigiert: Filtersperre + handler guard | noch nicht produktiv behoben |
| D01 | Rechnung nur explizit, korrekte Fassung, Zugriff, keine doppelten Provideraktionen | Bestanden im vorhandenen isolierten `qonto.test.mjs`, `qonto-gateway.test.mjs`, `protocol-mail.test.mjs` | Qonto/Bank/realer Mailweg nicht invasiv geprüft |
| D02 | Bewertungsmail nur mit Einwilligung, 168h nach Abschluss, keine Wiederholung | Bestanden: `tests/workflow.test.mjs`; bestehender Versandzeitpunkt unverändert | Marketingeinwilligungen realer Kunden nicht gelesen |
| D03 | Hell/Dunkel, 390/768/1440, Navigation, Unterschrift/übersprungene Schritte | Vorhandene 12 FLOW003-Viewportaufnahmen geprüft; neue Browserregression und Sichtnachweise im QA-Draft | kein universeller Plattform-/Screenreaderbeleg |
| E01 | Produktiver Caddy lässt exakt 50-MiB-Originale durch | **Nicht prüfbar**: keine Serverkonfigurationsschnittstelle verfügbar; Vorlage allein kein Nachweis | kein Upload in Produktivdaten erlaubt |
| E02 | HEIC auf iPhone | **Fehlgeschlagen / bekannte Funktionsgrenze**: bewusst nicht unterstützt, verständliche Ablehnung | neue Decoderfunktion nicht Teil dieses Fixes |
| E03 | Physische iOS/Safari/Android/Mac/Windows und Screenreader | **Nicht prüfbar**: keine entsprechenden Testgeräte/AT verfügbar | Chromium-Emulation reicht nicht |
| E04 | Tatsächlicher Mailzugang/Posteingang, Produktivschnittstellen-End-to-End | **Nicht prüfbar** ohne freigegebenes isoliertes E2E-System | keine echten Nachrichten erzeugt |

## Defekte und Priorität

**P1 – QA004-01: Abbruch wird zwischen Dateien nicht eingehalten.** Reproduktion: zwei Bilder wählen, erstes Original erfolgreich, lokale Vorschau noch ausstehend; Abbrechen klicken oder Galerie verlassen. Auf Releasebasis startet danach trotzdem `second.png`. Ursache: nur letzter XHR wurde abgebrochen, obwohl dieser schon abgeschlossen war; keine batchweite Abbruchprüfung nach dem asynchronen Decoder. Auftragsdaten werden dadurch gegen die aktuelle Nutzerabsicht weiter hochgeladen. Kein fremder Auftragszugriff nachgewiesen.

Fix ausschließlich im Entwicklungsbranch: batchweites AbortSignal, Prüfungen vor weiteren Originalen und Vorschauanforderungen, Abbruch beim Unmount. Bereits gespeicherte Originale bleiben erhalten, bewusstes Wiederholen verwendet vorhandene serverseitige Deduplizierung.

**P2 – QA004-02: Aktives Uploadformular durch Filter/Pagination ersetzbar.** Die alte UI ließ diese Bedienelemente während Upload aktiv. Fix: vorübergehend deaktiviert und Handler gesperrt; während Upload eintreffende Listenantwort rendert nicht über das Formular. Kein Recht oder Geschäftsprozess geändert.

**P2 – QA004-03: Historische Unterlagen widersprechen Release/Standardablauf.** FLOW003-Abnahme nennt noch „kein Merge/Deployment“, Kundenportal beschreibt den alten getrennten Standard. Aktuelle Korrekturhinweise ergänzen belegten Release und gemeinsame Angebots-/Terminannahme; historische Details bleiben erkennbar.

**Abnahmeblocker, keine erfundene Fehlerdiagnose:** Proxygrenze unbekannt; HEIC bekannte Lücke; echte Geräte und Zustellung fehlen. Keine Behauptung, Caddy sei nachweislich falsch konfiguriert.

## Sicherheitsreview

Schutzgüter: private Bilder, Signaturen, Schlüsselorte, Dokumentfassungen, Zugangsdaten und Versandidentitäten. Grenzen: Kunde→authentifizierte API→Auftrag/Assets; Betreiber→explizite Freigabe; Scheduler→Provider.

Geprüft: Auth-/Eigentumsprüfung pro Galerieabruf, parametrisierte SQL-Abfragen, getrennte Freigabe privater Altbilder, escaped UI-Metadaten, serverseitige Größen-/Typgrenzen, Originprüfung, CAS/Versionsprüfung, keine GET-Schreibaktion, kein Schlüsselort in neuen Benachrichtigungstexten, keine automatisch wiederholten ungeklärten Versände. Bildprüfung ist Container-/Signaturprüfung, kein vollständiger Schadsoftware- oder Decoderbeweis. Originale können EXIF-Metadaten enthalten; UI weist darauf hin.

`npm audit --json`: 0 bekannte Schwachstellen (411 Abhängigkeiten), keine Paketänderungen. Lint/Typecheck/Build/Bundle-/Shellsyntax bestanden. Neue Abbruchtests: Rot 3 Fehler/1 bestanden; identischer Befehl danach 4/4 bestanden. Erste fehlerhafte Testfixture wurde vor dem relevanten Rotlauf berichtigt und nicht als Verhaltensnachweis gewertet. Der bekannte UID-0-Installertest wird nicht entfernt; endgültiger Runnernachweis im Draft.

Panel-/Hostinger-spezifische Live-Werkzeuge konnten gezielt nicht gefunden werden. **Der Live-Abruf ist in diesem Turn nicht verfügbar** (angemeldete Paneldaten/Serverkonfiguration). Öffentliche HTTPS-GET-Prüfungen sind davon getrennt und oben belegt. Keine Behauptung einer global fehlenden Verbindung.

## Empfehlung WG-UX-005 – fokussiert, noch keine Umsetzung

Zuerst die praktische Abnahme von Abbruch/Retry und produktivem Proxy abschließen. Danach nur drei eng begrenzte CRM-/Kommunikationsverbesserungen planen:

1. **Auftragsbezogener Kommunikationsverlauf:** vorhandene Chat-/Mailnachweise zusammen anzeigen, Herkunft und Status „Entwurf / an Anbieter übergeben / zugestellt / unklar“ eindeutig trennen. Kein automatischer Neuversand und keine neue Plattform.
2. **Kundenwünsche als Arbeitsliste:** Termin passt nicht, Übergabewunsch und offene Rückfragen mit Auftragslink, Bearbeitungsstand und bewusster Antwortaktion. Kein stilles Ändern von Termin, Preis oder Leistung.
3. **Einheitliche Kontakte und bewusster Versand:** vorhandene Kundenakte wiederverwenden, Empfänger und Auftrag vor Versand sichtbar prüfen; interne Notizen strikt von kundenfreigegebenen Informationen trennen.

Abnahme für UX005: keine zusätzlichen Provideraufrufe beim bloßen Lesen, keine fremden Aufträge, keine doppelte Zustellung, Tastatur-/Mobilbedienung und klare Fehler-/Leerzustände. Designfreigabe vor wesentlichen visuellen Änderungen; WhatsApp erst nach eigenständig belegter Integration einplanen.

Ausführungshinweis: Ein erster vollständiger lokaler Testversuch überlappte versehentlich mit dem Neuaufbau von `dist` und erzeugte deshalb fehlende Builddateien. Dieser Lauf ist kein Produktdefektnachweis; die vollständige Suite wurde danach über `npm test` mit vorgeschaltetem, abgeschlossenem Build erneut gestartet.

Erneuter vollständiger lokaler Lauf (`npm test`, Build davor abgeschlossen): **733 Tests, 732 bestanden, genau 1 Fehler** – unveränderter UID-0-Installertest. Keine übersprungenen Tests. Sicherheitsmustersuche über 297 versionierte/neue Projektdateien: keine konkreten Credential-Mustertreffer; sieben neue/geänderte Dateien manuell geprüft. Keine Geheimnisse, Kundenbilder, Datenbanken oder Umgebungsdateien im Diff.
