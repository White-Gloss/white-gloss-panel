# Steuerberaterzugang

## Einrichtung durch den Betreiber

Im IONOS-Panel **Finanzen → Steuerberaterzugang verwalten** öffnen.
Kanzleiname und die persönliche E-Mail-Adresse der berechtigten Person selbst
eintragen. Pro Person einen eigenen Zugang anlegen.

„Zugang und Einrichtungslink erstellen“ zeigt einmalig einen 24 Stunden gültigen
Link. Diesen vertraulich selbst weitergeben; das Panel versendet keine Einladung.
Die Person bestätigt die hinterlegte E-Mail-Adresse durch Eingabe und richtet
ein Passwort mit mindestens 15 Zeichen ein. Das ist keine separate Verifikation
des E-Mail-Postfachs; der Einrichtungslink ist das Zugangsgeheimnis.
Anschließend erfolgt die Anmeldung unter `/kanzlei` mit E-Mail und Passwort.

„Zugang sperren“ entzieht sofort den Zugriff und löscht Sitzungen.
„Neuen Einrichtungslink erzeugen“ ist auch die Passwortwiederherstellung:
alte Links, Passwörter und Sitzungen werden ungültig. Die Person richtet ihr
Passwort erneut selbst ein. Kein bestehender Betreiber- oder Kundenzugang
wird in eine Kanzleirolle umgewandelt.

## Rechte und Grenzen

- Lesen: reale Belege, eingelesene Bankumsätze, aktuelle und frühere im Auftrag
  gespeicherte Rechnungen. Keine Testdaten, Fotos, Unterschriften,
  Kundennachrichten, Konfiguration oder Kunden-Zugangslinks.
- Originaldownload: Belege sowie bereits im Panel archivierte Rechnungs-PDFs;
  Integritätsprüfung vor Ausgabe. Fehlende Rechnungsoriginale muss der Betreiber
  über den bestehenden Rechnungsweg abrufen. Kein Anbieterabruf durch die Kanzlei.
  Die Zuordnung zwischen Rechnungs-ID und Originaldatei bleibt bei Storno und
  Neuausstellung erhalten. Vorhandene aktuelle Zuordnungen werden übernommen;
  bereits früher verlorene Zuordnungen werden nicht anhand vermuteter Dateiinhalte
  rekonstruiert.
- Export: CSV je Liste und Zeitraum, Beträge in Cent, Formeleingaben entschärft.
  Maximal 366 Tage und 10.000 Zeilen pro Export; größere Exporte werden mit einer
  sichtbaren Fehlermeldung abgewiesen, nicht abgeschnitten. Kein DATEV-EXTF.
  Originale werden einzeln heruntergeladen. Ein ZIP-Sammelexport ist noch offen.
- Belege und Bankumsätze kommentieren; unveränderlicher Kommentarverlauf.
  Bankkommentare bleiben über Anbieterrevisionen derselben Transaktion hinweg
  lesbar. Neue Kommentare und Vorschläge verlangen weiterhin den aktuellen Stand.
- Zuordnungen vorschlagen. Vorschläge bleiben getrennt von Zuordnungen.
  Nur der Betreiber darf sie ausdrücklich als Zuordnungsentwurf übernehmen oder
  ablehnen. Geänderte Zuordnungs-/Bankversionen blockieren eine Übernahme.
- Keine Rechnungsstellung, Stornierung, Zahlung, Mahnung, Nachricht, Qonto-Sync,
  Journalbuchung oder Steueranmeldung durch die Kanzlei.

Sitzungen laufen nach 30 Minuten Inaktivität oder spätestens acht Stunden ab.
Einrichtung, Login, Sperren, Downloads, Exporte, Kommentare und Entscheidungen
erhalten einen unveränderlichen Verlauf in `advisor_audit`. Ein Verwaltungsbildschirm
für diesen Verlauf und ein zweiter Anmeldefaktor sind weitere Ausbauschritte.

## Technische Prüfung

Eigene serverseitige Routen und Session-Cookie, scrypt mit dem bestehenden
Passwort-Hashing-Limit, sichere Cookies, Same-Origin-JSON-Anfragen, Rate Limits,
gehashte Einrichtungs-/Sitzungstoken und Berechtigungsprüfung vor jeder Ausgabe.
Schreibvorgänge prüfen die aktive Kontorevision nochmals in der atomaren SQL-
Anweisung. Übernahme, Klassifikationshistorie und Entscheidung werden gemeinsam
in einer Datenbanktransaktion gespeichert.

Serverlose Integrationstests prüfen Kontentrennung, Widerruf, Link-Replay, Ablauf,
CSRF, Datenminimierung, Downloads, Historie, >200 Einträge und Versionkonflikte.
Browserregressionen laufen ausschließlich im vorhandenen Linux-GitHub-Workflow.
Es wird kein lokaler White-Gloss-Server gestartet.

Das bestehende Backup erfasst zusätzlich die Originale aus `accounting_documents`
einschließlich Hashprüfung und Dateimetadaten. Ein Wiederherstellungstest prüft,
dass Belege auch nach Entfernen der Quelldatei aus der Sicherung lesbar bleiben.

## Nächste Verbesserungen am Rechnungspanel

1. Bestehende Finanzansicht: Pagination auch außerhalb der Kanzleiansicht,
   belastbare inkrementelle Qonto-Synchronisierung und verständliche Ladefehler.
2. Durchgängige Zuordnung Rechnung ↔ Zahlung ↔ Beleg einschließlich Teilzahlungen,
   Überzahlungen, Storno und offener Posten; manuelle Versandfreigaben erhalten.
3. Monatsabschluss: fehlende Belege, ungeklärte Umsätze, Prüffreigabe und
   nachvollziehbare Periodensperren mit Korrekturweg.
4. DATEV-Format, Kontenrahmen und Steuerschlüssel mit der Kanzlei festlegen und
   anhand eines Testimports verifizieren.
5. E-Rechnungen: strukturierte Originaldateien (XML bzw. eingebettetes XML),
   Formatvalidierung, lesbare Darstellung und geschützte Aufbewahrung.
6. Zweiter Faktor für Kanzlei/Betreiber und externe Sicherung mit dokumentierter
   Wiederherstellungsprüfung.

Die Funktion ist keine vollständige Buchführung und kein GoBD-Konformitätsnachweis.
