#!/usr/bin/env bash
# Install the local apt mirror of the Freebuff desktop package.
#
# After this runs, `sudo apt update && sudo apt upgrade` keeps the desktop app
# current: a daily systemd timer pulls the vendor's newest deb, checks its
# published sha512, re-signs the index and refreshes apt's lists. Nothing is
# installed behind your back — the timer only makes the upgrade available.
#
# Run it from this directory with sudo:
#
#   sudo ./install.sh             set up, then sync once
#   sudo ./install.sh --no-sync   set up only; the timer syncs on its first run
#
# Re-running is safe: an existing key and repository are reused.
set -euo pipefail

ROOT=/var/lib/freebuff-apt
REPO=$ROOT/repo
GNUPG_ROOT=$ROOT/gnupg
KEYRING=/etc/apt/keyrings/freebuff-local.gpg
SOURCELIST=/etc/apt/sources.list.d/freebuff-local.list
LIB=/usr/local/lib/freebuff-apt
UID_NAME='Freebuff local mirror (this host) <root@localhost>'

sync_now=1
for arg in "$@"; do
  case $arg in
    --no-sync) sync_now=0 ;;
    -h | --help)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '[freebuff-apt] %s\n' "$*"; }
die() {
  printf '[freebuff-apt] error: %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die 'run this with sudo'
[ -f "$(dirname "$0")/sync.sh" ] || die 'sync.sh is missing beside install.sh'
for tool in gpg dpkg-scanpackages apt-ftparchive curl dpkg-deb; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required (apt install dpkg-dev apt-utils gnupg curl)"
done

here=$(cd "$(dirname "$0")" && pwd)

install -d -m 0755 "$ROOT" "$REPO"
install -d -m 0700 "$GNUPG_ROOT"
install -d -m 0755 /etc/apt/keyrings "$LIB"

# The key that signs this host's index. Generated once and kept root-only: if it
# is replaced, regenerate the keyring below or apt will reject every refresh.
if [ -z "$(GNUPGHOME=$GNUPG_ROOT gpg --batch --list-secret-keys --with-colons 2>/dev/null | awk -F: '/^fpr/{print $10; exit}')" ]; then
  log 'generating the mirror signing key'
  GNUPGHOME=$GNUPG_ROOT gpg --batch --passphrase '' --quick-gen-key "$UID_NAME" rsa3072 sign never >/dev/null 2>&1 ||
    die 'could not generate the signing key'
else
  log 'reusing the existing signing key'
fi

GNUPGHOME=$GNUPG_ROOT gpg --batch --export >"$KEYRING.new"
[ -s "$KEYRING.new" ] || die 'the signing key exported to nothing'
chmod 0644 "$KEYRING.new"
mv -f "$KEYRING.new" "$KEYRING"

printf 'deb [signed-by=%s arch=amd64] file:%s ./\n' "$KEYRING" "$REPO" >"$SOURCELIST"
chmod 0644 "$SOURCELIST"

install -m 0755 "$here/sync.sh" "$LIB/sync.sh"

cat >/etc/systemd/system/freebuff-apt.service <<'UNIT'
[Unit]
Description=Refresh the local apt mirror of the Freebuff desktop package
Documentation=file:///var/lib/freebuff-apt
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/lib/freebuff-apt/sync.sh
# A failed download leaves the previous index in place; it is not fatal here.
SuccessExitStatus=0
UNIT

cat >/etc/systemd/system/freebuff-apt.timer <<'UNIT'
[Unit]
Description=Daily refresh of the local apt mirror of the Freebuff desktop package

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now freebuff-apt.timer >/dev/null
log 'timer enabled: freebuff-apt.timer (daily)'

if [ "$sync_now" -eq 1 ]; then
  "$LIB/sync.sh"
fi

log "installed — $SOURCELIST points at $REPO"
log 'uninstall with sudo ./uninstall.sh'
