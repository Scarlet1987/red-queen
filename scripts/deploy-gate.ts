// The deploy gate. Publishing is only allowed from a tree that was built from
// the source it is now sitting on and whose checks just passed.
//
//   npm run gate        (usually through npm run release: build, then gate)
//
// It refuses when the build is missing, when the source has changed since the
// build, when an artefact the manifest points at is gone, or when the release
// checks fail. In every one of those cases it also removes dist/deploy.json, so
// there is no manifest to hand the deploy tool: the block is the absence of the
// thing being published, not a warning someone can scroll past.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashInputs, manifestPath, readStamp, type Stamp } from './build-stamp.ts'
import { accepts, readPin, readPinConfig, show } from './node-pin.ts'
import { refreshStatusFile, STATUS } from './release-log.ts'

export { manifestPath }

const ROOT = join(import.meta.dirname, '..')

export type Refusal = 'missing-build' | 'stale-build' | 'missing-artifact' | 'unpinned' | 'unverified-runtime' | 'runtime-mismatch'

export type Assessment = { ok: true; stamp: Stamp } | { ok: false; code: Refusal; message: string; changed: string[] }

function differences(stamped: Record<string, string>, current: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(stamped), ...Object.keys(current)])
  return [...keys].filter((key) => stamped[key] !== current[key]).sort()
}

/** Decide whether dist/ is a publishable build of the source in root. */
export function assess(root: string): Assessment {
  const stamp = readStamp(root)
  if (!stamp) {
    return {
      ok: false,
      code: 'missing-build',
      message: 'There is no build in dist/ (or its build.json is unreadable).',
      changed: [],
    }
  }

  const changed = differences(stamp.files, hashInputs(root).files)
  if (changed.length) {
    return {
      ok: false,
      code: 'stale-build',
      message: `The build is older than ${changed.length} source change${changed.length === 1 ? '' : 's'}.`,
      changed,
    }
  }

  for (const [label, path] of [
    ['Worker module', join(root, 'dist', stamp.worker)],
    ['asset entry', join(root, 'dist', stamp.assets, 'index.html')],
  ] as const) {
    if (!existsSync(path)) {
      return { ok: false, code: 'missing-artifact', message: `The ${label} is missing: ${path}`, changed: [] }
    }
  }

  // The bytes were produced by whatever Node ran the build, and .nvmrc names the
  // one that is supported. A build stamped anywhere else is not this project's
  // output, even when the inputs are identical.
  const config = readPinConfig(root)
  if (!config.ok) {
    return { ok: false, code: 'unpinned', message: `The build's runtime cannot be checked: ${config.reason}.`, changed: [] }
  }

  const built = readPin(stamp.node)
  if (!built.ok) {
    return {
      ok: false,
      code: 'unverified-runtime',
      message: stamp.node
        ? `The build records its runtime as ${JSON.stringify(stamp.node)}, which cannot be compared to .nvmrc: ${built.reason}.`
        : 'The build does not record which Node produced it (its stamp predates the record), so its runtime cannot be verified.',
      changed: [],
    }
  }

  const pinned = accepts(config.value.text, built.value)
  if (!pinned.ok) {
    return { ok: false, code: 'unpinned', message: `The runtime pin cannot be read: ${pinned.reason}.`, changed: [] }
  }
  if (!pinned.value) {
    return {
      ok: false,
      code: 'runtime-mismatch',
      message: `The build was made on Node ${show(built.value)}, but .nvmrc pins ${config.value.text}.`,
      changed: [],
    }
  }

  return { ok: true, stamp }
}

/** The Sites manifest, derived from the build rather than hand-maintained. */
export function manifestFor(stamp: Stamp) {
  return {
    entrypoint: 'index.js',
    compatibilityDate: stamp.compatibilityDate,
    modules: [{ name: 'index.js', type: 'esm', path: `./${stamp.worker}` }],
    assetsDirectory: `./${stamp.assets}`,
    spa: true,
  }
}

function npmCheck(root: string): number {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'check'], { cwd: root, stdio: 'inherit' })
  if (result.error) {
    console.error(`Could not run the release checks: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

export interface GateIO {
  log: (line: string) => void
  error: (line: string) => void
  runChecks: (root: string) => number
}

const REMEDY = 'Run npm run release (build, then this gate) before publishing.'

/** Returns the process exit code: 0 only when the manifest was written. */
export function gate(root: string, io: Partial<GateIO> = {}): number {
  const log = io.log ?? console.log
  const error = io.error ?? console.error
  const runChecks = io.runChecks ?? npmCheck
  const target = manifestPath(root)

  // A manifest from an earlier run must never survive a failed one.
  rmSync(target, { force: true })

  const verdict = assess(root)
  if (!verdict.ok) {
    error(`Deploy blocked: ${verdict.message}`)
    for (const path of verdict.changed.slice(0, 10)) error(`  changed  ${path}`)
    if (verdict.changed.length > 10) error(`  …and ${verdict.changed.length - 10} more`)
    error(REMEDY)
    return 1
  }

  const { stamp } = verdict
  log('Red Queen deploy gate')
  log(`  build    ${stamp.version} · ${stamp.builtAt}`)
  log(`  inputs   ${Object.keys(stamp.files).length} files · ${stamp.hash.slice(0, 19)}…`)
  log(`  worker   dist/${stamp.worker}`)
  log(`  assets   dist/${stamp.assets}`)
  const pin = readPinConfig(root)
  log(`  runtime  ${stamp.node}${pin.ok ? ` · pinned ${pin.value.text}` : ''}`)
  log('')
  log('Running the release checks (typecheck, tests, COS-G)…')

  if (runChecks(root) !== 0) {
    error('')
    error('Deploy blocked: the release checks failed, so no manifest was written.')
    error(REMEDY)
    return 1
  }

  const manifest = manifestFor(stamp)
  writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n')

  log('')
  log(`Manifest written: ${target}`)
  log(`Publish with sites_deploy using manifestPath ${manifestPath(root).replace(`${resolve(root)}/`, '')}.`)

  // A new build is not a deployment: refresh the log's status line so the gap
  // shows up in RELEASES.md until release:log records the deploy.
  const refreshed = refreshStatusFile(root)
  if (refreshed) log(`  log      ${refreshed.status.replace(`${STATUS} `, '')}`)
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exitCode = gate(ROOT)
