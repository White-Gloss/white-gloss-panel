# Phase 0: Bestandsaufnahme

Stand: 13.10.2026, 21:30. Nur gelesen. Es wurde kein Code geändert, kein Server gestartet und kein PR eröffnet.

Grundlage:
- **Panel:** `White-Gloss/white-gloss-panel` `main` @ `7845a68`. Live auf panel.white-gloss.de laufen genau die Client-Dateien dieses Stands (per SHA-256 geprüft).
- **Website:** `White-Gloss/glanz-buchung-meister` `main` @ `adc96c1`.
- **Weitere Quellen:** die Branches beider Repos, die PRs #1–#18 (Panel) und #301 (Website), öffentliche Abrufe von panel.white-gloss.de und white-gloss.de.

Zeilenangaben beziehen sich auf `main` @ `7845a68`. „unklar“ heißt: ohne Serverzugang nicht belegbar.

---

## 1. Stack

| Bereich | Panel (panel.white-gloss.de) | Website (white-gloss.de) |
|---|---|---|
| Sprache/Framework | Vanilla-JS (ESM). Weder im Browser noch auf dem Server ein Framework. Laufzeit-Abhängigkeiten: nur `pdf-lib`, `@pdf-lib/fontkit` | TanStack Start, React 19, Vite 8, Nitro (node-server) |
| Server | `node:http` in `server/start.mjs` → `server/application.mjs` → `src/worker.mjs`. Daneben ein alter „Sites-Worker“-Build (`scripts/build.mjs`, `.openai/hosting.json`, D1/R2) | Nitro-SSR, `ops/white-gloss.service`, Port 3000 |
| Datenbank | SQLite über `node:sqlite` (WAL, `busy_timeout=5000`) mit einer D1-ähnlichen Hülle (`server/storage.mjs:9-12`). Kein Migrations-Framework, nur `CREATE … IF NOT EXISTS` an mehreren Stellen (s. Abschnitt 2) | PostgreSQL über `pg` (`src/lib/db.ts`), Migrationen `migrations/0001–0024` (Nummer 0006 doppelt). Zusätzlich ein alter Supabase-Migrationsbaum. Einige Spalten entstehen erst zur Laufzeit (`booking-operations.ts:50-85`) |
| Auth | Betreiber: E-Mail + Passwort (scrypt). Einrichtung und Wiederherstellung nur per frischem E-Mail-Link. Kunden: einmaliger Link + 6-stellige PIN (HMAC), Sitzungs-Cookie `__Host-wg-session` (24 h, 4 h Leerlauf) (`server/auth.mjs`, `server/password-auth.mjs`) | better-auth 1.6 mit Google-OAuth |
| Kalender | Keine Kalenderbibliothek. Eigener ICS-Generator (`src/calendar.mjs`). Google-Kalender über REST mit OAuth/PKCE (`server/calendar-oauth.mjs`, `server/providers.mjs`) | Keine. Feste Wunsch-Slots 09/11/13/15 Uhr (`src/data/site.ts:55`) |
| Hosting | IONOS-VPS 217.154.124.239, Ubuntu 24.04, Node 22.23.2, Caddy. Dienst `white-gloss-panel.service` auf 127.0.0.1:3101, `MemoryMax=512M`. `assertIonosRuntime` verhindert den Start außerhalb von `/srv/white-gloss-panel/` | Derselbe VPS, `white-gloss.service` |
| CI | `.github/workflows/checks.yml`: lint, typecheck, 195 Tests (22 Dateien, davon 4 jsdom-UI), build, Syntaxprüfung. **Kein Deploy** | `ci.yml` (Node 24): Checks, Tests, Flowtests. `deploy-ionos.yml` deployt automatisch nach grünem CI auf `main`, mit Smoke-Test und Rollback. Außerdem: `production-smoke.yml` (alle 6 h), `lighthouse-audit.yml` (wöchentlich), `live-visual-check.yml` (Playwright gegen die Live-Seite), `domain-migration-audit.yml` |

## 2. Datenmodell (Panel)

### Wo welche Daten liegen

Alle Tabellen entstehen per `CREATE TABLE IF NOT EXISTS`, und zwar in:
- `src/schema.mjs`
- `server/auth.mjs:12-19`
- `calendar-oauth.mjs:11`
- `providers.mjs:10`
- `booking-photos.mjs:5`
- `protocol-mail.mjs:18-19`
- `qonto.mjs:197-201`
- `chat.mjs:28-35`

| Fachobjekt | Speicherort |
|---|---|
| **Kunden** | `customers(id, data JSON, search, synthetic, version)`. Felder: name, company, email, phone, address, city, billingAddress, note, reviewConsent, history (`src/customers.mjs`) |
| **Fahrzeuge** | `vehicles(id, customer_id, data JSON)` mit plate, make, model, color, VIN, note. Verknüpfung über `customer_orders(order_id, customer_id, vehicle_id)` |
| **Aufträge** | `orders(id, wg, website_id, version, status, data JSON, synthetic)`. Fast alle Fachdaten liegen im JSON (s. unten). `audit` wird per Trigger befüllt |
| **Termine** | `orders.data.appointment = {start, end, duration, delivery, location}` und `appointments(order_id PK, start, end)`. Die Trigger `no_overlap_insert/update` (`schema.mjs:12-13`) erlauben **global eine einzige Belegung**. |
| **Angebote** | `orders.data.assessment`, `offer` (gültig 14 Tage, `domain.mjs:80`), `offerHistory`, `acceptance` (Unterschrift-Asset, snapshotHash). `offer_tokens` speichert den Hash, `orders.data.offerToken` das Token **im Klartext** (`worker.mjs:148`) |
| **Rechnungen** | Qonto: `invoice_claims`, `invoice_documents`, `invoice_deliveries`, `invoice_tokens`, `invoice_checks`. Dazu `orders.data.invoice`, darin `portalToken` im Klartext. Zahlungen in `orders.data.payments[]` |
| **Übergaben** | Annahme und Rückgabe in `orders.data.intake/return` samt Verlauf. Weiter: `protocol_drafts` (Entwurf + Hash), `signature_bindings`, `protocol_deliveries`, `acceptance_deliveries` (mit Snapshot), Ersatzdokumente in `orders.data.pending` + `document_requests` |
| **Fotos/Dateien** | Metadaten in `assets(id, order_id, kind, mime, hash, size)`, Dateien unter `/var/lib/white-gloss-panel/data/uploads/`. kinds: photo, signature, booking, receipt, protocol, invoice, chat. Website-Fotos über `booking_photo_sources/checks` |
| **Chat** | `chat_threads`, `chat_messages`, `chat_attachments` (unveränderlich, Trigger) |
| **Auth** | `auth_tokens`, `auth_sessions`, `auth_rates`, `auth_session_proofs`, `auth_passwords`, `auth_customer_pins`, `auth_customer_credentials` (auf `main` nur lesend genutzt), `auth_customer_sessions`, `calendar_oauth_states` |
| **Betrieb** | `settings` (Geheimnisse AES-GCM-verschlüsselt mit `CONFIG_KEY`), `sequences` (WG-Nummern), `jobs`, `runtime_locks` |

**Status** (`domain.mjs:3`): Preise prüfen → Angebot offen → Angenommen → Termin verbindlich → In Arbeit → Erledigt → Bezahlt. Daneben Abgelehnt, Storniert, Abgelaufen sowie `setStatus` als freier Override.

**Löschsperren:** Die Trigger `no_customer_delete`, `no_vehicle_delete`, `no_order_delete` und die Chat-Trigger verhindern Löschungen.

### Was für die sechs Pakete fehlt

1. **Kalender**
   - Fehlt: Ressourcen, Arbeitszeiten, Blocker, Feiertage, Puffer, mehrteilige Termine (Arbeitstage + Aushärtung), Termine ohne Auftrag.
   - Fehlt außerdem: abonnierbares ICS-Token, Auslastungs-Schnittstelle, Kunden-Umbuchung, Warteliste, Google-Gegenrichtung.
2. **Löschkonzept**
   - Fehlt: Datenarten-Register, Fristen, Sperrvermerk, Trockenlauf, Auskunftsexport, Löschanträge.
   - `recordsRestriction` wird nur gelesen (`src/record-compat.mjs:4-8`). Einen Schreibpfad gibt es auf `main` nicht.
3. **Übergabe aus der Ferne**
   - Fehlt: Pflichtfotos, ein Zubehörfeld, Einwände pro Foto, ein Freigabe-Entwurf für den Fernversand, der Ablauf „Kunde lehnt ab“, ein Siegel mit IP/Gerät/Textversion/Zeitstempel und Zusatzprotokolle.
   - Vorhanden: Schadenskarte, Fotos, Kilometerstand, Hash-gebundene Unterschriften, PDF.
4. **Web-App**
   - Fehlt: ein Manifest für das ganze Panel (bisher nur für die Vor-Ort-App), Update-Hinweis, IndexedDB-Warteschlange, Push, Leeren der Speicher beim Logout.
5. **Dashboard**
   - Fehlt: Kennzahlen-Definitionen, serverseitige Aggregation, Rolle „Inhaber“ (es gibt nur Betreiber und Kunde).
6. **B2B**
   - Fehlt: Firmen, Rollen (Firmen-Admin/Disponent/Fahrer), Fuhrpark, Kostenstellen, company_id-Filter, Sammelanfragen, E-Rechnung.
   - Die Website-Seite `b2b.tsx` ist nur eine Marketingseite.

## 3. Kalender heute

### Panel `main` (live)

- **Ansicht:** Nur ein Monatsraster Mo–So (`calendarPage`, `public/app.js:58`). **Jeder Termin erscheint nur an seinem Starttag**; mehrtägige Termine fehlen an den Folgetagen. Datenbasis sind höchstens 3000 Aufträge (`worker.mjs:32`). Tag-, Wochen- und Agenda-Ansicht sowie Drag & Drop gibt es nicht.
- **Dauer:**
  - `end = start + duration`, Standard 120 min, erlaubt 15–4320 (`domain.mjs:93`).
  - Vorschläge aus `packageMinutes = {basis:180, premium:360, keramik:2880}` (`src/catalog.mjs:9`). **Keramik = 48 h am Stück, Nächte eingerechnet.**
  - Die Website rechnet Keramik mit **1920 min** (`glanz-buchung-meister/src/lib/booking-time.ts`), dein Auftrag ebenfalls.
- **Blocker, Arbeitszeiten, Feiertage, Puffer:** **Gibt es nicht** (keine Treffer im Code). Gesperrt wird nur indirekt: `validateAppointment` lehnt einen Termin ab, wenn im Google-Kalender etwas eingetragen ist (`providers.mjs:32-46`; nur wenn Google verbunden ist).
- **Überschneidungsschutz:** SQL-Trigger auf `appointments`. Das gilt für alle Termine zusammen, also gibt es praktisch genau eine Ressource. Der Schutz hält auch gegen parallele Speicherungen, weil die Prüfung in der Transaktion liegt.
- **ICS:** `/api/calendar.ics` funktioniert nur mit Betreiber-Sitzung (`worker.mjs:109-110`), es gibt **kein Abo-Token**.
- **Google:** Nur die Richtung Panel → Google (`syncCalendar`, deterministische Event-ID, If-Match). Event-Titel ist WG-Nummer + **Kundenname**, die Beschreibung enthält Fahrzeug und Leistungen (`providers.mjs:31`).
- **Website-Anbindung:** Nur Pull über den Hub: `importWebsite` → `POST white-gloss.de/api/hub` (`worker.mjs:38`). Das Panel stellt **keine** Verfügbarkeit bereit.

### Website `main` (live)

- Im Panel-Modus liefert `/api/availability` immer `{windows:[], requestOnly:true}` (`api.availability.ts:30-34`). Live geprüft.
- Datum und Uhrzeit sind reine Wünsche. Verbindlich wird ein Termin erst im persönlichen Angebot.

### PR #6 (Panel)

- Gemergt am 07.10. als `f9b60ec` in **`feat/angebot-terminwahl`, nicht in `main`**.
- Inhalt:
  - Tabellen `calendar_entries` (Termin/Blockierung), `calendar_day_rules` (Wochenendfreigaben mit Fenstern) und `calendar_audit`.
  - Die Überschneidungs-Trigger wurden **per DROP neu angelegt** und berücksichtigen auch `calendar_entries`. Dazu kommen Wochenend-Trigger.
  - Regel 08:30–18:00 Europe/Berlin, alles am selben Tag, höchstens 570 min.
  - Anonyme Schnittstelle `GET /api/calendar/availability`.
  - 11 Tests.
- Ab `3791e76` (live vom 10.10. bis 12.10.) kamen Tag- und Wochenansicht, verknüpfte Termine und ein Änderungsverlauf dazu (`server/calendar-adjustments.mjs`).
- **Heute weder in `main` noch live:** `/booking-calendar.js` liefert 404, `/api/calendar/availability` liefert 401.

### PR #301 (Website, Draft)

- Liest die PR-#6-Schnittstelle anonym und behandelt Keramik als Anfrage ohne Uhrzeit.
- `mergeable=false` (Konflikte, 19 Commits hinter `main`).
- Ein Merge heute würde ins Leere laufen, weil der Endpunkt fehlt. Der PR muss nach Paket 1 neu gebaut werden.

## 4. Übergabe und Login heute

- **Protokoll** (`domain.mjs:35-56`, `public/protocol-form.js`):
  - Inhalte: Kennzeichen, Ort, Kilometer, Schlüsselanzahl, Tankstand, Verschmutzung innen/außen, Checkliste (5 Punkte), Notizen, Leistungen, offene Punkte.
  - Bis zu 40 Fotos, bis zu 60 Schäden mit **SVG-Schadenskarte** (Bereich, Art, Größe, Foto), Lackmessung.
  - **Keine Pflichtfelder und keine Pflichtfotos**, kein eigenes Zubehörfeld.
- **Unterschrift:**
  - Der Entwurf wird mit SHA-256 gespeichert (`prepareProtocol`). Jede Unterschrift wird per `signature_bindings` an Entwurf und Hash gebunden. Kunden- und Betreiberunterschrift müssen verschiedene Bilder sein.
  - Unterschriebene Protokolle sind unveränderlich, Änderungen gehen nur über ein Ersatzdokument mit neuer Unterschrift.
  - Unterschrieben wird heute **vor Ort auf dem Gerät des Betreibers**. Für ein **Ersatzdokument** gibt es den Weg aus der Ferne: Kundenlink (14 Tage gültig) mit Zugang (24 h).
- **PDF:**
  - pdf-lib mit Foto-Hashes und snapshotHash. Das PDF wird als Asset mit SHA-256 gespeichert und per Resend verschickt (Kopie an den Betreiber).
  - **Keine** PDF-Signatur (PAdES), kein Zeitstempel einer externen Stelle. IP und Gerät werden **nicht** festgehalten.
- **Kunden-Login:**
  - Link + PIN, einmal verwendbar, standardmäßig 10 min. Aus Angebots- und Dokumentmails bis 24 h.
  - Nach dem Login gelten die Dokumentlinks selbst: Ersatzdokumente 14 Tage, Rechnungsportal 400 Tage, Chatlink 365 Tage (`chat.mjs:13`; Token verschlüsselt gespeichert). Das ist wichtig für die 24-h-Vorgabe in Paket 3.
  - Kunden dürfen nur `/angebot/`, `/dokument/`, `/rechnung/` und `/chat/` sowie die zugehörigen APIs `/api/offer/`, `/api/document/`, `/api/rechnung/` und `/api/kundenchat/` aufrufen (`application.mjs:45`).
- **Rollen:** Nur Betreiber und Kunde. Inhaber, Mitarbeiter und Firmenrollen gibt es nicht.
- **Vor-Ort-App:** `/vor-ort` für den Betreiber, Sofortbuchung inklusive Unterschrift in einer Transaktion.
- **Nicht auf `main`, aber im alten Zweig:** dauerhafte, wiederverwendbare Kunden-PIN mit `/kundenportal` (PR #6) und Übergabeprotokoll mit späterer PIN-Signatur (PR #8, `public/handover*.js`).

## 5. Web-App (PWA) heute

- **Manifest** `public/manifest.webmanifest`:
  - „White Gloss Vor-Ort“, `start_url`/`id` `/vor-ort`, `scope /`, standalone.
  - Icons 192, 512 und 512 maskable; `apple-touch-icon` 180 vorhanden, aber **nur in `vor-ort.html` verlinkt**.
  - Das eigentliche Panel (`index.html`) hat **kein** Manifest.
- **Service Worker** `public/sw.js`:
  - App-Shell aus 11 Dateien, Network-First. Offline kommt nur ein kurzer Inline-Text als Ersatz, keine eigene Offline-Seite.
  - Scope `/`: Der Worker kontrolliert die ganze Origin, sobald die Vor-Ort-App installiert ist.
  - `/api/` und `/auth/` werden nie gecacht, Kundendaten also nicht.
  - Registriert wird er nur aus der Vor-Ort-App.
- **Fehlt:** Update-Hinweis, IndexedDB-Warteschlange (Entwürfe nur im Arbeitsspeicher), Push, iOS-Anleitung, Leeren von Speicher und Cache beim Logout. Die Vor-Ort-App hat keinen Logout.
- **Website:** Manifest unter `/__grok/` (Altlast), kein Service Worker.

## 6. Personenbezogene Daten

| Ort | Inhalt |
|---|---|
| Panel-SQLite `/var/lib/white-gloss-panel/data/panel.sqlite` | Aufträge (Name, Telefon, E-Mail, Adresse, Fahrzeug, Kennzeichen, VIN, Notizen, Protokolle, Zahlungen), Kunden mit Verlauf, Chat, Zustellungen mit Empfänger, `protocol_drafts` (nie gelöscht), Login-Tokens mit E-Mail, `settings.calendarAccount` |
| Panel-Dateien `/var/lib/white-gloss-panel/data/uploads` (0600) | Fotos, Unterschriften, Protokoll-, Rechnungs- und Chat-Dateien |
| **Alte Tabellen in der Live-DB (unklar)** | Die Linie `feat/angebot-terminwahl` lief vom 04.10. bis 12.10. live. Ihre etwa 40 Tabellen (u. a. `calendar_entries`, `customer_messages`, `customer_files`, `payment_records`, `panel_tasks`, `push_*`) liegen vermutlich noch in derselben DB. `main` liest sie nicht |
| Panel-Backups `/var/lib/white-gloss-panel/backups` | Täglich 03:30 als SQLite-Kopie mit Hardlinks der Dateien und **Klartext-Kopie aller Server-Geheimnisse** (`backup.mjs:17,22`). **Keine Rotation, kein Löschen, nur auf demselben Server** |
| Panel-Logs (journald) | Wenig. Einziges `console.error` ist `resend_connection_failed` (maskiert). Caddy-Zugriffslogs: unklar |
| Website-PostgreSQL | `bookings`, `customers`, `inbox_messages`, `outbound_queue` (Mailtexte), `booking_events` (Snapshots), CRM-Altjournale (RO/Bitrix/Zoho/Odoo), better-auth-Tabellen. In `shop_settings` liegen Alt-Geheimnisse im Klartext |
| Supabase-Storage `condition-photos` | Buchungsfotos der Website, **nicht im Backup** |
| Website-Backups | `scripts/backup-production.mjs` (pg_dump), wird manuell ausgeführt, ohne Timer und ohne Rotation |
| Altkopie Sites (D1/R2) | `.openai/hosting.json`, frühere private Sites-Kopie. Inhalt unklar |
| Dienstleister | Resend (alle Mails), Qonto (Rechnungsempfänger), Google Kalender (Kundenname im Event-Titel), Meta/WhatsApp und Telegram (Website-Benachrichtigungen), Google Tag/Ads nur nach Einwilligung |

**Löschungen heute:**
- Panel: nur technische Daten. `pruneAuth` entfernt Tokens nach 24 h, abgelaufene OAuth-States werden gelöscht, nie gesendete Chat-Uploads nach 24 h.
- Website: `cleanupFailedBookingPhotos` entfernt fehlgeschlagene Uploads nach 24 h.
- Alles andere bleibt unbegrenzt gespeichert.

**Datenschutzerklärung der Website** (Stand 25.09.2026):
- Erwähnt weder `panel.white-gloss.de` noch Kunden-PIN oder Kundenchat.
- Nennt noch die RO App, enthält keine konkreten Fristen.

## 7. Deploy-Weg

**Panel:**
1. `node scripts/package-ionos.mjs <archiv>` erzeugt aus einem sauberen Git-Stand ein tar.gz mit `dist/release.json` und gibt die SHA-256 aus.
2. Das Paket liegt auf einem Branch `release/…` unter `.ionos-releases/`, zusammen mit einer Übergabe-Datei. Zuletzt war das `release/claude-ionos-package-20261013-kundenchat`.
3. ChatGPT kopiert es per scp nach `/home/white-gloss-ci/` und führt als root `deploy/install-panel.sh <archiv> <sha256> <commit>` aus.
4. Der Installer:
   - prüft Archiv, Pfade und Commit,
   - legt ein unveränderliches Release unter `/srv/white-gloss-panel/releases/<commit>` an,
   - stoppt die Timer und **zieht ein Backup vor der Umstellung**,
   - setzt den Symlink `current` um und installiert Units und das Caddy-Snippet,
   - startet neu und prüft `/healthz`.
5. Bei einem Fehler setzt `trap rollback ERR` Symlink, Units und Caddy zurück. **Die Datenbank wird beim Rollback nicht zurückgesetzt.**

**Timer:**
- `white-gloss-panel-maintenance.timer` alle 15 min (`maintenance()`: Aufräumen, Anbieterabgleich, Fälligkeiten, Chat-Hinweise).
- `white-gloss-panel-backup.timer` täglich 03:30.

**Website:** GitHub Actions `deploy-ionos.yml` deployt automatisch nach grünem CI auf `main` über `/usr/local/sbin/white-gloss-deploy`, mit Smoke-Test und Rollback.

**Staging:** **Gibt es für keine der beiden Apps.** Das Panel trennt Testdaten mit `synthetic=1`, aber in der Produktionsdatenbank.

Achtung: Beim Kalender trennt `main` **nicht**. Der Überschneidungs-Trigger auf `appointments` gilt global, Test-Termine blockieren also echte Termine. Getrennt wird nur, wenn der Alt-Trigger live liegt (siehe Risiko 1).

## 8. Regeldateien

| Datei | Inhalt (kurz) |
|---|---|
| `white-gloss-panel/AGENTS.md` | Kein lokales Hosting (auch nicht WSL/Docker/Tunnel). Panel nur über den eigenen Installer, nie über den Deploy-Helfer der Website. Keine Geheimnisse oder Kundendaten committen. Echte Kundenmails, Rechnungen, Zahlungen und Uploads nur mit Freigabe. „Implementiert, getestet, veröffentlicht, live geprüft“ getrennt berichten |
| `glanz-buchung-meister/AGENTS.md` | Oben die Betreiberregel (27.09.: kein lokales Hosting, Flowtests nur in CI) und Panel-only (05.10.: keine CRM-Verbindungen, **keine Datenlöschung**). Ab Zeile ~30 ein **historischer Grok-App-Builder-Vertrag** |
| `glanz-buchung-meister/.claude/settings.json` + `plugins/verify` | Verify-Plugin. Das Gate `auth` braucht einen laufenden Dev-Server, wird aber durch `block-local-hosting` und `assertIsolatedGithubCi` blockiert |
| `glanz-buchung-meister/.claude/skills/*` | 13 Design- und Animations-Skills, keine Projektregeln |
| CLAUDE.md, AGENTS.project.md, `.cursor`, `copilot-instructions` | In beiden Repos nicht vorhanden |

**Widersprüche:**
1. Der Grok-Vertrag in der Website-AGENTS.md verlangt Dev-Server auf `0.0.0.0:8080`, `startup.sh` und „deployed to Vercel“. Das widerspricht dem Hosting-Verbot und dem echten IONOS-Betrieb. Die Rangfolge ergibt sich nur aus der Überschrift („geht … vor“).
2. Node-Version: Die Website baut in CI mit Node 24, läuft auf dem VPS aber mit Node 22.23.2. Das Panel nutzt durchgängig 22.23.2.
3. „Keine Datenlöschung“ (Website-Panel-only-Regel) steht gegen Paket 2. Für Löschläufe braucht es deine ausdrückliche neue Anweisung. Paket 2 löscht ohnehin keine Bestandsdaten.
4. Panel-AGENTS.md verlangt „vor einer Migration `docs/IONOS-und-Google.md` lesen“. Dieses Dokument nennt noch den 3.10. als Stand.

## 9. Risiken und Lücken (nach Schwere)

1. **Kritisch – Altlasten in der Live-Datenbank (unklar, nur auf dem Server prüfbar):**
   - Vom 04.10. bis 12.10. lief `feat/angebot-terminwahl` live. Danach wurde auf `main` gewechselt, ohne die DB anzufassen.
   - Vermutlich noch vorhanden sind:
     - `no_overlap_insert/update`: Sie wurden damals per DROP neu angelegt, prüfen auch `calendar_entries` und trennen nach `synthetic`. `main` legt sie nur mit `IF NOT EXISTS` an und ersetzt sie also nicht.
     - `calendar_entry_overlap_insert/update`: global über Einträge und `appointments`.
     - `appointment_weekend_insert/update`: Sie sind heute wirkungslos, weil `main` kein `appointment.calendarDay` schreibt. Sie werden aber scharf, sobald portierter Code dieses Feld setzt.
     - Fünf Audit-Trigger auf `calendar_entries` und `calendar_day_rules`.
     - Ab `3791e76` die Tabelle `calendar_adjustments` samt Triggern.
   - **Alte, im Panel unsichtbare Blockierungen können deshalb neue Termine mit „Terminüberschneidung“ ablehnen.** CI-Tests auf frischer DB würden dieses Verhalten nicht zeigen.
2. **Kritisch – möglicherweise unsichtbare echte Daten:** Was zwischen 07.10. und 12.10. in `payment_records`, `customer_messages`, `customer_files`, `calendar_entries` oder `calendar_day_rules` gespeichert wurde, zeigt `main` nicht an. Davon betroffen könnten bestätigte Barzahlungen, Kundennachrichten und Wochenendfreigaben sein.
3. **Hoch – zwei Entwicklungslinien:**
   - Wertvolle Funktionen liegen nur in `feat/angebot-terminwahl` bzw. `feat/acht-panel-erweiterungen-20261010`: Kalender mit Blockierungen und Tag-/Wochenansicht, dauerhafte Kunden-PIN, Zahlungsbuch, Briefpapier, Stornoregeln, Assistent, Push, Übergabe mit PIN-Signatur.
   - Ein Merge ergäbe 23–26 Konfliktdateien und doppelte Systeme (Chat, Kundenportal, Zahlungen). **Nur gezielt portieren.**
   - Neue Arbeit immer von `main` abzweigen, Release-Pakete nur von `main`.
4. **Hoch – Sicherung und Wiederherstellung:**
   - Die Backups enthalten alle Geheimnisse im Klartext, liegen nur lokal und werden nie rotiert.
   - Der Rollback setzt die DB nicht zurück.
   - Es gibt kein Staging, und ein externes Backup ist nicht nachgewiesen.
5. **Hoch – Datenschutz:**
   - Keine Löschroutinen (Panel und Website).
   - Die Datenschutzerklärung ist veraltet: Panel, Kunden-PIN und Chat fehlen, RO App wird noch genannt.
   - Alt-Geheimnisse liegen im Klartext in `shop_settings` der Website.
   - Der Google-Kalender bekommt den Kundennamen im Titel.
6. **Mittel – Kalender:**
   - Keramik blockiert 48 h am Stück, auch nachts.
   - Die Monatsansicht zeigt nur den Starttag.
   - Arbeitszeiten, Feiertage und Blocker fehlen.
   - Es gibt nur eine Ressource.
   - ICS ist nicht abonnierbar.
   - Panel (2880 min) und Website (1920 min) rechnen Keramik verschieden.
7. **Mittel – Tokens im Klartext:** Angebots-, Ersatzdokument- (`orders.data.pending`, `worker.mjs:65`) und Rechnungsportal-Token liegen im Klartext in `orders.data`, der Hash zusätzlich daneben.
8. **Mittel – Hub-Grenze:** Der Hub liefert nur die 40 neuesten offenen Anfragen. Auf der Website bleiben Anfragen im Panel-Modus „neu“. Bei vielen Anfragen können ältere also unbemerkt aus der Liste fallen.
9. **Niedrig – Website-Altlasten:** Die alten `/admin`-Routen (Kalender, Posteingang, CRM) existieren weiter, das kann man mit dem echten Panel verwechseln. Dazu kommen der Grok-Vertrag in AGENTS.md und die doppelte Migrationsnummer 0006.
10. **Niedrig – Prüfnachweis:** Die UI ist nur mit jsdom getestet. Echte Geräte (iPhone/Android, 360 px) lassen sich wegen des Hosting-Verbots nur am Live-Stand prüfen.

## 10. Fragen an dich

1. **Live-DB prüfen:** Darf ChatGPT auf dem Server einen reinen Lesebefehl ausführen? Er würde Tabellen, Trigger-Texte und die Zeilenzahlen der Alt-Tabellen auflisten, ohne Kundendaten auszugeben. Erst danach ist klar, ob Risiko 1 und 2 zutreffen. Der Befehl steht in Plan Paket 1, Schritt 1.0.
2. **Altdaten:** Falls sich in den Alt-Tabellen echte Daten finden (Blockierungen, Wochenendfreigaben, Zahlungsbestätigungen, Nachrichten): übernehmen, nur lesbar anzeigen oder ignorieren?
3. **Keramik:** Sind die 1.920 Minuten reine **Arbeitszeit**, die auf mehrere Arbeitstage verteilt wird (z. B. 4 Tage à 8 h), oder ein durchgehender Block? Und kommt die Aushärtung danach zusätzlich?
4. **Keramik-Produkt:** Welche Beschichtung(en) verwendest du? Ich brauche sie für die Herstellerangabe zur Aushärtung. Beispiel Gyeon Q² Mohs EVO: 24 h kein Wasser, 14 Tage kein Autoshampoo.
5. **Arbeitszeiten:** Mo–Fr 08:30–18:00 wie im früheren Kalender, oder 09:00–17:00 wie auf der Website angegeben (`site.ts:28`)? Samstag regulär oder nur per Freigabe? Feste Pausen?
6. **Puffer:** Wie viele Minuten zwischen zwei Aufträgen? Gleich für alle Pakete?
7. **Parallelität:** Arbeitest du allein an einem Fahrzeug, also eine Ressource? Darf während der Aushärtung eines Keramik-Fahrzeugs ein zweites Fahrzeug bearbeitet werden, d. h. Halle und Arbeitskraft getrennt? Die Website kennt intern zwei Ressourcen.
8. **Fahrzeit:** Soll sie für Abhol- und Bringservice später gerechnet werden (Startpunkt Arnistal 27)? Die Google Routes API ist bis 10.000 Abfragen im Monat kostenlos. Der Schalter bleibt bis zu deiner Freigabe aus.
9. **Umbuchen/Stornieren durch Kunden:** Bis wie viele Stunden vor dem Termin? Mit oder ohne Gebühr? Gibt es AGB-Text dafür? Soll eine Umbuchung sofort gelten oder als Wunsch auf deine Bestätigung warten?
10. **Auslastung für die Website:** Wie viele Wochen im Voraus? Ab wie viel Prozent gebuchter Arbeitszeit gilt ein Tag als „knapp“ bzw. „voll“? Vorschlag: unter 50 %, 50–85 %, über 85 %.
11. **Google-Kalender:** Welcher Kalender soll es sein (`anfrage@white-gloss.de`)? Soll der Kundenname künftig aus dem Event-Titel verschwinden, also nur WG-Nummer + Paket? Wird die Zwei-Wege-Synchronisation jetzt schon entschieden oder später?
12. **Feiertage:** Nur die gesetzlichen Feiertage in Baden-Württemberg, oder zusätzlich Heiligabend und Silvester geschlossen?
13. **Website-PR #301:** Darf er geschlossen und nach Paket 1 als neuer, kleiner PR gegen die neue Auslastungs-Schnittstelle neu gebaut werden?
14. **Abnahme ohne Staging:** Sind Tests im Testbereich der Live-Datenbank (`synthetic`) als Abnahmeumgebung in Ordnung, oder soll vorher ein Staging eingerichtet werden (zweiter Dienst auf dem VPS mit eigener DB)?
15. **Für später (Paket 5):** Bist du Kleinunternehmer nach § 19 UStG oder regelbesteuert? Davon hängt netto/brutto im Dashboard ab.
