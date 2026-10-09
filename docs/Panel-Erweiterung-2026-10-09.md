# Panel-Erweiterung: Assistent, Akten, Kalender und Aufgaben

## Ausgangslage und Veröffentlichung

Die Bestandsprüfung am 9. Oktober 2026 hat auf IONOS den aktiven Release
`ea1e21b3791bb3d2c152bcd3c4945d03f92578d3` bestätigt. Der Paneldienst war aktiv,
`/healthz` antwortete mit 200 `ok`, geschützte APIs ohne Sitzung mit 401.
Die Browserprüfung erreichte die persönliche Anmeldung; es bestand keine
angemeldete Betreibersitzung. Keine Kundenaktion wurde live ausgeführt.

Die Umsetzung begann in einer isolierten Kopie dieses Releases. Der neuere
GitHub-Stand `7e08fd7e925721a030432e25555ffd066ea7fc58` enthält zusätzlich
Fahrzeugübergaben mit späterer Kundenunterschrift. Er ist in dieser Erweiterung
integriert und mit den neuen Stornoregeln geprüft. Das ist kein Nachweis seiner Veröffentlichung.

Es wurde kein lokaler Website-Server gestartet. Eine Aktivierung benötigt den
vorhandenen separaten IONOS-Panel-Installer, eine konkrete Releasefreigabe,
Sicherung, Prüfsumme und anschließende Live-Prüfung. Die Hauptwebsite und ihre
Veröffentlichung sind davon getrennt.

## Bedienung

- Der jederzeit erreichbare **Assistent** liest den aktuellen Datenbereich,
  sucht Akten und speichert ausdrücklich beauftragte Kunden oder Aufgaben.
  Erkennt er widersprüchliche Angaben, fragt er nach. Bestätigte Aktionen und
  unbelegte Entwürfe sind getrennt gekennzeichnet. Der Chat wird nur im Browser-
  Arbeitsspeicher gehalten; Änderungen und Wiederholungskennungen werden privat
  in derselben SQLite-Datenbank gespeichert.
- Unter **Einstellungen → KI-Assistent** kann der Betreiber optional einen
  eigenen OpenAI-API-Zugang verschlüsselt speichern und aktivieren. Es war kein
  vorhandener KI-Zugang eingerichtet. Ohne Einrichtung arbeitet der Assistent
  mit lokalen Befehlen, Datenabfragen und einfacher Textbereinigung. Freie
  sprachliche Überarbeitung benötigt den eingerichteten Anbieter.
- Jede externe KI-Anfrage benötigt ein sichtbares, einmaliges Häkchen. Nur die
  Eingabe und der ausgewählte, begrenzte Aktenkontext werden übertragen. Modelle
  bekommen keine Aktionswerkzeuge, Zugangsschlüssel, Bilder oder Unterschriften.
  Quellenverweise sind kein automatischer Beweis der Richtigkeit. Die OpenAI-
  Anfrage verwendet `store:false`; das ist keine Zusage vollständiger
  Protokollfreiheit beim Anbieter. Modell und API-Kontingent müssen im eigenen
  Konto vorhanden sein. Es wurden keine echten KI-Anfragen oder Kosten ausgelöst.
- In **Kunden** gibt es eigenständige Kundenanlage und eine konkrete Vorschau
  vor Löschung, Sperrung oder Reduktion der Stammdaten. Verknüpfte Originale
  werden wegen ihrer unterschiedlichen Aufbewahrungsgründe nicht pauschal
  vernichtet. Details und Rechtsquellen stehen in
  [Akten, Projekte und Storno](Akten-Projekte-Storno.md).
- **Projekt bearbeiten** hält aktuelle Arbeitsangaben, korrigierbare
  Arbeitsschritte, Gründe und Versionen getrennt von ursprünglicher Anfrage,
  Preisvereinbarung, Zahlung und unterschriebenen Dokumenten. Dokumentstorno
  bewahrt Original, Zeitpunkt und Grund. Neue Inhalte erhalten einen neuen
  Vorgang; Freigaben und Zahlungen werden nicht übertragen.
- Der **Kalender** bietet Tag, Woche und Monat, bearbeitbare private Einträge,
  Aktenbezüge und Verschiebungen. Bestehende Kapazitäts- und Berliner Zeitregeln
  gelten weiterhin. Ein verbindlicher Kundentermin ändert sich erst nach
  persönlicher Zustimmung im Kundenpanel. Vorschläge reservieren keinen Termin.
- Die **Aufgaben-Spalte** zeigt offene, überfällige und erledigte Aufgaben.
  Titel, Notiz, Priorität, Fälligkeit und Bezüge können geändert werden. Auf
  schmalen Displays bleibt sie als aufklappbarer Bereich oberhalb des Inhalts
  erreichbar. Mehrfach ausgelöste Aktionen verwenden dauerhafte Kennungen;
  gleiche offene Aufgaben werden zusätzlich in der Datenbank abgefangen.

## Schutzregeln und Prüfungen

Alle neuen Betriebsendpunkte verwenden dieselbe serverseitige Betreibersitzung
wie die Oberfläche. Kundensitzungen dürfen nur ihre eigenen Terminänderungen
beantworten. Herkunft, Version, Datenbereich, Verknüpfungen und Speicherergebnis
werden geprüft. Gefälschte Identitätsheader erweitern keine Rechte.

Kundenannahme, Preisprüfung, Annahme vor Arbeit, Rückgabe vor Abschluss und
vollständiger Zahlungseingang bleiben Voraussetzung. Sperren und stornierte
Dokumente werden auch in älteren Aktions-, Versand- und Zahlungswegen geprüft.
Unklare oder laufende Versandvorgänge müssen vor einer Sperre geklärt werden.

Automatische Prüfungen verwenden ausschließlich synthetische Daten und direkte
App.fetch-/SQLite-Aufrufe. `scripts/ui-panel-extension-smoke.mjs` ergänzt die
vorhandenen Browserprüfungen auf dem Linux-GitHub-Runner; auch dort werden die
Anfragen direkt durch App.fetch beantwortet, ohne einen Website-Server.

Primärquellen zur optionalen KI-Anbindung:
[Responses / strukturierte Ausgaben](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses),
[OpenAI-Datenkontrollen](https://developers.openai.com/api/docs/guides/your-data).
