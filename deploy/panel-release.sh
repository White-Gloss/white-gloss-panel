#!/bin/bash
set -euo pipefail
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

root_protected_path() {
    /usr/bin/python3 -I - "$1" "$2" <<'PY'
import os, pathlib, stat, sys
path=pathlib.Path(sys.argv[1])
if not path.is_absolute(): raise SystemExit('Absoluter Administratorpfad erforderlich.')
for entry in (*reversed(path.parents),path):
    info=entry.lstat()
    if info.st_uid!=0 or stat.S_ISLNK(info.st_mode) or info.st_mode&0o022:
        raise SystemExit('Administratorpfad ist nicht geschützt.')
    if entry!=path and not stat.S_ISDIR(info.st_mode): raise SystemExit('Ungültiger Elternpfad.')
info=path.lstat()
if not (stat.S_ISREG(info.st_mode) if sys.argv[2]=='file' else stat.S_ISDIR(info.st_mode)):
    raise SystemExit('Unerwarteter Dateityp.')
PY
}

current_commit() {
    local current=/srv/white-gloss-panel/current target commit
    root_protected_path /srv/white-gloss-panel/releases directory || return 1
    [[ -L $current && $(stat -c '%u' -- "$current") == 0 ]] || { echo 'Aktiver Releaselink fehlt.' >&2; return 1; }
    target=$(readlink -- "$current")
    [[ $target =~ ^/srv/white-gloss-panel/releases/([a-f0-9]{40})$ ]] || { echo 'Aktiver Releasepfad ist ungültig.' >&2; return 1; }
    commit=${BASH_REMATCH[1]}
    root_protected_path "$target/dist/release.json" file || return 1
    /usr/bin/python3 -I - "$target/dist/release.json" "$commit" <<'PY'
import json,sys
with open(sys.argv[1]) as stream: manifest=json.load(stream)
if not isinstance(manifest,dict) or manifest.get('commit')!=sys.argv[2]: raise SystemExit('Releasekennzeichnung stimmt nicht.')
PY
    [[ $? == 0 ]] || return 1
    printf '%s\n' "$commit"
}

release_status() {
    local commit
    commit=$(current_commit) || return 1
    systemctl is-active --quiet white-gloss-panel.service || return 1
    systemctl is-active --quiet white-gloss-panel-maintenance.timer || return 1
    systemctl is-active --quiet white-gloss-panel-backup.timer || return 1
    systemctl is-active --quiet white-gloss.service || return 1
    systemctl is-active --quiet caddy.service || return 1
    printf '%s\n' "$commit"
}

valid_install_arguments() {
    [[ $# == 3 ]] && [[ $2 =~ ^[a-f0-9]{64}$ && $3 =~ ^[a-f0-9]{40}$ ]] &&
        [[ $1 == "/home/white-gloss-ci/white-gloss-panel-$3.tar.gz" ]]
}

validate_release_assets() {
    local directory=$1 name
    for name in install-panel.sh prepare-environment.mjs white-gloss-panel.service white-gloss-panel-maintenance.service white-gloss-panel-maintenance.timer white-gloss-panel-backup.service white-gloss-panel-backup.timer white-gloss-panel.caddy; do
        root_protected_path "$directory/$name" file || return 1
    done
    root_protected_path /etc/white-gloss-panel/environment file || return 1
}

acquire_release_lock() {
    local directory=/run/lock/white-gloss-panel-release
    # /run/lock is shared and sticky on Ubuntu. Never open a caller-created link there.
    /usr/bin/python3 -I - "$directory" <<'PY'
import os,stat,sys
directory=sys.argv[1]
parent=os.lstat('/run/lock')
if parent.st_uid!=0 or not stat.S_ISDIR(parent.st_mode) or parent.st_mode&0o022 and not parent.st_mode&stat.S_ISVTX:
    raise SystemExit('Unsicherer Sperrpfad.')
try: os.mkdir(directory,0o700)
except FileExistsError: pass
info=os.lstat(directory)
if info.st_uid!=0 or not stat.S_ISDIR(info.st_mode) or info.st_mode&0o077:
    raise SystemExit('Sperrverzeichnis ist nicht geschützt.')
PY
    [[ $? == 0 ]] || return 1
    [[ ! -L $directory/release.lock ]] || { echo 'Unsichere Releasedateisperre.' >&2; return 1; }
    exec 9>"$directory/release.lock" || return 1
    flock -x -w 120 9 || { echo 'Andere Panelveröffentlichung ist noch aktiv.' >&2; return 1; }
}

panel_release() {
    [[ $(id -u) == 0 && $(uname -s) == Linux ]] || { echo 'Nur durch den IONOS-Administrator ausführen.' >&2; return 1; }
    local operation=${1:-} installer=/usr/local/lib/white-gloss-panel/install-panel.sh active
    case "$operation" in
        status) [[ $# == 1 ]] || return 1 ;;
        install) shift; valid_install_arguments "$@" || { echo 'Ungültiger Panel-Releaseauftrag.' >&2; return 1; } ;;
        *) echo 'Nur status oder install ARCHIV SHA256 COMMIT erlaubt.' >&2; return 1 ;;
    esac
    acquire_release_lock || return 1
    if [[ $operation == status ]]; then release_status; return; fi
    active=$(release_status) || return 1
    if [[ $active == "$3" ]]; then printf '%s\n' "$active"; return; fi
    validate_release_assets "${installer%/*}" || return 1
    cd / || return 1
    env -i PATH="$PATH" /bin/bash "$installer" "$@" >&2 || return 1
    active=$(release_status) || return 1
    [[ $active == "$3" ]] || { echo 'Erwarteter Panelcommit wurde nicht aktiviert.' >&2; return 1; }
    printf '%s\n' "$active"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then panel_release "$@"; fi
