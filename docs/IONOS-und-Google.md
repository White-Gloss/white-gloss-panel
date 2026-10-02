# White Gloss Panel auf IONOS

Stand der Prüfung: 3. Oktober 2026. Der vorhandene IONOS-VPS ist der passende
Ausgangspunkt für eine unabhängige Panel-App. Der Quellcode wird in
`White-Gloss/white-gloss-panel` privat verwaltet. Der eigentliche Laufzeitumbau
und die Einrichtung des separaten Serverdienstes stehen noch aus.

## Tatsächlich geprüfter Server

| Eigenschaft | Festgestellter Stand |
| --- | --- |
| IONOS-Server | My VPS, VPS 6-8-240 |
| Adresse | 217.154.124.239 |
| Betriebssystem | Ubuntu 24.04 |
| Ressourcen | 6 vCore, 8 GB RAM, 240 GB NVMe |
| Freie Kapazität beim SSH-Abruf | etwa 7 GB verfügbarer RAM und 208 GB freier Speicher |
| Node.js | 22.23.2 |
| Reverse Proxy | Caddy aktiv |
| Hauptwebsite | white-gloss.service aktiv, Benutzer deploy |
| Aktive Hauptwebsite | /srv/white-gloss-releases/8e900aa082fa2f502290a85a6036fcc9a0b3a95a |
| Laufzeitkonfiguration Hauptwebsite | /etc/white-gloss/environment |
| Bestehender SSH-Zugang | white-gloss-ci, eingeschränkter Deployment-Zugang |

Die freie Kapazität spricht für einen zusätzlichen kleinen Paneldienst. Das ist
eine Kapazitätseinschätzung, noch kein Lasttest. Es ist dafür aktuell kein neuer
Serverkauf erforderlich. Den bestehenden Caddy-Dienst und die Hauptwebsite nur
über einen getrennten, geprüften Änderungsschritt erweitern.

## Hostingmöglichkeiten

| Weg | Eignung für dieses Panel |
| --- | --- |
| Bestehender IONOS-VPS | Empfohlen: eigener Node-Dienst, dauerhafte Datenbank, privater Dateispeicher und unabhängiger Zeitplan möglich. Laufzeitumbau erforderlich. |
| IONOS Deploy Now allein | Kein direkter Weg für den aktuellen Backendcode: Node-Buildschritte sind möglich, ein dauerhaft laufender Node-Backenddienst wird dort nicht angeboten. |
| Statische Dateien auf Webspace, Backend separat | Möglich, aber Datenbank, Anmeldung, Uploads und Hintergrundprüfung brauchen weiterhin ein eigenes Backend. Bringt gegenüber dem vorhandenen VPS zusätzliche Aufteilung. |

Die Unterscheidung von Build und Serverbetrieb ergibt sich aus den offiziellen
[IONOS-Technologien](https://www.ionos.de/hilfe/hosting/deploy-now/unterstuetzte-technologien-und-umfang-des-kundenservice/)
und der [Deploy-Now-FAQ](https://docs.ionos.space/docs/faq/).

## Vorgeschlagene getrennte Einrichtung

Alle folgenden Namen und Pfade sind Vorschläge, noch keine eingerichteten Ressourcen:

- Adresse `https://panel.white-gloss.de`, nach DNS-Prüfung und Freigabe.
- Eigener Dienst `white-gloss-panel.service` und eigener unprivilegierter
  Betriebssystembenutzer `white-gloss-panel`.
- Releases unter `/srv/white-gloss-panel/releases/`, aktiver Verweis
  `/srv/white-gloss-panel/current`.
- Datenbank und private Dateien unter `/var/lib/white-gloss-panel/`, getrennt von
  den austauschbaren Releases.
- Geheimnisse in `/etc/white-gloss-panel/environment`, nur für den Dienst lesbar.
- Caddy übernimmt HTTPS und leitet ausschließlich den neuen Hostnamen an den
  auf dem VPS intern gebundenen Paneldienst weiter. Port erst nach Prüfung wählen.
- Eigener 15-Minuten-Zeitplan auf dem VPS für Fälligkeiten, mit dauerhaftem Lock,
  Fehlerstatus und Nachweis eines tatsächlichen erfolgreichen Laufs.
- Getrennter, begrenzter Panel-Deployment-Weg mit überprüfbarem Commit,
  vorherigem Release und Rücksetzung; keine Wiederverwendung des Hauptwebsite-Helfers.

Ein separater Serverdienst kann ohne offenen Desktopbrowser laufen. Der Zeitplan
muss die vorhandenen Regeln für einmalige Nachrichten und unklare Providerantworten
erhalten. Er darf keine unbekannten Versandresultate automatisch erneut senden.

## Nötiger Laufzeitumbau

| Aktuelle Abhängigkeit | Erforderlicher Ersatz und Nachweis |
| --- | --- |
| Worker-fetch und Sites-ASSETS | Node-HTTP-Adapter und sichere statische Auslieferung, einschließlich unverändertem privaten Angebotslink. |
| D1 DB | Dauerhafte SQLite-Datenbank mit Transaktionen, Triggern, Konfliktprüfung, WG-Zähler und konsistenten Backups. Eine Adapteroption ist node:sqlite; dessen experimenteller Stand in Node 22 muss berücksichtigt werden. |
| R2 BUCKET | Privater Dateispeicher außerhalb des Webroots; Zugriffsprüfung, Dateigrößen, MIME-Typ, Hash und Protokollbindung beibehalten. |
| Sites-Anmeldung | Eigene geprüfte Anmeldung und serverseitige Rollen. Eingehende Identitätsheader des Browsers verwerfen; nicht ungeprüft als Betreiberkennung übernehmen. |
| Sites scheduled | Eigene ausführbare Hintergrundprüfung und serverseitiger Zeitplan mit Lock und Protokollierung. |
| Verschlüsselte Einstellungen | Sichere Übertragung des passenden CONFIG_KEY oder erneute geschützte Einrichtung; Geheimnisse niemals aus Git rekonstruieren. |

Die Betreiberkennung ist momentan der vertrauenswürdige Sites-Header
`oai-authenticated-user-email`. Dieser allein schützt eine außerhalb von Sites
betriebene App nicht. Die Portierung muss Sitzung, Herkunft und Identität selbst
prüfen. Kunden dürfen nur das eigene Angebot öffnen und persönlich annehmen;
der Betreiber bleibt von der Kundenannahme ausgeschlossen.

Die [Node-Dokumentation zu SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html)
beschreibt die Dateidatenbank-API. Bestehende Tests nutzen bereits isoliertes
SQLite. Das ist eine Grundlage, kein geprüfter Ersatz für die produktive Speicherung.

## Google Kalender

Im Projekt `white-gloss-detailing` ist CalDAV aktiviert. Die vollständig gelesene
Liste der 39 aktivierten APIs enthält keine Google Calendar API. Die
Anmeldedatenseite zeigt keine OAuth-Clients. PageSpeed- und Firebase-API-Schlüssel
sind kein persönlicher Kalenderzugang.

Im weiteren geöffneten Projekt `solar-center-510300-k5` existiert
`Desktop-Client 1`. Dieser ist als Desktop-Anwendung angelegt; der vorgesehene
IONOS-Serverfluss benötigt einen passenden Web-Client.

Vorgeschlagene Einrichtung, noch nicht durchgeführt:

1. Google Calendar API im Projekt `white-gloss-detailing` aktivieren.
2. OAuth-Zustimmungsbildschirm für das private Panel einrichten und die benötigten
   Betreiberkonten zulassen; Teststatus und Tokenlebensdauer ausdrücklich prüfen.
3. OAuth-Client vom Typ **Webanwendung** anlegen, nachdem die endgültige Paneladresse
   und der Callback im Backend feststehen. Vorgeschlagener Callback:
   `https://panel.white-gloss.de/auth/google/callback`.
4. Anmeldung und Kalenderfreigabe getrennt behandeln: für die Anmeldung
   `openid email profile`, für den zuerst lesenden Kalenderabgleich nur die
   erforderlichen Leserechte. Schreibrechte erst für den konkret freigegebenen
   Synchronisierungsumfang anfordern.
5. Kontoinhaber meldet sich bei Google an und bestätigt die gezielte Freigabe.
   Der Server erhält mit Offline-Zugriff einen Refresh-Token, speichert ihn
   verschlüsselt und erneuert kurzlebige Access-Tokens selbst.
6. Den vorgesehenen Kalender `anfrage@white-gloss.de` zunächst lesend prüfen.
   Den eigentlichen Kalender-Synchronisierungsadapter danach implementieren und
   mit freigegebenen synthetischen Terminen prüfen.

Der Calendar-Token steht nicht dauerhaft als fertiger Schlüssel in der
Anmeldedatentabelle. Er entsteht bei der Google-Freigabe. Der bisherige
`calendarToken` im Panel reicht für einen lesenden Providercheck; er bildet noch
keinen dauerhaften OAuth- und Synchronisierungsadapter.

Offizielle Grundlage: [OAuth für Webserver](https://developers.google.com/identity/protocols/oauth2/web-server?hl=de)
und [Kalenderzugriffsrechte](https://developers.google.com/workspace/calendar/api/auth).

## Website-Schlüssel und Adminzugang

Die aktive Hauptwebsite liest `/etc/white-gloss/environment`. Dort muss der
Administrator den tatsächlich konfigurierten `HUB_SYNC_TOKEN` prüfen; sein Wert
wurde mit dem eingeschränkten SSH-Konto nicht gelesen. Die bisherige Panelprüfung
weist den eingetragenen Schlüssel mit HTTP 401 zurück.

IONOS zeigt im Cloud Panel den Zugang `root` und die Funktion
**Initial-Passwort → Passwort anzeigen**. Für die normale Serverkonsole:
**Infrastruktur → Server → My VPS → Aktionen → Remotekonsole öffnen**.
Das Passwort wurde bei dieser Prüfung nicht eingeblendet oder gespeichert.
Ein Initialpasswort kann inzwischen geändert worden sein.

Der vorhandene SSH-Benutzer darf mit sudo nur
`/usr/local/sbin/white-gloss-deploy` ausführen. Für einen separaten Paneldienst
ist daher eine normale administrative Einrichtung oder ein dafür gezielt
bereitgestellter, begrenzter Zugang nötig. Die bestehende Berechtigungsgrenze
und der Hauptwebsite-Helfer werden nicht als Umweg zur Geheimnisabfrage benutzt.

Der gültige Hub-Schlüssel wird nach der Prüfung direkt geschützt im Panel
gespeichert. Anschließend ausschließlich den lesenden Providercheck durchführen.
Keine Website-Buchung bestätigen oder Statusänderung auslösen.

## Reihenfolge bis zum Umzug

1. Quellcode privat auf GitHub sichern und Prüfungen ohne Website-Server bestehen lassen.
2. Eigenständigen Node-, Datenbank-, Speicher- und Anmeldeadapter umsetzen und
   zunächst mit isolierten synthetischen Daten prüfen.
3. Endgültige Adresse, Callback und Anbieterrechte konkret zur Freigabe vorlegen.
4. Administrator richtet den getrennten IONOS-Dienst, HTTPS und Deployment-Weg ein.
5. Laufzeitgeheimnisse geschützt einrichten; synthetischen Testbestand getrennt
   übernehmen oder neu anlegen. Vor Datenübernahme Export, Verschlüsselung und
   Wiederherstellung prüfen. Kein automatischer Import alter Website-Aufträge.
6. Auf IONOS Anmeldung, Speicherung nach Neustart, private Dateien, Angebotsrollen,
   SQLite-Transaktionen, Hintergrundlauf und Rücksetzung nachweisen.
7. Anbieterzugriffe zuerst lesend prüfen. Reale Nachrichten, Annahmen und Rechnungen
   erst nach gezielter Freigabe und vollständigem Nummernabgleich testen.
8. Bestehende Sites-App erst nach einem geprüften und genehmigten Umzug ablösen.

Bis dahin läuft das veröffentlichte Panel weiterhin auf Sites. Ein privates
GitHub-Repository oder ein grüner Build bedeutet noch keinen IONOS-Livebetrieb.
