# Übergabe IONOS-Release · Kundenchat

- Repository: White-Gloss/white-gloss-panel
- Commit auf `main`: `7845a687b4737e23fde6fe3aa47b8540c3f65054` (Merge von PR #18 „Kundenchat im Panel“)
- Paket: `.ionos-releases/white-gloss-panel-7845a687b4737e23fde6fe3aa47b8540c3f65054.tar.gz`
- SHA-256: `85f497979bdfb0887c6e038f28eaced08e38f45d206ba2940d3c5ce59198eb82`
- Geprüft vor dem Paketieren: lint, typecheck, 195/195 Tests, Build, `node --check dist/server/index.js`, `bash -n deploy/install-panel.sh`, Archivprüfung des Installers lokal nachgestellt, GitHub-CI grün.
- Dieses Paket enthält den kompletten Stand von `main`, also auch die Qonto-Abrechnung (PR #17). Ist das Qonto-Release `f2c0e97…` noch nicht installiert, ersetzt dieses Paket es; die Qonto-Einrichtung im Panel aus der früheren Übergabe gilt dann zusätzlich.

## Regeln (AGENTS.md, zwingend)

- Nur der freigegebene Panel-Weg: Paket + `deploy/install-panel.sh` als root auf dem VPS.
- Nicht den Deployment-Helfer der Hauptwebsite verwenden. `white-gloss.service` nicht verändern.
- Auf dem Rechner des Betreibers keinen lokalen Server starten.
- Keine Passwörter, Schlüssel oder `/etc/white-gloss-panel/environment` ausgeben.
- Keine echten Kundenmails, Chat-Einladungen, Nachrichten, Uploads, Rechnungen oder Zahlungen auslösen. `scripts/verify-live.mjs` NICHT ausführen.
- Getrennt berichten: installiert · Dienst aktiv · HTTPS live geprüft. Bei Fehlern sofort stoppen.

Server: IONOS-VPS 217.154.124.239 (Ubuntu 24.04, Node 22, Caddy). Panel: `white-gloss-panel.service` auf 127.0.0.1:3101, Releases unter `/srv/white-gloss-panel/releases`.

## Schritt 1 – Paket auf den Server

Paket aus dem Branch `release/claude-ionos-package-20261013-kundenchat` herunterladen (GitHub → Datei → „Download raw file“), dann:

```sh
scp white-gloss-panel-7845a687b4737e23fde6fe3aa47b8540c3f65054.tar.gz root@217.154.124.239:/home/white-gloss-ci/
```

## Schritt 2 – Installation (root)

```sh
F=/home/white-gloss-ci/white-gloss-panel-7845a687b4737e23fde6fe3aa47b8540c3f65054.tar.gz
sha256sum "$F"   # muss 85f497979bdfb0887c6e038f28eaced08e38f45d206ba2940d3c5ce59198eb82 ergeben, sonst abbrechen
rm -rf /root/wg-installer && mkdir -p /root/wg-installer && tar -xzf "$F" -C /root/wg-installer deploy/install-panel.sh
bash /root/wg-installer/deploy/install-panel.sh "$F" 85f497979bdfb0887c6e038f28eaced08e38f45d206ba2940d3c5ce59198eb82 7845a687b4737e23fde6fe3aa47b8540c3f65054
```

Erwartete letzte Zeile: `Eigener Paneldienst und Timer aktiviert. HTTPS und Anbieterzugänge anschließend live prüfen.`
Der Installer sichert vorher die Daten und setzt bei Fehlstart automatisch auf das vorige Release zurück.
Keine Änderung an Serverkonfiguration, Caddy oder Umgebungsvariablen nötig. Die Chat-Tabellen legt das Panel beim Start selbst an.

## Schritt 3 – Prüfen (nur lesend, ohne Anmeldung)

```sh
Z=0000000000000000000000000000000000000000000000000000000000000000
systemctl is-active white-gloss-panel.service white-gloss.service caddy.service
readlink -f /srv/white-gloss-panel/current        # .../releases/7845a687b4737e23fde6fe3aa47b8540c3f65054
curl -s http://127.0.0.1:3101/healthz             # ok
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/chat.css         # 200
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/chat-ui.js       # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://panel.white-gloss.de/chat/$Z   # 303 → /auth/login?returnTo=%2Fchat%2F000…
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/api/kundenchat/$Z        # 401
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/api/chats                  # 401
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://panel.white-gloss.de/vor-ort    # 303 → /auth/login?returnTo=%2Fvor-ort
sudo -u white-gloss-panel sqlite3 /var/lib/white-gloss-panel/data/panel.sqlite ".tables" | tr ' ' '\n' | grep chat_   # chat_attachments chat_messages chat_threads (falls sqlite3 installiert)
journalctl -u white-gloss-panel.service -n 30 --no-pager   # nur auf Fehler prüfen
curl -s -o /dev/null -w '%{http_code}\n' https://white-gloss.de   # Hauptwebsite erreichbar
```

## Schritt 4 – Test im Panel (Betreiber, nur Testbereich)

1. Im Panel oben „Testbereich“ einschalten → Testauftrag öffnen (oder anlegen) → „Kundenchat“.
2. Nachricht und ein Foto senden – erscheint sofort, Foto ist verkleinert.
3. „Kundenzugang“ → „Kundenlink erstellen“ → Link im selben Browser öffnen → „Betreibervorschau“.
4. Navigation „Nachrichten“: Test-Chat erscheint nur im Testbereich.

Danach ist der Chat für echte Aufträge bereit: Auftrag öffnen → „Kundenchat“ → „Kundenzugang“ → „Einladung per E-Mail (Link + PIN)“ (benötigt geprüften und freigegebenen E-Mail-Versand in den Einstellungen).

Doku: `docs/Kundenchat.md`.
