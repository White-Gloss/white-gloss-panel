# WG-MCP-001 – sichere ChatGPT-Leseanbindung

Status: technische Spezifikation vom 08.11.2026, noch nicht implementiert oder
produktiv freigegeben. Bestand und Abhängigkeiten: [Phase 0](../WG-OS-Phase-0.md).

## Problem und Ziel

ChatGPT soll berechtigte White-Gloss-Daten unmittelbar über die App **White-Gloss
Panel** lesen können. Die bestehende Hermes-REST-Bridge ist auf einen kleinen
Auftragsausschnitt beschränkt und implementiert weder MCP noch OAuth für ChatGPT.
Sie wird erhalten, aber nicht als fertige MCP-Verbindung ausgegeben.

Die neue Anbindung nutzt bestehende fachliche Daten und Zugriffsregeln. Es entsteht
keine zweite Kundenverwaltung, keine eigene Datenkopie und kein SQL-/Shell-Werkzeug.
Der Dienst liefert Daten; er ruft selbst kein OpenAI-Modell auf. Deshalb ist für
diesen technischen Datenweg kein eigener Modell-API-Schlüssel vorgesehen. Daraus
folgt keine allgemeine Gebühren- oder Tarifzusage. Ein Assistent innerhalb des
Panels bleibt ein gesondertes Vorhaben mit nachgewiesenem Modellzugang.

## Nutzerfälle

1. Als Betreiber möchte ich meine Verbindung prüfen, damit ich erkenne, unter
   welcher berechtigten Identität die App arbeitet.
2. Als Betreiber möchte ich bestätigte Termine eines Tages sehen, damit ich meine
   Arbeit plane, ohne Kundenwünsche mit Buchungen zu verwechseln.
3. Als Betreiber möchte ich einen bestimmten Auftrag anhand seiner WG-Nummer lesen,
   damit ich seinen tatsächlichen Stand nachvollziehe.
4. Als Betreiber möchte ich Kunden und Fahrzeuge eindeutig finden, damit ähnliche
   Namen oder Telefonnummern keine fremden Akten zuordnen.
5. Als Betreiber möchte ich weitere Ergebnisse abrufen, damit eine begrenzte erste
   Seite nicht als vollständige Liste erscheint.
6. Als Betreiber möchte ich meine Freigabe widerrufen können, damit alte Verbindungen
   keinen weiteren Datenzugriff besitzen.
7. Als Betreiber möchte ich bei Fehlern eine klare Meldung erhalten, damit ein
   fehlgeschlagener Abruf nicht als leere Auftragsliste ausgegeben wird.
8. Als Kunde möchte ich, dass mein Portalzugang keine Betreiberwerkzeuge freischaltet,
   damit fremde Daten geschützt bleiben.
9. Als Betreiber möchte ich, dass Auskünfte nichts im Auftrag oder Postfach ändern,
   damit Lesen keine Nachricht, Rechnung oder Buchung auslöst.

## Technische Entscheidungen

### Vertrauensgrenzen

ChatGPT greift auf einen HTTPS-MCP-Ressourcenserver zu. Dieser prüft ein gültiges,
für ihn ausgestelltes Token und die aktuelle Betreiberberechtigung, bevor er einen
explizit freigegebenen Fachlese-Adapter aufruft. Dieser nutzt die bestehende
Anwendungslogik/SQLite-Datenquelle. Keine ungeschützte direkte Datenbankverbindung
aus ChatGPT; keine frei wählbare Datenbank, URL, SQL-Anweisung oder Shellaktion.

Die vorhandenen Betreiber-, Kunden- und Kanzleisitzungen bleiben getrennt.
PR #68 wird nicht umimplementiert. Ein Kundenpasswort darf niemals den Betreibergrant
für MCP ersetzen. Ein Prompt oder `readOnlyHint` ist keine Zugriffsprüfung.

### Transport und Autorisierung

Planungsbasis sind die unten verlinkten offiziellen Quellen, geprüft am 08.11.2026.
Vor Implementierung auf Änderungen prüfen und die verwendete SDK-/Protokollversion
festhalten. Für den dauerhaften VPS-Zugang ist Streamable HTTP über HTTPS vorgesehen,
mit Initialisierung, JSON-RPC, Werkzeugkatalog und validierten Ein-/Ausgaben.
Einen vorhandenen ungültigen Origin ablehnen; kein lokaler Tunnel als Ersatz.

Private Daten erfordern OAuth: Protected-Resource-Metadata, Discovery,
Authorization Code mit PKCE S256, Tokenbindung an die konkrete MCP-Ressource und
serverseitige Betreiber-/Scopeprüfung. Abgelaufene, widerrufene oder für eine andere
Audience ausgestellte Tokens werden abgewiesen. Keine Tokenweitergabe an Anbieter.
Refresh und Widerruf gehören zur Abnahme; „dauerhaft“ heißt nicht unbegrenzt gültig.

**Noch offen:** konkret verfügbarer Autorisierungsserver, unterstützte Clientregistrierung,
reale Redirect-URI, sichere Grant-/Tokenablage und Berechtigung im ChatGPT-Konto.
OpenAI beschreibt CIMD, DCR und vorkonfigurierte Clients. Die tatsächlich passende
Variante wird erst nach Prüfung gewählt. Kein eigener improvisierter OAuth-Server,
keine geratenen Client-IDs und keine Kopie des Hermes-Schlüssels in ChatGPT.

### Fachlicher Lesevertrag

Das erste Paket wird bewusst auf vier Werkzeuge begrenzt. Weitere im Master-Briefing
genannte Datenbereiche folgen mit eigenen Freigabe- und Feldregeln.

| Geplantes Werkzeug | Zweck | Mindestvertrag |
| --- | --- | --- |
| `panel_profile` | Verbindung und Betreiberidentität | Keine Aufträge; stabile opake Identität aus geprüftem Grant, keine vom Aufrufer gewählte Benutzer-ID |
| `panel_orders` | Aufträge suchen / paginieren | Begrenzte Filter, feste Sortierung, eindeutige IDs, Cursor und sichtbare Unvollständigkeit |
| `panel_order` | Einen Auftrag lesen | Exakte ID oder WG-Nummer; kein unscharfes automatisches Umhängen an Kunden |
| `panel_appointments` | Bestätigte Termine im Zeitraum | Nur bestätigte aktuelle Termine, stornierte Termine ausgeschlossen, Zeitzone Europe/Berlin, Zeitraumgrenzen dokumentiert |

Alle Werkzeuge werden als lesend und nicht destruktiv beschrieben. Zulässige
Argumente, Werte, Längen und Antwortfelder werden im Schema begrenzt. Der Server
erzwingt diese Grenzen auch bei direkten Aufrufen ohne Sprachmodell.

Antworten enthalten Erfassungszeit und Quellen-/Vollständigkeitsangaben. Vorschläge
und Kundenwünsche bleiben separate Felder; ein Status allein ist kein Nachweis.
Terminabfragen verwenden eine dokumentierte Intervallregel mit Zeitzonenprüfung
(einschließlich Mitternacht und Sommer-/Winterzeit). Cursor sind an Filter,
Sortierung und Berechtigung gebunden; Manipulation darf keine Daten erweitern.

Die Exportregel für gesperrte/anonymisierte Akten muss vor Implementierung festgelegt
werden. Bis dahin diese Akten im neuen externen Adapter nicht exportieren.
Schlüsselorte, Signaturen, private Notizen, Bankzugänge, Tokens und Rohobjekte werden
im ersten Paket nicht ausgegeben. Foto-/Dokumentinhalte und deren Zugriffslinks
sind nicht Teil dieses ersten Vertrags.

### Keine Fachänderung beim Lesen

Ein Werkzeugabruf darf keine Kunden-, Auftrags-, Termin-, Preis-, Status- oder
Nachrichtendaten schreiben. Keine Lesemarkierungen, Wartungsläufe, Imports,
Providerabfragen, Nachrichten oder Modellaufrufe im Leseadapter.

Sicherheitsmetadaten (Autorisierungsprüfung, Rate-Limits, minimales Zugriffsprotokoll)
sind separat zu definieren: keine Kundentexte, Zugangstokens oder vollständigen
Werkzeugantworten protokollieren. Bestehende HTTP-GET-Routen nicht pauschal wiederverwenden,
weil dort Sitzungsaktualisierung oder Wartung auftreten kann.

## Umsetzungsschritte und Abnahme

| Schritt | Ergebnis | Erforderlicher Nachweis |
| --- | --- | --- |
| A – Fachlese-Adapter | Kleine serverfreie Abfragegrenze auf bestehende Daten | Synthetische SQLite-Integration, Rechte/Felder/Termine/Pagination, unveränderte Fachdatensätze |
| B – MCP und Autorisierung | Protokolladapter mit geprüfter OAuth-Implementierung | Offizieller MCP-Client gegen isolierten Linux-Testdienst; kein lokales Hosting auf Betreiberrechner |
| C – Betriebsfreigabe vorbereiten | Verifizierter VPS-/Proxy-/Secret-/Rückwegplan und realer ChatGPT-Zugang | Sicherungs-/Restore-Nachweis, Least-Privilege-Konfiguration, keine öffentlichen Testdatenendpunkte |
| D – Getrennte Veröffentlichung | Erst nach ausdrücklicher Betreiberfreigabe | Erfolgreicher eigener Releasejob und HTTPS-/Token-/Widerrufstest; danach App registrieren und Werkzeuge prüfen |

Pflichtfälle: fehlendes/falsches/abgelaufenes/widerrufenes Token, falsche Audience,
Scope oder Betreiberidentität; Kunde/Kanzlei/Anonym; unbekannte Werkzeuge und
Zusatzargumente; Schreibversuche; Prompt-Injection in Namen und Freitext; überschrittene
Limits; gültige und manipulierte Cursor; mehr als eine Ergebnisseite; veraltete und
stornierte Termine; kein Zugriff auf verborgene Felder; keine Fachschreibaktion oder
Provideranfrage beim Lesen. Bestehende Hermes- und PR-68-Regressionsfälle bleiben grün.

## Nicht Teil dieses ersten Pakets

Keine Schreibwerkzeuge, Nachrichten, Rechnungen, Zahlungen, automatische Annahmen,
Preisfestsetzung, Belegbuchung, WhatsApp-Kundenanlage oder Modelltraining. Keine
eingebettete ChatGPT-Oberfläche, neuen kostenpflichtigen Dienste, Architekturwechsel,
Produktivmigrationen, DNS-Änderungen oder automatische Veröffentlichung.

## Offizielle Grundlagen

- [MCP Authorization, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Transports, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [OpenAI: Authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Custom MCP servers in ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)

Die Hilfe beschreibt derzeit das Hinzufügen über Plugins / Add custom MCP server.
Kontorechte sind trotzdem separat zu prüfen. Dieses Dokument bestätigt keine
Verfügbarkeit im konkreten Tarif und keine bereits eingerichtete Verbindung.
