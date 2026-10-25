#!/usr/bin/env bash
set -euo pipefail
umask 077

required=(PANEL_HOSTINGER_HOST PANEL_HOSTINGER_PORT PANEL_HOSTINGER_SSH_KEY PANEL_HOSTINGER_KNOWN_HOSTS)
missing=()
for name in "${required[@]}"; do
    [[ -n ${!name:-} ]] || missing+=("$name")
done
if ((${#missing[@]})); then
    printf '::error::Hostinger-Veröffentlichung blockiert. GitHub Actions Secrets fehlen: %s\n' "${missing[*]}" >&2
    exit 1
fi
[[ ${GITHUB_ACTIONS:-} == true && ${GITHUB_REPOSITORY:-} == White-Gloss/white-gloss-panel && ${GITHUB_REF:-} == refs/heads/main ]] || { echo 'Nur im freigegebenen GitHub-Hauptbranch ausführen.' >&2; exit 1; }
[[ $PANEL_HOSTINGER_HOST =~ ^[A-Za-z0-9.-]+$ && $PANEL_HOSTINGER_HOST != 217.154.124.239 ]] || { echo 'Unerwartetes Hostinger-Panelziel.' >&2; exit 1; }
[[ $PANEL_HOSTINGER_PORT =~ ^[1-9][0-9]{0,4}$ ]] && ((PANEL_HOSTINGER_PORT<=65535)) || { echo 'Ungültiger SSH-Port.' >&2; exit 1; }
commit=$(git rev-parse HEAD)
[[ $commit =~ ^[a-f0-9]{40}$ && $commit == "${GITHUB_SHA:-}" ]] || { echo 'Workflow und ausgecheckter Commit stimmen nicht überein.' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Nur einen sauberen Git-Stand veröffentlichen.' >&2; exit 1; }

latest_main() {
    local latest
    latest=$(gh api repos/White-Gloss/white-gloss-panel/git/ref/heads/main --jq .object.sha)
    [[ $latest =~ ^[a-f0-9]{40}$ ]] || return 1
    if [[ $latest != "$commit" ]]; then
        echo '::notice::Dieser Commit wurde durch einen neueren Hauptbranch-Stand ersetzt; kein Release ausgeführt.'
        if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
            printf 'Hostinger-Release für `%s` übersprungen: neuerer Hauptbranch vorhanden.\n' "$commit" >> "$GITHUB_STEP_SUMMARY"
        fi
        return 2
    fi
}
if latest_main; then :; else code=$?; [[ $code == 2 ]] && exit 0; exit "$code"; fi

temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
printf '%s\n' "$PANEL_HOSTINGER_SSH_KEY" > "$temporary/key"
printf '%s\n' "$PANEL_HOSTINGER_KNOWN_HOSTS" > "$temporary/known_hosts"
unset PANEL_HOSTINGER_SSH_KEY PANEL_HOSTINGER_KNOWN_HOSTS
ssh_options=(-i "$temporary/key" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$temporary/known_hosts" -o GlobalKnownHostsFile=/dev/null -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -o LogLevel=ERROR)
destination="white-gloss-ci@$PANEL_HOSTINGER_HOST"
remote() { ssh -p "$PANEL_HOSTINGER_PORT" "${ssh_options[@]}" "$destination" sudo -n /usr/local/sbin/white-gloss-panel-release "$@"; }
if ! previous=$(remote status); then
    echo 'Hostinger-Releasehilfe oder CI-Zugang fehlt. Zuerst deploy/install-hostinger-ci.sh auf dem VPS ausführen.' >&2
    exit 1
fi
[[ $previous =~ ^[a-f0-9]{40}$ ]] || { echo 'Aktiver Panel-Commit konnte nicht eindeutig geprüft werden.' >&2; exit 1; }
printf 'Aktiver Panel-Commit vor Veröffentlichung: %s\n' "$previous"

archive="$temporary/white-gloss-panel-$commit.tar.gz"
node scripts/package-ionos.mjs "$archive" > "$temporary/package.json"
archive_hash=$(sha256sum "$archive")
archive_hash=${archive_hash%% *}
if [[ $previous != "$commit" ]]; then
    remote_archive="/home/white-gloss-ci/white-gloss-panel-$commit.tar.gz"
    scp -P "$PANEL_HOSTINGER_PORT" "${ssh_options[@]}" "$archive" "$destination:$remote_archive"
    # A queued older workflow must not replace a newer main release.
    if latest_main; then :; else code=$?; [[ $code == 2 ]] && exit 0; exit "$code"; fi
    remote install "$remote_archive" "$archive_hash" "$commit"
fi
active=$(remote status)
[[ $active == "$commit" ]] || { echo 'Der aktive Panel-Commit stimmt nicht mit dem geprüften Commit überein.' >&2; exit 1; }

curl_options=(--proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 30 --retry 2)
curl "${curl_options[@]}" --dump-header "$temporary/health.headers" --output "$temporary/health.body" "https://panel.white-gloss.de/healthz?release=$commit"
[[ $(< "$temporary/health.body") == ok ]] || { echo 'Öffentliche Panel-Gesundheitsprüfung fehlgeschlagen.' >&2; exit 1; }
live_commit=$(awk 'tolower($1)=="x-panel-commit:" {gsub("\r", "", $2); print $2}' "$temporary/health.headers")
[[ $live_commit == "$commit" ]] || { echo 'Die öffentliche HTTPS-Antwort bestätigt den Release-Commit nicht.' >&2; exit 1; }
curl "${curl_options[@]}" --output "$temporary/login.html" https://panel.white-gloss.de/auth/login
[[ $(< "$temporary/login.html") == *'White Gloss'* ]] || { echo 'Panel-Anmeldung nicht erreichbar.' >&2; exit 1; }
for asset in app.js premium.js premium.css agency.css; do
    curl "${curl_options[@]}" --output "$temporary/$asset" "https://panel.white-gloss.de/$asset?release=$commit"
    cmp --silent "dist/client/$asset" "$temporary/$asset" || { echo "Öffentliche Paneldatei stimmt nicht überein: $asset" >&2; exit 1; }
done
printf 'Hostinger-Panel veröffentlicht und über HTTPS geprüft: %s\n' "$commit"
if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf 'Panel-Commit `%s` auf Hostinger aktiv. HTTPS, Commitheader, Anmeldung, Premium-Assets, Dienste und Timer geprüft.\n' "$commit" >> "$GITHUB_STEP_SUMMARY"
fi
