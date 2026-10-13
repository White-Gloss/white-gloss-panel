# Plan Paket 1: Kalender komplett

Stand: 13.10.2026. Grundlage sind `00-auftrag-sechs-pakete.md` (Auftrag) und `01-phase0-bestandsaufnahme.md` (Ist-Stand).
**Status: Entwurf. Umsetzung erst nach Freigabe durch Lars und nach Beantwortung der Fragen in Abschnitt 10 der Bestandsaufnahme.**

## Spielregeln für die Umsetzung (gilt für Codex/ChatGPT)

- Arbeitsbasis ist **immer `main`** von `White-Gloss/white-gloss-panel`. Nie auf `feat/angebot-terminwahl` oder `feat/acht-panel-erweiterungen-20261010` aufbauen. Code von dort wird nur gezielt übernommen (portiert).
- Es gilt `AGENTS.md`: kein lokales Hosting, auch nicht kurz. Prüfungen nur mit `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (die jsdom-UI-Tests rufen die Serverlogik im Prozess auf). Echte Geräte werden erst nach dem Release am Live-Stand im Testbereich geprüft.
- Kleine PRs in der Reihenfolge 1A bis 1F (siehe unten). Jeder PR braucht grüne CI und ein unabhängiges Review. Gemergt wird erst nach Lars' Okay.
- Release nur wie bisher: Paket von `main` mit `scripts/package-ionos.mjs`, Ablage auf einem `release/…`-Branch mit Übergabe-Datei, Installation mit `deploy/install-panel.sh`. Getrennt berichten: implementiert, getestet, veröffentlicht, live geprüft.
- Keine echten Kundenmails und keine Google-Schreibzugriffe als Test. Für Tests gibt es den Testbereich (`synthetic`).
- Kein Löschen von Bestandsdaten. Alt-Tabellen und Alt-Trigger werden nur nach ausdrücklicher Freigabe verändert (siehe 1.0).

## 1.0 Vorbedingung: Live-Datenbank lesend prüfen (vor jedem Code)

Ziel ist zu klären, ob die Alt-Trigger und Alt-Tabellen aus dem Zweig `feat/angebot-terminwahl` (live vom 04.10. bis 12.10.) noch in `panel.sqlite` liegen. Bestandsaufnahme, Risiko 1 und 2.

Ausführung durch ChatGPT als root auf dem VPS, **nur nach Lars' Freigabe (Frage 1)**. Die Abfrage liest nur und gibt keine Kundendaten aus, sondern Namen, Zähler und Trigger-Merkmale:

```sh
sudo -u white-gloss-panel /usr/bin/node --input-type=module - <<'EOF'
import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync('/var/lib/white-gloss-panel/data/panel.sqlite',{readOnly:true});
const q=(sql,...a)=>db.prepare(sql).all(...a);
const tables=q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r=>r.name);
for(const t of tables)console.log('TABLE',t,q(`SELECT COUNT(*) AS n FROM "${t}"`)[0].n);
for(const r of q("SELECT name,tbl_name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name")){
  const marks=[];
  if(/RAISE\(ABORT/.test(r.sql)&&r.sql.includes('calendar_entries'))marks.push('[Sperrt auch wegen calendar_entries]');
  if(r.sql.includes('calendarDay'))marks.push('[Wochenendregel]');
  if(r.name.startsWith('no_overlap')&&r.sql.includes('julianday'))marks.push('[Alt-Version aus feat/angebot-terminwahl]');
  console.log('TRIGGER',r.name,'on',r.tbl_name,...marks);
}
const now=new Date().toISOString(),today=now.slice(0,10);
if(tables.includes('calendar_entries'))console.log('calendar_entries echt / echt-zukuenftig',q("SELECT COUNT(*) AS n FROM calendar_entries WHERE synthetic=0")[0].n,q("SELECT COUNT(*) AS n FROM calendar_entries WHERE synthetic=0 AND julianday(end)>julianday(?)",now)[0].n);
if(tables.includes('calendar_day_rules'))console.log('calendar_day_rules echt / echt-zukuenftig',q("SELECT COUNT(*) AS n FROM calendar_day_rules WHERE synthetic=0")[0].n,q("SELECT COUNT(*) AS n FROM calendar_day_rules WHERE synthetic=0 AND day>=?",today)[0].n);
db.close();
EOF
```

Ausgegeben werden nur Tabellennamen, Zeilenzahlen und Trigger-Merkmale. Es wird keine Datei angelegt und nichts geschrieben (`readOnly`). Die Meldung „ExperimentalWarning“ ist normal.

Ergebnis an Lars berichten. Danach entscheidet Lars (Frage 2):
- **a) Übernehmen:** zukünftige echte Blockierungen und Freigaben werden in Paket 1 sichtbar und bearbeitbar. Die Tabellennamen sind identisch, siehe 1A.
- **b) Nur lesbar anzeigen.**
- **c) Ignorieren:** Dann ersetzt Paket 1 die Alt-Trigger durch eigene, eindeutig benannte Trigger. Das ist eine DB-Änderung ohne Datenverlust und läuft nur mit Freigabe und nach Backup.

## Ziel und Abnahme (aus dem Auftrag)

- Ansichten Tag, Woche, Monat und Agenda, alle handytauglich. Statusfarben von „Anfrage“ bis „Bezahlt“, aber **nie nur Farbe** (immer zusätzlich Text oder Symbol).
- Drag & Drop mit Konfliktprüfung auf dem Server. Spalte „Unverplant“ für Hub-Anfragen und Aufträge ohne Termin.
- Mehrtägige Balken. Keramik mit 1.920 Minuten Arbeitszeit. Kommt sie als Anfrage ohne feste Zeit, wird sie nach Bestätigung mehrtägig geplant, mit Aushärte-Block (Dauer je Produkt einstellbar, Herstellerangabe).
- Blocker (Urlaub, Krank, Material, Wetter, Feiertag nach Bundesland), Arbeitszeiten, Puffer, Fahrzeit (Routes API, Schalter aus).
- Auslastung frei/knapp/voll, anonymisiert an die Website. Wartelistenvorschlag nur mit Freigabe.
- Umbuchen und Stornieren mit Frist im Kunden-Login. ICS-Feed nur lesend, mit widerrufbarem Token.
- Zwei-Wege-Sync nur nach Lars' Entscheidung, mit syncToken.
- **Abnahme:**
  - Parallele Speichervorgänge ergeben nie eine Doppelbuchung.
  - Keramik erscheint als Mehrtagesbalken.
  - Kein Überlauf bei 360 px Breite.
  - Die Zeitumstellung verschiebt keine Termine.

## Architektur-Entscheidungen

1. **Termin = Auftrag + Segmente.**
   - Ein Auftrag kann mehrere Zeitabschnitte haben: `work` (Arbeitszeit), `curing` (Aushärtung), `buffer` (Puffer), `travel` (Fahrt).
   - Die bisherige Tabelle `appointments(order_id,start,end)` bleibt als Gesamtspanne bestehen (min. Start bis max. Ende). So laufen ICS, Google-Sync, Erinnerungen und Protokolle unverändert weiter.
2. **Ressourcen statt globalem Überlappungsverbot.** Es gibt zwei Ressourcen:
   - `arbeit`: Lars' Arbeitszeit. Darauf belegen `work`, `travel`, `buffer` und Blocker.
   - `halle`: der Stellplatz. Darauf belegen `work` und `curing`.
   - Ob die Aushärtung parallele Arbeit an einem zweiten Fahrzeug erlaubt, hängt von Frage 7 ab. Die Ressourcen sind deshalb konfigurierbar. Standard bis zur Antwort: Aushärtung blockiert nur die Halle; da es nur eine Halle gibt, ist während der Aushärtung kein zweites Fahrzeug möglich.
3. **Konfliktschutz in der Datenbank.**
   - SQLite-Trigger mit eigenen, versionierten Namen (`cal2_*`) prüfen jede Überschneidung pro Ressource, getrennt nach Testbereich, und lehnen sie mit `RAISE(ABORT,'Terminüberschneidung')` ab. Sie sitzen auf `appointment_segments` und `calendar_blocks`.
   - **Die globalen Trigger `no_overlap_insert/update` werden in jedem Fall abgelöst**, unabhängig von der Entscheidung in 1.0. Sie werden aus `src/schema.mjs` entfernt und beim Start per `DROP TRIGGER IF EXISTS` gelöscht. Andernfalls sperrt die Gesamtspanne in `appointments` (Arbeit + Aushärtung) alle Ressourcen und auch den Testbereich, und das neue Modell greift nie.
   - Dabei werden ebenfalls entfernt: `calendar_entry_overlap_*` und `appointment_weekend_*`. Die Alt-Audit-Trigger bleiben, sie schreiben nur in `calendar_audit`. Nur Trigger werden entfernt, nie Daten. Das passiert beim ersten Start des neuen Releases, nach dem Backup durch den Installer.
   - Fehler aus Triggern („Terminüberschneidung“, „gesperrt“) werden in der neuen Kalender-API genauso auf **409** abgebildet wie heute in `worker.mjs:154`.
   - Gespeichert wird im selben `BEGIN IMMEDIATE`-Batch wie der Auftrag (`server/storage.mjs`), mit Versionsprüfung (`version`, `operationId`).
   - So hält der Schutz auch zwischen Webdienst und Wartungslauf: SQLite sperrt über Prozesse hinweg.
4. **Zeit:** Gespeichert wird in UTC (ISO). Arbeitszeiten, Blocker-Tage und Feiertage sind Wandzeit in `Europe/Berlin`. Für die Umrechnung `berlinISO`/`berlin` aus `src/domain.mjs` verwenden; nicht existierende oder doppeldeutige Ortszeiten werden schon heute abgelehnt.
5. **Übernahme aus PR #6 / 3791e76 statt Neuschreiben:**
   - `calendar_day_rules` und `calendar_audit` mit identischer Definition (Quelle: `src/schema.mjs` @ `f9b60ec`); vorhandene Wochenendfreigaben gelten so weiter.
   - Blocker kommen in die neue Tabelle `calendar_blocks`, mit Ressource, Kategorie und Storno-Feld. Alte Einträge aus `calendar_entries` werden bei Entscheidung a) **kopiert**, nicht verschoben. Die Alt-Tabelle bleibt unverändert und wird nur gelesen.
   - Regel- und Validierungscode aus `src/booking-calendar.mjs`, `server/booking-calendar.mjs`, `server/calendar-adjustments.mjs`, `public/booking-calendar.js`.
   - Tests aus `tests/booking-calendar.test.mjs` (11 Fälle: Zeitgrenzen, Zeitumstellung, Parallelität, Datenschutz).
   - **Nicht** übernommen werden die Abhängigkeiten zu Kundenportal, Zahlungsbuch und Assistent.
6. **Keine neuen npm-Abhängigkeiten.** Drag & Drop mit Pointer Events, Feiertage per Osterformel (Gauß/Meeus) im Code, ICS mit dem vorhandenen `src/calendar.mjs`.

## Datenmodell (neu bzw. übernommen)

| Tabelle | Zweck | Herkunft |
|---|---|---|
| `calendar_blocks(id, version, synthetic, category ∈ urlaub/krank/material/wetter/feiertag/privat/google/sonstiges, resource ∈ arbeit/halle/beide, title, note, start, end, cancelled_at, source ∈ panel/legacy/google, updated_at)` | Blocker und freie Termine ohne Auftrag. Aufheben setzt `cancelled_at`, es wird **nie hart gelöscht** | neu (bei 1.0 a: Kopie der echten Alt-Einträge mit `source='legacy'`) |
| `calendar_entries`, `calendar_adjustments` (alt) | Nur lesend für die Übernahme. Werden nicht verändert oder gelöscht | Altbestand, falls vorhanden |
| `calendar_day_rules(day, synthetic, version, windows JSON, updated_at)` | Abweichende Tagesfenster, z. B. Samstag freigeben oder früher schließen | identisch zu `f9b60ec` |
| `calendar_audit` | Änderungsverlauf | identisch, nur IDs, keine Namen |
| `appointment_segments(id, order_id, seq, kind ∈ work/curing/buffer/travel, resource, start, end, synthetic)` | Mehrteilige Termine | neu |
| `calendar_feed_tokens(hash PK, label, created_at, revoked_at, last_used_at)` | ICS-Abo, nur der Hash wird gespeichert | neu |
| `calendar_change_requests(id, order_id, kind ∈ reschedule/cancel, wish JSON, state ∈ open/approved/declined, created_at, decided_at)` | Umbuchungs- und Stornowünsche von Kunden, Warteliste | neu |
| `calendar_google_sync(calendar_id PK, sync_token, updated_at)` | Nur für Schritt 1F | neu |

**Einstellungen** (`settings`, JSON):
- `calendarWorkHours`: je Wochentag Fenster. Standard nach Frage 5.
- `calendarBufferMinutes`: Puffer, Frage 6.
- `calendarHolidayState`: `BW`.
- `calendarExtraClosedDays`: Frage 12.
- `curingProducts[]`: `{id, name, hoursBeforeWater, curingHoursBlock, noteForCustomer}`.
- `ceramicWorkMinutes`: 1920.
- `capacityThresholds` `{tight:0.5, full:0.85}`.
- `availabilityWeeksAhead`.
- `customerChangeDeadlineHours`.
- `travelEnabled`: false.
- `twoWaySyncEnabled`: false.

## Umsetzung in Teilschritten (je ein PR)

### 1A – Grundlage: Schema, Regeln, Feiertage, Arbeitszeiten (nur Server + Tests)

- Neues Modul `src/calendar-rules.mjs` (rein, testbar, auch im Browser nutzbar):
  - `holidays(state, year)`: Regeltabelle für **alle 16 Bundesländer** (Auftrag: „Feiertag nach Bundesland“). Standard ist `BW` nach § 1 FTG BW mit 12 Tagen; Reformationstag und Buß- und Bettag gelten dort nicht.
  - Bewegliche Tage aus der Osterformel (Karfreitag, Ostermontag, Himmelfahrt, Pfingstmontag, Fronleichnam).
  - Länderregeln: u. a. Reformationstag, Buß- und Bettag (Sachsen), Weltkindertag (Thüringen), Frauentag (Berlin, Mecklenburg-Vorpommern). Nur örtlich geltende Tage (z. B. Mariä Himmelfahrt in Teilen Bayerns, Augsburger Friedensfest) als zuschaltbare Option.
  - Länderliste vor dem Merge gegen eine aktuelle amtliche Quelle prüfen. Test BW 2026/2027 gegen die bekannten Daten.
  - `workWindows(day)`: Arbeitszeiten minus Feiertage, Blocker und Tagesregeln.
  - `planSegments(order, product)`: verteilt die Arbeitsminuten auf freie Fenster, hängt danach die Aushärtung an und setzt die Puffer.
  - `capacity(day)`: Anteil gebuchter Arbeitsminuten an verfügbaren Arbeitsminuten.
- Neues Modul `server/calendar.mjs`:
  - Schema mit `CREATE TABLE IF NOT EXISTS` für die Tabellen oben.
  - Trigger `cal2_*` für die Überschneidungsprüfung pro Ressource über `appointment_segments` und `calendar_blocks` (ohne aufgehobene Blocker).
  - Alt-Trigger ablösen wie unter Architektur 3 beschrieben (immer). Abhängig von Entscheidung 1.0 nur die Übernahme von Alt-Einträgen in `calendar_blocks`.
  - **Rollback-Verträglichkeit:**
    - Wird auf ein Release vor 1A zurückgesetzt, legt der alte Code `no_overlap_*` per `IF NOT EXISTS` wieder global an. Das ist strenger, aber sicher.
    - Die `cal2_*`-Trigger hängen nur an den neuen Tabellen, die alter Code nicht beschreibt.
    - Neue Tabellen bleiben einfach liegen. Das wird im Test „Start mit Schema des Vorgänger-Release“ geprüft.
- API, nur für den Betreiber:
  - `GET /api/calendar/range?from&to&test=` liefert Segmente, Blocker, Tagesregeln, Feiertage und Unverplante.
  - `POST /api/calendar/action` für `saveBlock`, `cancelBlock` (setzt `cancelled_at`, löscht nichts), `setDayRule`, `planOrder`, `moveSegment`, `setSettings`. Bei veralteter Version oder Überschneidung kommt 409.
  - Weiterhin `POST /api/action appointment` für die bisherigen Wege (Vor-Ort-App). Intern wird es auf `planOrder` umgestellt.
- Tests (`tests/calendar-rules.test.mjs`, `tests/calendar-server.test.mjs`):
  - Feiertage 2026/2027.
  - Zeitumstellung 29.03.2026, 25.10.2026, 28.03.2027 und 31.10.2027. Ein Termin um 09:00 bleibt 09:00 Wandzeit, und Dauern über die Umstellung stimmen.
  - **Parallelität:**
    - 20 gleichzeitige `planOrder` auf denselben Slot über `Promise.all`; genau einer gewinnt, alle anderen bekommen 409.
    - Zusätzlich echte Prozessgleichzeitigkeit: 4 `worker_threads` bzw. `child_process`, jeder mit eigener `PanelDatabase` auf **einer gemeinsamen Temp-Datei** (nicht `:memory:`). Jeder bucht in einer Schleife; am Ende gibt es keine Überschneidung in der DB.
    - Hintergrund: `DatabaseSync` arbeitet synchron. Zwei Verbindungen im selben Thread laufen deshalb nie gleichzeitig, das würde die Sperre nicht testen.
  - **Alt-Schema-Test:** Start auf einer DB mit dem Alt-Schema von `f9b60ec`/`3791e76` (Trigger und Tabellen). Danach gilt: Alt-Trigger sind abgelöst, Alt-Daten unverändert, Buchungen funktionieren. So bilden die CI-Tests die Live-DB ab.
  - Blocker gegen Termin, Testbereich getrennt, Pufferberechnung.
  - Bestandsaufträge (nur `appointments`) erscheinen weiter korrekt.

### 1B – Kalender-Oberfläche

- Neues Modul `public/calendar-view.js`, eingebunden in `calendarPage` (`public/app.js`). Ansichten:
  - **Tag:** Zeitraster 06–20 Uhr, Ressourcen-Spalten.
  - **Woche:** 7 Spalten. Auf schmalen Bildschirmen 3 Tage, horizontal wischbar mit `scroll-snap`.
  - **Monat:** mehrtägige Balken über die Tage hinweg. Keramik ist sichtbar als Arbeit + Aushärtung.
  - **Agenda:** Liste nach Tagen, Standard auf dem Handy.
- **Statusdarstellung:** Farbe **plus** Text-Badge **plus** Symbol für Anfrage, Angebot offen, Angenommen, Termin verbindlich, In Arbeit, Erledigt, Bezahlt. „Anfrage“ ist kein eigener Status in `domain.mjs:3`. Er ist die Anzeige für Hub-Importe und den Status „Preise prüfen“. Blocker schraffiert mit Kategorie-Text, Feiertage mit Namen. Kontrast nach WCAG AA.
- **Spalte „Unverplant“:**
  - Aufträge ohne Termin in den Status Preise prüfen, Angebot offen und Angenommen.
  - Hub-Anfragen nach dem Import; in derselben Spalte gibt es den Button „Website-Anfragen holen“.
  - Keramik-Anfragen ohne Uhrzeit.
- **Drag & Drop:**
  - Mit Pointer Events (Maus, Touch, Stift), Raster 15 min. Beim Ablegen geht `moveSegment` bzw. `planOrder` an den Server. Bei 409 springt der Balken zurück und es erscheint eine verständliche Meldung („überschneidet sich mit …“, ohne fremde Kundendaten).
  - **Tastatur- und Barrierefrei-Alternative:** „Verschieben…“-Dialog mit Datum/Uhrzeit.
  - Auf Touch wird ein Termin erst nach Long-Press (300 ms) greifbar; so funktioniert das Scrollen weiter.
- **Handy (360 px):**
  - Keine horizontale Seiten-Scrollbar; nur Raster und Spalten scrollen intern.
  - Eingabefelder mit 16 px Schrift, `touch-action` nur auf den Griffen.
- **Tests (jsdom):**
  - Alle Ansichten rendern.
  - Drag & Drop mit simulierten Pointer-Events löst `moveSegment` aus.
  - Ein Konflikt wird zurückgesetzt.
  - Statusbadge enthält Text.
  - Keramik-Balken erstreckt sich über mehrere Tage.
  - 360 px: jsdom berechnet kein Layout. Geprüft werden deshalb nur CSS-Regeln (z. B. keine festen Breiten über 360 px, `min-width:0`, interne Scroll-Container). Die eigentliche Prüfung macht Lars am Live-Stand mit einem echten Handy. Eine Playwright-Prüfung in der GitHub-CI ist nur nach Lars' Freigabe zulässig (AGENTS.md).

### 1C – Mehrtägige Aufträge und Keramik

- Ein Paket bekommt `workMinutes`. Keramik hat 1920 (`src/catalog.mjs` angleichen; heute 2880).
- Ein Paket kann optional `curingProductId` haben.
- **Anfrage ohne feste Zeit**, z. B. von der Website: Sie landet in „Unverplant“ mit Hinweis „Keramik – Zeitraum vorschlagen“.
- **Planen:** Lars wählt den Starttag. `planSegments` verteilt die Arbeitszeit auf die Arbeitsfenster der Folgetage, überspringt Feiertage und Blocker und hängt danach den Aushärte-Block an (aus `curingProducts`). Vorschau vor dem Speichern.
- **Bestätigen:** Im bestehenden Ablauf wird der Termin verbindlich. Die Segmente werden in einer Transaktion geschrieben.
- Aushärte-Standardwerte nur aus Herstellerangaben, z. B. Gyeon Q² Mohs EVO: 24 h kein Wasser, 14 Tage kein Autoshampoo. Lars trägt sein Produkt ein (Frage 4). Ein erfundener Standardwert wird nicht vorbelegt.
- **Tests:**
  - 1920 min über Freitag mit Wochenende ergibt Fortsetzung am Montag.
  - Ein Feiertag mitten im Zeitraum wird übersprungen.
  - Die Aushärtung blockiert die Ressource `halle`.
  - Verschieben des ersten Segments verschiebt alle Segmente gemeinsam (atomar).

### 1D – ICS-Abo und Auslastung für die Website

- **Freischaltung in `server/application.mjs`:**
  - Heute gibt es ohne Sitzung 401 (Z. 28). `/ics/<token>.ics` und `/api/public/auslastung` müssen **vor** der Sitzungsprüfung ausdrücklich freigegeben werden.
  - `lockedHeaders` setzt immer `Cache-Control: no-store`. Für diese beiden Antworten braucht es eine Ausnahme wie beim Sandbox-CSP der Chat-Dateien.
  - Ein Token in der URL kann im Caddy-Zugriffslog landen. Deshalb vor dem Release prüfen, ob Caddy Zugriffe protokolliert, und gegebenenfalls `/ics/` vom Log ausnehmen.
- **ICS-Abo:**
  - `GET /ics/<token>.ics`, öffentlich erreichbar, aber nur mit gültigem Token. Gespeichert wird nur der SHA-256 des Tokens. Widerrufbar in den Einstellungen, mehrere Tokens möglich (z. B. Handy, Laptop).
  - Inhalt standardmäßig **ohne Kundennamen**: „WG-123 · Keramik · Arbeit“.
  - `Cache-Control: private, max-age=300` (Ausnahme von `lockedHeaders`, siehe oben).
  - Stabile UID je Segment, `SEQUENCE` hochzählen, `DTSTAMP`, Zeiten in UTC.
  - Gibt es kein Token oder ist es widerrufen, kommt 404. Rate-Limit über `limited()`.
- **Auslastung:**
  - `GET /api/public/auslastung?from&to`, anonym, höchstens 62 Tage.
  - Antwort `{days:[{day:"2026-10-20", level:"frei"|"knapp"|"voll"|"geschlossen"}]}`: keine Uhrzeiten, keine Namen, keine IDs. Testdaten werden ignoriert.
  - CORS nur für `https://white-gloss.de`, Rate-Limit pro IP.
  - Damit sind keine Rückschlüsse auf einzelne Kunden möglich (nur drei Stufen je Tag).
- **Website:** separater kleiner PR in `glanz-buchung-meister`. Er ersetzt den veralteten #301 und zeigt im Konfigurator je Tag frei/knapp/voll. Die Anfrage bleibt eine Anfrage (`requestOnly`). Nur nach Lars' Okay (Frage 13).
- **Tests:**
  - Token-Widerruf.
  - Kein PII im ICS ohne Opt-in.
  - Auslastung enthält keine Zeiten und Namen.
  - Schwellenwerte.
  - Testbereich bleibt unsichtbar.

### 1E – Kunden: Umbuchen/Stornieren, Warteliste

- **Umbuchen/Stornieren:**
  - Im bestehenden Kundenzugang (Link + PIN) eine Terminseite `/termin/<token>` nach dem Muster von `/rechnung/<token>`. Dafür muss der Pfad an drei Stellen ergänzt werden: `customerPath`/`eligible` (`server/auth.mjs`), die Kunden-Whitelist und die Redirect-Regex (`server/application.mjs:28,45`) und das Pfad-Mapping in `StaticAssets` (`server/storage.mjs`). Sie zeigt den eigenen Termin und, solange die Frist (`customerChangeDeadlineHours`) nicht abgelaufen ist, die Knöpfe „Umbuchen“ und „Stornieren“.
  - **Umbuchen:** Der Kunde wählt aus freien Tagen (gleiche Auslastungslogik). Daraus entsteht `calendar_change_requests` mit Zustand `open`, und Lars sieht ihn unter „Zu erledigen“. Erst seine Bestätigung verschiebt den Termin. Nichts läuft automatisch, solange Frage 9 nichts anderes ergibt.
  - **Stornieren** innerhalb der Frist: ebenfalls als Antrag, inklusive Hinweis auf eventuelle Gebühren laut AGB (Text aus den Einstellungen).
  - Nach Ablauf der Frist erscheint nur der Kontakthinweis bzw. der Chat.
- **Benachrichtigungen:** Bei einem Kundenantrag wird **keine automatische Mail an den Kunden** verschickt. Lars sieht den Antrag im Panel und bekommt optional eine Mail an info@. Der Kunde erfährt die Entscheidung nur über den bestehenden, freigabepflichtigen Mailweg (`sendApproved`) oder im Chat.
- **Warteliste:** Wird ein Termin frei, schlägt das Panel passende unverplante oder wartende Aufträge vor. Versendet wird **nichts**; Lars klickt „anbieten“.
- **Tests:**
  - Kunde A sieht nur den eigenen Termin.
  - Nach Fristablauf gibt es keinen Knopf (auch der Server lehnt ab).
  - Doppelt gesendeter Antrag ergibt einen Eintrag.
  - Bestätigung prüft Konflikte.

### 1F – Optional, nur nach Freigabe: Fahrzeit und Google-Zwei-Wege-Sync

- **Fahrzeit** (`travelEnabled`, Standard aus):
  - Google Routes API „Compute Routes Essentials“ (bis 10.000 Aufrufe im Monat kostenlos, danach 5 USD je 1.000).
  - Der API-Schlüssel liegt verschlüsselt in `settings` und ist auf die Routes API beschränkt.
  - Gespeichert wird **nur die berechnete Fahrzeit als `travel`-Segment** im Termin. Routen werden nicht vorgehalten (Nutzungsbedingungen zum Caching vor Umsetzung erneut prüfen).
  - Fällt die API aus, gilt ein manueller Wert.
- **Zwei-Wege-Sync** (`twoWaySyncEnabled`, Standard aus):
  - Ablauf: zuerst ein Voll-Abgleich `events.list` und den `nextSyncToken` speichern. Danach inkrementell mit `syncToken`; dabei keine Filter wie `timeMin` mitschicken. Gelöschte Events kommen mit. Bei `410 Gone` Token verwerfen und voll neu abgleichen.
  - Fremde Google-Termine werden zu Blockern („Google: belegt“) **ohne Titel und Details**.
  - Eigene Panel-Events weiter mit fester ID und `If-Match`/etag. Bei Konflikt gewinnt das Panel und meldet den Konflikt.
  - Abgleich im 15-Minuten-Wartungslauf; Push-Kanäle (`watch`) sind vorerst nicht nötig.

## Abnahme-Checkliste (für die Übergabe nach dem Release)

- [ ] 20 parallele Buchungen auf denselben Slot führen zu genau einer Buchung (Test 1A, grün in CI).
- [ ] Keramik (1920 min) wird über drei bis vier Arbeitstage plus Aushärtung als Mehrtagesbalken in Monat und Woche angezeigt (Test 1C + Live-Check im Testbereich).
- [ ] 360 px: keine horizontale Scrollbar in allen Ansichten (Live-Check auf einem echten Handy durch Lars, Screenshot).
- [ ] Termine um die Zeitumstellung 25.10.2026 und 28.03.2027 bleiben auf ihrer Wandzeit (Test 1A).
- [ ] Status ist auch in Graustufen erkennbar (Text/Symbol).
- [ ] ICS-Abo in Google/Apple-Kalender abonnierbar; nach Widerruf 404.
- [ ] `/api/public/auslastung` liefert nur Stufen, keine Zeiten oder Namen.
- [ ] Kunde kann innerhalb der Frist Umbuchung/Storno beantragen, außerhalb nicht.
- [ ] Bestehende Abläufe unverändert: Angebot, Vor-Ort-Sofortbuchung, Protokolle, Qonto, Chat, Erinnerungen (komplette Test-Suite grün).

## Aufwand und Reihenfolge

1A und 1B sind der Kern. Lars hat sie nach dem ersten Release sofort nutzbar.

Danach 1C, dann 1D zusammen mit dem Website-PR, dann 1E. 1F kommt nur auf Wunsch.

Schätzung: 1A ≈ 1 Tag, 1B ≈ 1,5 Tage, 1C ≈ 1 Tag, 1D ≈ 0,5 Tag (+ Website 0,5 Tag), 1E ≈ 1 Tag, 1F je ≈ 0,5–1 Tag.

## Quellen

- Feiertage Baden-Württemberg 2026/2027 (12 Tage, Fronleichnam, Allerheiligen und Heilige Drei Könige inklusive): [arbeitstage.org – Feiertage BW](https://www.arbeitstage.org/baden-wuerttemberg/feiertage-baden-wuerttemberg/), [DGB – Gesetzliche Feiertage 2026](https://www.dgb.de/service/ratgeber/feiertage/)
- Gyeon Q² Mohs EVO, Herstellerangaben zur Aushärtung: [gyeon.de](https://gyeon.de/GYEON-Q-Mohs-EVO)
- Google Routes API Preise und Freikontingente: [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing)
- Google Calendar inkrementelle Synchronisation: [Synchronize resources efficiently](https://developers.google.com/workspace/calendar/api/guides/sync)
- Alter Kalender-Code: `src/schema.mjs`, `src/booking-calendar.mjs`, `server/booking-calendar.mjs`, `tests/booking-calendar.test.mjs` @ `f9b60ec`; `server/calendar-adjustments.mjs` @ `3791e76`
