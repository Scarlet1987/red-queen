# Red Queen

Red Queen is a programming harness with a safe reverse-engineering directory
beside it: **38 tools** across 10 categories, where every entry says what it
does to the file you give it — read it, emulate it, or attach to something live.

The harness opens empty. You point it at a model and at the directory your
project will be seated in, then work in a bench with the preview on one side and
the conversation on the other. The directory stays a catalogue: it hosts no
binaries and runs no samples, and every entry links to the tool's own project
with its licence, platforms and safety level.

- **The harness** (`/`, `/workbench`) — model + project directory, then the
  workbench.
- **The directory** — the same catalogue with search, filters, tool pages and a
  personal shortlist ("rack") you can export as Markdown or JSON.
- `DIRECTORY.md` — the whole catalogue as a Markdown table, readable on GitHub.

## Design rules

Opening a Red Queen screen should feel quiet, not like a cockpit.

- The first screen is setup: one model, one folder, one button. Nothing else
  appears until both are chosen.
- The workbench is two panes and nothing more — a preview you can detach, and
  the conversation. The catalogue is one click away, not the landing page.
- One rail, destinations only: Setup, Workbench, Browse, Rack, COS-G, Worksheet,
  Safety. No settings drawer, no file tree, no second navigation.
- Depth is opt-in: filters, the refine panel and export options stay collapsed
  until asked for, and the directory shows twelve cards at a time.
- Flexibility comes from data, not from more controls: a new tool is one object
  in `src/data/tools.ts`, and your own labels and notes layer on locally.
- The 100 MB cap is for the **base program** — app, catalogue and generated
  covers. It is a ceiling on what every reader downloads, not on how many tools
  or refinements the directory can hold.

## Safety levels

| Level | What it means |
| --- | --- |
| **Static only** | Parses or disassembles the file. The sample never executes. |
| **Sandboxed run** | Executes the sample in an emulator or isolated runtime. Network off, throwaway VM underneath. |
| **Live attach** | Attaches to a running process, device or network. Only ever your own. |

27 entries are static-only, 4 are sandboxed, 7 attach live. The site's safety
page ([Safety.tsx](src/app/pages/Safety.tsx)) carries the full policy: scope,
legality, how entries are checked and what will not be listed.

## Refining an entry

Every tool page has a **Refine** panel. You can change the safety label to match
the way you actually run the tool, and add a note on how it fits your workflow
(command flags, target format, house rules). Refinements are stored in this
browser under `red-queen-refinements`, change the label shown throughout the
directory and filters, and travel with exports — Markdown bullets carry your
note, JSON carries both `safety` and `cataloguedSafety`.

`Reset to catalogue` on a tool, or `Reset all` in the directory, drops your
changes. The catalogue in `src/data/tools.ts` is never modified from the browser.

## Quick jump

<kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> — or the search button in the
header — opens a palette over the pages, the three safety levels and all 38
tools. Arrow keys move, Enter opens, Escape closes. It is the only navigation
added for speed: the header itself keeps two links.

## COS-G — the programming bible

The troubleshooting doctrine lives at `/cosg` and, as a read-only checker, in
`scripts/cosg.ts`:

```sh
npm run cosg -- ../my-project        # C / O / S / G report for that directory
npm run cosg -- . --json             # machine-readable findings
npm run cosg -- . --report cosg.md   # write a Markdown report
npm run cosg -- . --strict           # non-zero exit on any finding
npm run cosg -- --rules              # print the loop for each pass
npm run cosg -- . --host             # G, plus this machine's drivers and DKMS
npm run cosg -- . --host --fix       # those fixes as a script, run nothing
npm run cosg -- . --host --fix f --check   # what those commands cleared
```

Every pass runs the same loop: **define the problem → select one course of
action → test it → implement on success, or take it back through the cycle**.
S adds two steps first — identify the type of syntax error and the file/line it
occurred on — and tests the fix before keeping it. `--rules` prints all four
loops, and the same rules apply to Red Queen's own functions (the `/cosg` page
has an *Own functions* section).

- **C — crash risks**: unguarded `JSON.parse` (detected on the syntax tree, so a
  parse inside `try` is not reported), empty catch blocks, dynamic code,
  unbounded loops, child processes, raw HTML injection, DOM non-null assertions.
- **O — orphaned strings, directories and programs**: follows imports from real
  entry points, then reports unreachable source files, unreferenced public
  assets (literal or dynamic template paths), unused `dependencies`, package
  scripts pointing at missing files, backup copies, stray files and empty dirs.
- **S — syntax errors**: parses every TS/JS file with the compiler's parser and
  every JSON file with `JSON.parse`, plus leftover merge-conflict markers.
- **G — ghosts**: symlinks leaving the tree, git hooks, install lifecycle
  scripts, unignored secrets, executable files, oversized blobs and unknown
  hidden directories at the root.

The checker never executes, edits or deletes what it scans. It exits non-zero
when syntax errors are found; `--strict` makes any finding fail the run.

### Host drivers

`--host` widens G from the tree to the machine under it, read-only: every PCI
device and the driver bound to it, modules blocked in `/etc/modprobe.d/*.conf`,
and DKMS records whose `source/dkms.conf` is gone, the state that makes
`dkms status` fail. A network, storage, display or multimedia
device with no driver is reported once, named after the blacklist that claims it
when a blocked module would have driven it; an ordinary unclaimed bridge is not
a finding, and dkms's empty `kernel-<ver>-<arch>` markers are not mistaken for
version records. Names come from `pci.ids` when the distro ships one.

A DKMS package with no build for the kernel you are running is a warning too:
after a reboot into it, the module would not be there. The rule judges the
package rather than each version, since dkms keeps superseded versions around
and an idle old one is harmless while the current one works; a package whose
every record has lost its source is reported once, as that, and not again.

Two things keep that warning honest. If the kernel's own package already carries
a module the record builds — read from `modules.dep`, counting only paths outside
`updates/` and `extra/`, where dkms writes what it installs — then nothing is
missing and the rule says so by staying quiet: platform drivers move into the
kernel, and the packages that predate the move sit deliberately unbuilt while the
kernel loads its own copy. And if the record itself declares this kernel out of
range with `BUILD_EXCLUSIVE_KERNEL_MIN` or `_MAX`, the build was never asked for,
which is not a build that failed: that is printed as a note rather than a
warning, so it never reaches the cell a release row carries.

A block that is not doing its job is its own ghost. `/proc/modules` is read, so
a module named in `/etc/modprobe.d` that is loaded right now is reported as
`blacklist-ineffective`, with what is holding it: pulled in by a dependency
(which is named), in use, or nothing at all. `blacklist` only stops the
alias-driven autoload, so a softdep, an explicit `modprobe` or a load from
before the file was written all leave the module running — which is why the
finding says whether to unload it or go and fix what loads it. A blocked module
that is not loaded keeps the quieter note that the block is deliberate.

A driver that is loaded and driving nothing is a ghost too: `idle-driver` says
whether its aliases match no device on this machine at all (the hardware it was
loaded for is absent or unplugged) or the hardware it claims is served by
another driver, which is named. Only modules whose aliases claim PCI hardware
are judged, because this sweep enumerates PCI alone — `modules.alias` also maps
USB, platform and serio devices, and a USB driver would look idle for a reason
that is not true. A module that is in use or that something depends on is left
alone: it is not a leftover and could not be unloaded anyway. The driver on a
device is resolved through `driver/module`, since a driver's name is often not
its module's — `i2c_i801` is bound as `i801_smbus`.

The text report counts blacklisted modules per file, because a stock distro
blocks a hundred of them and the list would bury the finding that matters;
`--json` carries the full device, blacklist, loaded-module and DKMS detail. Host findings are
warnings, so `--host` never fails a build — `--strict` is the exception. A
finding with a fix prints the command for it, as a `fix:` line under the finding
in the console and a `Fix:` line in the Markdown report — the same command the
COS-G page offers beside its Copy button, so the terminal and the page hand over
one thing rather than two. `--fix` writes those commands out as a shell script
instead — beside the report when one was asked for — with the finding each one
clears above it, and the warnings no command clears named at the end rather than
left out. The file is written, never run: the sweep reads the machine, and this
is what changes it. `--fix` without `--host` is refused, since there would be no
sweep behind it.

The run also keeps the findings it worked from beside the script, under the same
name — `fixes.json` for `fixes.sh` — so running the same command weeks later
reports what has changed: how many are cleared, which are new, which are still
there, dated from the copy it compared with. Only warnings are kept, since a
note needed no action when it was written and so cannot have been cleared since,
and a copy is only compared with a sweep that could read its machine — an
unreadable copy is replaced and said to be, rather than reported as a machine
that lost all its faults.

`--check` is the run *after* the commands. It sweeps, compares the machine with
the copy, and writes nothing at all — not the script, not the copy — so the same
check can be made again after the next command lands. Every warning the copy
recorded comes back as `gone` or `still`, with the command that was meant to
clear it, alongside anything this sweep found that the copy never knew; the run
exits non-zero while any of them is still there, the way `--strict` exits on any
finding. It does not run the commands: the checker stays read-only, which is why
the answer is "these are cleared" rather than "I cleared these". The comparison
rides along in the JSON (`check: { comparedAt, cleared, stillThere, new, ok }`)
and in the Markdown report, and a check with no copy to compare with is refused
rather than quietly writing one and calling that a comparison. The sweep needs
Linux sysfs and says so plainly, then reports nothing, elsewhere.

The same sweep is what the COS-G page shows. A local install answers `/api/host`
with a sweep of the machine it is running on, so the panel on that page reads the
drivers, the blocks, the idle drivers and the DKMS records without opening a
terminal first. The hosted copy answers the same route in the same shape, saying
that a Worker has no filesystem and therefore no machine to read; a sandbox
install says its confinement is why it cannot look, rather than reporting a host
it never read. It is a section of the page it belongs to — one request, one
button to read again — not another destination to navigate to.

The findings that have a fix carry it as the command that clears it, with a Copy
button and named as needing root where it does: the `modprobe` that binds a
device whose module exists, the `rmmod` that frees an idle or ineffective load,
the move that takes a source-less DKMS record out of `/var/lib/dkms`, and
`sudo dkms autoinstall` for a package with no build for this kernel. A finding
with nothing to run — hardware no module in this kernel claims, a block that is
doing its job — offers no command rather than a guess, and the page never runs
one itself: the sweep stays read-only.

The same sweep runs as part of `npm run release:log`, so every release row
records what the machine that made it reported: `clean — 23 devices on 7.2.6`,
`2 warnings — unbound-hardware, dkms-not-built on 7.2.6`, or
`unavailable — no sysfs`. The kernel is in the cell because "not built for the
running kernel" means nothing without it, months later. The warnings themselves
print during the log and stay in the row; `release:check` refuses a row that is
blank there, since a release whose host was never looked at is not the whole
story of what shipped.

### Worksheet

`/cosg/worksheet` walks one finding through **Define → Act → Test → Decide**:
the pass, the definition and evidence, one course of action, the test and its
result, then the outcome (implemented, or back through the cycle) plus notes.
Everything is saved in this browser under `red-queen-cosg-worksheets` and
exports as `cosg-worksheet.md`, designed to sit beside the checker's
`cosg-report.md`. Nothing is uploaded and nothing is executed.

## The extended bible

`/cosg/bible` carries the rest of the doctrine, and `--rules` prints its index:

**Three laws**

1. **Zero-parasite, anti-bloat** — every line, dependency, service and asset
   justifies itself; no daemons, telemetry loops, startup hooks or idle cost;
   a clean uninstall with no orphaned keys, folders or libraries.
2. **Grounded reality, beginner focus** — build for the intermediate-to-beginner
   user, not the theoretical edge case; anyone should grasp the intent without
   a manual; a feature that needs fragile conditions is flawed.
3. **Three clicks, zero clutter** — nothing important hides; category, module,
   action, and no deeper; every pixel operational.

**Five frameworks**, each item carrying a definition and a first move:

| Code | Area | Letters |
| --- | --- | --- |
| **MDI T** | Startup and build | Missing dependencies · linker · initialization and types · uncaught config |
| **L R R** | Runtime behaviour | Logic · runtime exceptions · resources and interfaces |
| **S C N P** | Systems | Security · concurrency · network · performance |
| **H N S I** | Hardware | Bus faults · link failures · signal corruption · integration |
| **D C S R** | Release | Data integrity · concurrency conflicts · security gaps · regression |

COS-G stays the loop; these name the failures it goes looking for. When the
build is red, reach for S then MDI T. When it runs but is wrong, L R R. When it
fails only under load, S C N P. H N S I applies only to projects that touch
hardware. Before a release, D C S R.

## The harness

The harness runs entirely in the browser against an OpenAI-compatible endpoint.
There is no proxy and no key on a server: the page calls the endpoint you choose.

- **Models** — Ollama (`:11434/v1`), LM Studio (`:1234/v1`), llama.cpp
  (`:8080/v1`) or any custom base URL. *Add a model* lists what the endpoint
  reports at `/models` (falling back to Ollama's `/api/tags`), so the model id
  comes from the server rather than from typing. A local server must allow this
  page's origin; if it does not, the harness says so and you can still add the
  model id by hand.
- **Directory** — chosen with `showDirectoryPicker` in read-write mode and kept
  as a handle in IndexedDB, so the harness remembers the folder across reloads.
  Only the folder's name is shown.
- **Workbench** — a preview field takes your dev server's URL and loads it in a
  frame; **Detach** moves it into its own window for a second monitor, and
  **Bring it back** closes that window and frames it again. The conversation sits
  beside it, uses the COS-G doctrine as its system prompt, and keeps the last 40
  messages in this browser. An endpoint key is held in `sessionStorage` only for
  the tab, and is optional.

The harness cannot read or edit project files yet, and the conversation says so
rather than pretending otherwise. It is the first page you see; the rest of Red
Queen (directory, rack, safety, COS-G) is untouched.

### Bench test

**Run bench test** on the setup page is the in-app counterpart to `npm run
smoke`: seven checks that this copy works where it is running — local storage,
the saved rack and refinements through their validators, the catalogue (38 tools,
unique slugs, known categories and levels), covers loading as SVG, `POST
/api/export` returning Markdown with a refinement note kept, `/api/health` — whose
answer names the release (`red-queen · hosted · 1.0.2 · v1.0.2`) — and your model
endpoint when one is configured. It reads only: the single write is a
probe key it removes again, and no project folder is touched. Results stay on
screen with timings, so a test launch can be reported by reading them out — 6 of
7 passed and 1 skipped is the normal result with no model configured.

## Size budget

The base program ships under **100 MB**: source, catalogue data and generated
SVG covers, with zero tool binaries. Entries link upstream instead of mirroring
installers, which is also what keeps the licences honest — and means adding a
tool costs a few lines of data rather than megabytes.

That budget is a gate, not a note. `tests/size.test.ts` runs inside `npm test`,
so `npm run check` and both workflows go red when either number reaches **90 MB**
— the 100 MB cap less a 10 MB margin, so growth is caught while it is still
cheap to undo rather than on the day the promise breaks. The base program and
the build output are measured separately: a small repository that starts packing
a huge bundle fails exactly as loudly.

`npm run size` is the same rule with a breakdown — bytes per top-level entry,
both totals, and the headroom left to the gate — and exits non-zero when either
total reaches it. It also names any single file over 5 MB. The walk skips
`node_modules`, `.git`, `.wrangler`, `.freebuff` and, for the base figure,
`dist`; the build figure comes from `dist/` itself.

## One command

```sh
curl -fsSL https://raw.githubusercontent.com/Scarlet1987/red-queen/main/install.sh | sh
```

[install.sh](install.sh) installs or clones, then installs: it uses the checkout
it is run from (or the directory you are standing in), and clones the repository
first when there is no checkout at hand. Then it installs, starts Red Queen and
opens it — so the one-liner is the whole thing, and a double-click of the script
is the same thing.

```sh
./install.sh                                  # from a clone, metal install
./install.sh --mode sandbox --no-launch       # install only, do not start it
curl -fsSL … | sh -s -- --mode vm             # arguments go after `--`
```

- The clone source is `--repo URL` (or `RED_QUEEN_REPO`), `--source DIR` says
  where to clone it, `--ref` which branch or tag. All have defaults: the URL
  points at the repository this file is published from, and the ref is `v1.0.2`
  — the tagged release — so an install today and one in a month are the same
  program. `--ref main` follows the branch instead.
- It is idempotent: run it again and it finds the existing install and starts it
  rather than installing over it — and if the app is already answering on its
  port it just opens it, so a second click cannot start a second copy. That is
  what makes keeping it on the desktop safe.
- A failed clone, dependency install or build leaves nothing half-installed: the
  prefix only gains a directory after the installer itself succeeds.
- It checks git, Node at the pinned version and npm up front, with a short
  message, before the longer steps run.

When the repository is published somewhere other than the default URL above, the
one line to change is `DEFAULT_REPO` at the top of [install.sh](install.sh);
then the one-liner follows automatically. `DEFAULT_REF` beside it is the version
the installer pins — bump it when a new release is tagged, or installs keep
getting the old tag.

## Install locally (offline)

Three modes, each in its own directory, each one command to run and one to
uninstall. This is the copy that works without the hosted site, and this is the
path `install.sh` drives for you.

```sh
node scripts/red-queen.ts install --mode metal     # ~/.red-queen/metal
node scripts/red-queen.ts install --mode sandbox   # ~/.red-queen/sandbox
node scripts/red-queen.ts install --mode vm        # ~/.red-queen/vm
```

Use `--prefix DIR` to install somewhere else. Each directory contains the app,
the Node server, the catalogue, a `red-queen` launcher, `install.json` and a
`README.txt` — nothing is written anywhere else, with one deliberate exception:
a metal install also writes a systemd unit *into that directory* and links it
into your user unit path, so it can start again after a reboot.

```sh
~/.red-queen/metal/red-queen start        # http://127.0.0.1:4317
~/.red-queen/metal/red-queen status
~/.red-queen/metal/red-queen uninstall    # deletes the metal directory
```

Default ports keep the modes apart: metal 4317, sandbox 4318, vm 4319. Browser
data is per origin, so each mode keeps its own rack and setup.

- **metal** — plain Node under your account, registered as a systemd user
service so it survives a reboot (see below).
- **sandbox** — Node's permission model: the process may read its own app
directory and nothing else; no child processes, workers, addons or inspector.
The server binds loopback only.
- **vm** — a portable copy of the same bundle. Copy the directory into the VM
you control and run it there; Red Queen does not create or download a VM image.

Uninstall removes the mode directory, and the prefix when it becomes empty. It
cannot reach the browser's local data, so clear that first from *Safety → Forget
everything on this device*.

### Starts after a reboot

A metal install registers a **systemd user unit** called `red-queen.service`
(Linux only), so it comes back on its own instead of waiting for someone to run
the launcher:

```sh
~/.red-queen/metal/red-queen service          # enabled? running?
~/.red-queen/metal/red-queen service start
~/.red-queen/metal/red-queen service stop
~/.red-queen/metal/red-queen service disable  # stays installed, stops auto-starting
~/.red-queen/metal/red-queen service enable   # the way back

systemctl --user start red-queen.service     # the same thing, without the launcher
systemctl --user status red-queen.service    # is it running
journalctl --user -u red-queen.service       # what it logged
```

`service` asks the user manager, so it reports what systemd will actually do:
`enabled` and `running`, plus the address when it is up and a reminder when it
will not start on boot. `./red-queen status` is a different question — it prints
`install.json`, the record of what the install did. Neither command changes the
installed files, and `disable` leaves the app in place: only `uninstall` removes
it. On an install made with `--no-service`, or a metal prefix that was not the
one registered, `service` says so and exits non-zero instead of guessing.

- The unit file lives **inside the install directory**
  (`~/.red-queen/metal/red-queen.service`) and is linked into
  `$XDG_CONFIG_HOME/systemd/user/` (`~/.config/systemd/user` by default).
- It runs the installed server by absolute path, with the Node that performed
  the install and the metal port — a user service starts with a bare `PATH`, so
  `node` would not resolve there on its own. If you later remove that Node
  version, reinstall or edit `ExecStart`.
- It binds loopback only, restarts on failure, and starts **with your user
  session**. To have it up before you log in — on a machine you reach remotely —
  `loginctl enable-linger "$USER"`; Red Queen does not run that for you.
- Uninstall deregisters the unit *before* deleting the directory. Both the
  launcher (`./red-queen uninstall`) and `node scripts/red-queen.ts uninstall`
  do it, so no service is left pointing at files that are gone.
- Only a unit whose marker line names that install is removed or replaced, so
  installing metal at a second prefix cannot hijack — or later delete — the
  first prefix's service. The second install says so and stays unregistered.

`--no-service` (or `RED_QUEEN_NO_SERVICE=1`) installs without the unit and
prints that it runs only when started. Sandbox and vm never register one:
`sandbox` is a confined session rather than a daemon, and `vm` is a copy you
move into a machine you control. Where there is no reachable user manager — a
container, a bare SSH login without a session bus — the install still succeeds,
writes the unit, and prints the two `systemctl` commands that finish the job.

The install needs Node and npm to build once; the installed copy needs only
Node, with no dependencies to install. Its server is `node:http` and the static
build, and it serves `/api/health`, `/api/export` and `/api/host` from the same
shared Markdown builder and host view as the Worker — the one difference being
that it has a machine under it to sweep. Its health answer reports the mode it runs in
(`metal`, `sandbox`, `vm`) and that it is offline; the hosted Worker's answer
also names the release, because there is no `install.json` to ask there.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/client, dist/red_queen/index.js (Worker), dist/server (offline)
npm run typecheck
npm test           # node:test regression suite, no runner dependency
npm run check      # typecheck + tests + COS-G
npm run check:fast # the same minus tests/slow (the install cycle): what PRs run
npm run release    # build, then the deploy gate — run this before publishing
npm run gate       # the gate alone: refuses a missing, stale or untested build
npm run smoke      # after deploying: the published site, its pages, Worker and export
npm run release:log -- production  # smoke it, sweep the host, record it in RELEASES.md
npm run release:log -- production --dry-run  # smoke it and print the row, write nothing
npm run release:log -- --status    # refresh the log's build-drift line only
npm run release:check   # CI: newest logged build must be dist/ and name its Node and host
```

Node 24 is the supported runtime, and `.nvmrc` is the only place it is
written down: `nvm use` picks it up locally, `engines` makes npm point it out,
and both workflows pass the same file to `setup-node`, so CI cannot test a
different Node than you develop on. The suite runs `.ts` through the runtime's
own type stripping and the sandbox install needs `--permission`, which is why
the floor is 24 rather than something older. A test fails when the pin falls
outside the `engines` range, so the two cannot drift apart quietly, and the pin
is a build input: move it and the gate treats the build as stale, because the
bytes in `dist/` were produced by the runtime it used to name. The entry points
that build or serve — `npm run dev`, `npm run build`, `npm run offline` — all
start by checking the running Node against the pin, so a wrong runtime is
refused before Vite runs rather than after the work is done. `npm run
install:red-queen` shells out to `npm run build`, so it inherits that check. The
same check sits inside `vite.config.ts` and the offline builder, so a bare
`vite`, `vite build`, `vite preview` or `node scripts/build-offline.ts` is
refused as well — the prefix is a convenience, not the guard.

The Sites deploy tool uploads a built tree and cannot run npm hooks, so the
gate is an artefact rather than a promise. `npm run build` ends by writing
`dist/build.json`: a hash of every input it was built from. `npm run gate`
recomputes that hash and runs the release checks, and only then writes
`dist/deploy.json`, the manifest the uploader needs. So:

- **no build** → no stamp, gate exits non-zero;
- **source changed after the build** → the gate names the changed files and
exits non-zero;
- **a Worker or asset the manifest points at is gone** → the gate exits
  non-zero;
- **the build ran on a Node other than the pinned one** → the gate exits
  non-zero. Each stamp records the runtime that produced it, so a build made on
  some other machine's Node 22 is refused even though its inputs match. A stamp
  too old to name its runtime is refused too, rather than trusted;
- **typecheck, tests or COS-G fail** → the gate exits non-zero.

The build also refuses to finish when it cannot bake its own nameplate: if the
substitution that puts the version and release tag into the Worker stops
applying, `build-offline.ts` finds `__RED_QUEEN_VERSION__` still in the bundle
and stops before stamping, rather than deploy a site whose `/api/health` would
answer 500.

Every refusal removes `dist/deploy.json` before it starts, so a failed gate
leaves nothing to upload — and a plain `npm run build` deletes any manifest too,
because a rebuild replaces the bytes the checks ran against. `deploy.json` is no
longer committed: it is generated from the build it describes. `npm run release`
is `build` then `gate`, and the install tests inside it pack, start and uninstall
the tree you are about to ship rather than yesterday's `dist/`.

### Tests

`npm test` runs Node's built-in runner over `tests/*.test.ts` and
`tests/slow/*.test.ts`; there is no testing framework to install. The one slow
file is the install cycle, which packs and serves three modes — a pull request
does not need that, so `npm run test:fast` (and `npm run check:fast`) run only
the top-level files, five seconds instead of a build. Nine files cover the
release checks:

- **Storage validation** — `src/app/lib/validate.ts` is pure and shared by the
  rack, refinements, worksheets and harness providers, so the suite exercises
  the code that actually loads their JSON. Unknown tools, invalid safety levels,
  blank titles, missing model fields and trailing slashes are all asserted, plus
  the 280-character note and 160/4000-character worksheet caps.
- **COS-G rules** — every pass keeps a definition and its full loop, C/O/G close
  on the cycle, and the extended index names five distinct frameworks.
- **Exported Markdown** — the worksheet export groups by letter, flattens
  newlines and handles an empty list; the Worker's `/api/export` is called
  through Hono and checked for known-slug filtering, refinement grouping, note
  caps, unknown-level fallback and the empty-rack rejection.
- **COS-G detectors** — six throwaway fixture projects in the OS temp directory
  are scanned by the real CLI. A clean project must stay at zero findings; C
  must catch an unguarded parse and an empty catch while clearing a guarded one;
  O must report an unreachable source and an unused asset while clearing a used
  import; S must report a parse error, invalid JSON and a merge marker and exit
  non-zero; G must report an unignored secret, a git hook and a symlink leaving
  the tree.
- **The deploy gate** — a fixture workspace proves each refusal: no build, a
  build older than its source (naming the changed file), a missing asset and
  failing checks all exit non-zero without leaving `dist/deploy.json` behind; a
  current build with passing checks writes a manifest whose paths resolve inside
  `dist/`. The stamp is content-based, so a reverted edit stays publishable and
  edits to tests or docs never force a rebuild — while moving the Node pin does,
  since the shipped bytes depend on the runtime that made them. A fixture build
  stamped `v22.12.0` against a `24` pin, and one whose stamp has no runtime at
  all, are both refused before a check runs; rebuilt on the pinned runtime, the
  same tree is publishable.
- **The install cycle** — builds if needed, installs, starts the launcher on a
  free port, checks the shell, the SPA route, `/api/health` and the rack export,
  then uninstalls and proves both the mode directory and the prefix are gone.
  All three modes run this cycle. **sandbox** additionally reads the serving
  process's own command line and asserts `--permission`, the app-only
  `--allow-fs-read`, no writable paths, and that the process is running the
  installed bundle rather than the repo build — so the flags cannot become a
  label in the README. **vm** asserts its exact layout and that the README says
  it does not provision a VM. A final test installs metal, sandbox and vm into
  one prefix and removes them in turn, proving uninstall touches only its own
  directory and the shared prefix goes only when it is empty. This is the
  packaging check that would have caught the deploy manifest pointing at a stale
  Worker.

- **The installer pin** — `install.sh` clones the tagged release, so the tag it
  names has to exist on the remote it clones from. The suite reads `DEFAULT_REF`
  and asks `git ls-remote --tags` about that repository: a pin naming a tag
  nobody pushed fails, and so does a script that still sets the pin but no longer
  reads it — otherwise a bump would be documentation. An unreachable remote
  fails too, because the promise is about a machine that has nothing but a
  shell. `--ref main` remains available for following the branch on purpose.

- **The covers** — `public/images/tools` is generated, so an entry can ship
  without art and nothing else notices: the card just renders a broken image.
  The suite closes that. Every catalogue entry must have `<slug>.svg`, any file
  with no entry is an orphan and fails, each cover must be a real SVG with a
  `viewBox` rather than a zero-byte placeholder, slugs must be URL-safe (a
  camel-case or spaced slug 404s on a case-sensitive host), and nothing but
  SVGs may sit in the directory. Running `npm run covers` reproduces the
  committed art byte for byte, which is what makes "regenerate and commit" a
  safe instruction.

- **The release log** — a row carries the environment, the short build hash,
  the version and build time, the release tag those bytes ship as, the Node that
  produced the build (from the same stamp the gate checks, never the one running
  the log command), and either `14/14` or the names of the checks that failed; a
  build whose stamp cannot name its runtime logs `—` instead. The tag is the
  one the build baked into `/api/health`, read from the stamp rather than typed:
  the row and the live site then agree by construction, both saying `v1.0.0`
  for bytes cut at the tag, or the described form when the tree has moved past
  it with a changed input. A stamp written before the tag was recorded falls
  back to asking git the same question. A test walks a throwaway repository through all of it —
  tagged, docs-only commit, code commit, uncommitted edit, no tags, no
  repository — because that answer depends on git, not on the checkout. A new build is inserted directly under the
  header, a different build for the same environment becomes a second row, a
  row from before the Node column is still matched and rewritten in the current
  shape, and re-checking a logged build updates its row while keeping the
  deployment time. A log with no release
  table is refused rather than corrupted. The status line is pinned too: it
  matches the build, names both hashes when a local build has not been logged,
  says so when there is no build or no deployment yet, sits above the table
  once, and refreshes without rewriting anything when nothing changed. The
  command itself is  `npm run release:log -- production`; it writes to
  `RELEASES.md` after running the same smoke test the site sees, and
  `npm run release` refreshes the status line so a rebuild cannot pass for the
  published build. `release:check` is the verifier: it passes only when the
  build in `dist/` is the newest logged one, that row names the Node that built
  it, and the status line is the exact
  line that comparison would write; a missing build, a missing log, an unlogged
  build, a runtime-less row for the current build, and a missing or stale
  status line each fail with their own reason.
- **The live smoke test** — a local fixture mirrors the Worker's contract
  (shell with a bundle and stylesheet, the SPA pages, a cover, health, a filtered
  export, the empty-rack rejection), then breaks one thing at a time: a 500 page,
  a 503 health route, an export that echoes an unknown slug, an empty rack
  answered with a document, a shell that loads no bundle, a deployment serving
  an older shell, and a missing local build. A healthy fixture must pass all
  fourteen checks, and an unreachable host must be reported as failures rather
  than throw. This is what keeps the only post-publish check from going quiet.

## Editing the catalogue

- `src/data/tools.ts` is the only source of truth: tools, categories, safety
  levels and safety copy.
- `npm run covers` regenerates the SVG specimen covers in `public/images`
  from the catalogue. Deterministic, so nothing changes unless an entry does.
- `npm run directory` regenerates `DIRECTORY.md` from the same data. Commit it
  alongside catalogue changes so GitHub readers see the same directory.
- `npm run size` prints the size breakdown against the 100 MB budget. The gate
  itself lives in `npm test`, so `npm run check` is what actually stops growth.
- `npm run cosg -- .` runs the COS-G pass over the project itself.

Adding an entry means: a name, a category, a safety level, a licence, its
platforms, an official link and a one-line answer to "what does it do?". Check
the licence and platforms against the upstream project. Hosted malware, keygens
and tools whose only purpose is defeating licensing are out of scope.

## Layout

```
src/data/tools.ts          the catalogue
src/app/pages/             harness, workbench, directory, tool, rack, safety, COS-G, bible, worksheet
src/app/components/        nav, sidebar, footer, tool card, quick jump, UI primitives
src/app/lib/               harness state, rack, refinements, worksheets, jump state
src/app/lib/validate.ts    storage validators (pure, covered by tests)
tests/                      storage, doctrine, export, detector and release tests
tests/slow/                 the install cycle: packs, serves and uninstalls each mode
src/worker/index.ts        /api/health (version + release tag), /api/export (Markdown),
                           /api/host (the hosted copy has no machine, and says so)
scripts/release-tag.ts     which tag a build ships as: log, stamp and health agree
scripts/make-covers.ts     SVG cover generator
scripts/build-directory.ts DIRECTORY.md generator
scripts/check-size.ts      100 MB base-program budget
src/lib/rack-markdown.ts   shared rack export (Worker + offline server)
src/lib/host-view.ts       the host sweep's shape and its reading, shared the same way
src/app/components/HostPanel.tsx  the machine under this copy, on the COS-G page
scripts/cosg.ts            read-only C / O / S / G checker
scripts/doctrine.ts        the COS-G playbooks and extended framework index
scripts/host-scan.ts       the machine behind the project: drivers, blacklists, DKMS
scripts/red-queen.ts       install / start / status / uninstall, three modes + metal service
install.sh                 one command: install from here, or clone and install
scripts/build-offline.ts   assembles dist/server, then stamps the build
scripts/build-stamp.ts     hashes build inputs into dist/build.json
scripts/deploy-gate.ts     blocks publishing a missing, stale or untested build
scripts/smoke.ts           post-deploy smoke test of the published site
scripts/release-log.ts     records a deployment's build hash, smoke result and checks
scripts/offline-server.mjs dependency-free static + API server
public/images/             generated covers
LICENSE                    MIT, for the code, the catalogue text and the covers
RELEASES.md                deployments, build hashes and smoke results
.github/workflows/ci.yml   main-branch CI: build, checks, release record
.github/workflows/pr.yml   pull-request CI: typecheck, fast tests, COS-G
```

The look and feel started from the **Store** starter template (editorial
layout, Instrument Serif display type, warm paper canvas) and was re-themed
around a crimson accent and the three safety tones.

## Version 1.0.2, hosted

Red Queen 1.0.2 is live and needs no install. It is the release that names
itself in the page as well as at the endpoint: the footer carries the version
and tag the running bytes were built as, and `/api/health` answers with the
same pair.

- **Production** — **https://site-7b563dd9b57543d58f4ee10986624b94.freebuff.page**
- **Preview** — https://site-66228069b13847cc95a835f233ca293e.freebuff.page

Site `1710b6be-1a28-4f44-ba17-420cb5e348b8` on Freebuff Sites; both
environments are published and serve the same build (shell SHA-256
`801beb26…`), and both answer `/api/health` with the same release —
`{"ok":true,"service":"red-queen","version":"1.0.2","tag":"v1.0.2-12-ge83a4bd"}`
as that build was logged. The installer pins `v1.0.2`, the last tag cut: a
one-command install gives those bytes, while the hosted build is that tag plus
the twelve commits logged since — so the site runs ahead of a fresh install
until the next tag names the current tree.

That answer is the site's nameplate, and it is the cheapest way to ask a
deployment what it is: `curl https://…/api/health` says which version and which
release tag the running bytes were built as, with no page rendering and no
server state involved. The values are constants substituted at build time, so
the answer comes from the bytes that are running rather than from a file or a
lookup that could age.

The footer says the same pair on every page — `Version 1.0.2 ·
v1.0.2-12-ge83a4bd` — so a
copy running on metal, in a VM or offline names its own release without anyone
curling the endpoint. A build no tag describes says `untagged build` there
instead of borrowing the nearest release's name.
A release is `npm run release`, then `sites_deploy` with `manifestPath`
`dist/deploy.json` for the environment you are updating, then `npm run smoke`
against that URL (pass it as an argument). There is no committed manifest: the
gate writes one from the build it just checked, so a stale or untested tree has
nothing to upload.

The smoke test is the only check that sees the site after it ships. It fetches
the published origin the way a visitor would — the shell, every page, the
bundle and its stylesheet, a cover, `/api/health`, a rack export with a
refinement and an unknown slug, and the empty-rack refusal — then exits
non-zero naming whichever check failed. The shell it receives is compared
byte-for-byte (SHA-256) with `dist/client/index.html`, so a deployment that
silently skipped the latest build fails even though every page answers; the
failure names both asset bundles. The site also has to name its own release:
`/api/health` answers with the version and tag the build baked in (see
`define` in [vite.config.ts](vite.config.ts)), and those must match
`dist/build.json`, so a Worker from an older build is caught by its own
nameplate — a site that reports no version at all is one built before the
endpoint said anything but `{ ok, service }`. Because the footer is drawn by
the bundle rather than the shell, the smoke test also reads the bundle the
shell loads and requires the release baked there to be the pair `/api/health`
reports: a Worker replaced without its assets beside it would otherwise leave
a footer naming a release the API denies. `npm run smoke -- https://…` checks another
deployment; a 503 is reported as a hosting pause, not an app failure. What was
deployed and how it answered is logged in [RELEASES.md](RELEASES.md) — build
hash, release tag, environment, smoke result, the checks that run made and what
the host sweep reported, one row per deployment, written by
`npm run release:log -- <environment>`. A status line above the table compares
`dist/build.json` with the newest logged build, so a local build that was never
deployed is called out in the log instead of being mistaken for the published
one — and `npm run release:check` turns that comparison into a CI failure
rather than a warning nobody reads. `.github/workflows/ci.yml` runs `build`,
`check` and `release:check` on every push to `main`; `.github/workflows/pr.yml`
runs `check:fast` on every pull request, because a PR's build is never the
logged deployment and its packaging is not what is being reviewed.

What travels and what does not: the app, the catalogue and your rack notes all
work from any browser. The model endpoint and the project folder do not travel —
the endpoint is called by your browser, and the folder handle lives in that
browser's IndexedDB. A hosted HTTPS page also cannot call `http://localhost`, so
the model presets (Ollama, LM Studio, llama.cpp) work when Red Queen runs locally
or when the endpoint itself is HTTPS. Everything else — directory, rack, safety,
COS-G, worksheet, workbench preview — is fully usable from the hosted URL.

## Publishing on GitHub

`DIRECTORY.md` is the directory GitHub renders. Everything is labelled as part
of the Red Queen program: the repository topic should be `red-queen`, every
tool entry carries a category, safety level, licence and upstream link in
`src/data/tools.ts`, and the JSON export stamps `program: "Red Queen"`,
`label: "red-queen"` on every file it produces. No binaries are stored — that
is what keeps the repository inside its 100 MB budget.

The site itself is a Vite SPA plus a Worker — GitHub Pages can host
`dist/client` if you drop the `/api` routes (the rack export then needs a
fallback), otherwise deploy it somewhere that runs the Worker.

The repository is published at **https://github.com/Scarlet1987/red-queen**,
MIT licensed (see below). `install.sh` clones from that URL by default, so the
one-liner works on a machine that has nothing but a shell.

## Licence

Red Queen's own code, its catalogue text and the generated covers are **MIT**
licensed — the full text is in [LICENSE](LICENSE). Use it, change it, ship it,
keep the copyright notice.

That licence covers this program, not the tools it lists. Every catalogue entry
names its upstream licence and no tool binaries are stored in the repository:
install and run each tool under its own terms. MIT here means you may reuse the
directory, the harness and the writing — not that the tools become MIT.

`package.json` deliberately carries no `license` field: it is a hashed build
input, so adding one would change the build stamp and strand the release record
until the next deployment. [LICENSE](LICENSE) is the statement of record, and a
test fails if a field ever appears there and disagrees with it.
