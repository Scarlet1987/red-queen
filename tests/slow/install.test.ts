import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Packaging drift is how the hosted Worker once ran stale code, and how the
// launcher once left an empty prefix behind. These tests walk the real install
// path for every mode: build if needed, install, start, check the pages and the
// export, then uninstall and prove nothing is left.
//
// This file lives in tests/slow/ because it packs and serves three installs.
// `npm test` runs it; `npm run test:fast` (what a pull request runs) does not.
// `repo` is therefore two levels up, not one.
const repo = fileURLToPath(new URL('../..', import.meta.url))
const installer = join(repo, 'scripts', 'red-queen.ts')

type Mode = 'metal' | 'sandbox' | 'vm'

let built = false

function ensureBuild(): void {
  if (built) return
  if (!existsSync(join(repo, 'dist', 'server', 'server.mjs')) || !existsSync(join(repo, 'dist', 'client', 'index.html'))) {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: repo, encoding: 'utf8', timeout: 120_000 })
    assert.equal(build.status, 0, `build failed: ${build.stderr}`)
  }
  built = true
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close()
        reject(new Error('Could not reserve a port.'))
        return
      }
      probe.close(() => resolvePort(address.port))
    })
  })
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

async function waitFor(url: string, child: ChildProcess, stderr: () => string): Promise<Response> {
  const deadline = Date.now() + 15_000
  let last = ''
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}. ${stderr()}`)
    try {
      const response = await fetch(url)
      if (response.ok) return response
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await delay(120)
  }
  throw new Error(`Server did not answer ${url} in time (${last}). ${stderr()}`)
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  const closed = await Promise.race([exited.then(() => true), delay(3000).then(() => false)])
  if (!closed) child.kill('SIGKILL')
}

// The launcher execs node, so the serving process keeps the launcher's pid and
// its command line shows exactly what the mode really runs. /proc is Linux;
// ps covers the other POSIX hosts. Returns null where neither is available.
function processArgs(pid: number): string[] | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    return raw.split('\0').filter(Boolean)
  } catch {
    // Not Linux, or the process already exited.
  }
  const ps = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' })
  if (ps.status === 0 && ps.stdout.trim()) return ps.stdout.trim().split(/\s+/)
  return null
}

interface Installed {
  prefix: string
  target: string
  launcher: string
  port: number
  env: NodeJS.ProcessEnv
}

const DEFAULT_PORTS: Record<Mode, number> = { metal: 4317, sandbox: 4318, vm: 4319 }

// The installer registers a real systemd user unit for metal, so every install
// here points XDG_CONFIG_HOME at a scratch directory: a test prefix must never
// edit the unit path of the machine running the suite. Tests that want the
// service pass a stub `systemctl` on PATH and turn the unit back on.
const scratchDirs: string[] = []

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratchDirs.push(dir)
  return dir
}

const unitHome = scratch('red-queen-units-')
// Every scratch directory this file made goes, including the stubs — a test run
// must not leave directories behind any more than an uninstall may.
process.on('exit', () => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

interface InstallOptions {
  service?: boolean
  env?: NodeJS.ProcessEnv
}

function envFor(options?: InstallOptions): NodeJS.ProcessEnv {
  return { ...process.env, XDG_CONFIG_HOME: unitHome, ...options?.env }
}

function install(mode: Mode, shared?: string, options?: InstallOptions): Installed {
  ensureBuild()
  let prefix = shared
  if (!prefix) {
    prefix = mkdtempSync(join(tmpdir(), `red-queen-install-${mode}-`))
    // mkdtemp creates the directory; install expects to own the tree, so start empty.
    rmSync(prefix, { recursive: true, force: true })
  }
  const args = [installer, 'install', '--mode', mode, '--prefix', prefix]
  if (!options?.service) args.push('--no-service')
  const env = envFor(options)
  const result = spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', timeout: 120_000, env })
  assert.equal(result.status, 0, `install ${mode} failed: ${result.stderr}`)
  const target = join(prefix, mode)
  const marker = readMarker(target)
  assert.equal(marker.program, 'red-queen')
  assert.equal(marker.mode, mode)
  assert.equal(marker.port, DEFAULT_PORTS[mode])
  return { prefix, target, launcher: join(target, 'red-queen'), port: marker.port, env }
}

interface Marker {
  program: string
  mode: string
  port: number
  version: string
  directory: string
  service: { kind: string; unit: string; link: string | null; enabled: boolean } | null
}

function readMarker(target: string): Marker {
  const raw = readFileSync(join(target, 'install.json'), 'utf8')
  try {
    return JSON.parse(raw) as Marker
  } catch {
    assert.fail(`install.json in ${target} is not valid JSON: ${raw}`)
  }
}

async function startServing(installed: Installed, mode: Mode) {
  const port = await freePort()
  let stderr = ''
  const child = spawn(installed.launcher, ['start', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const base = `http://127.0.0.1:${port}`
  const home = await waitFor(`${base}/`, child, () => stderr)
  assert.match(await home.text(), /<div id="root"><\/div>/)

  const spa = await fetch(`${base}/workbench`)
  assert.equal(spa.status, 200)
  assert.match(await spa.text(), /<div id="root"><\/div>/)

  const health = (await (await fetch(`${base}/api/health`)).json()) as { ok: boolean; mode: string; offline: boolean }
  assert.equal(health.ok, true)
  assert.equal(health.mode, mode)
  assert.equal(health.offline, true)

  // The COS-G page reads the machine through the server that serves the page, so
  // an install that cannot answer this leaves the panel guessing. A sandbox copy
  // is confined to its own directory by its permission flags: it must say so
  // rather than report a host it never looked at.
  const host = (await (await fetch(`${base}/api/host`)).json()) as {
    available: boolean
    mode: string
    reason: string
    cell: string
    findings: unknown[]
    counts: { devices: number; loaded: number }
  }
  assert.equal(host.mode, mode)
  assert.ok(Array.isArray(host.findings))
  assert.ok(host.cell.length > 0, 'the panel would have no line to show')
  if (mode === 'sandbox') {
    assert.equal(host.available, false)
    assert.match(host.reason, /sandbox install/, 'a confined copy says why it cannot see the machine')
  } else if (process.platform === 'linux' && existsSync('/sys/bus/pci/devices')) {
    assert.equal(host.available, true, 'the sweep reads the machine this install sits on')
    assert.ok(host.counts.devices > 0, 'the sweep found no PCI devices at all')
  }

  const exported = await fetch(`${base}/api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slugs: ['ghidra', 'not-a-tool'], refinements: { ghidra: { safety: 'live', note: 'install test' } } }),
  })
  assert.equal(exported.status, 200)
  const markdown = await exported.text()
  assert.match(markdown, /# Red Queen rack/)
  assert.match(markdown, /## Live attach/)
  assert.match(markdown, /Your note: install test/)
  assert.ok(!markdown.includes('not-a-tool'))

  return { child, port, base }
}

function uninstall(installed: Installed, clearsPrefix = true): void {
  const result = spawnSync(installed.launcher, ['uninstall'], { encoding: 'utf8', timeout: 20_000, env: installed.env })
  assert.equal(result.status, 0, `uninstall ${installed.target} failed: ${result.stderr}`)
  assert.match(result.stdout, /Removed/)
  assert.equal(existsSync(installed.target), false)
  // The shared prefix goes only once it is empty, so sibling modes survive.
  if (clearsPrefix) assert.equal(existsSync(installed.prefix), false)
  else assert.equal(existsSync(installed.prefix), true, `${installed.prefix} should stay while other modes are installed`)
}

async function cycle(mode: Mode, check?: (installed: Installed, running: ChildProcess) => void, options?: InstallOptions): Promise<void> {
  const installed = install(mode, undefined, options)
  let server: ChildProcess | null = null
  try {
    const serving = await startServing(installed, mode)
    server = serving.child
    check?.(installed, serving.child)
    await stop(server)
    server = null
    uninstall(installed)
  } finally {
    if (server) {
      await stop(server)
      rmSync(installed.prefix, { recursive: true, force: true })
    }
  }
}

test('metal install serves the app, the SPA routes and the export, then uninstalls', { timeout: 120_000 }, async () => {
  await cycle('metal', (installed) => {
    const status = spawnSync(installed.launcher, ['status'], { encoding: 'utf8', timeout: 10_000 })
    assert.equal(status.status, 0)
    assert.match(status.stdout, /"mode": "metal"/)
    assert.ok(existsSync(join(installed.target, 'app', 'server', 'server.mjs')))
    // This install had --no-service, so the launcher must not pretend it can
    // steer a unit that was never registered: it says so and fails.
    const noUnit = launcherRun(installed, ['service'])
    assert.equal(noUnit.status, 1)
    assert.match(noUnit.stderr, /No systemd unit is registered for/)
  })
})

test('the launcher reports and steers the metal service', { timeout: 180_000 }, async (t) => {
  if (nonLinux) return t.skip(`the metal service is a systemd user unit; this host is ${process.platform}`)
  const stub = stubSystemctl()
  const configHome = scratchConfigHome()
  const env = { ...stub.env, XDG_CONFIG_HOME: configHome }
  const installed = install('metal', undefined, { service: true, env })
  const running = join(stub.env.RED_QUEEN_SYSTEMCTL_STATE ?? '', 'running')
  try {
    const initial = launcherRun(installed, ['service'])
    assert.equal(initial.status, 0, initial.stderr)
    assert.match(initial.stdout, /enabled {2}enabled/)
    assert.match(initial.stdout, /running {2}inactive/)
    assert.doesNotMatch(initial.stdout, /address/, 'no address is printed for a service that is not running')
    assert.doesNotMatch(initial.stdout, /does not start on boot/)

    assert.equal(launcherRun(installed, ['service', 'start']).status, 0)
    assert.ok(existsSync(running), 'start is passed through to the user manager')
    const started = launcherRun(installed, ['service'])
    assert.match(started.stdout, /running {2}active/)
    assert.match(started.stdout, /address {2}http:\/\/127\.0\.0\.1:4317/, 'a running service reports where it serves')

    assert.equal(launcherRun(installed, ['service', 'stop']).status, 0)
    assert.equal(existsSync(running), false)

    assert.equal(launcherRun(installed, ['service', 'disable']).status, 0)
    const disabled = launcherRun(installed, ['service'])
    assert.match(disabled.stdout, /enabled {2}disabled/)
    assert.match(disabled.stdout, /does not start on boot: .*service enable/)

    assert.equal(launcherRun(installed, ['service', 'enable']).status, 0)
    assert.equal(existsSync(running), false, 'enable must not start the app')
    assert.match(launcherRun(installed, ['service']).stdout, /enabled {2}enabled/)
    assert.equal(launcherRun(installed, ['service', 'nonsense']).status, 2)

    // None of that touched the install itself: the app still serves.
    assert.ok(existsSync(join(installed.target, 'app', 'server', 'server.mjs')))
    uninstall(installed)
    assert.equal(existsSync(join(configHome, 'systemd', 'user', 'red-queen.service')), false)
  } finally {
    rmSync(installed.prefix, { recursive: true, force: true })
    rmSync(configHome, { recursive: true, force: true })
  }
})

test('sandbox install actually runs under the permission flags and still serves', { timeout: 120_000 }, async (t) => {
  // Asked for a service explicitly: sandbox is a confined session, so it must
  // still register nothing.
  await cycle('sandbox', (installed, running) => {
    assert.equal(readMarker(installed.target).service, null, 'sandbox registers no service')
    assert.equal(existsSync(join(installed.target, 'red-queen.service')), false)

    const launcher = readFileSync(installed.launcher, 'utf8')
    assert.match(launcher, /--permission/)
    assert.match(launcher, /--allow-fs-read="\$here\/app"/)
    assert.doesNotMatch(launcher, /--allow-fs-write/, 'sandbox must not grant writable paths')

    // The running process's own command line must show the flags — proof the
    // sandbox mode is not just a label in the README. It must also be the
    // installed copy, not the repo build, or the served bundle proves nothing.
    assert.ok(running.pid, 'server has a pid')
    const argv = processArgs(running.pid)
    if (!argv) {
      t.diagnostic(`Could not read the command line of pid ${running.pid} on this platform; launcher flags were checked instead.`)
      return
    }
    const line = argv.join(' ')
    assert.ok(argv.includes('--permission'), `permission flag missing from: ${line}`)
    assert.ok(
      argv.some((arg) => arg.startsWith('--allow-fs-read=') && arg.includes(join(installed.target, 'app'))),
      `filesystem allow-list missing from: ${line}`,
    )
    assert.ok(!argv.some((arg) => arg.startsWith('--allow-fs-write')), `sandbox has writable paths: ${line}`)
    assert.ok(line.includes(join(installed.target, 'app', 'server', 'server.mjs')), `serving something other than the install: ${line}`)
    // No unit, no command: the launcher's usage line is all it has to offer.
    const refused = launcherRun(installed, ['service'])
    assert.equal(refused.status, 2)
    assert.match(refused.stderr, /usage:/)
  }, { service: true })
})

test('vm install is a portable bundle with the documented layout and runs', { timeout: 120_000 }, async () => {
  await cycle('vm', (installed) => {
    // A portable copy must be exactly the documented set of entries: the app,
    // the launcher, the marker and the README a VM user reads first.
    assert.deepEqual(readdirSync(installed.target).sort(), ['README.txt', 'app', 'install.json', 'red-queen'])
    assert.ok(existsSync(join(installed.target, 'app', 'client', 'index.html')))
    assert.ok(existsSync(join(installed.target, 'app', 'server', 'server.mjs')))
    assert.ok(existsSync(join(installed.target, 'app', 'server', 'catalogue.json')))
    const readme = readFileSync(join(installed.target, 'README.txt'), 'utf8')
    assert.match(readme, /virtual machine/i)
    assert.match(readme, /does not/i)
    assert.match(readFileSync(installed.launcher, 'utf8'), /mode=vm/)
    assert.equal(installed.port, 4319)
  }, { service: true })
})

test('all three modes coexist in one prefix and uninstall only what they own', { timeout: 120_000 }, async () => {
  ensureBuild()
  const prefix = mkdtempSync(join(tmpdir(), 'red-queen-modes-'))
  rmSync(prefix, { recursive: true, force: true })
  const modes: Mode[] = ['metal', 'sandbox', 'vm']
  try {
    const installed = modes.map((mode) => install(mode, prefix))
    assert.deepEqual(readdirSync(prefix).sort(), ['metal', 'sandbox', 'vm'])
    for (const entry of installed) {
      const marker = readMarker(entry.target)
      assert.equal(marker.directory, entry.target)
      const launcher = readFileSync(entry.launcher, 'utf8')
      assert.match(launcher, new RegExp(`mode=${marker.mode}\\b`))
      assert.match(launcher, new RegExp(`port=${marker.port}\\b`))
    }

    // Removing a middle mode leaves the prefix and both siblings untouched.
    uninstall(installed[1], false)
    assert.deepEqual(readdirSync(prefix).sort(), ['metal', 'vm'])
    for (const index of [0, 2]) assert.equal(existsSync(installed[index].target), true)
    assert.equal(readMarker(installed[0].target).mode, 'metal')

    uninstall(installed[0], false)
    uninstall(installed[2], true)
  } finally {
    rmSync(prefix, { recursive: true, force: true })
  }
})

// --- the metal service ------------------------------------------------------
//
// A stub `systemctl` sits first on PATH and copies what the real one does to an
// XDG_CONFIG_HOME of our choosing: link, enable, disable, unlink. So the test
// proves the installer's calls and their effect without a systemd session, and
// without writing to the unit path of the machine running the suite.
function stubSystemctl(fail = false): { env: NodeJS.ProcessEnv; log: string } {
  const dir = scratch('red-queen-systemctl-')
  const log = join(dir, 'calls.log')
  const state = join(dir, 'state')
  mkdirSync(state, { recursive: true })
  const file = join(dir, 'systemctl')
  // Enough of systemd to be honest: link/enable/disable move real files, and
  // start/stop set a flag so is-active reports what actually happened.
  writeFileSync(
    file,
    `#!/bin/sh
printf '%s\\n' "$*" >> "$RED_QUEEN_SYSTEMCTL_LOG"
${fail ? 'exit 1' : ''}
[ "\${1:-}" = "--user" ] && shift
conf="\${XDG_CONFIG_HOME:-\$HOME/.config}/systemd/user"
state="$RED_QUEEN_SYSTEMCTL_STATE"
case "\${1:-}" in
  link) mkdir -p "$conf" && ln -sfn "$2" "$conf/red-queen.service" ;;
  unlink) rm -f "$conf/red-queen.service" ;;
  enable) mkdir -p "$conf/default.target.wants" && ln -sfn "$conf/red-queen.service" "$conf/default.target.wants/\${2:-red-queen.service}" ;;
  disable) rm -f "$conf/default.target.wants/\${2:-red-queen.service}" ;;
  is-enabled)
    if [ -e "$conf/default.target.wants/red-queen.service" ]; then echo enabled; else echo disabled; fi
    ;;
  is-active)
    if [ -e "$state/running" ]; then echo active; else echo inactive; fi
    ;;
  start) touch "$state/running" ;;
  stop) rm -f "$state/running" ;;
  *) exit 0 ;;
esac
`,
  )
  chmodSync(file, 0o755)
  return {
    log,
    env: { PATH: `${dir}:${process.env.PATH ?? ''}`, RED_QUEEN_SYSTEMCTL_LOG: log, RED_QUEEN_SYSTEMCTL_STATE: state },
  }
}

function launcherRun(installed: Installed, args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(installed.launcher, args, { encoding: 'utf8', timeout: 15_000, env: installed.env })
}

function calls(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
}

function scratchConfigHome(): string {
  return scratch('red-queen-config-')
}

const nonLinux = process.platform !== 'linux'

test('metal install registers a systemd user unit and the launcher uninstall removes it', { timeout: 180_000 }, async (t) => {
  if (nonLinux) return t.skip(`the metal service is a systemd user unit; this host is ${process.platform}`)
  const stub = stubSystemctl()
  const configHome = scratchConfigHome()
  const env = { ...stub.env, XDG_CONFIG_HOME: configHome }
  const installed = install('metal', undefined, { service: true, env })

  const unit = join(installed.target, 'red-queen.service')
  const link = join(configHome, 'systemd', 'user', 'red-queen.service')
  const wants = join(configHome, 'systemd', 'user', 'default.target.wants', 'red-queen.service')
  try {
    assert.ok(existsSync(unit), 'the unit file belongs to the install directory')
    const body = readFileSync(unit, 'utf8')
    assert.match(body, new RegExp(`# Managed by Red Queen: ${installed.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.match(body, /ExecStart=".*node.*" ".*server\.mjs" --port 4317/, 'the unit names the installed server and the metal port')
    assert.match(body, /RED_QUEEN_MODE=metal/)
    assert.match(body, /WantedBy=default\.target/)

    const marker = readMarker(installed.target)
    assert.equal(marker.service?.kind, 'systemd-user')
    assert.equal(marker.service?.unit, unit)
    assert.equal(marker.service?.link, link)
    assert.equal(marker.service?.enabled, true)

    assert.ok(existsSync(link), 'the unit is linked into the user unit path')
    assert.ok(readFileSync(link, 'utf8').includes(installed.target), 'the link resolves to this install')
    assert.ok(existsSync(wants), 'the unit is enabled for the user session')
    assert.ok(calls(stub.log).some((line) => line === `--user link ${unit}`), `link called: ${calls(stub.log).join(' | ')}`)
    assert.ok(calls(stub.log).some((line) => line === '--user enable red-queen.service'))

    uninstall(installed)
    assert.equal(existsSync(installed.target), false)
    assert.equal(existsSync(link), false, 'uninstall removed the unit link')
    assert.equal(existsSync(wants), false, 'uninstall removed the enable link')
    assert.ok(calls(stub.log).some((line) => line === '--user disable red-queen.service'))
  } finally {
    rmSync(installed.prefix, { recursive: true, force: true })
    rmSync(configHome, { recursive: true, force: true })
  }
})

test('the script uninstall deregisters the unit too, so no orphan service is left', { timeout: 180_000 }, async (t) => {
  if (nonLinux) return t.skip(`the metal service is a systemd user unit; this host is ${process.platform}`)
  const stub = stubSystemctl()
  const configHome = scratchConfigHome()
  const env = { ...stub.env, XDG_CONFIG_HOME: configHome }
  const installed = install('metal', undefined, { service: true, env })
  const link = join(configHome, 'systemd', 'user', 'red-queen.service')
  const wants = join(configHome, 'systemd', 'user', 'default.target.wants', 'red-queen.service')
  try {
    assert.ok(existsSync(link))
    const result = spawnSync(process.execPath, [installer, 'uninstall', '--mode', 'metal', '--prefix', installed.prefix], { encoding: 'utf8', timeout: 20_000, env })
    assert.equal(result.status, 0, `uninstall failed: ${result.stderr}`)
    assert.match(result.stdout, /removed red-queen\.service/)
    assert.equal(existsSync(installed.target), false)
    assert.equal(existsSync(link), false, 'the unit link outlived the directory it pointed at')
    assert.equal(existsSync(wants), false)
  } finally {
    rmSync(installed.prefix, { recursive: true, force: true })
    rmSync(configHome, { recursive: true, force: true })
  }
})

test('metal install completes when no user manager answers, and says how to finish', { timeout: 180_000 }, async (t) => {
  if (nonLinux) return t.skip(`the metal service is a systemd user unit; this host is ${process.platform}`)
  const stub = stubSystemctl(true)
  const configHome = scratchConfigHome()
  const env = { ...stub.env, XDG_CONFIG_HOME: configHome }
  const installed = install('metal', undefined, { service: true, env })
  try {
    const marker = readMarker(installed.target)
    assert.equal(marker.service?.enabled, false, 'an unreachable manager must not be reported as enabled')
    assert.ok(existsSync(join(installed.target, 'red-queen.service')), 'the unit is still written for a later login')
    assert.equal(existsSync(join(configHome, 'systemd', 'user', 'red-queen.service')), false)
    assert.match(readFileSync(join(installed.target, 'README.txt'), 'utf8'), /no systemd user manager answered[\s\S]*systemctl --user link/)
    // Uninstall is still clean when nothing was registered.
    uninstall(installed)
  } finally {
    rmSync(installed.prefix, { recursive: true, force: true })
    rmSync(configHome, { recursive: true, force: true })
  }
})

test('a second metal install leaves the first install’s unit alone', { timeout: 180_000 }, async (t) => {
  if (nonLinux) return t.skip(`the metal service is a systemd user unit; this host is ${process.platform}`)
  const stub = stubSystemctl()
  const configHome = scratchConfigHome()
  const env = { ...stub.env, XDG_CONFIG_HOME: configHome }
  const link = join(configHome, 'systemd', 'user', 'red-queen.service')
  const first = install('metal', undefined, { service: true, env })
  const second = install('metal', undefined, { service: true, env })
  try {
    assert.ok(readFileSync(link, 'utf8').includes(first.target), 'the link still belongs to the first install')
    const marker = readMarker(second.target)
    assert.equal(marker.service?.enabled, false)
    assert.equal(calls(stub.log).filter((line) => line.startsWith('--user link ')).length, 1, 'only one install may link the unit')
    assert.match(readFileSync(join(second.target, 'README.txt'), 'utf8'), /belongs to another install/)

    // The second launcher will not even read the first one's unit.
    const refused = launcherRun(second, ['service'])
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /belongs to another install/)
    assert.match(launcherRun(first, ['service']).stdout, /enabled {2}enabled/)

    // Removing the second install must not deregister the first one's service.
    uninstall(second)
    assert.ok(existsSync(link), 'uninstall of the second prefix removed the first prefix’s unit')

    uninstall(first)
    assert.equal(existsSync(link), false)
  } finally {
    rmSync(first.prefix, { recursive: true, force: true })
    rmSync(second.prefix, { recursive: true, force: true })
    rmSync(configHome, { recursive: true, force: true })
  }
})
