#!/usr/bin/env bash
# Remove the local Freebuff apt mirror: timer, unit, apt source, keyring and the
# staged debs. The Freebuff desktop package itself is left installed — this only
# stops the mirror from offering upgrades.
#
#   sudo ./uninstall.sh
set -euo pipefail

ROOT=/var/lib/freebuff-apt
KEYRING=/etc/apt/keyrings/freebuff-local.gpg
SOURCELIST=/etc/apt/sources.list.d/freebuff-local.list
LIB=/usr/local/lib/freebuff-apt

log() { printf '[freebuff-apt] %s\n' "$*"; }
die() {
  printf '[freebuff-apt] error: %s\n' "$*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die 'run this with sudo'

if systemctl list-unit-files freebuff-apt.timer >/dev/null 2>&1; then
  systemctl disable --now freebuff-apt.timer >/dev/null 2>&1 || true
fi
rm -f /etc/systemd/system/freebuff-apt.timer /etc/systemd/system/freebuff-apt.service
systemctl daemon-reload

rm -f "$SOURCELIST" "$KEYRING"
rm -rf "$LIB" "$ROOT"

apt-get update -qq || log 'apt update reported a problem; run it by hand to see why'
log 'mirror removed; the freebuff package stays installed'
