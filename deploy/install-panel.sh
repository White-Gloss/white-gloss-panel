#!/bin/bash
set -euo pipefail
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
panel_unit_templates=(white-gloss-panel.service white-gloss-panel-maintenance.service white-gloss-panel-maintenance.timer white-gloss-panel-backup.service white-gloss-panel-backup.timer)

validate_installer_directory() {
    /usr/bin/python3 -I - "$1" install-panel.sh prepare-environment.mjs "${panel_unit_templates[@]}" white-gloss-panel.caddy <<'PY'
import pathlib,stat,sys
for name in sys.argv[2:]:
    path=pathlib.Path(sys.argv[1])/name
    if not path.is_absolute(): raise SystemExit('Absoluter Administratorpfad erforderlich.')
    for entry in (*reversed(path.parents),path):
        info=entry.lstat()
        if info.st_uid!=0 or info.st_mode&0o022 or stat.S_ISLNK(info.st_mode): raise SystemExit('Installer oder Dienstvorlage ist nicht geschützt.')
        if not (stat.S_ISREG(info.st_mode) if entry==path else stat.S_ISDIR(info.st_mode)): raise SystemExit('Ungültige Installerdatei.')
PY
}

validate_release_archive() {
    /usr/bin/python3 -I - "$1" <<'PY'
import sys,tarfile,pathlib
with tarfile.open(sys.argv[1],'r:gz') as archive:
    members=archive.getmembers()
    if len(members)>2000 or sum(member.size for member in members)>100*1024*1024: raise SystemExit('Archiv ist zu groß.')
    for member in members:
        path=pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not(member.isfile() or member.isdir()): raise SystemExit('Unsicherer Archivpfad.')
        if any(part in {'.git','.env','data','uploads','node_modules'} for part in path.parts): raise SystemExit('Unzulässiger Archivinhalt.')
        if member.size>20*1024*1024: raise SystemExit('Unerwartete Archivdatei.')
PY
}

install_trusted_service_templates() {
    local unit
    for unit in "${panel_unit_templates[@]}"; do
        install -m 0644 "$installer_directory/$unit" "/etc/systemd/system/$unit" || return "$?"
    done
    install -m 0644 "$installer_directory/white-gloss-panel.caddy" /etc/caddy/white-gloss-panel.caddy
}

clear_release_link() {
    local link=$1 destination
    [[ ! -e $link && ! -L $link ]] && return 0
    [[ $link == */current.next || $link == */current.rollback ]] || return 1
    [[ -L $link ]] || { echo 'Temporärer Releasepfad ist kein Link.' >&2; return 1; }
    destination=$(readlink -- "$link")
    [[ $destination =~ ^/srv/white-gloss-panel/releases/[a-f0-9]{40}$ ]] || { echo 'Unerwarteter temporärer Releaselink.' >&2; return 1; }
    rm -- "$link"
}

restore_timer_state() {
    local index unit
    for index in "${!timer_units[@]}"; do
        unit=${timer_units[$index]}
        if [[ ${timer_was_enabled[$index]} == true ]]; then
            systemctl enable "$unit" || true
        else
            systemctl disable "$unit" || true
        fi
        if [[ ${timer_was_active[$index]} == true ]]; then
            systemctl start "$unit" || true
        else
            systemctl stop "$unit" || true
        fi
    done
}

pause_panel_jobs() {
    timers_paused=true
    if [[ $previous == /srv/white-gloss-panel/releases/* ]]; then
        systemctl stop "${timer_units[@]}" || return "$?"
        systemctl stop white-gloss-panel-maintenance.service white-gloss-panel-backup.service || return "$?"
        systemctl start white-gloss-panel-backup.service || return "$?"
    else
        systemctl stop "${timer_units[@]}" 2>/dev/null || true
        systemctl stop white-gloss-panel-maintenance.service white-gloss-panel-backup.service 2>/dev/null || true
    fi
}

finish_install() {
    local result=$1
    trap - EXIT INT TERM
    if [[ $result != 0 ]]; then
        if [[ $activation_started == true ]]; then rollback || true; fi
        if [[ $timers_paused == true ]]; then restore_timer_state; fi
    fi
    exit "$result"
}

install_panel() {
[[ $(id -u) == 0 && $(uname -s) == Linux ]] || { echo 'Nur durch den IONOS-Administrator ausführen.' >&2; exit 1; }
[[ $# == 3 ]] || { echo 'Archiv, SHA256 und Git-Commit erforderlich.' >&2; exit 1; }
installer_directory=$(dirname -- "$(realpath -e -- "${BASH_SOURCE[0]}")")
validate_installer_directory "$installer_directory"
cd /
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
validate_release_archive "$archive"
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
    /usr/bin/node "$installer_directory/prepare-environment.mjs"
fi
if [[ ! -f /etc/white-gloss-panel/migration-private.pem ]]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /etc/white-gloss-panel/migration-private.pem 2>/dev/null
    chmod 0600 /etc/white-gloss-panel/migration-private.pem
fi
previous=$(readlink -f /srv/white-gloss-panel/current 2>/dev/null || true)
clear_release_link /srv/white-gloss-panel/current.next
clear_release_link /srv/white-gloss-panel/current.rollback
backup=/etc/caddy/Caddyfile.white-gloss-panel.$(date -u +%Y%m%dT%H%M%SZ).bak
install -m 0600 /etc/caddy/Caddyfile "$backup"
timer_units=(white-gloss-panel-maintenance.timer white-gloss-panel-backup.timer)
timer_was_active=()
timer_was_enabled=()
for unit in "${timer_units[@]}"; do
    if systemctl is-active --quiet "$unit"; then timer_was_active+=(true); else timer_was_active+=(false); fi
    if systemctl is-enabled --quiet "$unit"; then timer_was_enabled+=(true); else timer_was_enabled+=(false); fi
done
timers_paused=false
activation_started=false
rollback() {
    install -m 0644 "$backup" /etc/caddy/Caddyfile || true
    if [[ $previous == /srv/white-gloss-panel/releases/* ]]; then
        if clear_release_link /srv/white-gloss-panel/current.rollback && ln -s "$previous" /srv/white-gloss-panel/current.rollback; then
            mv -T /srv/white-gloss-panel/current.rollback /srv/white-gloss-panel/current || true
        fi
        install_trusted_service_templates || true
        systemctl daemon-reload || true
        systemctl restart white-gloss-panel.service || true
    else
        systemctl stop white-gloss-panel.service || true
    fi
    caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 && systemctl reload caddy.service || true
    echo 'Panelaktivierung zurückgesetzt. Hauptwebsite wurde nicht ersetzt.' >&2
}
trap 'finish_install "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
pause_panel_jobs
activation_started=true
ln -s "$target" /srv/white-gloss-panel/current.next
mv -T /srv/white-gloss-panel/current.next /srv/white-gloss-panel/current
install_trusted_service_templates
/usr/bin/python3 -I - <<'PY'
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
trap - EXIT INT TERM
echo 'Eigener Paneldienst und Timer aktiviert. HTTPS und Anbieterzugänge anschließend live prüfen.'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then install_panel "$@"; fi
