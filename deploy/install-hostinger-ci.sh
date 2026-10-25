#!/bin/bash
set -euo pipefail
umask 077
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

[[ $(id -u) == 0 && $(uname -s) == Linux ]] || { echo 'Als root auf dem Hostinger-VPS ausführen.' >&2; exit 1; }
[[ $# == 1 ]] || { echo 'Aufruf: install-hostinger-ci.sh ÖFFENTLICHER_ED25519_SCHLÜSSEL' >&2; exit 1; }
public_key=$(realpath -e -- "$1")
[[ -f $public_key && ! -L $public_key ]] || exit 1
/usr/bin/python3 -I - "$public_key" <<'PY'
import base64,pathlib,sys
lines=pathlib.Path(sys.argv[1]).read_text().splitlines()
if len(lines)!=1: raise SystemExit('Genau ein öffentlicher Schlüssel ist erforderlich.')
parts=lines[0].split()
if len(parts)<2 or parts[0]!='ssh-ed25519': raise SystemExit('Nur ein öffentlicher ED25519-Schlüssel ist zulässig.')
try: base64.b64decode(parts[1],validate=True)
except ValueError: raise SystemExit('Ungültiger öffentlicher Schlüssel.')
PY

[[ -f /etc/white-gloss-panel/environment ]] || { echo 'Bestehende Panelumgebung fehlt; Bootstrap abgebrochen.' >&2; exit 1; }
systemctl is-active --quiet white-gloss-panel.service
systemctl is-active --quiet white-gloss.service
[[ $(docker inspect --format '{{.State.Running}}' white-gloss-edge 2>/dev/null) == true ]] || { echo 'Caddy-Container white-gloss-edge ist nicht aktiv.' >&2; exit 1; }

source_directory=$(dirname -- "$(realpath -e -- "${BASH_SOURCE[0]}")")
assets=(install-panel.sh prepare-environment.mjs white-gloss-panel.service white-gloss-panel-maintenance.service white-gloss-panel-maintenance.timer white-gloss-panel-backup.service white-gloss-panel-backup.timer white-gloss-panel.caddy)
for asset in "${assets[@]}" panel-release.sh white-gloss-panel-ci.sudoers; do
    [[ -f $source_directory/$asset ]] || { echo "Deploydatei fehlt: $asset" >&2; exit 1; }
done

id white-gloss-ci >/dev/null 2>&1 || useradd --create-home --shell /bin/bash white-gloss-ci
install -d -m 0700 -o white-gloss-ci -g white-gloss-ci /home/white-gloss-ci/.ssh
install -m 0600 -o white-gloss-ci -g white-gloss-ci "$public_key" /home/white-gloss-ci/.ssh/authorized_keys
install -d -m 0755 -o root -g root /usr/local/lib/white-gloss-panel
for asset in "${assets[@]}"; do
    install -m 0644 -o root -g root "$source_directory/$asset" "/usr/local/lib/white-gloss-panel/$asset"
done
install -m 0755 -o root -g root "$source_directory/panel-release.sh" /usr/local/sbin/white-gloss-panel-release
install -m 0440 -o root -g root "$source_directory/white-gloss-panel-ci.sudoers" /etc/sudoers.d/white-gloss-panel-ci
visudo -cf /etc/sudoers.d/white-gloss-panel-ci

marker=$(mktemp)
trap 'rm -f -- "$marker"' EXIT
printf 'hostinger\n' > "$marker"
install -d -m 0700 -o root -g root /etc/white-gloss-panel
install -m 0600 -o root -g root "$marker" /etc/white-gloss-panel/release-target
rm -f -- "$marker"
trap - EXIT
active=$(/usr/local/sbin/white-gloss-panel-release status)
[[ $active =~ ^[a-f0-9]{40}$ ]] || { echo 'Aktiver Panelcommit konnte nicht bestätigt werden.' >&2; exit 1; }
printf 'Hostinger-CI eingerichtet. Aktiver Panelcommit: %s\n' "$active"
printf 'Kein neuer Release installiert. GitHub-Secrets und Repository-Variable jetzt gemäß docs/Hostinger-Umzug.md setzen.\n'
