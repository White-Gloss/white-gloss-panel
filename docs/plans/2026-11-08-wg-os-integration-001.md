# White-Gloss OS Integration Implementation Plan

> **For agentic workers:** Use the host's available task-by-task implementation workflow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR #70, #68 und #69 gemeinsam prüfen und als isolierten Draft bereitstellen.

**Architecture:** Vorhandene Anwendung, SQLite und Authentifizierung bleiben maßgeblich.
Quelländerungen werden anhand unveränderlicher Commit-IDs übernommen. MCP liest
dieselben Geschäftsdatensätze über begrenzte Adapter.

**Tech Stack:** JavaScript ESM, Node 22.23.2, SQLite, GitHub Actions, Chromium.

## Global Constraints

Kein Merge/main-Push, Deployment, Produktivmigration, Versand, DNS-/Secretwechsel.
Keine lokalen Website-/Browser-Server. Keine Quell-PRs schließen.

---

### Task 1: Vorhandene Pakete zusammenführen

**Files:** server/application.mjs sowie alle geänderten Quelldateien der drei PRs.
**Interfaces:** createApplication(env), handleMcp(env,request,resolveIdentity),
customerAuthSchema(env), customerAuth(env,request), readCustomerRecord(env,id).
- [x] main/Quellheads und Dateibäume lesen; Überschneidung nur application.mjs.
- [x] Alle Quelländerungen übernehmen; Imports, Initialisierung, Routing und Wartung zusammenführen.
- [x] Serverfreie vorhandene Tests ohne Provideraufrufe ausführen.
- [ ] Vollständige Linux-Prüfung und additive Schemakompatibilität prüfen.

### Task 2: Fachliche Exportfehler korrigieren

**Files:** server/mcp-tools.mjs, server/customer-record.mjs.
**Test:** tests/mcp-integration-regressions.test.mjs, tests/mcp-integration.test.mjs.
**Interfaces:** mcpRead(env,name,args,identity), customerRecordModel(input).
- [x] Rot: ungültige Bestätigung, Stornierung, Berliner Offset-Tagesgrenze,
  gesperrte Akte, zwei Aufträge mit derselben E-Mail.
- [x] Minimal korrigieren: explizite Objektbestätigung, inaktive Status ausschließen,
  Zeitpunkte vergleichen, Restriktionen über vorhandene Links prüfen,
  E-Mail über mail_order_links lesen.
- [x] Gleichen gezielten Testbefehl erneut ausführen und echte unveränderte
  Geschäftsdatensätze bei Lesezugriffen prüfen.

### Task 3: Pagination und OAuth prüfen

**Files:** server/mcp-pagination.mjs (neu), server/mcp-tools.mjs,
server/mcp-auth.mjs, server/mcp.mjs.
**Interfaces:** readCursor(env,name,args,identity), finishPage(env,name,args,identity,data).
- [x] Rot: fehlende filter-/grantgebundene Cursor, übergroße Mehrbyte-Ausgabe,
  Refresh trotz geändertem Scope.
- [x] Signierte Fortsetzung hinter tatsächlich gelieferten Elementen,
  begrenzte Ausgabe, erkennbare Live-Konsistenz, Scopeprüfung implementieren.
- [x] Gleichen Testbefehl ausführen; vorhandene OAuth-/Token-/Replaytests beibehalten.
- [ ] Unabhängige Sicherheits- und Spezifikationsprüfung abschließen.

### Task 4: Abnahme und Übergabe

**Files:** docs/WG-OS-INTEGRATION-001.md, docs/WG-MCP-001.md.
- [ ] Gemeinsamen Entwicklungscommit mit belegten Quellparents bereitstellen.
- [ ] Draft zur Auslösung der vorhandenen CI erstellen; bis Abschluss als ungeprüft markieren.
- [ ] lint/typecheck, vollständige Code-Tests, Build, Shellprüfungen und Browserregression prüfen.
- [ ] Belegten Head/Lauf, Migrationsrisiken und offene reale Betriebsabnahmen im Draft dokumentieren.

Keine ungeklärten Produktentscheidungen für den Entwicklungsumfang.
Live-OAuth, Veröffentlichung und produktive Migration bleiben separat freizugeben.

