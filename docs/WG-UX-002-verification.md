# WG-UX-002 – Umsetzungs- und Prüfnachweis

Stand: 07.11.2026. Design vom Betreiber ausdrücklich freigegeben.
Basis: `649469a3fd6e2680a8810641b70abbcabb162cca`.
Branch: `codex/wg-ux-002-order-evidence`. Kein Merge, kein Deployment.

## Änderungen

Vier Dokumentzeilen im bestehenden sechsten Reiter, Signaturen und Fassungen
getrennt, Vorab-Übergabeerlaubnis separat, vorhandene Rechnungsstatuslogik wiederverwendet.
Drei aufklappbare Mediengruppen; Anfragemedien ausschließlich mit `sync=false`.
Protokollfotos bleiben ihrer aktuellen, offenen oder früheren Fassung zugeordnet.
Kommunikationszugänge bewusst per Klick; Notizen und Statusformulare erhalten.
PDFs bleiben in den bestehenden Fachbereichen über „Bereich öffnen“ erreichbar;
keine neuen PDF-Endpunkte und kein Vorabrendern.

## TDD und Regression

Beobachtete rote Verhaltenstests:
- Kurzdatensatz: `false !== true` beim Ladezustand.
- Fotoabruf: ein externer Aufruf statt null trotz `sync=false`.
- Dokumentoberfläche: null statt vier Dokumentzeilen.
- Mediencontroller: null statt einem verzögerten Abruf.
- Integration: bisheriger Titel „Kundenakte & Status“ statt freigegebenem Titel.
- Vorab-Erlaubnis: fehlender separater Nachweis.
- Rechnung: „Offen“ statt „Bezahlt“ bei bereits ausgeglichenem Qonto-Beleg.
- Fehlerversuch: zweites Toggle löste ungewollten Retry aus; jetzt expliziter Retry.

Diese fokussierten Tests wurden nach der jeweiligen Änderung grün ausgeführt.
Zusätzliche Sicherheits-/MIME-/Versionstests wurden ergänzend geschrieben; für
jeden davon wird kein eigener Rot-Grün-Nachweis behauptet.

Lokale Website-Server wurden nicht gestartet. Browserprüfungen sind dem echten
Linux-GitHub-Runner vorbehalten. Der bekannte Test
„panel data directories are created and repaired through directory descriptors“
läuft lokal unter UID 0 anders: Root kann das absichtlich unzugängliche Verzeichnis
weiter öffnen. Dieser unveränderte Test wird weder entfernt noch abgeschwächt;
sein Ergebnis auf dem unprivilegierten GitHub-Runner ist gesondert zu prüfen.

## Akzeptanzmatrix

| Kriterium | Umsetzung / Prüfbeleg | Restprüfung |
| --- | --- | --- |
| A1 | Sechs Tab-IDs unverändert, direkte Rückgabe, separate Schrittannotation; jsdom-Integration | Browser |
| A2 | Reines Dokumentmodell, Original/Ersatz/Historie; Modelltests | Schlussreview |
| A3 | Slim-Ladezustand; entsorgter Mediencontroller rendert keine verspätete Antwort | Browser-Wechsel |
| A4 | Kein Autochat/PDF/Versand; Provider-Test null externe Abrufe und unveränderter Auftrag | Browser-Netzwerk |
| A5 | Echter Anwendungsrequest: 401 ohne Sitzung, 403 für Kunden, nur eigene Auftragsmedien | Bestehende Schutzregression |
| A6 | Quellenlabel, Fassungslabel, Alt-Texte, getrennte Bild/Video/PDF-Darstellung, 40er-Hinweis | Sichtprüfung |
| A7 | Bestehende Discard-Guards; neue Dokumentabsprünge und Chat geschützt | Browser |
| A8 | Deutsche Statuslabels, Signatur/Betriebserlaubnis/Versand getrennt | Sichtprüfung |
| A9 | Bestehende Tokens, Stapelung mobil, 44px Aktionen; 10 neue Browserfälle | Screenshotprüfung; echte Plattformgeräte offen |
| A10 | Lazy Loading, Leerzustand, Fehler mit bewusstem Retry, kein doppelter Abruf | Browser |
| A11 | Escaping, ausschließlich geschützte lokale Asset-URLs, unveränderte Rechte | Schlussreview |
| A12 | Vollständiger Lauf lokal und anschließend CI | Noch nicht abgeschlossen |

200%-Browserfall nutzt CSS-Zoom zur Layoutprüfung; dies ersetzt keine manuelle
Prüfung mit echter Browserzoomfunktion, VoiceOver/TalkBack oder physischen Geräten.

## Sicherheits- und Codeprüfung vor Veröffentlichung

284 versionierte bzw. neue Dateien auf private Schlüssel, gängige Tokenformate,
Credential-URLs und sensible Dateitypen geprüft. Kandidaten manuell geprüft:
synthetische Negativtests und Regex-Treffer über JavaScript-Feldgrenzen; kein
reales Geheimnis festgestellt. Keine Datenbanken, Umgebungsdateien, Kundenfotos,
Signaturdateien oder Backups im Änderungssatz. Neue Testdaten sind synthetisch.

Änderung an der Serverlogik beschränkt sich auf die explizite Unterdrückung der
Fotosynchronisation. Rechteprüfung, Assetzuordnung, Domainregeln und Versandlogik
bleiben unverändert. Keine neuen Abhängigkeiten oder Workflowänderungen.
GitHub-Release-Jobs sind ausschließlich auf main Push/Dispatch begrenzt;
Draft-PR-Prüfungen dürfen keine Veröffentlichung auslösen.

## Offene Abnahme

CI am finalen Head, heruntergeladene Screenshots tatsächlich prüfen,
veröffentlichte Dateien und Draft-PR nachlesen, Betreiberabnahme.
Produktive Daten und angemeldete Live-Aufträge bleiben ungeprüft und unverändert.
