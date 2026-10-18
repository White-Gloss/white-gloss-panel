# Panel-Release B2B und Finanz-Inbox

**Veraltet – dieses Paket nicht mehr installieren.** Am 18. Oktober 2026 stimmen die öffentlich abrufbaren B2B-, Finanz-, Monatsbuchhaltungs- und Kanzlei-Dateien auf `panel.white-gloss.de` bytegenau mit dem neueren Hauptbranch-Commit `74f443102959f0fac16485369adc80b010b130ce` überein. Die neue Route `/buchhaltung` ist ebenfalls live erreichbar und leitet ohne Anmeldung nach `/kanzlei`. Der tatsächlich aktive Server-Commit und angemeldete Fachabläufe wurden mangels Server- beziehungsweise Betreibersitzung nicht ausgelesen. Vor einem weiteren Release den aktiven Serverstand prüfen und ein Paket aus dem aktuellen freigegebenen Commit verwenden; die folgenden Installationsbefehle sind nur noch historische Dokumentation.

Ziel: `https://panel.white-gloss.de`. Dieses Dokument ist eine Übergabe für den **separaten Paneldienst**. Es ist kein Nachweis, dass das Release bereits aktiv ist.

- GitHub: `White-Gloss/white-gloss-panel`, PR #29 in `main` übernommen
- Commit: `9503480ec93e790946eee8450d723b299be6ab7e`
- Paket: `white-gloss-panel-9503480ec93e790946eee8450d723b299be6ab7e.tar.gz`
- SHA-256: `bfc0b77d9b2ffce25ede43ec8da1e63df5873ddcb6efe52b1d83fc45fa2fef2b`
- Paketprüfung: 112 sichere Archiv-Einträge, `dist/release.json` enthält den angegebenen Commit, erforderliche Panel-Dateien vorhanden.
- Lokale Prüfung: 333 Tests, Lint, Typprüfung, Build, Shell-Syntax und Diff-Prüfung bestanden.
- GitHub-Prüfung: PR #29 und der anschließende Hauptbranch-Lauf waren vollständig grün, einschließlich Browser-Tests.
- Paket-Verteilung: privater Branch `release/ionos-b2b-finance-9503480`, Datei unter `.ionos-releases/`. Der Branch enthält nur das Releasepaket und diese Übergabe; der im Paket geprüfte Code stammt aus dem oben genannten `main`-Commit.

GitHub Actions für PR #29 ist vollständig grün (einschließlich Browser-Tests). Der dokumentierte IONOS-Host `217.154.124.239` lehnt SSH auf Port 22 aktuell ab. Den freigegebenen SSH-Port beziehungsweise einen anderen freigegebenen Zugang ermitteln; keine Zugangsdaten ins Repository oder in einen Chat kopieren.

Nach sicherer Übertragung des **unveränderten** Pakets nach `/home/white-gloss-ci/` auf dem VPS als root ausführen:

```bash
F=/home/white-gloss-ci/white-gloss-panel-9503480ec93e790946eee8450d723b299be6ab7e.tar.gz
sha256sum "$F"
install -d -m 0700 /root/wg-installer
tar -xzf "$F" -C /root/wg-installer deploy/install-panel.sh
bash /root/wg-installer/deploy/install-panel.sh "$F" bfc0b77d9b2ffce25ede43ec8da1e63df5873ddcb6efe52b1d83fc45fa2fef2b 9503480ec93e790946eee8450d723b299be6ab7e
```

Der Installer erstellt eine Sicherung, prüft Paket, Dienst und Caddy und führt bei einem Fehler einen Rollback des Paneldienstes durch. Die Hauptwebsite darf nicht mit ihrem separaten Deployment-Helfer verändert werden.

Nach dem Installer **ohne echte Kundenvorgänge** prüfen:

```bash
readlink -f /srv/white-gloss-panel/current
systemctl is-active white-gloss-panel.service white-gloss.service caddy.service
curl -fsS https://panel.white-gloss.de/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/business.css
curl -sS -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/accounting.css
curl -sS -o /dev/null -w '%{http_code}\n' https://panel.white-gloss.de/api/accounting
```

Erwartet: Panel-Commit im `current`-Link; alle drei Dienste aktiv; `healthz` meldet `ok`; beide CSS-Dateien HTTP 200; Betreiber-API ohne Anmeldung HTTP 401. Authentifizierte Prüfungen und ein echter Qonto-Erstabgleich stehen weiterhin aus. Die Finanz-Inbox ist nur eine Vorstufe; Journal, DATEV, KI und GoBD-Abnahme sind nicht enthalten.
