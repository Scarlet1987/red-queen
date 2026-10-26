import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// install.sh is the one-command entry point: install from the checkout you are
// in, or clone the repository first. These tests drive it the three ways a user
// can reach it — as a file, piped through sh, and with nowhere to install from —
// and pin the promises that make it safe: it never installs over an existing
// copy, and a failed clone leaves no half-install behind.
//
// It runs installs, so it lives in tests/slow/; `repo` is two levels up.
const repo = fileURLToPath(new URL('../..', import.meta.url))
const installer = join(repo, 'install.sh')
const body = readFileSync(installer, 'utf8')

// The version the installer announces comes from package.json, so the test asks
// the same file rather than pinning a number that a release bump would break.
const version = (JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string }).version

const scratchDirs: string[] = []

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratchDirs.push(dir)
  return dir
}

process.on('exit', () => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

function ensureBuild(): void {
  if (existsSync(join(repo, 'dist', 'server', 'server.mjs')) && existsSync(join(repo, 'dist', 'client', 'index.html'))) return
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: repo, encoding: 'utf8', timeout: 120_000 })
  assert.equal(build.status, 0, `build failed: ${build.stderr}`)
}

// The unit path must never be the host's: an install here registers a real
// systemd unit unless it is told not to, and a test prefix is not the machine.
const unitHome = scratch('red-queen-boot-units-')
const env = { ...process.env, XDG_CONFIG_HOME: unitHome }

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function runAsFile(args: string[], options: { cwd?: string } = {}): Run {
  return spawnSync('sh', [installer, ...args], { cwd: options.cwd ?? repo, encoding: 'utf8', timeout: 180_000, env })
}

// What `curl … | sh -s -- …` does: no script path, so $0 is "sh".
function runPiped(args: string[], options: { cwd?: string } = {}): Run {
  return spawnSync('sh', ['-s', '--', ...args], { cwd: options.cwd ?? repo, encoding: 'utf8', timeout: 180_000, env, input: body })
}

function marker(prefix: string, mode: string): { mode: string; port: number; installedAt: string; service: unknown } {
  const file = join(prefix, mode, 'install.json')
  assert.ok(existsSync(file), `no install marker at ${file}`)
  return JSON.parse(readFileSync(file, 'utf8')) as { mode: string; port: number; installedAt: string; service: unknown }
}

test('--help explains the one-liner and every option', () => {
  const help = runAsFile(['--help'])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /curl -fsSL .*\/install\.sh \| sh -s -- \[options\]/)
  assert.match(help.stdout, /--mode metal\|sandbox\|vm/)
  assert.match(help.stdout, /--repo URL/)
  assert.match(help.stdout, /--no-launch/)
})

test('an unknown option stops before anything is installed', () => {
  const prefix = join(scratch('red-queen-boot-bad-'), 'rq')
  const bad = runAsFile(['--nope', '--prefix', prefix])
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /unknown option --nope/)
  assert.equal(existsSync(prefix), false)

  const mode = runAsFile(['--mode', 'potato', '--prefix', prefix])
  assert.equal(mode.status, 1)
  assert.match(mode.stderr, /unknown mode "potato"/)
  assert.equal(existsSync(prefix), false)
})

test('installs from the checkout it sits next to, and again is a no-op', { timeout: 180_000 }, () => {
  ensureBuild()
  const prefix = join(scratch('red-queen-boot-'), 'rq')
  const first = runAsFile(['--prefix', prefix, '--mode', 'metal', '--no-service', '--no-launch'])
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /Installing from /)
  assert.match(first.stdout, new RegExp(`Installed Red Queen ${version.replaceAll('.', '\\.')} · metal`))
  assert.match(first.stdout, /Install only\. Start it when you want it\./)

  const installed = marker(prefix, 'metal')
  assert.equal(installed.mode, 'metal')
  assert.equal(installed.port, 4317)
  assert.equal(installed.service, null, '--no-service must reach the installer')
  assert.equal(existsSync(join(prefix, 'metal', 'red-queen')), true)
  // The summary must not offer service commands that were never registered.
  assert.doesNotMatch(first.stdout, /red-queen service \[start\|stop\|enable\|disable\]/)

  const second = runAsFile(['--prefix', prefix, '--mode', 'metal', '--no-service', '--no-launch'])
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /Already installed at /)
  assert.equal(marker(prefix, 'metal').installedAt, installed.installedAt, 'a second run reinstalled over the first')

  const gone = spawnSync(join(prefix, 'metal', 'red-queen'), ['uninstall'], { encoding: 'utf8', env })
  assert.equal(gone.status, 0, gone.stderr)
})

test('works piped into sh, reading the checkout from the current directory', { timeout: 180_000 }, () => {
  ensureBuild()
  const prefix = join(scratch('red-queen-boot-pipe-'), 'rq')
  // The repo path is deliberately unreachable: if detection ever falls through
  // to cloning, this test fails instead of reaching the network.
  const piped = runPiped(['--prefix', prefix, '--mode', 'sandbox', '--no-service', '--no-launch', '--repo', '/nonexistent/red-queen.git'])
  assert.equal(piped.status, 0, piped.stderr)
  assert.match(piped.stdout, /Installing from /)
  assert.equal(marker(prefix, 'sandbox').mode, 'sandbox')
  assert.equal(existsSync(join(prefix, 'sandbox', 'red-queen')), true)
})

test('with no checkout it clones, and a failed clone leaves nothing behind', () => {
  const nest = scratch('red-queen-boot-clone-')
  const prefix = join(nest, 'rq')
  const source = join(nest, 'src')
  const failed = runPiped(['--prefix', prefix, '--source', source, '--mode', 'metal', '--no-service', '--no-launch', '--repo', join(nest, 'not-a-repo.git')], { cwd: nest })
  assert.equal(failed.status, 1)
  assert.match(failed.stdout, /Cloning /)
  assert.match(failed.stderr, /could not clone /)
  assert.equal(existsSync(prefix), false, 'a failed clone installed something')
})

test('refuses a source directory inside the prefix it installs into', () => {
  const nest = scratch('red-queen-boot-src-')
  const prefix = join(nest, 'rq')
  const refused = runPiped(['--prefix', prefix, '--source', join(prefix, 'src')], { cwd: nest })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /may not live inside --prefix/)
  assert.equal(existsSync(prefix), false)
})
