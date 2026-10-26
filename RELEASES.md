# Releases

One row per deployment to Freebuff Sites. A release is listed only after the
post-deploy smoke test (`npm run smoke -- <url>`) has run against that URL, so
a row is evidence the published site answered, not just that an upload
finished.

**Build** is the gate's content hash from `dist/build.json`, written by
`npm run release`. **Tag** is the release those bytes ship as, read from
`dist/build.json`: the build bakes it into `/api/health`, so the row and the
live site say the same thing. The build resolves it as the tag whose inputs are
its own, so bytes cut at the tag read `v1.0.0` even when the deploy is logged a
couple of commits later, and a tree past its tag with a changed input keeps the
`v1.0.0-2-gabc1234` form. A build no tag describes — an untagged branch, an
input changed since the tag, an uncommitted edit — logs `—`, which is a fact
rather than a gap. **Node** is the runtime that produced that build, taken from
the same stamp — so the gate refuses a build made off the pin and the row then
names the version it was made on. Rows logged before a column existed show
`—`: the runtime or the version of those builds was not recorded, and this log
does not invent one. **Smoke** is that run's result; every run includes the
byte-for-byte comparison of the served shell with `dist/client/index.html`.
**Checks** names every check that run made, in order — so a row is evidence that
the footer and health checks happened, not just that a count came back green.
Rows logged before the column existed stop at **Smoke**: their runs made fewer
checks and nothing here can say which. Environment URLs are in
[README.md](README.md#version-102-hosted).

The **Build status** line above the table is the drift flag: it compares
`dist/build.json` with the newest build in the table, names both hashes when
they differ, and says outright that the build on disk has not been deployed and
logged. `npm run release` refreshes it, so a rebuild shows up immediately as
*not yet deployed*; `npm run release:log` refreshes it after a deploy; and
`npm run release:log -- --status` refreshes it without deploying anything.

`npm run release:check` is the CI form. It is read-only and exits non-zero
when the newest logged build is not `dist/build.json`, when that row does not
record the Node that built it — a dash where a version belongs — when that row
has no tag column at all, when that row does not name the smoke checks it made
or names a set the suite no longer makes, or when the status line is missing or
stale. A freshly written mismatch line is still a failure: an honest warning is
not a deployment. The Node, tag and check rules bind only to the row for the
current build, and a dashed tag on that row passes: a build can ship before any
tag names it. The dashes and short rows on older rows are history, not drift.

> **Build status:** `dist/build.json` is `ae12da6ac2db`, which matches the newest logged build.

| Deployed (UTC) | Environment | Build | Tag | Node | Smoke | Checks |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-26 02:51 | production | `ae12da6ac2db` — 1.0.2, built 02:50 | v1.0.2 | v24.17.0 | 15/15 | shell, deployment, bundle, styles, route /directory, route /tool/ghidra, route /rack, route /safety, route /cosg, route /cosg/worksheet, cover, health, footer, export, export empty |
| 2026-10-26 02:51 | preview | `ae12da6ac2db` — 1.0.2, built 02:50 | v1.0.2 | v24.17.0 | 15/15 | shell, deployment, bundle, styles, route /directory, route /tool/ghidra, route /rack, route /safety, route /cosg, route /cosg/worksheet, cover, health, footer, export, export empty |
| 2026-10-26 01:23 | production | `71ff1b4f67a7` — 1.0.1, built 01:22 | v1.0.1 | v24.17.0 | 14/14 |
| 2026-10-26 01:23 | preview | `71ff1b4f67a7` — 1.0.1, built 01:22 | v1.0.1 | v24.17.0 | 14/14 |
| 2026-10-25 23:30 | preview | `5c17c5487276` — 1.0.0, built 23:27 | v1.0.0-4-g7bfd380 | v24.17.0 | 14/14 |
| 2026-10-25 23:30 | production | `5c17c5487276` — 1.0.0, built 23:27 | v1.0.0-4-g7bfd380 | v24.17.0 | 14/14 |
| 2026-10-25 22:09 | preview | `267de9ddf693` — 1.0.0, built 20:49 | v1.0.0 | v24.17.0 | 14/14 |
| 2026-10-25 20:51 | production | `267de9ddf693` — 1.0.0, built 20:49 | v1.0.0 | v24.17.0 | 14/14 |
| 2026-10-25 16:54 | production | `307b1cc03a98` — 1.0.0, built 16:54 | — | v24.17.0 | 14/14 |
| 2026-10-25 16:54 | preview | `307b1cc03a98` — 1.0.0, built 16:54 | — | v24.17.0 | 14/14 |
| 2026-10-25 16:45 | production | `4be18bd0f4be` — 1.0.0, built 16:44 | — | — | 14/14 |
| 2026-10-25 16:45 | preview | `4be18bd0f4be` — 1.0.0, built 16:44 | — | — | 14/14 |
| 2026-10-25 16:38 | production | `f4aeddfc6962` — 1.0.0, built 16:37 | — | — | 14/14 |
| 2026-10-25 16:38 | preview | `f4aeddfc6962` — 1.0.0, built 16:37 | — | — | 14/14 |
| 2026-10-25 16:19 | production | `334ffbe307a9` — 1.0.0, built 16:19 | — | — | 14/14 |
| 2026-10-25 16:19 | preview | `334ffbe307a9` — 1.0.0, built 16:19 | — | — | 14/14 |
| 2026-10-25 05:18 | production | `362b716d12f4` — 1.0.0, built 05:17 | — | — | 14/14 |
| 2026-10-25 05:18 | preview | `362b716d12f4` — 1.0.0, built 05:17 | — | — | 14/14 |
| 2026-10-25 05:14 | production | `a600b114b0ee` — 1.0.0, built 05:12 | — | — | 14/14 |
| 2026-10-25 05:14 | preview | `a600b114b0ee` — 1.0.0, built 05:12 | — | — | 14/14 |
| 2026-10-24 21:36 | production | `853089c7ad64` — 1.0.0, built 21:35 | — | — | 14/14 |
| 2026-10-24 21:35 | preview | `853089c7ad64` — 1.0.0, built 21:35 | — | — | 14/14 |
| 2026-10-24 21:29 | production | `935e02c6b357` — 1.0.0, built 21:28 | — | — | 14/14 |
| 2026-10-24 21:28 | preview | `935e02c6b357` — 1.0.0, built 21:28 | — | — | 14/14 |
| 2026-10-24 21:18 | production | `429051402764` — 1.0.0, built 21:13 | — | — | 14/14 |
| 2026-10-24 20:31 | preview | served shell `6d49ada3b198`; build stamp not recorded (log started later) | — | 14/14 |

Latest deployment receipts: preview `e9a6f34b-e339-4294-90e0-b9a82e285cdf`,
production `6835613c-cc0c-4eba-bc50-d14dc394eb8e` (earlier: `104ad627…`,
`2e0a1a1a…`, `4a1b4db1…`). Both environments serve the `ae12da6ac2db` build,
whose shell hash is `dcb0090bd0d1` — the served page and
`dist/client/index.html` hash the same, which is what the smoke test asserts.

## Recording a release

```sh
npm run release:log -- production                      # smoke it, then log it
npm run release:log -- preview --at "2026-10-24 21:18"  # name the deploy time
npm run release:log -- production --url https://…       # another deployment
npm run release:log -- --status                         # refresh the drift flag
npm run release:check                                   # CI: log and build must agree
```

The command runs the same smoke test against the environment, reads the build
hash and runtime from `dist/build.json` — so the row names the build the gate
approved and the Node it was built on — and puts the row at the top of the
table. Re-logging an older row is how a dash is replaced with a version, since
the stamp of a build made now still records its runtime. A build that is already logged for
that environment is updated in place and keeps its deployment time: a re-check
is not a new deployment. A failure is written down too, with the checks that
failed, and the command exits non-zero so a bad release is not mistaken for a
good one. The timestamp is the moment the command ran; `--at` records the
actual deploy time instead.

The deploy itself is a Sites operation, not a CLI step, so the command records
what it can observe: the URL that answered, the build in `dist/`, and the
result.
