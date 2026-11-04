# Roadmap Betriebspanel

Stand: 03.11.2026. Grundlage ist die Bestandsaufnahme des Repositorys vom 03.11.2026
(Code, Dokumentation, Tests und GitHub-Lauf #165).

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
| V8 | „Nächster Schritt“ an einer Stelle führen, ungenutzte `premium.*`/`agency.css` entfernen | Mittel | offen |
| V2 | Auftragsdetail mit einer statt zwei Navigationen (Ablaufschritte und Reiter zusammenführen) | Hoch | offen |
| V3 | Kommunikation bündeln: gemeinsamer Posteingang, „Nachrichten“ in der mobilen Leiste. E-Mail-Teil: Communication Center ([Details](Communication-Center.md)) | Hoch | E-Mail-Teil veröffentlicht (PR #41, live mit 999a667); Menü/Darstellung in Prüfung |
| V5 | Navigation straffen: gefilterte Auftragslisten zusammenführen | Mittel | offen |
| V7 | Übersicht fälliger Mahnstufen | Mittel | offen |
| V6 | Offene Angebote nachfassen (Liste, Erinnerung nur mit Versandfreigabe) | Mittel | offen |
| V12 | Rechnungsregister zeigt Rohstatus „unpaid“ statt „Offen“ (`invoiceRegister()` in `public/app.js` nutzt die Bezeichnungen aus `public/invoice-ui.js` nicht) | Mittel | offen |
| V13 | Externe Datensicherung prüfen: Panel-Backup liegt nur auf dem VPS (`/var/lib/white-gloss-panel`, Dienst ohne Netzwerk). Laut Betreiber sind Hostinger-Sicherungen aktiv; Umfang und Wiederherstellung sind ungeprüft | Mittel | offen, Betreiber |
| V11 | Abhängigkeiten aktualisieren (`exceljs`-Kette, 8 mittlere Audit-Hinweise) | Niedrig | offen |
| V9 | `public/app.js` in Module aufteilen | Niedrig | offen |
| V10 | Weniger Daten pro Aktualisierung als das vollständige `/api/state` | Niedrig | offen |

Entfallen: Mitarbeiterkonten und Rollen (V4). Der Betrieb hat keine Mitarbeiter
(Betreiberantwort vom 03.11.2026 bestätigt).

Grundlage und Belege aller Punkte: [Bestandsaufnahme](Bestandsaufnahme.md).
