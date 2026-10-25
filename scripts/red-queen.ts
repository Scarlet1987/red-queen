// Red Queen, installed locally in one command.
//
//   node scripts/red-queen.ts install --mode metal|sandbox|vm [--no-service]
//   node scripts/red-queen.ts start --mode sandbox
//   node scripts/red-queen.ts status --mode sandbox
//   node scripts/red-queen.ts uninstall --mode sandbox
//
// Every mode is a self-contained directory under ~/.red-queen/<mode>: app,
// server, catalogue, launcher and marker. Uninstall deletes that directory, so
// no components are left elsewhere on the host.
//
// A metal install also registers a systemd *user* unit, so the app starts again
// after a reboot instead of only when someone runs the launcher. The unit file
// is written into the install directory and linked from the user's unit path;
// uninstall removes the link before it deletes the directory, so the service
// cannot outlive the files it points at.
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const MODES = ['metal', 'sandbox', 'vm'] as const
type Mode = (typeof MODES)[number]

const PORTS: Record<Mode, number> = { metal: 4317, sandbox: 4318, vm: 4319 }

// The unit name is fixed: one metal install can own the service at a time, and
// a second prefix is told so rather than silently taking the link over.
const UNIT = 'red-queen.service'

const MODE_NOTES: Record<Mode, string[]> = {
  metal: [
    'Runs with your own user account, no extra isolation.',
    'The app, the Node server and the catalogue live in this directory and nowhere else.',
  ],
  sandbox: [
    'Runs under Node’s permission model: the process can read this app directory and nothing else.',
    'No child processes, workers, addons or inspector; reads outside the directory are denied.',
    'The server binds 127.0.0.1 only.',
  ],
  vm: [
    'A portable copy: move or copy this directory into the virtual machine you control, then run it there.',
    'Red Queen does not create, download or provision a VM image; it installs the self-contained copy.',
    'The same launcher works inside the VM, still bound to 127.0.0.1.',
  ],
}

const [command = 'help', ...rest] = process.argv.slice(2)

function flag(name: string): string | undefined {
  const index = rest.indexOf(`--${name}`)
  if (index >= 0) return rest[index + 1]
  const inline = rest.find((arg) => arg.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : undefined
}

const modeArg = flag('mode') ?? 'metal'
if (!(MODES as readonly string[]).includes(modeArg)) {
  console.error(`Unknown mode "${modeArg}". Use one of: ${MODES.join(', ')}.`)
  process.exit(2)
}
const mode = modeArg as Mode

const prefix = resolve(flag('prefix') ?? join(homedir(), '.red-queen'))
const target = join(prefix, mode)
const launcher = join(target, 'red-queen')

// Opt out of the boot-time unit: useful for a throwaway install, and what the
// install tests use so a test prefix never edits the host's unit path.
const noService = rest.includes('--no-service') || process.env.RED_QUEEN_NO_SERVICE === '1'

function version(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function buildIfNeeded(): void {
  if (existsSync(join(process.cwd(), 'dist', 'server', 'server.mjs')) && existsSync(join(process.cwd(), 'dist', 'client', 'index.html'))) return
  console.log('Building the app first…')
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { stdio: 'inherit' })
  if (result.status !== 0) fail('The build failed; nothing was installed.')
}

// --- per-user service -------------------------------------------------------
//
// Only the metal mode registers one: sandbox is a permission-confined session
// rather than a daemon, and vm is a copy meant to be moved somewhere else.

interface Service {
  kind: 'systemd-user'
  unit: string
  link: string | null
  enabled: boolean
  note: string
}

function systemdUserDir(): string {
  const home = process.env.XDG_CONFIG_HOME?.trim()
  return join(home && home !== '' ? home : join(homedir(), '.config'), 'systemd', 'user')
}

interface Run {
  status: number | null
  error?: Error
  stdout: string
  stderr: string
}

function systemctl(args: string[]): Run {
  const result = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' })
  return { status: result.status, error: result.error ?? undefined, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

function outputOf(result: Run): string {
  const text = `${result.stderr}${result.stdout}`.trim()
  return text.split('\n').find((line) => line.trim() !== '') ?? 'no detail'
}

function unitBody(): string {
  // The unit is written for the Node that installed it, by absolute path: a
  // user service starts with a bare PATH where `node` may not resolve at all.
  const exec = join(target, 'app', 'server', 'server.mjs')
  return [
    `# Managed by Red Queen: ${target}`,
    '# Written by the metal install; uninstall removes this file and its link.',
    '[Unit]',
    `Description=Red Queen ${version()} (metal install)`,
    'After=default.target',
    '',
    '[Service]',
    'Type=simple',
    `WorkingDirectory=${join(target, 'app')}`,
    'Environment=RED_QUEEN_MODE=metal',
    `ExecStart="${process.execPath}" "${exec}" --port ${PORTS.metal}`,
    'Restart=on-failure',
    'RestartSec=2',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

function registerService(): Service {
  const unit = join(target, UNIT)
  const link = join(systemdUserDir(), UNIT)
  writeFileSync(unit, unitBody())
  const base: Service = { kind: 'systemd-user', unit, link, enabled: false, note: '' }
  const later = `register it with: systemctl --user link "${unit}" && systemctl --user enable ${UNIT}`

  if (process.platform !== 'linux') {
    return { ...base, link: null, note: `this host is ${process.platform}, so the unit is written but not registered; on Linux it goes in the user unit path` }
  }

  const probe = systemctl(['show-environment'])
  if (probe.error || probe.status !== 0) {
    return { ...base, note: `no systemd user manager answered (${outputOf(probe)}); ${later}` }
  }

  // A link from an earlier install may point somewhere else. Leave it alone and
  // say so: silently re-pointing it would enable a directory nobody asked for.
  if (existsSync(link)) {
    let owner = ''
    try {
      owner = readFileSync(link, 'utf8')
    } catch {
      owner = ''
    }
    if (!owner.includes(target)) {
      return { ...base, note: `${link} already exists and belongs to another install; left it alone — remove it, then ${later}` }
    }
    systemctl(['unlink', UNIT])
  }

  const linked = systemctl(['link', unit])
  if (linked.status !== 0) return { ...base, note: `systemctl --user link refused (${outputOf(linked)}); ${later}` }

  const enabled = systemctl(['enable', UNIT])
  if (enabled.status !== 0) {
    return { ...base, note: `linked, but not enabled (${outputOf(enabled)}); run: systemctl --user enable ${UNIT}` }
  }
  return { ...base, enabled: true, note: '' }
}

// Removes only a unit that points at this install, so uninstall can never take
// out another prefix's service — or an unrelated unit that shares the name.
function unregisterService(): string | null {
  const dir = systemdUserDir()
  const link = join(dir, UNIT)
  const wants = join(dir, 'default.target.wants', UNIT)
  if (!existsSync(link)) return null

  let own = false
  try {
    own = readFileSync(link, 'utf8').includes(target)
  } catch {
    own = false
  }
  if (!own) return `left ${link} alone: it does not belong to ${target}`

  systemctl(['disable', UNIT])
  rmSync(link, { force: true })
  rmSync(wants, { force: true })
  systemctl(['daemon-reload'])
  return `removed ${UNIT} from the systemd user manager; Red Queen no longer starts at login or after a reboot`
}

// --- install ----------------------------------------------------------------

function install(): void {
  if (existsSync(target)) fail(`${target} already exists. Run: ${launcher} uninstall`)
  buildIfNeeded()

  mkdirSync(join(target, 'app'), { recursive: true })
  cpSync(join(process.cwd(), 'dist', 'client'), join(target, 'app', 'client'), { recursive: true })
  cpSync(join(process.cwd(), 'dist', 'server'), join(target, 'app', 'server'), { recursive: true })

  const service = mode === 'metal' && !noService ? registerService() : null
  const installedAt = new Date().toISOString()
  writeFileSync(
    join(target, 'install.json'),
    JSON.stringify(
      {
        program: 'red-queen',
        version: version(),
        mode,
        port: PORTS[mode],
        installedAt,
        directory: target,
        service: service ? { kind: service.kind, unit: service.unit, link: service.link, enabled: service.enabled } : null,
      },
      null,
      2,
    ) + '\n',
  )

  const readFlag = mode === 'sandbox' ? `--permission --allow-fs-read="$here/app"` : ''
  const removal = mode === 'metal'
    ? `    conf="\${XDG_CONFIG_HOME:-\$HOME/.config}/systemd/user"
    if [ -f "$conf/red-queen.service" ] && grep -qF "$here" "$conf/red-queen.service"; then
      if command -v systemctl >/dev/null 2>&1; then
        systemctl --user disable red-queen.service >/dev/null 2>&1 || true
      fi
      rm -f -- "$conf/red-queen.service" "$conf/default.target.wants/red-queen.service"
      if command -v systemctl >/dev/null 2>&1; then
        systemctl --user daemon-reload >/dev/null 2>&1 || true
      fi
      echo "Removed the systemd user unit: Red Queen no longer starts at login or after a reboot."
    fi
`
    : ''
  // Metal's launcher can also read and steer the unit. Status is read live from
  // the user manager rather than from install.json: the marker says what the
  // install did, this says what systemd will actually do.
  const control = mode === 'metal'
    ? `  service)
    conf="\${XDG_CONFIG_HOME:-\$HOME/.config}/systemd/user"
    unit="$conf/red-queen.service"
    action="\${2:-status}"

    if [ ! -f "$unit" ]; then
      echo "No systemd unit is registered for $here." >&2
      echo "Register this one with:" >&2
      echo "  systemctl --user link \\"$here/red-queen.service\\" && systemctl --user enable red-queen.service" >&2
      exit 1
    fi
    if ! grep -qF "$here" "$unit"; then
      echo "$unit belongs to another install; leaving it alone." >&2
      exit 1
    fi
    if ! command -v systemctl >/dev/null 2>&1; then
      echo "systemctl is not on PATH, so the service cannot be read or changed here." >&2
      exit 1
    fi

    case "$action" in
      status)
        enabled=$(systemctl --user is-enabled red-queen.service 2>/dev/null || true)
        active=$(systemctl --user is-active red-queen.service 2>/dev/null || true)
        echo "Red Queen — metal service"
        echo "  unit     $unit"
        echo "  enabled  \${enabled:-unknown}"
        echo "  running  \${active:-unknown}"
        if [ "$active" = "active" ]; then
          echo "  address  http://127.0.0.1:$port"
        fi
        if [ "$enabled" != "enabled" ]; then
          echo "  note     it does not start on boot: $0 service enable"
        fi
        ;;
      start|stop|enable|disable)
        systemctl --user "$action" red-queen.service
        case "$action" in
          start) echo "Started: http://127.0.0.1:$port" ;;
          stop) echo "Stopped. It starts again at login unless you disable it." ;;
          enable) echo "Enabled: starts with your user session and after a reboot." ;;
          disable) echo "Disabled: it will not start on boot. $0 service start runs it now." ;;
        esac
        ;;
      *)
        echo "usage: $0 service [status|start|stop|enable|disable]" >&2
        exit 2
        ;;
    esac
    ;;
`
    : ''
  const usage = mode === 'metal'
    ? 'start [port] | service [status|start|stop|enable|disable] | status | uninstall'
    : 'start [port] | status | uninstall'
  const script = `#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mode=${mode}
port=${PORTS[mode]}

case "\${1:-start}" in
  start)
    cd "$here/app"
    RED_QUEEN_MODE="$mode" exec node ${readFlag} "$here/app/server/server.mjs" --port "\${2:-$port}"
    ;;
  status)
    if [ -f "$here/install.json" ]; then cat "$here/install.json"; else echo "not installed" >&2; exit 1; fi
    ;;
${control}  uninstall)
    if [ ! -f "$here/install.json" ]; then echo "Refusing to remove $here: no install marker." >&2; exit 1; fi
${removal}    parent=$(dirname -- "$here")
    cd /
    rm -rf -- "$here"
    rmdir -- "$parent" 2>/dev/null || true
    echo "Removed $here — the program, its bundle and its directory are gone."
    echo "Browser data for this port is separate; clear it from Safety → Forget everything on this device before uninstalling."
    ;;
  *)
    echo "usage: $0 ${usage}" >&2
    exit 2
    ;;
esac
`
  writeFileSync(launcher, script)
  chmodSync(launcher, 0o755)

  writeFileSync(join(target, 'README.txt'), readme(installedAt, service))

  console.log('')
  console.log(`Installed Red Queen ${version()} · ${mode}`)
  console.log(`  directory  ${target}`)
  console.log(`  start      ${launcher} start`)
  console.log(`  status     ${launcher} status`)
  console.log(`  uninstall  ${launcher} uninstall`)
  console.log(`  address    http://127.0.0.1:${PORTS[mode]}`)
  if (service) {
    console.log(`  service    ${UNIT} · ${service.enabled ? 'enabled: starts at login and after a reboot' : 'written, not enabled'}`)
    if (service.note) console.log(`             ${service.note}`)
    if (service.enabled) console.log(`  logs       journalctl --user -u ${UNIT}`)
    console.log(`  control    ${launcher} service [status|start|stop|enable|disable]`)
  } else if (mode === 'metal') {
    console.log('  service    none (--no-service): it runs when you start it')
  }
  console.log('')
  for (const note of MODE_NOTES[mode]) console.log(`  ${note}`)
  console.log('')
}

function readme(installedAt: string, service: Service | null): string {
  const serviceLines = service
    ? [
        '',
        'Service (systemd user):',
        `  unit    ${service.unit}`,
        `  linked  ${service.link ?? '(not linked on this host)'}`,
        ...(service.enabled
          ? [
              '  enabled yes — start it now with: systemctl --user start red-queen.service',
              '  It also starts at login and after a reboot. Logs: journalctl --user -u',
              '  red-queen.service. To reach it before you log in, enable lingering for',
              '  your account: loginctl enable-linger "$USER".',
            ]
          : ['  enabled no', `  ${service.note}`]),
        '',
        `  status  ${join(target, 'red-queen')} service`,
        `  control ${join(target, 'red-queen')} service start|stop|enable|disable`,
        '',
        `  Remove it with: ${join(target, 'red-queen')} uninstall`,
        '  (uninstall deregisters the unit before it deletes this directory).',
      ]
    : mode === 'metal'
      ? ['', 'Service: none (installed with --no-service). It runs only when you start it.']
      : []
  return [
    `Red Queen 1.0 · ${mode} install`,
    '',
    `Installed: ${installedAt}`,
    `Directory: ${target}`,
    `Address:   http://127.0.0.1:${PORTS[mode]}`,
    '',
    'Start:',
    '  ./red-queen start',
    '  ./red-queen start 4500     (choose another port)',
    '',
    'Stop: Ctrl+C.',
    ...serviceLines,
    '',
    'Uninstall:',
    '  ./red-queen uninstall',
    '',
    'This removes the directory shown below, including the app, server,',
    'catalogue and launcher. Nothing is installed anywhere else.',
    '',
    'Browser data (rack, refinements, worksheets, harness setup, conversation)',
    'lives in the browser for this address, not on disk. Clear it from',
    'Safety → Forget everything on this device before you uninstall.',
    '',
    ...MODE_NOTES[mode].map((line) => `- ${line.replace(/’/g, "'")}`),
    '',
  ].join('\n')
}

function start(): void {
  if (!existsSync(launcher)) fail(`${target} is not installed. Run: node scripts/red-queen.ts install --mode ${mode}`)
  const result = spawnSync(launcher, ['start'], { stdio: 'inherit' })
  if (result.error) fail(`Could not start ${launcher}: ${result.error.message}`)
  process.exitCode = result.status ?? 1
}

function status(): void {
  const marker = join(target, 'install.json')
  if (!existsSync(marker)) fail(`${target} is not installed.`)
  try {
    console.log(readFileSync(marker, 'utf8').trim())
  } catch (error) {
    fail(`Could not read ${marker}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function uninstall(): void {
  const marker = join(target, 'install.json')
  if (!existsSync(marker)) fail(`Refusing to remove ${target}: no install marker.`)
  let info: { program?: string; mode?: string }
  try {
    info = JSON.parse(readFileSync(marker, 'utf8')) as { program?: string; mode?: string }
  } catch {
    fail(`Refusing to remove ${target}: the install marker is unreadable.`)
  }
  if (info.program !== 'red-queen' || info.mode !== mode) fail(`Refusing to remove ${target}: the marker does not match this mode.`)
  // Deregister first: the unit file lives inside the directory, so deleting the
  // directory first would leave the user manager pointing at nothing.
  const note = unregisterService()
  rmSync(target, { recursive: true, force: false })
  try {
    if (readdirSync(prefix).length === 0) rmdirSync(prefix)
  } catch {
    // The prefix is shared or already gone; nothing to clean up.
  }
  if (note) console.log(note)
  console.log(`Removed ${target} — the program, its bundle and its directory are gone.`)
}

switch (command) {
  case 'install':
    install()
    break
  case 'start':
    start()
    break
  case 'status':
    status()
    break
  case 'uninstall':
    uninstall()
    break
  default:
    console.log('Red Queen local install')
    console.log('')
    console.log('  node scripts/red-queen.ts install   --mode metal|sandbox|vm [--prefix DIR] [--no-service]')
    console.log('  node scripts/red-queen.ts start     --mode metal|sandbox|vm')
    console.log('  node scripts/red-queen.ts status    --mode metal|sandbox|vm [--prefix DIR]')
    console.log('  node scripts/red-queen.ts uninstall --mode metal|sandbox|vm [--prefix DIR]')
    console.log('')
    console.log('Each mode installs into its own directory under ~/.red-queen.')
    console.log('A metal install also registers a systemd user unit (red-queen.service),')
    console.log('so it starts again after a reboot; uninstall removes that unit too.')
}
