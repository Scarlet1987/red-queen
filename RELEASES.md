# Releases

One row per deployment to Freebuff Sites. A release is listed only after the
post-deploy smoke test (`npm run smoke -- <url>`) has run against that URL, so
a row is evidence the published site answered, not just that an upload
finished.

**Build** is the gate's content hash from `dist/build.json`, written by
`npm run release`. **Node** is the runtime that produced that build, taken from
the same stamp — so the gate refuses a build made off the pin and the row then
names the version it was made on. Rows logged before the column existed show
`—`: the runtime of those builds was not recorded, and this log does not invent
one. **Smoke** is that run's result; every run includes the byte-for-byte
comparison of the served shell with `dist/client/index.html`.
Environment URLs are in [README.md](README.md#version-10-hosted).

The **Build status** line above the table is the drift flag: it compares
`dist/build.json` with the newest build in the table, names both hashes when
they differ, and says outright that the build on disk has not been deployed and
logged. `npm run release` refreshes it, so a rebuild shows up immediately as
*not yet deployed*; `npm run release:log` refreshes it after a deploy; and
`npm run release:log -- --status` refreshes it without deploying anything.

`npm run release:check` is the CI form. It is read-only and exits non-zero
when the newest logged build is not `dist/build.json`, when that row does not
record the Node that built it — a dash where a version belongs — or when the
status line is missing or stale. A freshly written mismatch line is still a
failure: an honest warning is not a deployment. The Node rule binds only to the
row for the current build; the dashes on older rows are history, not drift.

> **Build status:** `dist/build.json` is `267de9ddf693`, which matches the newest logged build.

| Deployed (UTC) | Environment | Build | Node | Smoke |
| --- | --- | --- | --- | --- |
| 2026-10-25 20:51 | production | `267de9ddf693` — 1.0.0, built 20:49 | v24.17.0 | 14/14 |
| 2026-10-25 16:54 | production | `307b1cc03a98` — 1.0.0, built 16:54 | v24.17.0 | 14/14 |
| 2026-10-25 16:54 | preview | `307b1cc03a98` — 1.0.0, built 16:54 | v24.17.0 | 14/14 |
| 2026-10-25 16:45 | production | `4be18bd0f4be` — 1.0.0, built 16:44 | — | 14/14 |
| 2026-10-25 16:45 | preview | `4be18bd0f4be` — 1.0.0, built 16:44 | — | 14/14 |
| 2026-10-25 16:38 | production | `f4aeddfc6962` — 1.0.0, built 16:37 | — | 14/14 |
| 2026-10-25 16:38 | preview | `f4aeddfc6962` — 1.0.0, built 16:37 | — | 14/14 |
| 2026-10-25 16:19 | production | `334ffbe307a9` — 1.0.0, built 16:19 | — | 14/14 |
| 2026-10-25 16:19 | preview | `334ffbe307a9` — 1.0.0, built 16:19 | — | 14/14 |
| 2026-10-25 05:18 | production | `362b716d12f4` — 1.0.0, built 05:17 | — | 14/14 |
| 2026-10-25 05:18 | preview | `362b716d12f4` — 1.0.0, built 05:17 | — | 14/14 |
| 2026-10-25 05:14 | production | `a600b114b0ee` — 1.0.0, built 05:12 | — | 14/14 |
| 2026-10-25 05:14 | preview | `a600b114b0ee` — 1.0.0, built 05:12 | — | 14/14 |
| 2026-10-24 21:36 | production | `853089c7ad64` — 1.0.0, built 21:35 | — | 14/14 |
| 2026-10-24 21:35 | preview | `853089c7ad64` — 1.0.0, built 21:35 | — | 14/14 |
| 2026-10-24 21:29 | production | `935e02c6b357` — 1.0.0, built 21:28 | — | 14/14 |
| 2026-10-24 21:28 | preview | `935e02c6b357` — 1.0.0, built 21:28 | — | 14/14 |
| 2026-10-24 21:18 | production | `429051402764` — 1.0.0, built 21:13 | — | 14/14 |
| 2026-10-24 20:31 | preview | served shell `6d49ada3b198`; build stamp not recorded (log started later) | — | 14/14 |

Latest deployment receipts: preview `4a1b4db1-61bd-4d71-b378-c3d79ce2ed35`,
production `dd733c2c-8efc-4736-b06f-223ce4520bd9` (earlier: `a23b6818…`,
`97779ca2…`, `525b73ab`, `0c4ef9f6…`). Both environments serve the
`853089c7ad64` build, whose shell hash is `065e4f51976a`.

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
