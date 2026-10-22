# Umzug auf Hostinger

Stand: 22.10.2026. Quellen sind jeweils genannt. Nur Gelesenes steht als Tatsache da,
alles andere ist als offen markiert. Keine Geheimnisse in dieser Datei.

## Zustand

- Website `white-gloss.de` und Panel `panel.white-gloss.de` zeigen per DNS auf den
  Hostinger-VPS (KVM 4, Ubuntu 24.04). Quelle: Hostinger-DNS-Abfrage am 22.10.2026.
- Der alte IONOS-Server leitet laut Umzugsprotokoll auf Hostinger weiter und bleibt als
  Rückfall bestehen. Eine Kündigung erst nach einer Schonfrist und einer letzten Sicherung.
- Dienste auf dem VPS (Server-Ausgabe 22.10.2026): `white-gloss`, `white-gloss-panel`,
  PostgreSQL, Docker aktiv. Timer für Erinnerungen, Wartung und tägliche Sicherung laufen.
- Webserver ist Caddy in Docker (`white-gloss-edge`), nicht als Systemdienst `caddy.service`.
- Firewall `white-gloss-web` (nur SSH 22, HTTP 80, HTTPS 443, UDP 443) ist seit
  22.10.2026 aktiv und synchronisiert.
- E-Mail: Resend-Absender `hub.white-gloss.de` ist per DNS verifiziert, der MX-Eintrag
  der Hauptdomain zeigt auf Hostinger Mail.

## Bekannte Lücken

1. **Kein Releaseweg auf Hostinger.** Es fehlen der Benutzer `white-gloss-ci` und
   `/usr/local/sbin/white-gloss-panel-release`. Der vorhandene Helfer und Installer
   prüfen zudem `caddy.service` und laden Caddy per systemd neu. Das passt nicht zu
   Caddy in Docker und muss vor dem ersten Release angepasst und auf dem Server getestet
   werden. `scripts/deploy-ionos.sh` akzeptiert nur das IONOS-Ziel.
2. **SSH-Härtung offen.** Auf dem VPS sind Passwort-Anmeldung und Root-Anmeldung per
   Passwort aktiv. Ziel: nur Schlüssel, Root nur per Schlüssel.
3. **Zwei zusätzliche KI-Agenten** (Hermes, OpenClaw) laufen mit offenen Ports im Docker.
   Die Firewall blockiert sie von außen. Ob sie bleiben, entscheidet der Betreiber.
4. **Zugänge aufräumen:** Migrationsschlüssel von Codex nach Abschluss entfernen,
   Hostinger-API-Token nach der Migration neu ausstellen.
5. **Alte Buchungsfotos** liegen in einem pausierten Supabase-Projekt und werden nicht
   migriert (Betreiberentscheidung). Ob Foto-Uploads der Website noch funktionieren,
   ist ungeprüft.

## Veröffentlichung

Der automatische IONOS-Release im Workflow ist abgeschaltet (`vars.PANEL_RELEASE_TARGET`
nicht gesetzt). Bis ein Hostinger-Releaseweg getestet ist, gilt: ein grüner Workflow
ist keine Veröffentlichung, und es wird nichts auf dem Server geändert, ohne dass der
Betreiber es ausdrücklich freigibt. Der Releaseweg gilt erst als vorhanden, wenn ein
Probe-Release mit Commit-Header, Anmeldung und `app.js`-Vergleich nachgewiesen ist.
