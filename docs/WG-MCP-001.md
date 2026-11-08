# WG-MCP-001 – direkte ChatGPT-Leseverbindung

Stand: 08.11.2026. Entwicklungsbasis: `b08158596e23f96f05382382fce918a9aaa5fb78`.
Branch: `codex/wg-mcp-001-persistent-integration`. Kein Merge, Deployment,
DNS-Wechsel oder produktive Autorisierung durch diesen Entwicklungsauftrag.

## Nachgewiesener Ausgangszustand

- Aktueller main enthält PR #67. GitHub-Lauf
  [42442156232](https://github.com/White-Gloss/white-gloss-panel/actions/runs/42442156232),
  Job `128613821720`, protokolliert den erfolgreichen Hostinger-Release exakt dieser Basis.
- Öffentlicher Browserabruf von `https://panel.white-gloss.de/healthz`: `ok`.
- Hostinger-API: VPS `2077393`, Ubuntu 24.04, KVM 4, Zustand `running`.
- Bestehender Code: `server/agent.mjs` stellt einen Bearer-geschützten Hermes-Kontext
  bereit. Das ist kein MCP/OAuth-Server. Diese Integration bleibt unverändert.
- Gezielte Plugin-Suche und installierte Pluginliste: kein Panel-Lesewerkzeug
  aufrufbar; `White-Gloss Website Control` stellt GitHub-Werkzeuge bereit.
  Der Live-Abruf ist in diesem Turn nicht verfügbar (authentifizierte Paneldaten).
- Im angemeldeten ChatGPT-Konto ist unter Plugins > Hinzufügen der Dialog
  „Benutzerdefinierten MCP-Server hinzufügen“ erreichbar: Server-URL, OAuth und
  „Als Plugin erstellen“. Nur angesehen, nichts eingetragen oder registriert.
  Erweiterte OAuth-Einstellungen sind ohne Server-URL deaktiviert; konkrete
  Callback-/Client-Werte und erfolgreicher OAuth-Verbindungsaufbau bleiben offen.

## Architektur und Grenzen

Der vorhandene Paneldienst erhält `/mcp` und OAuth-Routen. Er verwendet dieselbe
SQLite-Datenbank, denselben HTTPS-Ursprung, den bestehenden systemd-Dienst und
Releaseweg. Kein separater Tunnel, KI-Anbieter, OpenAI-API-Aufruf oder Kundenbestand.
Der geplante Endpunkt ist `https://panel.white-gloss.de/mcp`; er wird hier nicht
als produktiv aktiviert bezeichnet. Es ist keine neue Subdomain erforderlich.

Streamable HTTP mit JSON-Antworten, ohne Server-to-Client-Anfragen und ohne
flüchtige MCP-Sitzungen. GET am MCP-Endpunkt liefert authentifiziert 405 (kein
SSE-Abonnement), POST verarbeitet initialize/ping/tools/list/tools/call und
Initialisierungs-/Abbruchbenachrichtigungen. Versionen 2025-03-26, 2025-06-18 und
2025-11-25; unbekannte Initialisierungsversionen erhalten 2025-06-18 als Angebot.
Keine generischen SQL-/Shell-Werkzeuge. Die feste Leseschicht verwendet
parametrisierte SELECT-Abfragen und vorhandene Domänenfunktionen.

| Werkzeug | Umfang |
| --- | --- |
| panel_profile | Verbindung, Betreiber-Subject und Scope; keine Auftragsdaten |
| panel_dashboard | Statuszahlen, laufende Aufgaben, Zahl offener Kundenwünsche |
| panel_bookings | Anfragen in Preise prüfen/Angebot offen |
| panel_orders | Auftrag, Preisbasis, Leistungen, nächster Schritt |
| panel_customers / panel_vehicles | Vorhandener Kunden-/Fahrzeugstamm |
| panel_appointments | Bestätigte aktive Termine, optional Berliner Kalendertag |
| panel_messages | Chat, gespeicherte E-Mails oder offene Portalwünsche (channel=requests) |
| panel_documents | Auftragsdokumentstatus bzw. Belegmetadaten |
| panel_media | Fahrzeugfoto-Metadaten je WG-Nummer; keine Bildbytes |
| panel_invoices | Gespeicherter Rechnungs-/Zahlungsstand; kein Anbieterabgleich |
| panel_accounting | Letzte Belegzuordnung und fehlende Angaben |

Listen verwenden limit/offset und nextOffset. Maximal 50 Einträge und begrenzte
Textlängen; Antworten nennen Quelle, Abrufzeit und Berlin-Zeitzone. Wünsche
(`desiredDate/timeWindow`) werden getrennt von unbestätigten Vorschlägen und
`appointment.confirmation` ausgegeben. Testaufträge und Papierkorb sind ausgeschlossen.
Keine Signaturen, Schlüsselorte, Zugangstokens, Passwortdaten oder freien Rohobjekte
aus Aufträgen. Kundentexte werden als nicht vertrauenswürdige Daten gekennzeichnet.

**Bewusste V1-Grenzen:** Dokument-/Bildinhalte und Fotobegutachtung sind nicht
enthalten; keine Behauptung einer Beleginhaltsprüfung. Keine automatische
Dokumentzuordnung, WhatsApp-Kontaktanlage, Steuerkorrektur oder Schreibwerkzeuge.
E-Mails sind der bereits im Panel gespeicherte Stand, keine Postfach-Livesynchronisation.
Kunden-/Fahrzeughistorie ist über Auftragsabfragen zu recherchieren, kein Volltextexport.

## Autorisierung und Lebenszyklus

Ein vorregistrierter öffentlicher OAuth-Client mit exakt konfigurierter Client-ID
und HTTPS-Callback-Adresse. Kein DCR und kein serverseitiger Abruf fremder
Client-Metadaten. Authorization Code + PKCE S256, Scope ausschließlich `panel:read`.
Offizielle OpenAI-Dokumentation erlaubt vorregistrierte Clients neben CIMD/DCR.
Die tatsächliche Eignung dieses Weges im konkreten Konto bleibt bis zum Verbindungstest offen.

- Betreiber wird über bestehende serverseitige Panel-Sitzung und OWNER_EMAIL_SHA256
  geprüft. Ein Kundenlogin erhält keine Administratorrechte.
- Eigene explizite Zustimmungsseite; CSRF-Schutz durch Origin und signierte,
  sitzungsgebundene, einmalige Zustimmung (5 Minuten).
- Ohne Anmeldung: Betreiber meldet sich über den Link in einem zweiten Tab an und
  lädt die Zustimmungsseite erneut. Keine neue Kundenmail wird automatisch ausgelöst.
- Codes: 60 Sekunden, nur einmal mit passendem PKCE-Verifier einlösbar.
- Opaque Access-Tokens: 15 Minuten. Refresh-Tokens: Rotation bei jeder Nutzung,
  Grant absolut 30 Tage. Danach bewusste neue Autorisierung erforderlich.
- Tokenprüfung pro Anfrage: Grant, Betreiber, Client, Zielressource, Scope,
  Ablauf und Widerruf. SQLite speichert nur Token-Hashes.
- Wiederverwendung eines Refresh-Tokens widerruft dessen gesamte Grant-Familie.
  Parallele Erneuerung kann deshalb erneute Anmeldung verlangen; kein stilles Replay.
- `POST /auth/mcp/revoke` widerruft mit Client-ID und bekanntem Access-/Refresh-Token
  die gesamte Familie. Keine Geheimnisse in URL oder Chat eingeben.
- Technische Auth-/Rate-Datensätze dürfen sich ändern. Lesewerkzeuge ändern keine
  Kunden-, Auftrags-, Rechnungs-, Nachrichten- oder Lesestatusdaten.
- Authentifizierte Limits je Grant (120/Minute); anonyme Fehler verbrauchen dieses
  Kontingent nicht. Fehlerlogs enthalten Ereignistypen, keine Texte/Token.

## Installation nach gesonderter Freigabe

1. Draft und CI abnehmen. Erst dann Merge/Hostinger-Release gesondert freigeben.
2. In ChatGPT den unterstützten MCP-/Plugin-Erstellungsweg prüfen. Name
   **White-Gloss Panel**, Streamable HTTP, OAuth. Exakte angezeigte Redirect-URI
   und fest registrierte Client-ID übernehmen; keine Platzhalter live eintragen.
3. Außerhalb des Repositorys in `/etc/white-gloss-panel/environment` setzen:
   `PANEL_MCP_ENABLED=true`, `PANEL_MCP_CLIENT_ID`, `PANEL_MCP_REDIRECT_URI`.
   Bestehende PANEL_ORIGIN, OWNER_EMAIL_SHA256 und CONFIG_KEY weiterverwenden.
   Ohne vollständige gültige Konfiguration liefern die neuen Routen 404.
4. Vorhandenen Paneldienst über freigegebenen Releaseweg aktualisieren. Kein
   neuer Port, keine DB-Portfreigabe, keine Änderung an Website oder Caddy nötig.
5. HTTPS-Metadaten, 401-Challenge, Betreiberzustimmung und echte ChatGPT-Abfrage
   prüfen. Erst danach als verbunden berichten. Keine Testkundendaten produktiv anlegen.

Eine private Verbindung muss nicht automatisch öffentlich im Pluginverzeichnis
veröffentlicht werden. Kontopolitik entscheidet über privaten Erstellungsweg oder
Workspace-Freigabe. Installation und Betreiber-OAuth können Benutzerinteraktion
erfordern. Verfügbarkeit in neuen Chats hängt auch von ChatGPT/Konto/Toolauswahl ab.

## Betrieb, Diagnose und Wiederherstellung

- Vorhandene Unit: Restart=on-failure, RestartSec=5, WantedBy=multi-user.target.
  OAuth-Zustand liegt im persistenten Panel-Datenpfad; Neustart braucht keine
  Neuregistrierung. Ein realer VPS-Neustart wurde nicht ausgelöst.
- `/mcp/health`: nur Version/Betriebsmodus; 404 bei abgeschalteter Konfiguration.
- `/healthz` bleibt unverändert. Vorhandenes Release-Rollback bleibt verwendbar.
- Journal nach `component=mcp`, `authentication_failed` (minutenweise begrenzt)
  und `read_failed` prüfen. Keine Request-Bodies/Authorization-Header loggen.
- 401: widerrufen/abgelaufen/falsche Zielressource; neu autorisieren. 403: falscher
  Ursprung/Kundenkonto/Consent. 429: Minutenkontingent. 500: serverseitig prüfen,
  keine Kundendaten als Erfolg ausgeben. 404: Konfiguration/Release prüfen.
- Wartung entfernt abgelaufene Codes, Zustimmungen und Grants samt Token-Hashes;
  kein Kundenbestand wird bereinigt. Backups enthalten technische OAuth-Daten
  und müssen wie der übrige geschützte Panelbestand behandelt werden.
- Abschaltung: PANEL_MCP_ENABLED=false und freigegebener Dienstneustart. Bei
  Sicherheitsvorfall zusätzlich Grants widerrufen; Backuprückspielungen dürfen
  widerrufene Zugänge nicht unbemerkt wieder aktivieren. Erneute Autorisierung einplanen.

## Prüfung und Belegstufen

Lokale serverfreie Tests: `node --test tests/mcp.test.mjs tests/mcp-auth.test.mjs
tests/mcp-tools.test.mjs tests/mcp-security.test.mjs`. Vollständige Integration,
Lint, Typprüfung, Build und Browserregression im vorhandenen GitHub-Linux-Workflow.
Kein lokaler Website-/Preview-/Tunnelserver. Alle Testdaten synthetisch.

Rot/Grün belegt für deaktivierte Route, OAuth-Grundfluss, Transport/Tools sowie
konkrete Feldzuordnungs-, Zahlungsstatus-, Kundenwunsch- und Quota-Regressionen.
Weitere Sicherheitsfälle wurden ergänzend nach der Implementierung geprüft;
sie werden nicht nachträglich als vollständiger TDD-Nachweis bezeichnet.

| Kategorie | Stand |
| --- | --- |
| Implementiert | Deaktivierte MCP/OAuth-Leseschicht und Betriebsdokumentation im Entwicklungsbranch |
| Getestet | 17 serverfreie fokussierte Tests lokal bestanden; vollständige CI-Belege am aktuellen Commit im Draft-PR |
| Mit ChatGPT verbunden | Nein; kein echter Toolaufruf aus registrierter Panel-App nachgewiesen |
| Produktiv veröffentlicht | Nein; kein Merge/Deployment/DNS-/Berechtigungswechsel |
| Noch offen | Konkrete Kontoregistrierung/Callback, Freigabe, Live-OAuth, echte Leseabfrage, Dienstneustart/Wiederverbindung, Geräteprüfung |

## Offizielle Quellen, geprüft 08.11.2026

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization

Keine OpenAI-API-Abrechnung wird durch diesen Code eingeführt. ChatGPT-Abonnement
und vorhandener VPS-Betrieb bleiben eigenständige Voraussetzungen.
