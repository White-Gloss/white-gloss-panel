# White Gloss Panel auf IONOS

Einrichtung: 3. Oktober 2026; Verbindungsprüfung: 18. Oktober 2026 (siehe unten). Die eigenständige IONOS-Laufzeit ist getrennt installiert. Paneldienst, Hauptwebsite und Caddy wurden bei der Einrichtung aktiv geprüft. Jede neue Codeversion benötigt weiterhin ihren eigenen Aktivierungs- und HTTPS-Nachweis; GitHub-CI allein beweist keine Veröffentlichung.

## Getrennter Betrieb

Der vorhandene IONOS-VPS 217.154.124.239 verwendet Ubuntu 24.04, Node 22.23.2 und Caddy. Die Hauptwebsite läuft als white-gloss.service auf Port 3000. Deren vorhandener Deployment-Helfer wird weder verändert noch für das Panel verwendet.

Vorbereitet sind:

- https://panel.white-gloss.de mit persönlicher Anmeldung;
- eigener Benutzer und white-gloss-panel.service, intern 127.0.0.1:3101;
- Releases unter /srv/white-gloss-panel/releases und aktiver Verweis current;
- Datenbank und private Dateien unter /var/lib/white-gloss-panel/data;
- geschützte Konfiguration /etc/white-gloss-panel/environment, Modus 0600;
- separater Hintergrundlauf alle 15 Minuten und tägliche private Sicherung.

Der Installer verlangt Root, einen konkreten Commit und die richtige Archiv-Prüfsumme. Er kopiert das Paket zuerst in Root-Staging, prüft Archivpfade und Commit, lehnt Links ab und installiert ein unveränderliches Release. Caddy wird vor dem Reload geprüft. Ein fehlgeschlagener Start setzt Panelverweis und Caddy-Konfiguration zurück. Die Hauptwebsite wird nicht ersetzt oder neu gestartet.

Die Betreiberregel verlangt den freigegebenen IONOS-Weg. Lars hat am 18.10.2026 beauftragt, künftige beauftragte Codeänderungen nach erfolgreicher Prüfung ohne erneute Veröffentlichungsbestätigung über diesen separaten Panelweg zu veröffentlichen und online zu prüfen. Lokales Hosting bleibt verboten; der Server verweigert den Start auf Windows, WSL und außerhalb des vorgesehenen IONOS-Verzeichnisses.

## Direkte Veröffentlichung nach Codeänderungen

Die Betreiberfreigabe ist vorhanden; die technische Automatisierung ist noch
nicht eingerichtet. Bei der Verbindungsprüfung am 18.10.2026 waren GitHub-Lese-
und Schreibzugriff sowie erfolgreiche Prüfungen für Hauptbranch-Commit
`976ba8f9caa77596cf9aaa4eea3948ee8fc94195` nachgewiesen. Der einzige Workflow
`.github/workflows/checks.yml` führt Prüfungen aus und veröffentlicht nichts.
In der verfügbaren Cloud-Arbeitsumgebung wurde kein IONOS-Serverzugang bereitgestellt.
Ob GitHub bereits passende Secrets enthält, war wegen fehlender Berechtigung
der GitHub-Integration zum Auflisten der Secret-Namen nicht prüfbar.

Das öffentliche Panel leitete zur Anmeldung weiter und `/healthz` lieferte
HTTP 200 mit `ok`. Das bestätigt die Erreichbarkeit, aber keinen aktiven
Server-Commit. Der Panel-Connector verlangte eine erneute Anmeldung; dieser
operative Datenzugang ist vom Serverzugang zum Veröffentlichen getrennt.

Für den vollständigen Releaseweg ist ein sicher konfigurierter Serverzugang
zum bestehenden Paneldienst nötig: bestätigter SSH-Host und Port, geprüfter
Hostschlüssel, Uploadrecht nach `/home/white-gloss-ci/` und die Berechtigung,
den vorhandenen Panel-Installer auszuführen. Private Schlüssel und andere
Geheimnisse ausschließlich über die sichere Zugangsverwaltung bereitstellen.

Sobald dieser Zugang verfügbar ist, den aktiven `current`-Verweis und
`dist/release.json` lesen, den aktuellen geprüften Commit mit
`scripts/package-ionos.mjs` paketieren und das Archiv mit SHA-256 über den
separaten Panel-Installer aktivieren. Anschließend den aktiven Commit,
Paneldienst und Timer sowie HTTPS, Anmeldung und die betroffenen öffentlichen
Dateien prüfen. Änderungen hinter der Anmeldung brauchen zusätzlich einen
dafür verfügbaren authentifizierten Prüfzugang. Erst dann ist die jeweilige
Veröffentlichung mit ihrem tatsächlich geprüften Umfang nachgewiesen.

## Anmeldung, Angebote und Fotos

Der Betreiber meldet sich mit E-Mail und eigenem Passwort an. Einrichtung und Wiederherstellung benötigen einen frischen persönlichen E-Mail-Link. Kunden erhalten Link und eine separate sechsstellige PIN in derselben E-Mail. Private Secure/HttpOnly-Sitzungen ersetzen die Sites-Identitätsheader. Kunden dürfen ausschließlich ihr eigenes gültiges Angebot sehen; Auftragslisten, Betriebsfunktionen und Fotos bleiben gesperrt. Der Betreiber kann keine Kundenannahme ausführen. Details: [Passwort, PIN und Protokoll-PDF](Passwort-PIN-und-Protokoll-PDF.md).

Pakete, Extras, eigene Leistungen und Abholung werden einzeln angepasst und serverseitig in ganzen Centbeträgen summiert. Jede Änderung verlangt erneute Preisprüfung und Speicherung vor dem Fixpreis. Das bestätigte Angebot bleibt unveränderlich. Originale Website-Wünsche bleiben separat erhalten.

Buchungsbilder und Videos kommen ausschließlich aus der freigegebenen Hub-Fotoabfrage und werden geschützt auf IONOS übernommen. Wiederholungen erzeugen keine doppelten Kopien. Abgelaufene Website-Links beeinträchtigen gespeicherte Aufnahmen nicht. Manuelle Aufträge können eigene Buchungsbilder erhalten. Fahrzeugprotokolle verlangen weiterhin ihre eigenen Zustandsfotos sowie zwei persönlich geleistete, dem angezeigten Protokoll zugeordnete Unterschriften.

## Vorhandene Anbieterzugänge übertragen

IONOS erzeugt einen RSA-Schlüssel; nur dessen öffentlicher Teil kommt in die private Sites-Konfiguration. Sites verschlüsselt den vorhandenen geprüften Resend-Zugang und gegebenenfalls den geprüften Qonto-Zugang mit AES-GCM und RSA-OAEP für genau dieses Panel. Das Paket gilt 24 Stunden. Der private Schlüssel bleibt auf dem Server. Übertragung erfolgt erst nach ausdrücklicher Freigabe dieser Zugangsdaten und des IONOS-Ziels.

Der Administrationsimport `import-connections` prüft Ziel, Fingerabdruck und Ablauf, entschlüsselt auf IONOS und speichert erneut unter dem dortigen CONFIG_KEY. Bereits vorhandene Zugänge werden nicht überschrieben. Frühere Verbindungsflags werden zurückgesetzt; tatsächliche Absenderdomain und Qonto-Organisation werden erneut lesend geprüft. Dabei wird keine Kundenmail versendet. Geheimnisse gehören weder in GitHub noch in Berichte.

## Google-Kalender

Erforderlich ist ein OAuth-Client vom Typ Webanwendung mit Rückruf:

https://panel.white-gloss.de/auth/calendar/callback

Die offizielle Webclient-JSON wird lokal mit `scripts/seal-google-client.mjs` und dem öffentlichen Serverschlüssel verschlüsselt. Nur die verschlüsselte Datei gelangt auf IONOS. `import-google-client` prüft den gesonderten Paketzweck und den exakten Rückruf; das Clientgeheimnis bleibt in der geschützten Datenbank. Ein bestehender Webclient wird nicht überschrieben.

Ein Desktop-Client passt nicht zu diesem HTTPS-Rückruf. Das Backend verwendet PKCE, einen einmaligen OAuth-Zustand, die geprüfte Kontoidentität und geschützte Access-/Refresh-Tokens. Rechte: Kontoidentität, Kalender-Metadaten lesen sowie Ereignisse in eigenen Kalendern lesen und bearbeiten. Vorgesehen ist das Geschäftskonto anfrage@white-gloss.de. Der OAuth-Veröffentlichungsstatus muss geprüft werden: Googles externer Testmodus kann Kalender-Refresh-Tokens nach sieben Tagen verfallen lassen.

Nach Verbindung und lesender Prüfung werden bestehende Google-Belegungen vor der Terminbestätigung geprüft, einschließlich wiederkehrender und ganztägiger Einträge. Verbindliche Paneltermine erhalten eine stabile Google-ID. Verschiebungen aktualisieren denselben Eintrag; Stornierungen entfernen ausschließlich den eigenen zugeordneten Eintrag. Externe Google-Änderungen übernehmen keine Kundenannahme und ändern nicht automatisch die Auftragsvereinbarung.

Grundlage: [Google Ereignisse lesen](https://developers.google.com/workspace/calendar/api/v3/reference/events/list) und [Google Ereignisse anlegen](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

## Qonto und WG-Nummern

Qonto ist das einzige Rechnungssystem des Panels (Betreiberentscheidung 13.10.2026). Login und Secret Key bleiben verschlüsselt, die Organisation wird lesend geprüft. Abrechnung erst nach Arbeitsabschluss und Rückgabe mit ausdrücklicher Prüfung von Kunde, Anschrift, Steuer, Leistungen und Bruttofestpreis. Rechnungsnummer = WG-Nummer; Qonto lehnt doppelte Nummern ab.

Vor dem ersten echten Auftrag bleibt der vollständige WG-Nummernabgleich einschließlich Buchungen und vorhandener Qonto-Rechnungen notwendig. Zahlungsziel 7 Tage, Zahlungsabgleich und Mahnwesen laufen über den Hintergrunddienst; automatische Mahnungen nur nach Freigabe. Details: [Qonto: Rechnungen, Quittungen und Mahnwesen](Qonto-Rechnungen-und-Mahnwesen.md).

## Zeitplan und Sicherung

Der 15-Minuten-Lauf besitzt eine Datenbanksperre. Fotoübernahmen, Kalenderabgleiche und Mails sind pro Lauf begrenzt. Ein einzelner Anbieterfehler blockiert nicht die unabhängige Prüfung abgelaufener Angebote. Einwilligung, Versandsperren sowie die 72-/168-Stunden-Grenzen bleiben unverändert. Autoimport, Kalenderabgleich und Versand benötigen separate sichtbare Aktivierung. Unklare Versandresultate werden nicht automatisch wiederholt.

Die tägliche Sicherung erstellt eine konsistente SQLite-Kopie, prüft Integrität und Foto-Hashes und speichert ein Manifest samt geschützter Konfiguration. Unveränderliche Fotos werden über private Hardlinks gesichert und beanspruchen nicht täglich erneut ihren vollständigen Speicher. Fehlerhafte Sicherungen bleiben als unvollständig erkennbar. Eine isolierte synthetische Wiederherstellung wird ohne Website-Server geprüft. Die Serverkopie ist noch keine nachgewiesene externe Katastrophensicherung.

## Abschlussnachweise

Für betriebsbereit sind zusätzlich zum geprüften Code nötig: freigegebener Panelweg, aktiver Dienst und Timer, HTTPS/DNS, Betreiberanmeldung, persistente Speicherung, isolierter Kundenablauf sowie bestätigte Resend-, Google- und Qonto-Verbindungen. Echte Kundenmails, Rechnungen, Zahlungen und Kundenannahmen werden nicht als Tests verwendet.
