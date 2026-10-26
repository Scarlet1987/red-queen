# Freebuff desktop: a local apt mirror

Freebuff ships the desktop app as a `.deb` with no apt repository, so
`apt upgrade` never sees a new version. It does publish an update feed —
`https://freebuff.com/api/desktop/updates/linux-x64-deb/latest-linux.yml` — that
names the newest package, its size and its sha512, and redirects to the release
on GitHub.

These scripts turn that feed into a repository apt can use, so the desktop app
upgrades the way every other package does:

```sh
sudo apt update && sudo apt upgrade        # or: sudo apt install --only-upgrade freebuff
```

## What gets installed

| Path | What it is |
| --- | --- |
| `/var/lib/freebuff-apt/repo` | the mirror: the newest `.deb`, `Packages`, `Release`, `InRelease` |
| `/var/lib/freebuff-apt/gnupg` | the signing key, root-only |
| `/etc/apt/keyrings/freebuff-local.gpg` | that key's public half, what apt checks the index with |
| `/etc/apt/sources.list.d/freebuff-local.list` | `deb [signed-by=…] file:/var/lib/freebuff-apt/repo ./` |
| `/usr/local/lib/freebuff-apt/sync.sh` | the copy the timer runs |
| `freebuff-apt.timer` | daily refresh, with up to an hour of jitter |

## Install

```sh
cd tools/freebuff-apt
sudo ./install.sh
```

It generates the key, writes the source, enables the timer and syncs once. Then:

```sh
apt-cache policy freebuff      # Candidate should be the newest release
sudo apt install --only-upgrade freebuff
```

Re-running `install.sh` is safe; an existing key and mirror are reused.

## What the timer does

`sync.sh`, daily: read the feed, download the deb if its version is not already
staged, check the sha512 against the feed, confirm it really is an `amd64`
`freebuff` package, drop the older deb, rebuild and sign the index, refresh
apt's lists for this source only.

It never installs anything. A release sits in the mirror until you run
`apt upgrade`, which is the difference between "keeps itself current" and
"changes software as root while you sleep".

Anything that fails stops the sync before the index is touched, so the last good
index keeps working:

```sh
sudo /usr/local/lib/freebuff-apt/sync.sh          # sync now
sudo freebuff-apt.timer                           # nothing: use the commands below
systemctl list-timers freebuff-apt.timer          # when it next runs
journalctl -u freebuff-apt.service -n 30          # what the last run did
```

`sync.sh --no-fetch` re-indexes and re-signs whatever is already staged, which is
what to run if the index is ever lost or the key is rotated.

## The trust model, plainly

The signing key is generated on this machine. It proves the index was assembled
here and has not been edited since; it does **not** prove Freebuff, Inc. made the
package. What establishes that is the HTTPS feed at `freebuff.com` and the
sha512 it publishes, which is what `sync.sh` verifies before staging anything.
A real vendor-signed repository would replace this the day one exists; until
then, this is the closest honest equivalent.

Each staged deb is around 130 MB in `/var/lib`. Only the newest is kept.

## Uninstall

```sh
sudo ./uninstall.sh
```

Removes the timer, unit, apt source, keyring and mirror. The installed `freebuff`
package and `/opt/Freebuff` are left alone.
