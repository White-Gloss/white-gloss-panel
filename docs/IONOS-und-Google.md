# White Gloss Panel auf IONOS

Stand: 3. Oktober 2026. Die eigenständige IONOS-Laufzeit ist getrennt installiert. Paneldienst, Hauptwebsite und Caddy wurden aktiv geprüft. Jede neue Codeversion benötigt weiterhin ihren eigenen Aktivierungs- und HTTPS-Nachweis; GitHub-CI allein beweist keine Veröffentlichung.

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

Die Betreiberregel verlangt den freigegebenen IONOS-Weg. Der separate Panelweg muss vor seiner ersten Verwendung konkret freigegeben sein. Lokales Hosting bleibt verboten; der Server verweigert den Start auf Windows, WSL und außerhalb des vorgesehenen IONOS-Verzeichnisses.

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

Der Organisationszugang nutzt Qontos API-Login und API-Schlüssel. Alle Seiten des Kunden- und Rechnungsbestands einschließlich importierter Rechnungen werden gelesen. Rechnungsnummern werden im vollständig gelesenen Bestand verglichen; kein erfundener Nummernfilter wird verwendet.

Vor dem ersten echten Auftrag ist der bisherige WG-Nummernstand einschließlich Buchungsbestand und Rechnungen einmalig nachweisbar abzugleichen. Die App setzt keinen Nummernstand zurück. Testaufträge verwenden getrennte TEST-Nummern.

Schlussrechnungen sind erst nach vollständigem Arbeitsabschluss und Rückgabe möglich. Der Betreiber prüft Rechnungskunde, vollständige Rechnungsadresse, Steuersatz, Zahlungskonto, Fälligkeit und Leistungen. Zuerst entsteht ein Entwurf. Nur bei exakter Übereinstimmung der Bruttosumme mit dem unveränderlichen Festpreis wird finalisiert. Qonto verwendet Nettopreise je Position; die Umrechnung erfolgt ohne Fließkommafehler. Rechnungserstellung setzt einen Auftrag nicht auf Bezahlt.

Unklare Antworten bleiben gegen erneute Erstellung gesperrt. Ein lesender Anbieterabgleich kann eine passende vorhandene Schlussrechnung zuordnen. Ein abweichender Entwurf bleibt zur Prüfung erhalten. Es werden keine Zahlungen, Überweisungen oder automatischen Rechnungsmails ausgelöst.

Grundlage: [Qonto Authentifizierung](https://docs.qonto.com/get-started/business-api/authentication/introduction) und [Qonto Rechnung erstellen](https://docs.qonto.com/api-reference/business-api/expense-management/client-quotes-notes/client-invoices/create-a-client-invoice).

## Zeitplan und Sicherung

Der 15-Minuten-Lauf besitzt eine Datenbanksperre. Fotoübernahmen, Kalenderabgleiche und Mails sind pro Lauf begrenzt. Ein einzelner Anbieterfehler blockiert nicht die unabhängige Prüfung abgelaufener Angebote. Einwilligung, Versandsperren sowie die 72-/168-Stunden-Grenzen bleiben unverändert. Autoimport, Kalenderabgleich und Versand benötigen separate sichtbare Aktivierung. Unklare Versandresultate werden nicht automatisch wiederholt.

Die tägliche Sicherung erstellt eine konsistente SQLite-Kopie, prüft Integrität und Foto-Hashes und speichert ein Manifest samt geschützter Konfiguration. Unveränderliche Fotos werden über private Hardlinks gesichert und beanspruchen nicht täglich erneut ihren vollständigen Speicher. Fehlerhafte Sicherungen bleiben als unvollständig erkennbar. Eine isolierte synthetische Wiederherstellung wird ohne Website-Server geprüft. Die Serverkopie ist noch keine nachgewiesene externe Katastrophensicherung.

## Abschlussnachweise

Für betriebsbereit sind zusätzlich zum geprüften Code nötig: freigegebener Panelweg, aktiver Dienst und Timer, HTTPS/DNS, Betreiberanmeldung, persistente Speicherung, isolierter Kundenablauf sowie bestätigte Resend-, Google- und Qonto-Verbindungen. Echte Kundenmails, Rechnungen, Zahlungen und Kundenannahmen werden nicht als Tests verwendet.
