# WG-FLOW-003 – Implementierung und Abnahme

Basis: `de73465b0ec7f7103beff2cacb810f36ad2ca04c` (PR #64/WG-UX-002 auf main).
Entwicklungsbranch: `codex/wg-flow-003-customer-journey`.
Aktualisierung 07.11.2026: PR #65 wurde nach gesonderter Betreiberfreigabe als `edaac91a49f66b4df2b1d2f371f0c16e4d1e8756` gemergt und mit [Lauf 42324642961](https://github.com/White-Gloss/white-gloss-panel/actions/runs/42324642961) auf Hostinger veröffentlicht. 729 Code- und 89 Browsertests bestanden. Die nachfolgenden Vorlaufangaben sind historisch; neue QA-Befunde stehen in [WG-QA-004](WG-QA-004.md). Die neue QA-Freigabe erlaubt keinen weiteren Merge oder Release.

## Umgesetzt

- Stundenbedienung mit Dezimalkomma, halben und individuellen Stunden; Minuten-API und zeitzonensichere Endzeit bleiben erhalten.
- Bestehende gemeinsame Angebots-/Terminunterschrift bleibt unverändert. „Termin passt nicht“ erfasst einen Wunsch und öffnet bewusst den bestehenden Kundenchat; keine automatische Ablehnung oder Preisänderung.
- Portalzugang für vorhandene Auftrags-E-Mails bleibt erhalten. Explizite Betreiber-Einladung ist je Auftrag/Adresse gegen doppelte Zustellung abgesichert. Keine automatische Aktivierung neuer Versandjobs für Bestandskunden.
- 72-Stunden-Erinnerung nur bei nachgewiesener, rechtzeitiger Bestätigung. Versand pro Termin-/Bestätigungsfassung; alte und ungeklärte Versandjobs werden berücksichtigt. Kurzfristige Bestätigung löst keine automatische Sofortmail aus.
- Kunden können „selbst bringen“, „Abholung anfragen“ oder „nicht vor Ort“ als Wunsch melden. Bestehende Leistungen und Preise werden dadurch nicht verändert.
- Bestehende Vorab-Schlüsselregelung bleibt getrennt von der finalen Protokollunterschrift. Widerruf vor dem unterschriebenen Protokoll mit unveränderter Historie. Materielle Terminänderungen entwerten noch nicht vollzogene Vorab-Erlaubnisse. Keine neuen Rechtsformulierungen.
- Schlüsselablageorte werden nicht mehr in Benachrichtigungstexte übernommen.
- Gemeinsame, paginierte Fahrzeuggalerie mit expliziter Kundenfreigabe, Abschnitten, Herkunft, Datum, Beschreibung und aktuellen Protokollbezügen. Alte private Fotos bleiben intern; fehlende Herkunft/Abschnitte werden als unbekannt ausgewiesen.
- Mehrfachauswahl, Kameraeingang, Fortschritt, Abbruch und sicherer Wiederholungsupload. Unveränderte Originale, lokal berechnete Vorschaubilder, kein externer Bilddienst. Zulässige neue Galerieformate: JPEG, PNG, WebP.
- Exakte Grenze 52.428.800 Byte (50 MiB) in Galerie/Protokoll-Upload und passender versionierter Proxyvorlage. Andere API-Anfragen behalten ihre bestehende Laufzeitgrenze; globales Pufferbudget wird wegen größerer Originale von 96 auf 64 MiB gesenkt.
- Vorhandene optionalen Protokollfelder, unabhängigen Schritte, Rechte, Rechnungen und Anbieterfreigaben bleiben erhalten.

## Nachweise und noch laufende Prüfungen

- Stunden-/DST-Tests zuerst mit fehlschlagender Minimalimplementierung, danach erfolgreich.
- Neue Tests für echte Terminbestätigung statt Status allein, Widerruf, Sperre nach Betreiberunterschrift, Terminänderungen und Übergabewünsche zuerst rot, danach erfolgreich.
- Tests für mandantengetrennte Galerie, private Bestandsfotos, nebenwirkungsfreie Abrufe, parallele Wiederholung, unveränderte Originale/Vorschauen, Dateigrenze und Typprüfung.
- Letzter vollständiger lokaler Lauf: 726/727 Tests bestanden; anschließend zusätzlich der neue Paginationstest bestanden. Der bestehende Test „panel data directories are created and repaired through directory descriptors“ scheitert unter UID 0. Nicht entfernt oder abgeschwächt; Bestätigung auf unprivilegiertem GitHub-Runner ist Pflicht.
- Lint, Typecheck, Build, Syntax des Serverbundles und Shell-Syntax bestanden. Der erste GitHub- und Screenshot-Nachweis ist unten dokumentiert. Den aktuellen Head-Prüfstand und die nachfolgenden Galerieaufnahmen führt [PR #65](https://github.com/White-Gloss/white-gloss-panel/pull/65).
- Browserprüfung ausschließlich auf echtem Linux-GitHub-Runner. Kein lokaler Website-Server gestartet.

## Offene Abnahmegrenzen

1. HEIC ist nicht implementiert. Die UI weist auf lokale Konvertierung hin. Kein behaupteter universeller iPhone-Fotoupload.
2. Chromium-Prüfungen ersetzen keine echten iOS/Safari-/Android-/Mac-/Windows- und Screenreader-Tests.
3. Produktiver Hostinger-Proxy und produktive Uploadgröße sind nicht verändert oder live geprüft. Die Caddy-Vorlage allein belegt keine produktive Freigabe.
4. Der bestehende Chat behält seine Metadatenbereinigung und 15-MB-Dateigrenze; 50-MiB-Originale gehören in die neue Galerie. Vorhandene Chat-Anhänge bleiben im bisherigen Chat erreichbar; die neue Galerie übernimmt keine privaten oder ungesendeten Chat-Anhänge automatisch.
5. Bestehende Protokollbilder bleiben privat, bis ausdrücklich geteilt; neue Galeriezuordnung ändert keine bereits unterschriebenen Dokumente.
6. Die bestehende Bewertungsmail bleibt einwilligungsgebunden 168 Stunden nach Abschluss. Sie wird nicht still auf „direkt nach Rechnung“ umgestellt.
7. Keine tatsächliche Mailzustellung, Kundenbuchung, Rechnung oder reale Übergabe getestet. Alle Testdaten sind synthetisch.
8. Die abschließende Betreiberabnahme bleibt offen. Der jeweils aktuelle CI- und visuelle Prüfstand ist in PR #65 mit Commit und Lauf vermerkt.

## Sicherheits- und Code-Review vor Branch-Push

Aktueller Dateibestand (293 Dateien beim ersten Scan), 158 Basiscommits und 1.093 historische Blobs auf konkrete Token-/Schlüssel-/Private-Key-Muster geprüft: keine Treffer. Keine Datenbanken, Umgebungsdateien, Backups, Kundenuploads oder vertraulichen Laufzeitkonfigurationen im neuen Diff. Neue Fixtures verwenden synthetische Namen, `.invalid`-Adressen und lokal erzeugte IDs.

Manuell geprüft: Authentifizierung und Auftragseigentum bei jedem Galerieabruf; private Legacy-Dateien; ausgeschlossene Signaturen/Belege/Protokollvorschauen; versionsgesicherte Metadatenänderungen; parallele Uploadwiederholungen; Speichergrenzen; unveränderliche Originale; keine Schreibaktion beim Lesen; Widerrufssperren; Terminversionsprüfung unmittelbar vor Mailversand; kein Auto-Retry bei unklarem Providerresultat. Die Mustersuche ist kein mathematischer Beweis für Geheimnisfreiheit.

Workflow geprüft: Pull Requests führen Code- und Browserjobs aus. Releasejobs setzen `refs/heads/main` und Push/Workflow-dispatch voraus. Dieser Draft löst keinen produktiven Release aus.

## Erster GitHub-Nachweis und visuelle Nacharbeit

Commit `d71b4e68564f9b83f5f05507ddaaa46a57f975d1`, Lauf [42321598235](https://github.com/White-Gloss/white-gloss-panel/actions/runs/42321598235): **728/728 Code-Tests und 89/89 Browsertests bestanden**. Der lokal unter Root fehlschlagende Installertest bestand auf dem GitHub-Runner. Beide Releasejobs wurden übersprungen.

Die zwölf FLOW003-Aufnahmen (Betreiber/Kunde × Hell/Dunkel × 390/768/1440) wurden geöffnet und visuell geprüft. Lesbarkeit, Statusunterscheidung und Farbgestaltung entsprechen dem bestehenden Design; keine horizontale Seitenüberbreite. Die Smartphone-Kundennavigation zeigte jedoch nur einen seitlich scrollbar erreichbaren Teil der Ziele. Deshalb werden alle Ziele nun mehrzeilig angezeigt, mit direktem Fahrzeugfotozugang. Die Galerie erhält explizite Abschnittsgruppen und einen Abschnittsfilter. Für die separaten Betreiber-Scrollbereiche werden zusätzliche Galerieaufnahmen erfasst; der erste Desktop-/Tablet-Screenshot allein zeigte dort nur den oberen Bereich. Die Bilddatei ist eine synthetische Pixel-Fixture, kein Beleg für reale Fahrzeugfotoqualität.

Die visuelle Nacharbeit wird über denselben Draft erneut geprüft; den konkreten Folge-Commit, CI-Lauf und die bewerteten Galerieaufnahmen dokumentiert die PR-Beschreibung. Keine Produktionsfreigabe aus einem grünen Lauf ableiten.

Der zusätzliche 50-MiB-Grenztest verwendet eine synthetische gültige PNG mit privatem Padding-Chunk und prüft Upload über beide Rollen, Byteerhalt und Duplikatsperre. Nach erfolgreicher separater Ausführung ist er Bestandteil der Regressionstests. Der alte 15-MB-Hinweis am Buchungsfotoformular wurde an die neue Grenze angepasst.
