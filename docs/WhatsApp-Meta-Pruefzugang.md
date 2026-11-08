# Isolierter WhatsApp-Prüfzugang

Der Prüfmodus ist ausschließlich für eine separate, leere Installation auf einem
eigenen HTTPS-Ursprung vorgesehen. Er erteilt keine Meta-Berechtigungen und ersetzt
weder App Review noch die Voraussetzungen von Meta. Ein tokenbegrenztes Test-Asset
muss in Meta tatsächlich verfügbar und dem separaten Zugang zugewiesen sein.

Alle folgenden Variablen sind gemeinsam vor dem Serverstart erforderlich:

| Variable | Vorgabe |
| --- | --- |
| `WHATSAPP_REVIEW_MODE` | Exakt `true` |
| `WHATSAPP_REVIEW_ORIGIN` | Exakt derselbe HTTPS-Ursprung wie `PANEL_ORIGIN`; Hostname beginnt mit `meta-review.` |
| `WHATSAPP_REVIEW_PHONE_NUMBER_ID` | Verifizierte Phone Number ID des Meta-Test-Assets |
| `WHATSAPP_REVIEW_RECIPIENT` | Eine vom Betreiber freigegebene eigene Testnummer im internationalen Format, etwa `+491700000000` |
| `WHATSAPP_REVIEW_GRAPH_VERSION` | Tatsächlich in Meta gewählte Version, etwa `vXX.X` |
| `WHATSAPP_REVIEW_ACCESS_TOKEN` | Separater Zugang ausschließlich zum freigegebenen Test-Asset |

Keine dieser Variablen setzen, wenn die normale Installation betrieben wird.
Teilweise Konfiguration, `false`, abweichender Ursprung oder ungültige Werte
verhindern den Start. Es gibt keinen HTTP-Schalter für diesen Modus.

Beim Start wird eine noch fehlende WhatsApp-Konfiguration mit dem festen Absender,
der Graph-Version und dem mit `CONFIG_KEY` verschlüsselten Token angelegt. App Secret
und Webhook-Verify-Token bleiben leer. Die Vorgaben werden für die Lebensdauer des
Prozesses eingefroren. Bestehende abweichende Einstellungen verhindern den Start;
spätere Abweichungen sperren Lesen, Prüfen und Versand. Auch bereits angenommene
Versand-IDs umgehen diese Kontrolle nicht. Ein GET legt keine Konfiguration an.

Ein angemeldeter Betreiberzugang kann die Verbindung lesen und nach ausdrücklicher
Einzelbestätigung die feste Vorlage `hello_world` (`en_US`) an genau diese Testnummer
senden. Die Oberfläche kennzeichnet den Prüfzugang und zeigt den festen Empfänger
schreibgeschützt. Serverseitig werden andere Absender, Empfänger,
Einstellungsänderungen, Webhooks, Analyse, Auftragsübernahme und Fotozuordnung
abgewiesen. Die bestehenden Versand-ID- und Abstandsprüfungen bleiben aktiv.
Der Zugangsschlüssel wird weder in API-Antworten noch im Client ausgeliefert.

Die normale Installation verlangt weiterhin Access Token, App Secret und Verify
Token. Nur der ausdrücklich aktivierte Prüfmodus erlaubt ausgehende Prüfung und
Testversand ohne Webhook-Geheimnisse.

## Betrieb

- Eigenen Dienst, Benutzer, Datenbank, Uploadpfad, `CONFIG_KEY` und Anmeldedaten
  verwenden. Keine Produktionsdaten oder produktiven Meta-Zugänge kopieren.
- Laufzeitgeheimnisse ausschließlich in der privaten Serverkonfiguration halten.
  Kein echtes Token oder echter Empfänger gehört in dieses Dokument oder Git.
- Der Prüfmodus begrenzt die WhatsApp-Routen. Er ist keine allgemeine Sandbox für
  alle Panel-Integrationen. Die getrennte Installation benötigt weiterhin ihre
  bestehenden Routen- und Netzsperren sowie ausgeschaltete Hintergrundläufe.
- Vor Freigabe der notwendigen Graph-Verbindung Meta-Asset, Tokenumfang, festen
  Empfänger und isolierte Installation prüfen. Der Code aktiviert keinen
  Netzzugang und führt beim Start keinen Anbieteraufruf aus.
- Tokenwechsel oder neue feste Werte: Dienst stoppen, Werte und gespeicherte
  Konfiguration kontrolliert gemeinsam ändern oder nur die WhatsApp-Konfiguration
  der leeren Prüfinstallation gezielt neu anlegen lassen. Das System repariert
  Abweichungen absichtlich nicht selbst. Versandnachweise nicht löschen, um eine
  automatische Wiederholung auszuschließen.
- Erst nach den Code- und Linux-Browserprüfungen in der separaten Prüfinstallation
  veröffentlichen. Eine Veröffentlichung auf `main` würde die Produktion betreffen.
