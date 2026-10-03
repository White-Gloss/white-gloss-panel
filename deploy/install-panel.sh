#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $(id -u) == 0 && $(uname -s) == Linux ]] || { echo 'Nur durch den IONOS-Administrator ausführen.' >&2; exit 1; }
archive=${1:?Archiv erforderlich}
archive_hash=${2:?SHA256 erforderlich}
release=${3:?Git-Commit erforderlich}
[[ $archive_hash =~ ^[a-f0-9]{64}$ && $release =~ ^[a-f0-9]{40}$ ]] || exit 1
[[ ! -L $archive ]] || exit 1
archive=$(realpath -e -- "$archive")
[[ $archive == /home/white-gloss-ci/white-gloss-panel-*.tar.gz && -f $archive ]] || exit 1
install -d -m 0700 -o root -g root /root/white-gloss-panel-staging
staged=/root/white-gloss-panel-staging/white-gloss-panel-$release.tar.gz
[[ ! -e $staged ]] || { echo 'Stagingdatei bereits vorhanden.' >&2; exit 1; }
install -m 0600 -o root -g root "$archive" "$staged"
archive=$staged
[[ $(sha256sum -- "$archive" | cut -d' ' -f1) == "$archive_hash" ]] || { echo 'Archiv-Prüfsumme stimmt nicht.' >&2; exit 1; }
[[ -f /etc/caddy/Caddyfile && -f /etc/white-gloss/environment ]] || { echo 'Erwarteter IONOS-Stand fehlt.' >&2; exit 1; }
systemctl is-active --quiet white-gloss.service
systemctl is-active --quiet caddy.service
node_major=$(/usr/bin/node -p 'process.versions.node.split(".")[0]')
[[ $node_major -ge 22 ]] || { echo 'Node 22 oder neuer erforderlich.' >&2; exit 1; }
python3 - "$archive" <<'PY'
import sys,tarfile,pathlib
with tarfile.open(sys.argv[1],'r:gz') as archive:
    members=archive.getmembers()
    if len(members)>2000: raise SystemExit('Archiv ist zu groß.')
    for member in members:
        path=pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not(member.isfile() or member.isdir()): raise SystemExit('Unsicherer Archivpfad.')
        if any(part in {'.git','.env','data','uploads','node_modules'} for part in path.parts): raise SystemExit('Unzulässiger Archivinhalt.')
        if member.size>20*1024*1024: raise SystemExit('Unerwartete Archivdatei.')
PY
id white-gloss-panel >/dev/null 2>&1 || useradd --system --home-dir /var/lib/white-gloss-panel --shell /usr/sbin/nologin white-gloss-panel
install -d -m 0750 -o root -g white-gloss-panel /srv/white-gloss-panel /srv/white-gloss-panel/releases
install -d -m 0700 -o white-gloss-panel -g white-gloss-panel /var/lib/white-gloss-panel /var/lib/white-gloss-panel/data /var/lib/white-gloss-panel/backups
install -d -m 0700 -o root -g root /etc/white-gloss-panel
target=/srv/white-gloss-panel/releases/$release
[[ ! -e $target ]] || { echo 'Release bereits vorhanden; kein Überschreiben.' >&2; exit 1; }
install -d -m 0750 -o root -g white-gloss-panel "$target"
tar --extract --gzip --file "$archive" --directory "$target" --no-same-owner --no-same-permissions
chown -R root:white-gloss-panel "$target"
find "$target" -type d -exec chmod 0750 {} +
find "$target" -type f -exec chmod 0640 {} +
[[ -f $target/server/start.mjs && -f $target/dist/client/index.html ]] || exit 1
/usr/bin/node -e 'const fs=require("fs");if(JSON.parse(fs.readFileSync(process.argv[1])).commit!==process.argv[2])process.exit(1)' "$target/dist/release.json" "$release"
if [[ ! -f /etc/white-gloss-panel/environment ]]; then
    /usr/bin/node "$target/deploy/prepare-environment.mjs"
fi
if [[ ! -f /etc/white-gloss-panel/migration-private.pem ]]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /etc/white-gloss-panel/migration-private.pem 2>/dev/null
    chmod 0600 /etc/white-gloss-panel/migration-private.pem
fi
previous=$(readlink -f /srv/white-gloss-panel/current 2>/dev/null || true)
systemctl stop white-gloss-panel-maintenance.timer white-gloss-panel-backup.timer 2>/dev/null || true
systemctl stop white-gloss-panel-maintenance.service white-gloss-panel-backup.service 2>/dev/null || true
if [[ $previous == /srv/white-gloss-panel/releases/* ]]; then
    systemctl start white-gloss-panel-backup.service
fi
backup=/etc/caddy/Caddyfile.white-gloss-panel.$(date -u +%Y%m%dT%H%M%SZ).bak
install -m 0600 /etc/caddy/Caddyfile "$backup"
rollback() {
    install -m 0644 "$backup" /etc/caddy/Caddyfile
    if [[ $previous == /srv/white-gloss-panel/releases/* ]]; then
        ln -s "$previous" /srv/white-gloss-panel/current.rollback
        mv -T /srv/white-gloss-panel/current.rollback /srv/white-gloss-panel/current
        for unit in white-gloss-panel.service white-gloss-panel-maintenance.service white-gloss-panel-maintenance.timer white-gloss-panel-backup.service white-gloss-panel-backup.timer; do
            [[ ! -f $previous/deploy/$unit ]] || install -m 0644 "$previous/deploy/$unit" /etc/systemd/system/$unit
        done
        [[ ! -f $previous/deploy/white-gloss-panel.caddy ]] || install -m 0644 "$previous/deploy/white-gloss-panel.caddy" /etc/caddy/white-gloss-panel.caddy
        systemctl daemon-reload || true
        systemctl restart white-gloss-panel.service || true
        systemctl start white-gloss-panel-maintenance.timer white-gloss-panel-backup.timer || true
    else
        systemctl stop white-gloss-panel.service || true
    fi
    caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy.service || true
    echo 'Panelaktivierung zurückgesetzt. Hauptwebsite wurde nicht ersetzt.' >&2
}
trap rollback ERR
ln -s "$target" /srv/white-gloss-panel/current.next
mv -T /srv/white-gloss-panel/current.next /srv/white-gloss-panel/current
install -m 0644 "$target/deploy/white-gloss-panel.service" /etc/systemd/system/white-gloss-panel.service
install -m 0644 "$target/deploy/white-gloss-panel-maintenance.service" /etc/systemd/system/white-gloss-panel-maintenance.service
install -m 0644 "$target/deploy/white-gloss-panel-maintenance.timer" /etc/systemd/system/white-gloss-panel-maintenance.timer
install -m 0644 "$target/deploy/white-gloss-panel-backup.service" /etc/systemd/system/white-gloss-panel-backup.service
install -m 0644 "$target/deploy/white-gloss-panel-backup.timer" /etc/systemd/system/white-gloss-panel-backup.timer
install -m 0644 "$target/deploy/white-gloss-panel.caddy" /etc/caddy/white-gloss-panel.caddy
python3 - <<'PY'
from pathlib import Path
path=Path('/etc/caddy/Caddyfile')
text=path.read_text()
line='import /etc/caddy/white-gloss-panel.caddy'
if line not in text.splitlines(): path.write_text(text.rstrip()+'\n\n'+line+'\n')
PY
caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1
systemctl daemon-reload
systemctl enable white-gloss-panel.service
systemctl restart white-gloss-panel.service
ready=false
for attempt in {1..10}; do
    if curl --fail --silent --max-time 5 http://127.0.0.1:3101/healthz >/dev/null; then ready=true; break; fi
    sleep 1
done
[[ $ready == true ]]
systemctl reload caddy.service
systemctl start white-gloss-panel-backup.service
systemctl enable --now white-gloss-panel-maintenance.timer white-gloss-panel-backup.timer
systemctl is-active --quiet white-gloss.service
trap - ERR
echo 'Eigener Paneldienst und Timer aktiviert. HTTPS und Anbieterzugänge anschließend live prüfen.'
