#!/usr/bin/env bash
# Refresh the local apt mirror of the Freebuff desktop package.
#
# The vendor publishes no apt repository, only a deb per release and an
# electron-updater feed that names the newest one with its sha512. This script
# turns that feed into a repository apt understands: download the newest deb,
# check it against the published hash, rebuild Packages/Release and sign them.
#
# The signing key is generated on this host (see install.sh). It proves the
# index was assembled here and has not been edited since; it does not prove
# Freebuff, Inc. produced the package. That claim rests on the HTTPS feed and
# the sha512 the vendor publishes, which is what this script verifies.
#
#   sync.sh              fetch, verify, re-index and refresh apt's lists
#   sync.sh --no-fetch   re-index whatever debs are already staged
set -euo pipefail

FEED=${FREEBUFF_APT_FEED:-https://freebuff.com/api/desktop/updates/linux-x64-deb/latest-linux.yml}
ROOT=${FREEBUFF_APT_ROOT:-/var/lib/freebuff-apt}
KEYRING=${FREEBUFF_APT_KEYRING:-/etc/apt/keyrings/freebuff-local.gpg}
SOURCELIST=${FREEBUFF_APT_SOURCELIST:-/etc/apt/sources.list.d/freebuff-local.list}
REPO=$ROOT/repo
GNUPG_ROOT=$ROOT/gnupg

no_fetch=0
for arg in "$@"; do
  case $arg in
    --no-fetch) no_fetch=1 ;;
    -h | --help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
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

[ -d "$REPO" ] || die "no repository at $REPO — run install.sh first"
[ -d "$GNUPG_ROOT" ] || die "no signing key under $GNUPG_ROOT — run install.sh first"
export GNUPGHOME=$GNUPG_ROOT

key=$(gpg --batch --list-secret-keys --with-colons 2>/dev/null | awk -F: '/^fpr/{print $10; exit}')
[ -n "${key:-}" ] || die "no secret key in $GNUPG_ROOT — run install.sh first"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ "$no_fetch" -eq 0 ]; then
  log "reading $FEED"
  curl -fsSL --retry 3 --retry-delay 2 -o "$tmp/feed.yml" "$FEED" || die "could not read the update feed"

  version=$(sed -n 's/^version: *//p' "$tmp/feed.yml" | head -1)
  file=$(sed -n 's/^path: *//p' "$tmp/feed.yml" | head -1)
  want=$(sed -n 's/^sha512: *//p' "$tmp/feed.yml" | head -1)
  [ -n "$version" ] && [ -n "$file" ] && [ -n "$want" ] || die "the feed did not name a version, file and hash"

  installed=$(dpkg-query -W -f='${Version}' freebuff 2>/dev/null || echo 'not installed')
  log "feed says $version ($(numfmt --to=iec --suffix=B "$(sed -n 's/^ *size: *//p' "$tmp/feed.yml" | head -1)" 2>/dev/null || echo 'unknown size')); installed $installed"

  if [ -f "$REPO/$file" ]; then
    log "already staged: $file"
  else
    base=${FEED%/*}
    log "downloading $file"
    curl -fL --retry 3 --retry-delay 2 -o "$tmp/$file" "$base/$file" || die "download failed"

    printf '%s  %s\n' "$want" "$tmp/$file" | sha512sum -c - >/dev/null 2>&1 || die "sha512 mismatch for $file — refusing to stage it"
    log "sha512 matches the feed"

    pkg=$(dpkg-deb -f "$tmp/$file" Package 2>/dev/null || true)
    arch=$(dpkg-deb -f "$tmp/$file" Architecture 2>/dev/null || true)
    [ "$pkg" = 'freebuff' ] || die "$file is not a freebuff package (Package: ${pkg:-none})"
    [ "$arch" = 'amd64' ] || die "$file is not amd64 (Architecture: ${arch:-none})"

    install -m 0644 "$tmp/$file" "$REPO/$file"
    log "staged $file"
  fi

  # One version is enough: apt can only install the newest, and each deb is
  # about 130 MB. Older ones go as soon as their replacement lands.
  for old in "$REPO"/*.deb; do
    [ -e "$old" ] || continue
    [ "$(basename "$old")" = "$file" ] || rm -f -- "$old"
  done
fi

[ -n "$(ls -A "$REPO"/*.deb 2>/dev/null)" ] || die "no packages staged in $REPO"

log 'rebuilding the index'
(
  cd "$REPO"
  # One package, fixed section: an override file keeps scanpackages quiet.
  printf 'freebuff optional net\n' >override
  dpkg-scanpackages . override >Packages.new
  mv -f Packages.new Packages
  gzip -9nc Packages >Packages.gz

  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=Freebuff \
    -o APT::FTPArchive::Release::Label='Freebuff Desktop (local mirror)' \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Codename=stable \
    -o APT::FTPArchive::Release::Architectures=amd64 \
    -o APT::FTPArchive::Release::Description='Local mirror of the Freebuff desktop package feed' \
    release . >Release.new
  mv -f Release.new Release

  gpg --batch --yes --local-user "$key" --digest-algo SHA256 --clearsign -o InRelease Release
  gpg --batch --yes --local-user "$key" --digest-algo SHA256 --armor --detach-sign -o Release.gpg Release
  chmod 0644 override Packages Packages.gz Release InRelease Release.gpg
)

log 'index signed'

# apt's own view of the mirror is only refreshed when this runs as root, and
# only for this one source, so a sync never rewrites other repositories' lists.
if [ "$(id -u)" -eq 0 ] && [ -f "$SOURCELIST" ]; then
  if apt-get update -qq \
    -o Dir::Etc::sourcelist="$SOURCELIST" \
    -o Dir::Etc::sourceparts=- \
    -o APT::Get::List-Cleanup=0; then
    log 'apt lists refreshed — `sudo apt upgrade` will offer the new version'
  else
    log 'apt-get update failed; run `sudo apt update` by hand to see why'
  fi
fi

log "done — keyring $KEYRING"
