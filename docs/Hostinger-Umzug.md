# Umzug auf Hostinger

Stand: 25.10.2026. Quellen sind jeweils genannt. Nur Gelesenes steht als Tatsache da,
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

## Hostinger-Releaseweg

Der Releaseweg ist seit 25.10.2026 im Repository vorbereitet, aber noch **nicht aktiviert
oder live getestet**. Er verwendet den vorhandenen VPS und verändert weder DNS noch die
Hauptwebsite. Caddy in Docker bleibt unverändert; der Release wechselt nur den versionierten
Panelstand unter `/srv/white-gloss-panel/releases` und startet den Paneldienst neu.

Enthalten sind:

- `deploy/install-hostinger-ci.sh`: einmaliger root-Bootstrap für den eingeschränkten
  SSH-Benutzer `white-gloss-ci`, den root-eigenen Releasehelfer und die Sudo-Regel.
- `deploy/panel-release.sh`: Status- und Installationsoperationen mit Commitprüfung,
  Dateisperre, Dienst- und Timerprüfung sowie Prüfung des Containers `white-gloss-edge`.
- `deploy/install-panel.sh`: atomarer Releasewechsel mit Rollback; auf Hostinger keine
  Caddy-Dateiänderung und kein systemd-Caddy-Reload.
- `scripts/deploy-hostinger.sh`: Paketierung, SHA-256-Prüfung, Schutz vor veralteten
  Workflow-Läufen und HTTPS-/Dateiintegritätsprüfung.
- `deploy/checks-with-hostinger.yml`: vollständige Vorlage des Prüfworkflows einschließlich
  des Jobs `Hostinger panel release`. Die GitHub-Integration konnte die Workflowdatei
  nicht direkt verändern, weil dem Zugriff dafür die Workflow-Berechtigung fehlt.

### Einmalige Freischaltung

1. Auf einem vertrauenswürdigen Rechner ein eigenes ED25519-Schlüsselpaar erzeugen:

   ```bash
   ssh-keygen -t ed25519 -f hostinger-panel-ci -C white-gloss-panel-ci
   ```

2. Den aktuellen Repositorystand und `hostinger-panel-ci.pub` auf sicherem Weg in das
   root-Verzeichnis des Hostinger-VPS übertragen. Den privaten Schlüssel nicht auf den
   VPS kopieren.
3. Im Repositoryverzeichnis auf dem VPS den Bootstrap ausführen:

   ```bash
   sudo bash deploy/install-hostinger-ci.sh /root/hostinger-panel-ci.pub
   ```

   Der Befehl richtet nur den CI-Zugang und den Releasehelfer ein. Er installiert keinen
   neuen Panelstand und muss den bereits aktiven Commit ausgeben.
4. In den Repository-Einstellungen unter **Secrets and variables → Actions → Environments**
   die Umgebung `hostinger-panel` anlegen und dort folgende Secrets setzen:
   - `PANEL_HOSTINGER_HOST`: VPS-IP oder SSH-Hostname aus dem Hostinger-Dashboard.
   - `PANEL_HOSTINGER_PORT`: SSH-Port, derzeit laut Bestandsdokumentation `22`.
   - `PANEL_HOSTINGER_SSH_KEY`: vollständiger privater Schlüssel aus `hostinger-panel-ci`.
   - `PANEL_HOSTINGER_KNOWN_HOSTS`: Ausgabe von `ssh-keyscan -p PORT HOST`, wobei HOST und
     PORT exakt den beiden SSH-Secrets entsprechen. Die Ausgabe vor der Übernahme über
     einen zweiten sicheren Weg mit dem VPS-Hostschlüssel abgleichen.
5. Den Inhalt von `deploy/checks-with-hostinger.yml` über die GitHub-Weboberfläche oder
   einen Git-Zugang mit Workflow-Berechtigung in `.github/workflows/checks.yml` übernehmen.
   Die Vorlage enthält alle bisherigen Prüfungen und den zusätzlichen Hostinger-Job.
6. Die Repository-Variable `PANEL_RELEASE_TARGET` auf `hostinger` setzen. Erst danach ist
   der automatische Releasejob freigeschaltet.
7. Den Workflow **Panel checks** manuell auf `main` ausführen. Der erste Lauf ist der
   erforderliche Probe-Release.

Der Weg gilt erst als betriebsbereit, wenn dieser Lauf den exakten Commit, den Header
`x-panel-commit`, die Anmeldung sowie `app.js`, `premium.js`, `premium.css` und `agency.css`
gegen das Releasepaket geprüft hat und die Statusprüfung Dienste, Timer und Caddy-Container
bestätigt. Bei einem Fehler ist der Release nicht als erfolgreich zu betrachten.

## Weitere bekannte Lücken

1. **SSH-Härtung offen.** Auf dem VPS sind Passwort-Anmeldung und Root-Anmeldung per
   Passwort aktiv. Ziel: nur Schlüssel, Root nur per Schlüssel. Erst nach erfolgreichem
   Test eines zweiten Administratorzugangs umstellen.
2. **Zwei zusätzliche KI-Agenten** (Hermes, OpenClaw) laufen mit offenen Ports im Docker.
   Die Firewall blockiert sie von außen. Ob sie bleiben, entscheidet der Betreiber.
3. **Zugänge aufräumen:** Migrationsschlüssel von Codex nach Abschluss entfernen,
   Hostinger-API-Token nach der Migration neu ausstellen.
4. **Alte Buchungsfotos** liegen in einem pausierten Supabase-Projekt und werden nicht
   migriert (Betreiberentscheidung). Ob Foto-Uploads der Website noch funktionieren,
   ist ungeprüft.

## Veröffentlichung

Der alte automatische IONOS-Release bleibt abgeschaltet. Ein grüner Check- oder
Browser-Workflow allein ist keine Veröffentlichung. Entscheidend ist der erfolgreiche
Job **Hostinger panel release** einschließlich aller Liveprüfungen. Ohne ausdrückliche
Betreiberfreigabe werden keine Serveränderungen vorgenommen.
