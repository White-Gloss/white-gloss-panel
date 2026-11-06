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

## Prüfstand und Fehlerkorrektur

Draft-PR [#63](https://github.com/White-Gloss/white-gloss-panel/pull/63) ist auf
`codex/wg-ux-001-order-workspace` veröffentlicht. Branch-Updates sind ausdrücklich
freigegeben; Merge und Deployment bleiben ausgeschlossen. Die frühere Push-Sperre
ist nach der ausdrücklichen Betreiberfreigabe aufgehoben.

Run [42301277197](https://github.com/White-Gloss/white-gloss-panel/actions/runs/42301277197)
bestätigt die vollständige Codeprüfung einschließlich des Installertests. Der lokale
Fehler (UID 0 wird vom Installer bestimmungsgemäß abgelehnt) war umgebungsbedingt;
der Test wird weder übersprungen noch abgeschwächt. Beide Release-Jobs wurden
übersprungen. Acht von 67 Browserfällen scheiterten am Wechsel aus Angebot & Termin.

Ursache: `markFormsSaved` übersprang das Fotoformular, `hasUnsavedForms` prüfte es
jedoch trotzdem. Sein fehlender Ausgangszustand ließ selbst ein leeres Formular
als ungespeichert erscheinen. Playwright verwirft unbehandelte Bestätigungsdialoge;
damit blieb der aktive Reiter unverändert. Die älteren jsdom-Fälle hatten den
Upload nicht, weil die Worker-Fixture keine eigenständige Authentifizierung meldet.

Reproduktion: zusätzlicher jsdom-Test mit exakt diesem Formular und abgelehntem
Bestätigungsdialog schlug vor der Korrektur mit `false !== true` fehl. Nach der
Korrektur passiert unberührte Navigation ohne Dialog; ausgewählte Dateien bleiben
vor Verwerfen geschützt. Dateiauswahl wird anhand Name, Größe, Typ und
Änderungsdatum erkannt. Signaturformulare behalten ihren bisherigen Schutz.

Die acht Browsertests behalten alle bisherigen Assertions und prüfen zusätzlich:
keine Warnung ohne Änderung, sichtbare ausstehende Unterschrift, ausgewählte Fotos
blockieren Navigation bei abgelehnter Warnung, geleerte Auswahl erlaubt Navigation.
Screenshots umfassen Angebot & Termin sowie Rückgabe in Hell/Dunkel bei
320/390/768/1440 px. Erneuter vollständiger GitHub-Lauf und visuelle Auswertung
werden vor Abschluss im PR dokumentiert.

Offen bleiben die persönliche Designabnahme und reale Geräteprüfungen für
Safari/iOS, Android, macOS und Windows. Kein lokaler Website-Server gestartet,
keine realen Kundenaktionen und kein Produktionsrelease.
