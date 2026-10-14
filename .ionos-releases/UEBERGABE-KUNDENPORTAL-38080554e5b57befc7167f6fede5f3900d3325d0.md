# Übergabe IONOS-Release · Kundenportal

- Repository: White-Gloss/white-gloss-panel
- Commit auf `main`: `38080554e5b57befc7167f6fede5f3900d3325d0` (Merge von PR #20 „Kundenportal ‚Mein White Gloss‘ unter /kunde“)
- Paket: `.ionos-releases/white-gloss-panel-38080554e5b57befc7167f6fede5f3900d3325d0.tar.gz`
- SHA-256: `61faebef00d48bf3b79f46f96a995a57ff474f991fae6608c495c1ee2decc844`
- Geprüft vor dem Paketieren: lint, typecheck, 233/233 Tests, Build, `node --check dist/server/index.js`, `bash -n deploy/install-panel.sh`, Entpacken und Prüfung von `dist/release.json` wie im Installer nachgestellt, GitHub-CI grün.
- Dieses Paket enthält den kompletten Stand von `main`: Kundenchat (PR #18), Fernunterschrift für Protokolle, Auftrags-Papierkorb und Rechnungsentwurf (PR #19) sowie das neue Kundenportal (PR #20). Ist PR #19 noch nicht live, kommt es mit diesem Paket.

## Regeln (AGENTS.md, zwingend)

- Nur der freigegebene Panel-Weg: Paket + `deploy/install-panel.sh` als root auf dem VPS.
- Nicht den Deployment-Helfer der Hauptwebsite verwenden. `white-gloss.service` nicht verändern.
- Auf dem Rechner des Betreibers keinen lokalen Server starten.
- Keine Passwörter, Schlüssel oder `/etc/white-gloss-panel/environment` ausgeben.
- Keine echten Kundenmails, Anmeldelinks, Chat-Einladungen, Nachrichten, Uploads, Rechnungen oder Zahlungen auslösen. `scripts/verify-live.mjs` NICHT ausführen. Auch kein `POST /auth/request` mit echten Adressen.
- Getrennt berichten: installiert · Dienst aktiv · HTTPS live geprüft. Bei Fehlern sofort stoppen.

Server: IONOS-VPS 217.154.124.239 (Ubuntu 24.04, Node 22, Caddy). Panel: `white-gloss-panel.service` auf 127.0.0.1:3101, Releases unter `/srv/white-gloss-panel/releases`.

## Schritt 0 – aktuellen Stand notieren (nur lesen)

```sh
readlink -f /srv/white-gloss-panel/current      # bisheriges Release für den Bericht notieren
systemctl is-active white-gloss-panel.service
```

## Schritt 1 – Paket auf den Server

Paket aus dem Branch `release/claude-ionos-package-20261014-kundenportal` herunterladen (GitHub → Datei → „Download raw file“), dann:

```sh
scp white-gloss-panel-38080554e5b57befc7167f6fede5f3900d3325d0.tar.gz root@217.154.124.239:/home/white-gloss-ci/
```

## Schritt 2 – Installation (root)

```sh
F=/home/white-gloss-ci/white-gloss-panel-38080554e5b57befc7167f6fede5f3900d3325d0.tar.gz
sha256sum "$F"   # muss 61faebef00d48bf3b79f46f96a995a57ff474f991fae6608c495c1ee2decc844 ergeben, sonst abbrechen
rm -rf /root/wg-installer && mkdir -p /root/wg-installer && tar -xzf "$F" -C /root/wg-installer deploy/install-panel.sh
bash /root/wg-installer/deploy/install-panel.sh "$F" 61faebef00d48bf3b79f46f96a995a57ff474f991fae6608c495c1ee2decc844 38080554e5b57befc7167f6fede5f3900d3325d0
```

Erwartete letzte Zeile: `Eigener Paneldienst und Timer aktiviert. HTTPS und Anbieterzugänge anschließend live prüfen.`
Der Installer sichert vorher die Daten und setzt bei Fehlstart automatisch auf das vorige Release zurück.
Keine Änderung an Serverkonfiguration, Caddy oder Umgebungsvariablen nötig. Die Tabelle `portal_requests`
und die Spalte `chat_threads.link_revoked` legt das Panel beim Start selbst an (es wird nichts gelöscht).

## Schritt 3 – Prüfen (nur lesend, ohne Anmeldung)

```sh
systemctl is-active white-gloss-panel.service white-gloss.service caddy.service
readlink -f /srv/white-gloss-panel/current        # .../releases/38080554e5b57befc7167f6fede5f3900d3325d0
curl -s http://127.0.0.1:3101/healthz             # ok
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/kunde.css          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/kunde.js           # 200
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://panel.white-gloss.de/kunde   # 303 → /auth/login?returnTo=%2Fkunde
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/api/portal/me       # 401
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/api/portal-admin/requests   # 401
curl -s -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/api/chats           # 401
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://panel.white-gloss.de/vor-ort    # 303 → /auth/login?returnTo=%2Fvor-ort
sudo -u white-gloss-panel sqlite3 /var/lib/white-gloss-panel/data/panel.sqlite ".tables" | tr ' ' '\n' | grep portal_   # portal_requests (falls sqlite3 installiert)
journalctl -u white-gloss-panel.service -n 30 --no-pager   # nur auf Fehler prüfen
curl -s -o /dev/null -w '%{http_code}\n' https://white-gloss.de   # Hauptwebsite erreichbar
```

## Schritt 4 – Test im Panel (Betreiber, nur Testbereich)

1. Im Panel oben „Testbereich“ einschalten → Testauftrag öffnen (oder anlegen).
2. Oben im Auftrag „Kundenportal-Vorschau“ → neuer Tab mit gelbem Hinweis „Betreibervorschau“:
   Status mit Fortschritt, Termin, Leistungen, Zusatzleistungen, Dokumente. Knöpfe sind gesperrt.
3. Auf `https://panel.white-gloss.de/kunde` ohne Anmeldung → Anmeldeseite mit Text
   „Mein White Gloss – Ihr Kundenportal …“ (nichts absenden).
4. Übersicht im Panel öffnet sich ohne Fehler (Kasten „offene Kundenwünsche“ erscheint erst bei Wünschen).

## Hinweise für den Betreiber nach dem Release

- Bestehende Chats ohne aktiven Kundenlink sind im Portal zunächst gesperrt (früher widerrufene Links sind nicht
  unterscheidbar). Im Chat „Kundenzugang“ → „Kundenlink erstellen“ gibt sie frei.
- Auf white-gloss.de einen Menüpunkt „Kundenlogin“ auf `https://panel.white-gloss.de/kunde` setzen.
- Datenschutzerklärung um das Kundenportal ergänzen (rechtlich prüfen lassen).

Doku: `docs/Kundenportal.md`.
