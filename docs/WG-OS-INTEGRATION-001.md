# WG-OS-INTEGRATION-001 – gemeinsamer Entwicklungsstand

Stand: 08.11.2026. Isolierter Integrationsbranch, keine Produktionsfreigabe.

## Ausgangsstand und Zusammenführung

| Paket | Geprüfter Quellcommit |
| --- | --- |
| main | b08158596e23f96f05382382fce918a9aaa5fb78 |
| PR #70 – Agententermine | 4bea07e4b069153cae97f79650d5a106c72fddaf |
| PR #68 – Kundenkonten und Kundenakte | b07c9d0ae006c4c9ff713368d033d71a282cd027 |
| PR #69 – vorhandener MCP/OAuth-Dienst | feabaa7f9203358cb7b312fba898a96a51957d4f |

Alle Quelländerungen werden übernommen. Nur server/application.mjs überschneidet sich:
Imports, Schemaaufbau, frühes MCP-Routing, Kundenkontorouten und Wartung werden
additiv zusammengeführt. Der gemeinsame Git-Commit referenziert alle drei
Quellheads als Eltern zusätzlich zur main-Basis. Änderungen bestehender Quelldateien
sind auf die unten beschriebenen Korrekturen begrenzt. Kein Quell-PR wird geschlossen.
Dateiinhalte und Blob-IDs wurden über den GitHub-Zugang gelesen; direkter Git-Download
scheiterte in dieser Arbeitsumgebung an DNS. Die vollständige Prüfung erfolgt auf
dem vorhandenen Linux-Runner. Lokal wurden nur serverfreie Tests ausgeführt.

## Fachliche Korrekturen

- MCP-Auftragsansicht und Kalender erkennen nur objektförmige Bestätigungsnachweise.
  Storniert, Abgelehnt und Abgelaufen liefern keinen aktiven Termin/Vorschlag.
  Die Kundenaktenübersicht und Hermes behandeln diese Zustände ebenso. Historische Originaldaten
  werden nicht verändert. Terminwünsche bleiben eigene Felder.
- Kalender vergleichen echte Zeitpunkte mit julianday statt ISO-Zeichenketten.
  Berliner Tagesgrenzen sind halboffen: Start vor Tagesende und Ende nach Tagesbeginn.
  Zeitstempel mit Offset und Sommerzeitwechsel werden berücksichtigt.
  Ohne Tagesfilter ist die Liste ein bestätigtes Terminarchiv, keine Zusage nur künftiger Termine.
- Externe Auftragsabfragen schließen recordsRestriction blocked/anonymized aus.
  Kunden- und Fahrzeugdaten werden auch dann zurückgehalten, wenn ein ausdrücklich
  verknüpfter Auftrag gesperrt/anonymisiert ist. Dieselbe Einschränkung gilt für
  weitere Aufträge dieser verknüpften Kundenakte. Keine Zuordnung nach vermuteten
  Namen, Telefonnummern oder gemeinsam verwendeten E-Mail-Adressen.
- Belegmetadaten mit expliziter Verbindung über mail_attachments und mail_order_links
  zu ausgeschlossenen Aufträgen bleiben auch im allgemeinen Buchhaltungs-/Dokumentabruf verborgen.
- MCP-E-Mails werden ausschließlich über mail_order_links aus PR #68 gelesen.
  Zwei Aufträge derselben E-Mail-Adresse sind getrennt; unzugeordnete Archivmails
  und Mails gesperrter Aufträge werden extern nicht ausgegeben. coverage benennt
  diese Beschränkung. Das interne Postfach bleibt unverändert.
- Cursor sind HMAC-signiert, 15 Minuten gültig und an Werkzeug, Filter, Seitengröße,
  Betreiber und OAuth-Grant gebunden. limit/offset bleiben kompatibel.
  nextCursor/nextOffset setzen hinter dem letzten tatsächlich gelieferten Datensatz fort,
  auch bei der 60.000-Byte-Ausgabegrenze. Keine leere endlos fortgesetzte Seite.
- Pagination ist ausdrücklich live-offset, keine Momentaufnahme. Änderungen zwischen
  Seiten können Einträge verschieben; die Antwort nennt diese Konsistenzgrenze.
  Bei mehr als 100.000 Offset wird die Fortsetzungsgrenze sichtbar gemeldet.
- OAuth-Refresh prüft zusätzlich den gespeicherten Grant-Scope vor Tokenausstellung.

## Prüfung und Nachweise

Serverfreie Rot/Grün-Prüfung:
`node --test tests/mcp-integration-regressions.test.mjs`

Neun Verhaltensfälle zuerst an der übernommenen Logik fehlgeschlagen (nach Korrektur
eines Fixture-Spaltenfehlers), anschließend korrigiert und erneut geprüft. Zusätzlich 36 vorhandene
Kernfälle für MCP, Kundenkonten, Kundenakte und Hermes-Termine erfolgreich.
Windows / Node 24 lokal ist kein Ersatz für den produktionsnahen Node-22-Linux-Lauf.

Vollständige verbindliche CI: npm ci, lint, typecheck, npm test, Build, Bundle-Syntax,
Shell-/sudoers-Prüfungen und gesamte Chromium-Browserregression.
Exakter finaler Head, Lauf und tatsächlich erfolgreiche Testzahlen stehen im Draft-PR.
Die Erstellung des Drafts startet diese vorhandene CI; bis zu deren Abschluss ist
der Draft ausdrücklich nicht technisch abgenommen.

Unabhängige Standards-/Sicherheitsprüfung und separate Spezifikationsprüfung.
Befunde werden vor Abschluss behoben oder im Draft als offen ausgewiesen.

## Migration, Bestand und Rückweg

Keine neue Datenbank, kein zweiter MCP-Server, kein zweiter Mailversand und keine
zusätzlichen Abhängigkeiten. Die additiven Kundenauth-/Mailtabellen aus PR #68
und die bei aktivem MCP angelegten OAuth-Tabellen aus PR #69 bleiben bestehen.
Keine neuen Migrationen durch die Integrationskorrekturen. Kein Backfill von
Einladungen, keine Datenkopie und keine produktive Migration ausgeführt.

Vor einer späteren Veröffentlichung: konsistente Sicherung einschließlich SQLite,
Uploads, Konfiguration und Authzustand; Wiederherstellung separat nachweisen.
Vorheriges Codeartefakt als Rollback behalten, additive Tabellen nicht löschen.
Keine alten Credential-Versionen oder widerrufenen Sitzungen/Grants aus einer
Sicherung unbemerkt reaktivieren. Bei Auth-Rollback erneute Autorisierung vorsehen.
Der Kundenkontocode verarbeitet neue Einladungen erst im vorhandenen freigegebenen
Versandweg; diese Prüfung hat keine echten Nachrichten ausgelöst.

## Offen bis zur gesonderten Betriebsabnahme

- Kein Merge, kein Hostinger-Release, keine Aktivierung und keine realen Panelabfragen.
- Reale ChatGPT-Client-ID/Callback aus dem Kontodialog ermitteln; keine geratenen Werte.
  Nach gesonderter Freigabe vorhandene MCP-Konfiguration setzen, Betreiber-OAuth,
  echte reine Leseabfrage, Widerruf/Refresh und Wiederverbindung nach Neustart prüfen.
- Kein physischer iOS-/Android-/Mac-/Windows-Gerätetest; CI prüft Chromium-Layouts.
- Produktive Mailzustellung, Proxy-/HEIC-Grenzen, Backup-Restore und rechtliche Fachprüfung
  bleiben separate Abnahmen. Keine automatische Freigabe durch grüne Tests.
- Unzugeordnete E-Mails, Bild-/PDF-Inhalte und nicht explizit zugeordnete WhatsApp-Chats
  werden nicht als auftragsbezogene MCP-Inhalte ausgegeben.
- Kein offizieller MCP-SDK-Interoperabilitätslauf und kein echter ChatGPT-Aufruf
  in diesem Entwicklungsschritt; geprüft wird der bestehende HTTP/RPC-Adapter.

Offizielle Protokollgrundlagen erneut abgerufen am 08.11.2026:
https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
https://developers.openai.com/plugins/build/auth

