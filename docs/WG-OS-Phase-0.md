# White-Gloss OS – Phase 0 und Übergabe

Stand: 08.11.2026, Europe/Berlin. Grundlage: das Master-Briefing des Betreibers,
aktuelle Repository-Abfragen und die unten genannten Prüfnachweise.

## Auftrag und Grenze dieser Änderung

Diese Phase prüft den Bestand, verhindert doppelte Entwicklung und behebt einen
konkreten Fehler bei Agentenauskünften: Ein eingetragener Terminvorschlag war bisher
ohne Bestätigungsnachweis als `appointment` sichtbar. Die Korrektur trennt bestätigte
Termine von Vorschlägen. Es entsteht hier noch kein ChatGPT-MCP-Dienst.

Der aktuelle Auftrag erlaubt ausschließlich einen geprüften Entwicklungsbranch und
Draft-PR. Die älteren automatischen Releasefreigaben in AGENTS.md/Roadmap gelten für
diesen Auftrag nicht. Kein Merge, kein Push auf main, kein Deployment, keine
Produktivmigration, keine Änderung von DNS, Secrets oder echten Kundendaten.

## Nachweisbarer Ausgangsstand

| Bereich | Am 08.11.2026 überprüfter Stand | Beleg / Grenze |
| --- | --- | --- |
| Panel main | `b08158596e23f96f05382382fce918a9aaa5fb78`, Merge PR #67 | GitHub-Branchabfrage; ersetzt die ältere Briefingbasis `1ad5575` |
| Letzter geprüfter Panelrelease | Hostinger-Release erfolgreich für `b081585` | [Lauf 42442156232](https://github.com/White-Gloss/white-gloss-panel/actions/runs/42442156232), Job `128613821720`, Log 08.11.2026 04:20:34 MEZ: „Hostinger-Panel veröffentlicht und über HTTPS geprüft: b08158596e23f96f05382382fce918a9aaa5fb78“ |
| Öffentliche Erreichbarkeit | `/healthz` liefert `ok`; `/kunde` zeigt im vorhandenen Betreiber-Browser die gesperrte Vorschau | Lesende Browserprüfung; kein direkter aktueller Commit-Headernachweis, kein Kundenlogin getestet |
| Kundenkonten / Kundenakte | [PR #68](https://github.com/White-Gloss/white-gloss-panel/pull/68), offen und Draft | Head `b07c9d0ae006c4c9ff713368d033d71a282cd027`, Basis `b081585`; nicht erneut entwickeln |
| Parallel entstehende MCP-Anbindung | [PR #69](https://github.com/White-Gloss/white-gloss-panel/pull/69), offen und Draft, während dieser Phase entdeckt | Abgefragter Head `bf9e72c5c019ead36a90cf9d8b963ee8b28ad2f8`; eigene MCP-/OAuth-Implementierung vorhanden, noch nicht mit ChatGPT verbunden/veröffentlicht. Keine zweite Implementierung beginnen. |
| Prüfung PR #68 | 771 Code-/Integrationstests und 107 Chromiumtests erfolgreich | [Lauf 42445729400](https://github.com/White-Gloss/white-gloss-panel/actions/runs/42445729400); je null Fehler/Abbruch/Skip; Releasejobs übersprungen |
| Website | [PR #323](https://github.com/White-Gloss/glanz-buchung-meister/pull/323) weiter offen und Draft | Head `66fac5d1879f6988e3c588439de33794b292d5ed`; keine Websiteänderung in dieser Phase, keine erneute Website-Abnahme |
| Hostinger-VPS | Eine laufende KVM-4-Instanz, Ubuntu 24.04 LTS, 4 CPUs / 16 GiB RAM | Hostinger-API lesend; dies beweist keine einzelnen Dienste oder aktive Serverkonfiguration |
| Hostinger-Sicherungen | Zwei Sicherungspunkte vorhanden: 04.11.2026 05:21:11 MEZ und 27.10.2026 09:42:45 MEZ | API vollständig paginiert: zwei von zwei; keine Wiederherstellung und keine Konsistenz-/Vollständigkeitsprüfung der Paneldaten |
| Panel-App in diesem Chat | Gezielte Werkzeug- und Pluginsuche lieferte keine White-Gloss-Panel-Fachwerkzeuge | Der Live-Abruf ist in diesem Turn nicht verfügbar. Dies ist keine Aussage über andere Chats oder globale Installation. |

Die Testzahlen von PR #68 gehören ausschließlich zu dessen Head. Sie sind kein
Testbeleg für diesen Branch. Der neue Prüflauf wird im Draft mit exakter SHA genannt.

## Gelesene Projektgrundlagen

AGENTS.md, README.md, Roadmap, Bestandsaufnahme, Kundenportal, Communication-Center,
Obsidian-und-Platin, WG-FLOW-003-Abnahme, WG-QA-004,
Protokoll-Kunde-nicht-vor-Ort, Hostinger-Umzug, Hermes-Integration sowie
WG-AUTH-001-UX-005 am Head von PR #68. Zusätzlich: Prüfworkflow, Paketdefinition,
Agentenlogik, Anwendungsrouting, Domain-Terminlogik und bestehende Agententests.

Die Bestandsaufnahme/Roadmap vom 03.11.2026 enthalten historische offene Punkte.
Sie dürfen nicht ohne Code-/PR-Abgleich als aktuelle Funktionslücken übernommen
werden. Alte IONOS-Angaben beschreiben nicht automatisch die aktuelle Laufzeit.

## Bestand und fachliche Reihenfolge

| Paket | Stand | Nächste konkrete Arbeit |
| --- | --- | --- |
| WG-FLOW-003 / WG-QA-004 | Geschäftsablauf und Galerie im main; QA-Korrekturen vor `b081585` enthalten | Reale Proxygrenze, Geräte und Zustellung getrennt abnehmen |
| WG-AUTH-001 | Dauerhafte Kundenkonten in PR #68 implementiert und dort geprüft | Bestehenden Draft fachlich abnehmen; keine zweite Authentifizierung entwickeln |
| WG-UX-005 | Kundenakte, Kommunikationszuordnung und offene Wünsche in PR #68 | Bestehenden Draft prüfen; seine Änderungen nicht duplizieren |
| WG-MCP-001 | Kein MCP-Server im main; REST-Lesebrücke für Hermes vorhanden. Neue MCP-/OAuth-Arbeit parallel in PR #69 | Vorhandenen Draft anhand der [Abnahmekriterien](specs/WG-MCP-001.md) prüfen; keine zweite Implementierung |
| WG-AI-001 | Bestehender API-Assistent und vorbereitete Hermes-Anbindung; kein bestätigter geeigneter Modellzugang für alle Ziele | Vor Erweiterung Modellweg, Datenumfang und Betreiberfreigaben nachweisen |
| WhatsApp-Automatisierung | Testversand/Verbindungsprüfung aus PR #67 im veröffentlichten main | Empfang, Identitätsabgleich und erlaubte Schreibaktionen gesondert nachweisen; keine automatische Kundenanlage aus einer Nummer ableiten |
| WG-PRICE-001 | Strategische Produktanforderung | Freigegebene Erfahrungsdaten, Bewertungskriterien und manuell geprüfte unverbindliche Vorschläge planen |
| Plattformoptimierung | PWA und bestehendes Obsidian-&-Platin-Design vorhanden | Geräte-/Assistenztechnik-Abnahme, HEIC, Leistung und Wiederherstellbarkeit; keine Entscheidung für Capacitor/Tauri getroffen |

Weitere offene PRs bei Bestandsaufnahme: #55, #32, #28, #16, #15 und #1.
Keine automatische Zusammenführung oder Schließung. #1 hat ein anderes Basisbranch.
Die neue Korrektur berührt keine von PR #68 geänderte Datei. Vor jeder späteren
Integration erneut main, PR-Heads und mögliche Konflikte prüfen.

Nachtrag zur laufenden Bestandsaufnahme: PR #69 entstand während dieser Arbeit.
Deshalb wird das zunächst formulierte MCP-Konzept als Abnahme- und Abgleichsliste
weitergeführt. Seine konkreten Implementierungsentscheidungen werden nicht durch
eine ungeprüfte konkurrierende Architektur ersetzt. Der Terminfix hier betrifft
die bereits vorhandene Hermes-Brücke; PR #69 bleibt eigenständig.
Auch die Dateiliste von PR #69 überschneidet sich nicht direkt mit dieser Korrektur.
Seine MCP-Abbildung ist jedoch eigenständig: unser Fix korrigiert deren
Terminsemantik nicht automatisch. Konkrete Befunde am geprüften MCP-Head
`feabaa7f9203358cb7b312fba898a96a51957d4f` stehen in der Abnahmeliste.

## Korrektur: Termine im Agentenkontext

Auslöser: `server/agent.mjs` exportierte `appointment.start/end` unabhängig von
`appointment.confirmation`. Der bisherige Bridge-Test erwartete diese Daten sogar
bei einem Auftrag im Zustand „Neu“ ohne Bestätigung. Das ist für eine verbindliche
Terminauskunft unzureichend.

Neuer Vertrag für die bestehende Lesebrücke und deren Hermes-Kontext:

- `appointment` enthält nur den aktuellen Termin mit ausdrücklichem
  Bestätigungsnachweis nach der vorhandenen Domainsemantik.
- `appointmentProposal` kennzeichnet einen vorhandenen unbestätigten Termin.
- Kundenwünsche (`requestedDate` / `requestedTimeWindow`) und Auswahlvorschläge
  (`appointmentOptions`) werden nicht zu bestätigten Terminen hochgestuft.
- Ein Status allein ersetzt keinen Bestätigungsnachweis. Historische Altdaten ohne
  Nachweis bleiben unbestätigt.
- Stornierte Aufträge liefern keinen aktuellen Termin oder Terminvorschlag;
  gespeicherte historische Daten werden nicht verändert.
- Signaturen, Schlüsselorte, interne Notizen, Zugangsdaten und Originalobjekte
  werden nicht zusätzlich exportiert. Die explizite Feldbegrenzung bleibt bestehen.
- Die bestehenden 20-Auftrags-/65.536-Byte-Grenzen und `truncated` bleiben erhalten.
  Auch nach dem Fix ist die Bridge keine vollständige Kalenderabfrage.

Keine neue Datenbanktabelle, Migration, Abhängigkeit, Route oder Freigabevariable.
Die vorhandene Hermes-Bridge bleibt separat autorisiert und standardmäßig nur bei
ausdrücklicher Laufzeitaktivierung erreichbar. Diese Änderung aktiviert sie nicht.

## Offene Risiken und Voraussetzungen

| Punkt | Einstufung / Folge |
| --- | --- |
| MCP-Protokoll und OAuth im main noch nicht vorhanden | PR #69 implementiert einen Entwicklungsstand. Vor Abnahme dessen Autorisierung, Betreiberbindung, Scopes, Widerruf und Transport unabhängig prüfen. Eine bestehende REST-Bridge ist keine MCP-App. |
| Konto-/Workspace-Unterstützung | Die konkrete Möglichkeit, eine eigene MCP-Verbindung einzurichten, wurde im Benutzerkonto nicht nachgewiesen. Keine Tarifzusage aus allgemeinen Hilfeseiten ableiten. |
| Datenfreigabe für externe KI | Bestehende Betreiberrechte sind keine pauschale Freigabe aller Daten an Modelle. Gesperrte/anonymisierte Akten, interne Felder, Fotos und Belege brauchen eine definierte Exportregel. |
| Fachlich reine Lesezugriffe | Die REST-Bridge verwendet SELECT. Andere vorhandene GET-Routen können Wartung oder Sitzungsaktivität schreiben; nicht pauschal als nebenwirkungsfreie MCP-Adapter verwenden. |
| Galerie / HEIC | Produktive 50-MiB-Proxygrenze, iPhone-HEIC und reale Kamera-/EXIF-Darstellung sind weiterhin nicht vollständig abgenommen. Keine Änderung in diesem Paket. |
| Sicherungen | Sicherungspunkte sind nachgewiesen, Wiederherstellbarkeit und Transaktionskonsistenz nicht. Keine Produktivmigration auf dieser Grundlage freigeben. |
| Serverhärtung | Historische Aussagen über SSH/Root/Docker wurden hier nicht serverseitig neu bestätigt. Keine veraltete Konfiguration als aktuellen Defekt ausgeben. |
| Screenshot-Artefakte | Lauf 42445729400 meldet Namenskollisionen bei zwölf `flow003-…png`-Dateien. Teststatus bleibt erfolgreich; Upload ist kein Beweis, dass jede Aufnahme eindeutig erhalten ist. |
| Reale End-to-End-Abnahme | Mailzustellung, Kundenlogin, WhatsApp-Empfang, echte Übergaben, physische Geräte und Screenreader separat prüfen; keine echten Aktionen zum Test ausgelöst. |

## Prüfung, Rückweg und nächste Übergabe

Regressionstests prüfen die echte SQLite-Abfrage ohne Website-Server: unbestätigter
Termin, bestätigter Termin, manuelle Bestätigung, Status ohne Nachweis, Stornierung,
Kundenwunsch/Vorschlagsliste und unveränderte Daten beim Lesen. Bestehende
Bridge- und Hermes-Tests sichern Autorisierung, Datenbegrenzung und Kontextweitergabe.

Die vollständige Regression (Lint, Typprüfung, Code-/Integrationstests, Build,
Bundle-/Shell-/sudoers-Prüfung und Chromium) läuft über den bestehenden Linux-CI-Weg.
Lokal wird kein White-Gloss-Server gestartet. Neue UI ist nicht Teil dieses Pakets;
eine neue physische Geräteabnahme wird nicht behauptet.

Lokaler Nachweis auf Windows / Node 24.22.1: derselbe Befehl
`node --test tests/agent-appointments.test.mjs` scheiterte auf der Ausgangslogik
in allen fünf neuen Fällen und bestand nach der Korrektur mit 5/5 Tests. Erneute
unabhängige Ausführung ebenfalls 5/5; Syntax aller drei JavaScript-Dateien geprüft.
Unabhängiger Review gegen main ergab keine blockierenden Befunde im begrenzten
Fix. Der produktionsnahe Node-22-/Linux-Nachweis bleibt die gesamte GitHub-Prüfkette.

Der endgültige Draft nennt Head, Lauf, tatsächliche Testergebnisse und verbleibende
Grenzen. Eine Code-Rücknahme benötigt keine Datenmigration. Sie würde allerdings
die unklare Terminsemantik wiederherstellen; bei einem notwendigen späteren Rollback
die Agentenanbindung bis zur Korrektur nicht für verbindliche Terminauskünfte nutzen.

Nächster Entwicklungsabschnitt: bestehenden WG-MCP-001-Draft #69 anhand der verlinkten
Kriterien abnehmen und gezielt vervollständigen. Keine neue MCP-Parallelentwicklung.
PR #68 bleibt eigenständige Arbeit.
Keine Aktivierung oder Veröffentlichung wird durch diesen Bericht freigegeben.
