# Hermes-Integration: Panel-Chat und Betreiber-WhatsApp

## Umfang der ersten Ausbaustufe

Diese Integration verbindet das eigenständige White-Gloss-Panel mit Hermes, statt den bestehenden OpenAI-Prüfassistenten zu ersetzen:

1. **Panel → Hermes:** Betreiber-Chat über die serverseitige Hermes Chat Completions API. Der Browser erhält keinen Hermes-Schlüssel.
2. **Hermes → Panel:** Native Hermes-Erweiterung mit dem ausschließlich lesenden Werkzeug `white_gloss_context`. Damit kann ein dafür autorisierter Betreiber-WhatsApp-Chat dieselben begrenzten CRM-Zusammenfassungen abfragen.

Der erste Datenumfang besteht aus Auftragszahlen und begrenzten Auftragszusammenfassungen einschließlich Kunde/Fahrzeug/Paket/Status. Das ist **noch kein Vollzugriff auf E-Mail-Inhalte, Bankbelege, Steuerberatung, Dateien oder alle Kalenderdaten**. Keine schreibenden CRM-Werkzeuge; kein Versand, keine Rechnung, kein Auftrag und keine Zahlung durch die Integration. Alle Pflichtfelder und die bestehende Website-Anbindung bleiben unverändert.

Der Panel-Chat ist zunächst Frage/Antwort mit aktuellem CRM-Kontext; kein unbegrenzt persistierender Gesprächsverlauf. Anfragekennungen, Inhalts-Hashes und Zustände werden im Integrationsledger gespeichert, nicht der Fragetext. Erfolgreiche Antworttexte werden nach sieben Tagen ab Anfrageerstellung bei der nächsten Agentwartung entfernt; Kennungen/Hashes bleiben als Wiederholschutz bestehen. Backups und Aufbewahrung beim Hermes-/Modellanbieter benötigen ein getrenntes Datenschutzkonzept.

## Getrennte Vertrauensgrenzen

- Panel-Chat nur für die bestehende serverseitig geprüfte Betreiberidentität; kein Kunden-/Kanzleizugriff.
- Bridge ausschließlich mit eigenem langem Zufallstoken, nicht mit Betreiberpasswort, Website-Hub-Token oder Qonto-Zugang.
- Nur der SHA-256-Hash dieses Bridge-Tokens liegt in der Panel-Umgebung. Der Klartext liegt ausschließlich im passenden Hermes-Profil als Secret.
- Das Plugin kann nur GET auf `/api/agent-bridge/context` ausführen. Ziel ist der konfigurierbare, vom Betreiber administrierte HTTPS-Ursprung, nicht eine vom Modell vorgegebene URL. Redirects sind gesperrt.
- Das Plugin gibt begrenzte Daten an das Modell zurück. Diese Daten sind nicht automatisch für WhatsApp-Kunden freigegeben.
- **Nicht in einem allgemeinen Kunden-WhatsApp-Bot aktivieren.** Der Hermes-Zugang muss ausschließlich dem Betreiber zugänglich sein. Kunden- und Kanzleizugänge bleiben getrennt.
- **Ein Prompt ist keine technische Berechtigungsgrenze.** Der über die Panel-API erreichbare Hermes-Dienst muss in einem dedizierten eingeschränkten Profil laufen. Keine Terminal-, Browser-, Mailversand-, Zahlungs- oder sonstigen schreibenden Werkzeuge in diesem Profil. Die Freigabevariable ersetzt diese Einschränkung nicht und prüft sie nicht selbst.
- Niemals das bestehende vollberechtigte Gateway nur durch einen neuen Systemprompt als schreibgeschützt deklarieren. Vor Freigabe tatsächliches Toolinventar und Zugriffsmöglichkeiten des Zielprofils prüfen.

## Durch Betreiber-Terminalausgaben bestätigte Installation

Aus vom Betreiber bereitgestellten Terminalbildern abgelesen (kein eigener SSH-Zugriff):

- Panel-Dienst: `white-gloss-panel.service`, Benutzer `white-gloss-panel`.
- Arbeitsverzeichnis: `/srv/white-gloss-panel/current`.
- Unit-Datei: `/etc/systemd/system/white-gloss-panel.service`.
- Geschützte Umgebungsdatei: `/etc/white-gloss-panel/environment`, `ignore_errors=no`. Ihr Inhalt wurde nicht angefordert oder offengelegt.
- Zugeordneter Hermes-Container: `hermes-agent-68ag-hermes-agent-1`, ID `5d9f58cbd60f`. Der Hostname der Agentumgebung stimmt mit dieser ID überein.
- Ein zweiter Hermes-Container `hermes-agent-qylq-hermes-agent-1` ist vorhanden und bleibt unangetastet.
- Die angezeigten Portweiterleitungen auf Container-Port `4860/tcp` sind kein Beleg für einen Hermes-Agent-API-Endpunkt und werden nicht als solcher konfiguriert.
- In der Agentumgebung sind weder Docker-Verwaltungssocket noch Host-Panel-Datenpfad eingebunden. Daraus folgt kein administrativer Zugriff auf den Paneldienst.

Für die Verbindung auf demselben VPS ist keine öffentliche Freigabe der Agent-API erforderlich. Den tatsächlichen internen HTTPS-/Proxyweg und das eingeschränkte Hermes-Profil vor jeder Änderung prüfen; keine Docker-Ports oder laufenden Dienste ungeprüft verändern. Es wurde noch kein Laufzeit-Secret eingerichtet und kein Dienst neu gestartet.

## Serverseitige Konfiguration

Standardmäßig bleibt die Integration deaktiviert. Die folgenden Variablen sind Voraussetzungen, keine bereits eingerichteten Zugänge:

- `PANEL_AGENT_ENABLED=true`: aktiviert die ausdrücklich freigegebene Integrationsoberfläche/Bridge.
- `PANEL_AGENT_READ_TOKEN_SHA256`: SHA-256-Hash eines separaten, kryptografisch zufälligen Bridge-Tokens.
- `HERMES_AGENT_ORIGIN`: exakter HTTPS-Ursprung der vorgesehenen Hermes-API; kein Pfad, kein Query, keine Zugangsdaten in der URL.
- `HERMES_AGENT_API_KEY`: separater serverseitiger Bearer-Schlüssel der vorgesehenen Hermes-API.
- `HERMES_AGENT_READ_ONLY_CONFIRMED=true`: erst nach tatsächlicher Prüfung des dedizierten eingeschränkten Hermes-Profils setzen.

Die Bridge kann separat eingerichtet werden; für ihren lesenden Zugang ist kein Hermes-Chat-API-Schlüssel notwendig. Die Chat-Funktion benötigt dagegen alle für sie erforderlichen Freigaben und Zugangsdaten. Statusanzeigen sind Konfigurationsanzeigen, keine Behauptung einer laufenden externen Verbindung.

Geheimnisse ausschließlich im geschützten Laufzeit-Secretstore außerhalb des Repositorys pflegen; nicht in Chat, Git, Browser oder dieses Dokument schreiben. Der Betreiber muss kontrollieren können, an welche Hermes-Instanz und welchen Modellanbieter Daten übertragen werden. Die bestehende Hostinger-Konfiguration und deren sichere Secretverwaltung zuerst prüfen; keine neue `.env` in den Quellcode legen.

## Hermes-Erweiterung

Paket: `integrations/hermes/white-gloss-panel/`

- `plugin.yaml`: Manifest, ein Werkzeug, keine Hooks oder Zusatzabhängigkeiten.
- `__init__.py`: HTTPS-GET-Client, feste Bridge-Route, Redirect-Sperre, Ergebnisgrenze, sichere Fehlermeldungen.
- Secret im vorgesehenen Hermes-Profil: `WHITE_GLOSS_PANEL_READ_TOKEN`.
- Plugin-Einstellung `origin`: standardmäßig `https://panel.white-gloss.de`; nur auf den verifizierten echten Panel-Ursprung ändern.

Plugin-Validierung ohne Installation in das aktive Profil:

```sh
hermes plugins doctor integrations/hermes/white-gloss-panel --ci
python -m unittest discover -s integrations/hermes/tests -v
```

Installation/Aktivierung erst im ausgewählten Betreiberprofil nach geprüftem Ziel und Secretbereitstellung über die offizielle Hermes-Pluginverwaltung. Dieses Paket wurde nicht automatisch in das laufende WhatsApp-Gateway kopiert und ändert keine fremden Profile.

## Verhalten bei Fehlern

- Keine automatische Wiederholung von Agentanfragen.
- Jede Anfrage bekommt eine stabile UUID und Inhaltsbindung.
- Erneute identische abgeschlossene Anfrage darf das gespeicherte Ergebnis liefern; Konflikte oder unklarer Ausführungsstand dürfen keinen neuen Agentlauf unter neuer Kennung starten.
- `finish_reason:error/cancelled` ist kein Erfolg; `length` ist ein ausdrücklich unvollständiges Ergebnis.
- Kein Erfolg nur aufgrund von HTTP 200 oder einer frei formulierten Modellantwort behaupten.
- Begrenzte Anfragen pro Zeitfenster; begrenzte Ein-/Ausgabemengen.

## Abnahme vor echter Aktivierung

1. Änderungen und Tests unabhängig prüfen; keine Freigabe nur anhand eines Teiltests.
2. Vor Veröffentlichung aktuellen Remote-Branch und Hostinger-Releaseweg prüfen. `main` veröffentlicht laut Projektregeln automatisch.
3. Dediziertes Hermes-Profil mit tatsächlich reduzierten Tools und Betreiberzugang konfigurieren.
4. HTTPS-Verbindung, Schlüsseltrennung und fehlende Redirects lesend prüfen; keine Kundendaten beim Verbindungstest senden.
5. Mit synthetischen Daten prüfen: Panel-Betreiber erfolgreich, Kunde/Kanzlei/Anonym abgewiesen; falsches/entferntes Bridge-Token abgewiesen; unbekannte Routen und Schreibmethoden gesperrt.
6. Modellantworten, Prompt-Injection-Versuche in CRM-Namen und Größen-/Quotenlimits prüfen; keine Schreibwerkzeuge verfügbar.
7. Im Betreiber-WhatsApp eine begrenzte Testabfrage durchführen; keine Kundennachricht oder sonstige echte Aktion auslösen.
8. Erst danach datenschutzrechtlich freigegebene echte CRM-Daten nutzen. Für schreibende Fähigkeiten später ein eigenes Freigabe-/Audit-/Idempotenzkonzept implementieren.

## Offizielle Referenzen

- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server
- https://hermes-agent.nousresearch.com/docs/developer-guide/plugins
- https://hermes-agent.nousresearch.com/docs/user-guide/security

## Ergebnis der Sicherheitsnacharbeit und verbleibende Betriebsgrenzen

Die erste unabhängige Quellcodeprüfung fand keine kritische oder hohe Sicherheitslücke in diesem begrenzten Integrationsumfang; das ist kein Penetrationstest und keine Live-Freigabe. Die Nacharbeit ergänzt:

- `priceBasis:assessment-draft`, Prüfstatus und angenommenen Angebotsbetrag getrennt; keine ungeprüften Entwürfe als verbindliche Preise ausgeben.
- Inhaltsgebundene, transaktionale Sperre gleicher noch laufender/ungeklärter Fragen, auch unter neuer UUID nach Seitenwechsel. Identische abgeschlossene Fragen bleiben unter neuer ID möglich, weil der CRM-Stand sich ändern kann.
- Betreiberseitige Liste der letzten 20 Anfrage-Metadatensätze; nach jeder Anfrage wird nur diese Liste neu geladen. Die gespeicherte Antwort wird ausschließlich nach ausdrücklichem Klick abgerufen, ohne neuen Anbieteraufruf.
- Wartung bei Agentzugriff und im bestehenden Wartungslauf: älter als 90 Sekunden laufende Anfragen werden ungeklärt. Erfolgreiche Antworttexte älter als sieben Tage werden entfernt, ID/Hash/Zustand bleiben als Tombstones erhalten. Späte Anbieterantworten dürfen ungeklärte Zustände nicht wiederbeleben.

Verbleibende Grenzen:

- Ungeklärte Inhalts-Hashes bleiben absichtlich gesperrt, bis ein gesonderter verifizierter Klärungsweg existiert. Die Oberfläche kann sie anzeigen, aber nicht eigenmächtig erneut ausführen.
- Sieben Tage werden ab Erstellung der Anfrage berechnet; Bereinigung erfolgt bei nächster Wartung, nicht als garantierte sekundengenaue Löschfrist. Externe Backups, Hermes-Sitzungen und Anbieteraufbewahrung sind davon nicht umfasst.
- Nicht vollständige Hermes-Antworten einschließlich `finish_reason:length` werden konservativ als ungeklärt abgewiesen, nicht als nutzbare Teilantwort ausgegeben.
- Das eingeschränkte Betreiberprofil, tatsächliche Toolrechte, interne Verbindung und Laufzeit-Secrets sind weiterhin nicht eingerichtet oder live geprüft. Bis dahin bleibt die Integration deaktiviert.

## Nicht erledigt durch diese Quellcodeänderung

Kein Hostinger-Serverzugang eingerichtet, keine API-Schlüssel generiert/übertragen, kein externes Hermes-Profil bereitgestellt, kein aktives Gateway umkonfiguriert, kein Live-Release und kein echter WhatsApp-CRM-Test. Die fehlenden Betriebszugänge müssen separat sicher bereitgestellt werden.
