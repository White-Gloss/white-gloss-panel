# WG-UX-001 – Auftragszentrale 2.0

Stand: 06.11.2026. Erster isolierter Entwicklungsabschnitt; keine Veröffentlichung.
Grundlage: `main` bei `4f1ddb2e98bfd979f70707c8cb9f34e25096a313` und der aktuelle
Masterauftrag. Dieser verlangt eine konkrete Freigabe vor dem Merge/Release.

## Bedienkonzept

Für das gesamte Panel gilt: Übersicht priorisiert Handlungen, Auftragslisten dienen
Suche und Auswahl, die Auftragszentrale bündelt die Bearbeitung. Kundenakte,
Kommunikation, Kalender und Finanzen bleiben eigene, verknüpfte Fachbereiche.
Bestehende API, Authentifizierung, Dokumentversionen und Anbieter bleiben erhalten.
Kundenportal und Vor-Ort-App verwenden weiterhin die gemeinsamen Design-Tokens.
Native Apps folgen erst nach geprüfter gemeinsamer Web-Oberfläche.

Erster Abschnitt: Die doppelte Ablaufleiste/Reiternavigation wird durch genau eine
Navigation mit sechs bestehenden Arbeitsbereichen ersetzt. Desktop: horizontale
Bereichsleiste; Smartphone: zweispaltige, vollständig erreichbare Bereiche. Keine
neue Farbwelt, Schrift oder Abhängigkeit. Grundlage bleibt Obsidian & Platin.

Der Kopf zeigt Kunde, Fahrzeug, Paket, Gesamtstatus, Termin und Angebotsfestpreis
bzw. vorläufigen Preis. Ein Terminvorschlag wird ausdrücklich als unbestätigt
gekennzeichnet. Ein Kundenwunsch ist kein bestätigter Termin. Nur die vorhandene
`appointment.confirmation` belegt die Bestätigung.

Annahme und Rückgabe bleiben unabhängig erreichbar. Die Bereichsleiste zeigt
Dokumente und ausstehende Unterschriften anhand ihrer tatsächlichen Datensätze.
Manuelle Schrittvermerke stehen daneben und ersetzen diesen Nachweis nicht.
Der Gesamtstatus erzeugt keine erfundenen erledigten Protokolle mehr.
Der bestehende nächste Schritt bleibt als ein kompakter Hinweis erhalten.

## Umsetzung und Grenzen

- `public/order-workspace.js`: reines, unveränderndes Anzeigemodell.
- `public/app.js`: Kopfübersicht, gemeinsame Navigation, korrekte Vorauswahl des
  gespeicherten manuellen Schrittzustands.
- `public/surface.css`: auf die neuen Komponenten begrenzte responsive Regeln.
- `public/enterprise.css`: ausschließlich nicht mehr verwendete Ablaufleistenregeln entfernt.
- Bestehende Datenaktionen, Zahlungs-/Unterschriftsschutz, Formulare, Chat und
  Änderungsprotokoll unverändert; keine Datenmigration, kein Kundenzugriff.

Das ist der erste Abschnitt, kein Abschluss des gesamten Masterauftrags.
Noch offen: Designabnahme, vollständige Dokumentenübersicht, weitere Optimierung
von Leistungen/Fotozugriff, durchgehende UX-Prüfung der angemeldeten Produktion,
anschließende Bereiche des Panels und native Apps. Zahlungsnachweise werden
weiter im vorhandenen Rechnungsbereich geprüft, nicht aus einem Navigationsbadge
abgeleitet. Der nächste Schritt verwendet weiterhin die bestehende Statuslogik.

## Prüfplan und Abnahme

- Modultests: fehlende Dokumente trotz späterem Status; ausstehende Ersatzfassungen;
  Trennung von Kundenwunsch, Vorschlag und Bestätigung; keine Datenmutation.
- jsdom-Prozessintegration: direkte Bereichswahl, übersprungene Annahme und
  unabhängige Rückgabe, gespeicherte Schrittwahl, Tastatur, ungespeicherte Eingaben.
- Vollständige README-Prüfungen ohne lokalen Website-Server.
- GitHub-Browserprüfung: 320, 390, 768 und 1440 px, Hell/Dunkel, alle Bereiche,
  Touchflächen, horizontaler Überlauf, Tastatur und Screenshots.
- Browser-Screenshots anschließend visuell prüfen. Physische iOS-/Android- und
  Safari-/Windows-Gerätetests sind davon nicht abgedeckt.

## Quellen und Zugänge

GitHub-Zugriff und lokale Kopie bestätigt. Browser Use hat Panel-Anmeldeseite und
öffentliche Website erreichbar vorgefunden. Die angemeldete Auftragsansicht und
der aktive Produktionscommit sind damit nicht verifiziert. Kein Live-UX-Audit
behauptet. Panel-MCP- und Hostinger-Operationen waren auch nach gezielter Suche
nicht exponiert. Der Hostinger-Releaseweg ist in `.github/workflows/checks.yml`
belegt; seine Ausführung wird in diesem Abschnitt nicht ausgelöst.

Verwendet: GitHub-Werkzeuge, Browser Use, Product Design (Index, Kontext-Preflight,
Audit-Regeln), Hostinger-Anleitung zur Zugangsprüfung, bestehende Node-/jsdom-
Prüfwerkzeuge. Keine zusätzlichen Plugins oder Projektabhängigkeiten installiert.

## Tatsächlicher Prüfstand dieser Sitzung

- Commit des ersten Abschnitts: `e478d39` (lokaler Entwicklungsbranch).
- 46 gezielte Tests: bestanden.
- Lint, Typprüfung, Build, `node --check dist/server/index.js`, Syntax des neuen
  Browsertests und `git diff --check`: bestanden.
- Gesamtsuite: 698 Tests, davon 697 bestanden und ein Fehler im unveränderten
  `tests/deploy-installer.test.mjs:79`. Die Test-Fixture übernimmt die aktuelle UID;
  diese Umgebung läuft als UID 0. Der Installer lehnt UID 0 bestimmungsgemäß ab
  („Eigener unprivilegierter Panelbenutzer erforderlich“). `runuser -u nobody`
  wird von der Umgebung mit „cannot set groups: Operation not permitted“ abgelehnt.
  Dieser Fall ist auf dem vorgesehenen unprivilegierten GitHub-Runner noch zu prüfen.
- Kein Website-Server gestartet. Keine echten Kundenaktionen ausgeführt.
- Push durch automatische Freigabeprüfung blockiert: öffentliche Sichtbarkeit von
  Projektcode und Dokumentation verlangt eine ausdrückliche Bestätigung.
- Deshalb: kein Pull Request angelegt, keine GitHub-Browserläufe, keine visuelle
  Abnahme, kein Merge und kein Deployment. PR-Text ist lokal vorbereitet.
- Nächster Schritt: Freigabe ausschließlich für den öffentlichen Entwicklungsbranch
  und Draft-PR einholen, anschließend GitHub-Prüfungen und Screenshots auswerten.
