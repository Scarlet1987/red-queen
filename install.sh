#!/bin/sh
# Red Queen — one command, no ceremony.
#
#   ./install.sh
#   ./install.sh --mode sandbox --no-launch
#   curl -fsSL https://raw.githubusercontent.com/Scarlet1987/red-queen/main/install.sh | sh
#
# Installs from the checkout this script sits in, or from the directory you are
# standing in. With neither — the piped one-liner, or a shell opened somewhere
# else — it clones the repository first. Then it installs, starts the app and
# opens it, so one command is the whole thing.
#
# A clone takes the tagged release (DEFAULT_REF), not the tip of main, so an
# install run today and one run next month are the same program. Pass --ref main
# to follow the branch instead.
#
# Options:
#   --mode metal|sandbox|vm   which install to create (default: metal)
#   --prefix DIR              where the installs live (default: ~/.red-queen)
#   --source DIR              where to clone when there is no checkout
#                             (default: ~/.red-queen-src)
#   --repo URL                what to clone (default: RED_QUEEN_REPO or the
#                             repository above)
#   --ref REF                 branch or tag to clone (default: v1.0.0)
#   --no-service              install without the boot-time systemd unit
#   --no-launch               do not start the app or open a browser
#
# Environment: RED_QUEEN_REPO, RED_QUEEN_REF, RED_QUEEN_SRC, RED_QUEEN_PREFIX.
set -eu

DEFAULT_REPO=https://github.com/Scarlet1987/red-queen.git
DEFAULT_REF=v1.0.0

mode=metal
prefix=${RED_QUEEN_PREFIX:-"$HOME/.red-queen"}
source_dir=${RED_QUEEN_SRC:-"$HOME/.red-queen-src"}
repo=${RED_QUEEN_REPO:-$DEFAULT_REPO}
ref=${RED_QUEEN_REF:-$DEFAULT_REF}
service=1
launch=1

step() { printf '\n==> %s\n' "$*"; }
say() { printf '    %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Red Queen installer. One command: install from here, or clone and install.

  ./install.sh [options]
  curl -fsSL https://raw.githubusercontent.com/Scarlet1987/red-queen/main/install.sh | sh -s -- [options]

  --mode metal|sandbox|vm   which install to create (default: metal)
  --prefix DIR              where the installs live (default: ~/.red-queen)
  --source DIR              where to clone when there is no checkout
  --repo URL                what to clone (default: $DEFAULT_REPO)
  --ref REF                 branch or tag to clone (default: $DEFAULT_REF)
  --no-service              install without the boot-time systemd unit
  --no-launch               do not start the app or open a browser
  -h, --help                this text

Environment: RED_QUEEN_REPO, RED_QUEEN_REF, RED_QUEEN_SRC, RED_QUEEN_PREFIX.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      [ $# -ge 2 ] || die "--mode needs a value: metal, sandbox or vm"
      mode=$2
      shift 2
      ;;
    --prefix)
      [ $# -ge 2 ] || die "--prefix needs a directory"
      prefix=$2
      shift 2
      ;;
    --source)
      [ $# -ge 2 ] || die "--source needs a directory"
      source_dir=$2
      shift 2
      ;;
    --repo)
      [ $# -ge 2 ] || die "--repo needs a URL"
      repo=$2
      shift 2
      ;;
    --ref)
      [ $# -ge 2 ] || die "--ref needs a branch or tag"
      ref=$2
      shift 2
      ;;
    --no-service) service=0; shift ;;
    --no-launch) launch=0; shift ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown option %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$mode" in
  metal | sandbox | vm) ;;
  *) die "unknown mode \"$mode\": use metal, sandbox or vm" ;;
esac

# A checkout is: package.json and the installer it drives. Both together, so a
# stray package.json elsewhere cannot be mistaken for the program.
usable() {
  [ -n "${1:-}" ] && [ -f "$1/package.json" ] && [ -f "$1/scripts/red-queen.ts" ]
}

# $0 is this script when it runs as a file, and "sh" when it is piped.
script_dir=
if [ -f "$0" ]; then
  script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || script_dir=
fi

if usable "$script_dir"; then
  checkout=$script_dir
elif usable "$(pwd)"; then
  checkout=$(pwd)
else
  checkout=
fi

if [ -z "$checkout" ]; then
  # Nothing to install from: the repository is the source of truth.
  command -v git >/dev/null 2>&1 || die "no checkout here and git is missing. Install git, or clone $repo yourself and run install.sh from it."

  case "$source_dir" in
    "$prefix" | "$prefix"/*)
      die "--source may not live inside --prefix ($prefix): uninstall clears that directory."
      ;;
  esac

  if [ -e "$source_dir" ]; then
    [ -d "$source_dir/.git" ] || die "$source_dir exists and is not a git checkout. Move it, or pass --source somewhere else."

    step "Updating the checkout in $source_dir"
    git -C "$source_dir" fetch --depth 1 origin "$ref" || die "could not fetch $ref from $repo. Check the URL and your connection, then run this again."
    git -C "$source_dir" checkout -f --detach FETCH_HEAD >/dev/null 2>&1 || die "could not check out $ref in $source_dir."
  else
    step "Cloning $repo ($ref) into $source_dir"
    mkdir -p "$(dirname -- "$source_dir")"
    git clone --depth 1 --branch "$ref" "$repo" "$source_dir" || die "could not clone $repo. Check the URL and your connection, or pass --repo with the right one."
  fi
  checkout=$source_dir
else
  step "Installing from $checkout"
fi

# The build refuses a wrong runtime on its own; this fails earlier and with a
# shorter explanation, before a dependency install.
command -v node >/dev/null 2>&1 || die "Node is not installed. Red Queen needs the version in .nvmrc (24) — install it from nodejs.org or with nvm, then run this again."
want=$(head -n 1 "$checkout/.nvmrc" 2>/dev/null | tr -d 'v	 ' || true)
[ -n "${want:-}" ] || want=24
have=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$have" -ge "${want%%.*}" ] 2>/dev/null || die "Node $want is required; this shell has $(node -v). Run 'nvm use' in $checkout and try again."

marker="$prefix/$mode/install.json"
installed_now=1
if [ -f "$marker" ]; then
  installed_now=0
  step "Already installed at $prefix/$mode"
  say "Using it as it is. To install fresh, uninstall first:"
  say "  $prefix/$mode/red-queen uninstall"
else
  step "Installing Red Queen ($mode) into $prefix/$mode"

  if [ ! -x "$checkout/node_modules/.bin/vite" ]; then
    command -v npm >/dev/null 2>&1 || die "npm is missing; install Node (which brings npm) and run this again."
    if [ -f "$checkout/package-lock.json" ]; then
      (cd "$checkout" && npm ci) || die "the dependency install failed; nothing was installed."
    else
      (cd "$checkout" && npm install) || die "the dependency install failed; nothing was installed."
    fi
  fi

  set -- install --mode "$mode" --prefix "$prefix"
  [ "$service" -eq 1 ] || set -- "$@" --no-service
  (cd "$checkout" && node scripts/red-queen.ts "$@") || die "the install failed; see the message above."
fi

port=$(sed -n 's/.*"port": *\([0-9][0-9]*\).*/\1/p' "$marker" | head -n 1)
[ -n "${port:-}" ] || port=4317
url="http://127.0.0.1:$port"

if [ "$launch" -eq 1 ]; then
  # A second click should bring the app up, not start a second copy that cannot
  # bind the port.
  up=0
  if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    up=1
    step "Already running at $url"
  else
    step "Starting it"
    if [ "$mode" = metal ] && command -v systemctl >/dev/null 2>&1 && systemctl --user is-enabled red-queen.service >/dev/null 2>&1; then
      systemctl --user start red-queen.service 2>/dev/null || true
    fi
    if ! curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      # No unit to lean on: run the launcher detached, with its output kept
      # inside the install directory so uninstall takes the log with it.
      (cd "$prefix/$mode" && nohup ./red-queen start >"$prefix/$mode/red-queen.log" 2>&1 &)
    fi

    # Give it a moment before the browser asks, so the first paint is the app
    # and not a connection error. Only when curl is there to ask with.
    if command -v curl >/dev/null 2>&1; then
      tries=0
      while [ "$tries" -lt 40 ]; do
        curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && break
        tries=$((tries + 1))
        sleep 0.25
      done
      [ "$tries" -lt 40 ] || printf '    it has not answered yet; give it a moment at %s\n' "$url"
    fi
  fi

  for opener in xdg-open open wslview; do
    if command -v "$opener" >/dev/null 2>&1; then
      "$opener" "$url" >/dev/null 2>&1 && break
    fi
  done
fi

# The installer already ends with a blank line when it ran; do not add a second.
[ "$installed_now" -eq 1 ] || printf '\n'
printf 'Red Queen · %s\n' "$mode"
printf '  address   %s\n' "$url"
printf '  start     %s/%s/red-queen start\n' "$prefix" "$mode"
printf '  status    %s/%s/red-queen status\n' "$prefix" "$mode"
# Only advertise the service commands when this install actually registered one.
if [ "$mode" = metal ] && ! grep -q '"service": null' "$marker"; then
  printf '  service   %s/%s/red-queen service [start|stop|enable|disable]\n' "$prefix" "$mode"
fi
printf '  uninstall %s/%s/red-queen uninstall\n' "$prefix" "$mode"
if [ "$launch" -eq 0 ]; then
  printf '\nInstall only. Start it when you want it.\n'
fi
