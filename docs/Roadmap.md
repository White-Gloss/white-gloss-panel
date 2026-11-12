# Roadmap Betriebspanel

Stand: 10.11.2026. Ausgangsbasis: Code auf `main` (`e41906e`), Repository-Prüfung und
GitHub-Lauf 42891989349.

## Arbeitsweise

Es wird immer nur eine Hauptaufgabe bearbeitet. Jede Aufgabe durchläuft:

1. Analyse
2. Planung
3. Freigabe
4. Umsetzung
5. Technische Tests (`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`,
   `node --check dist/server/index.js`, Browserprüfung auf dem GitHub-Runner)
6. Anwender-Test (UI-Tests mit synthetischen Daten, Browser-Screenshots, Testbereich)
7. Online-Stellung über `main` und den Job **Hostinger panel release**
8. Überwachung
9. Abschluss mit getrenntem Bericht: implementiert, getestet, veröffentlicht, live geprüft

Betreiberentscheidung vom 03.11.2026: Der Agent gibt die Aufgaben dieser Liste nach
erfolgreichen Prüfungen selbst frei und stellt sie online. Der Betreiber arbeitet allein;
die Rollen bleiben Betreiber, Kunde und Steuerberater.

## Reihenfolge

| Nr. | Aufgabe | Priorität | Stand |
| --- | --- | --- | --- |
| V0 | Dokumentation an den belegten Hostinger-Releaseweg angleichen | Kritisch | veröffentlicht (PR #38) |
| V1 | Handlungszentrale auf der Übersicht: alle fälligen Schritte in einer Liste, Monatszahlen statt Gesamtsumme, Arbeitsvorrat nach Dringlichkeit, Wiedervorlagen abhaken ([Details](Handlungszentrale.md)) | Hoch | Liste veröffentlicht (PR #39); Abhaken in Prüfung |
| V8 | „Nächster Schritt“ an einer Stelle führen, ungenutzte `premium.*`/`agency.css` entfernen | Mittel | ungenutzte Dateien entfernt; Releaseprüfung auf aktive Paneldateien umgestellt |
| V2 | Auftragsdetail mit einer statt zwei Navigationen (Ablaufschritte und Reiter zusammenführen) | Hoch | eine gemeinsame Tab-Leiste; Angebot und Termin liegen im selben Bereich |
| V3 | Kommunikation bündeln: gemeinsamer Posteingang, „Nachrichten“ in der mobilen Leiste. E-Mail-Teil: Communication Center ([Details](Communication-Center.md)) | Hoch | Gemeinsamer, nach Eingang sortierter E-Mail-/Kundenchat-/WhatsApp-Eingang mit Rücksprung in den jeweiligen Kanal; E-Mail- und Chat-Ungelesenfilter; Veröffentlichung nach Prüfung |
| V5 | Navigation straffen: gefilterte Auftragslisten zusammenführen | Mittel | umgesetzt: Anfragen, Laufend und Abgeschlossen filtern dieselbe Auftragsliste; Anfragealter sichtbar |
| V7 | Übersicht fälliger Mahnstufen | Mittel | offen |
| V6 | Offene Angebote nachfassen (Liste, Erinnerung nur mit Versandfreigabe) | Mittel | offen |
| V12 | Rechnungsregister zeigt Rohstatus „unpaid“ statt „Offen“ (`invoiceRegister()` in `public/app.js` nutzt die Bezeichnungen aus `public/invoice-ui.js` nicht) | Mittel | umgesetzt: gemeinsame Statusbezeichnungen aus `public/invoice-ui.js` |
| V13 | Externe Datensicherung prüfen: Panel-Backup liegt nur auf dem VPS (`/var/lib/white-gloss-panel`, Dienst ohne Netzwerk). Laut Betreiber sind Hostinger-Sicherungen aktiv; Umfang und Wiederherstellung sind ungeprüft | Mittel | offen, Betreiber |
| V11 | Abhängigkeiten aktualisieren (`exceljs`-Kette, 8 mittlere Audit-Hinweise) | Niedrig | offen |
| V14 | Optik „Obsidian & Platin“ für alle Oberflächen, Vor-Ort-App zuerst ([Details](Obsidian-und-Platin.md)) | Hoch | umgesetzt (PR #48), Prüfung offen |
| V15 | Panel auf dem Handy wie eine iOS-App: Tab-Leiste, Kopfleiste, Schrift, Listen, Auftragsdetail, Communication Center ([Plan](plans/2026-11-10-wg-ios-001.md)) | Hoch | Phase 1 bis 5 veröffentlicht (PR #81, #82, #83, #84, #89, #90, #91); Phase 6a in Prüfung |
| V9 | `public/app.js` in Module aufteilen | Niedrig | offen |
| V10 | Weniger Daten pro Aktualisierung als das vollständige `/api/state` | Niedrig | offen |

Entfallen: Mitarbeiterkonten und Rollen (V4). Der Betrieb hat keine Mitarbeiter
(Betreiberantwort vom 03.11.2026 bestätigt).

Grundlage und Belege aller Punkte: [Bestandsaufnahme](Bestandsaufnahme.md).
