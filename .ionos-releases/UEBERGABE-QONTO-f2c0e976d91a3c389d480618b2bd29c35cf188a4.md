# Übergabe IONOS-Release · Qonto-Abrechnung

- Repository: White-Gloss/white-gloss-panel
- Commit auf `main`: `f2c0e976d91a3c389d480618b2bd29c35cf188a4` (enthält PR #17 „Qonto statt Lexware“)
- Paket: `.ionos-releases/white-gloss-panel-f2c0e976d91a3c389d480618b2bd29c35cf188a4.tar.gz`
- SHA-256: `2ffc0a2c9efdefb856a8bbff5d846bbc311fe3f1e833a3051e4d73b019a29f37`
- Geprüft vor dem Paketieren: lint, typecheck, 181/181 Tests, Build, `node --check dist/server/index.js`, `bash -n deploy/install-panel.sh`, GitHub-CI grün.

## Regeln (AGENTS.md, zwingend)

- Nur der freigegebene Panel-Weg: Paket + `deploy/install-panel.sh` als root auf dem VPS.
- Nicht den Deployment-Helfer der Hauptwebsite verwenden. `white-gloss.service` nicht verändern.
- Auf dem Rechner des Betreibers keinen lokalen Server starten.
- Keine Passwörter, Schlüssel oder `/etc/white-gloss-panel/environment` ausgeben.
- Keine echten Kundenmails, Rechnungen oder Zahlungen auslösen. `scripts/verify-live.mjs` NICHT ausführen.
- Getrennt berichten: installiert · Dienst aktiv · HTTPS live geprüft. Bei Fehlern sofort stoppen.

Server: IONOS-VPS 217.154.124.239 (Ubuntu 24.04, Node 22, Caddy). Panel: `white-gloss-panel.service` auf 127.0.0.1:3101, Releases unter `/srv/white-gloss-panel/releases`.

## Schritt 1 – Paket auf den Server

Paket aus dem Branch `release/claude-ionos-package-20261013` herunterladen (GitHub → Datei → „Download raw file“), dann:

```sh
scp white-gloss-panel-f2c0e976d91a3c389d480618b2bd29c35cf188a4.tar.gz root@217.154.124.239:/home/white-gloss-ci/
```

## Schritt 2 – Installation (root)

```sh
F=/home/white-gloss-ci/white-gloss-panel-f2c0e976d91a3c389d480618b2bd29c35cf188a4.tar.gz
sha256sum "$F"   # muss 2ffc0a2c9efdefb856a8bbff5d846bbc311fe3f1e833a3051e4d73b019a29f37 ergeben, sonst abbrechen
mkdir -p /root/wg-installer && tar -xzf "$F" -C /root/wg-installer deploy/install-panel.sh
bash /root/wg-installer/deploy/install-panel.sh "$F" 2ffc0a2c9efdefb856a8bbff5d846bbc311fe3f1e833a3051e4d73b019a29f37 f2c0e976d91a3c389d480618b2bd29c35cf188a4
```

Erwartete letzte Zeile: `Eigener Paneldienst und Timer aktiviert. HTTPS und Anbieterzugänge anschließend live prüfen.`
Der Installer sichert vorher die Daten und setzt bei Fehlstart automatisch auf das vorige Release zurück.
Keine Änderung an der Serverkonfiguration nötig. Neue Datenbanktabellen legt das Panel beim Start selbst an.

## Schritt 3 – Prüfen (nur lesend)

```sh
systemctl is-active white-gloss-panel.service white-gloss.service caddy.service
readlink -f /srv/white-gloss-panel/current        # .../releases/f2c0e976d91a3c389d480618b2bd29c35cf188a4
curl -s http://127.0.0.1:3101/healthz             # ok
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/manifest.webmanifest   # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://panel.white-gloss.de/vor-ort  # 303 → /auth/login?returnTo=%2Fvor-ort
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://panel.white-gloss.de/rechnung/0000000000000000000000000000000000000000000000000000000000000000  # 303 → /auth/login?returnTo=%2Frechnung%2F…
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/api/lexware/webhook   # 401 (Route entfernt, nur Anmeldung)
journalctl -u white-gloss-panel.service -n 30 --no-pager   # nur auf Fehler prüfen
curl -s -o /dev/null -w '%{http_code}\n' https://white-gloss.de   # Hauptwebsite erreichbar
```

## Schritt 4 – Einrichtung im Panel (Betreiber, nicht ChatGPT)

1. Qonto → Einstellungen → Integrationen & Partnerschaften → API-Schlüssel: Login + Secret Key.
2. Qonto-Rechnungseinstellungen: Steuernummer/USt-IdNr. und Firmenangaben prüfen.
3. Panel → Einstellungen → Qonto: Login + Secret Key → „Qonto-Verbindung prüfen“ → Zahlungskonto wählen → „Einstellungen geschützt speichern“.
4. „Vorhandene Qonto-Rechnungen abgleichen“ (nur lesend).
5. Optional: „Zahlungserinnerungen und Mahnungen … automatisch senden“ freigeben.
6. Erste echte Rechnung: Haken „per E-Mail senden“ weglassen, PDF in Qonto ansehen, dann im Auftrag „Rechnung per E-Mail senden“.

Doku: `docs/Qonto-Rechnungen-und-Mahnwesen.md`.
