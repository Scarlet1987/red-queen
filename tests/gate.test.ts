import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { hashInputs, readStamp, writeBuildStamp } from '../scripts/build-stamp.ts'
import { assess, gate, manifestFor, manifestPath } from '../scripts/deploy-gate.ts'

// The gate is the only thing standing between a stale build and the published
// site, so it is tested the same way the install is: against a real directory,
// with the suite stubbed out so the verdict is what is on trial.

interface Fixture {
  root: string
  cleanup: () => void
}

function workspace(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-gate-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'app.ts'), 'export const answer = 42\n')
  writeFileSync(join(root, 'index.html'), '<div id="root"></div>\n')
  writeFileSync(join(root, '.nvmrc'), '24\n')
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ engines: { node: '>=24' } }, null, 2)}\n`)
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** Build in the fixture, optionally as if the build had run on another Node. */
function build(root: string, runtime?: string): void {
  mkdirSync(join(root, 'dist', 'red_queen'), { recursive: true })
  mkdirSync(join(root, 'dist', 'client'), { recursive: true })
  writeFileSync(join(root, 'dist', 'red_queen', 'index.js'), 'export default { fetch() {} }\n')
  writeFileSync(join(root, 'dist', 'client', 'index.html'), '<div id="root"></div>\n')
  writeBuildStamp(root, { version: '1.0.0', compatibilityDate: '2026-09-29', worker: 'red_queen/index.js', assets: 'client', tag: 'v1.0.0' })
  if (runtime) stampField(root, 'node', runtime)
}

/** Rewrite one field of the stamp. The hash covers inputs, not the runtime. */
function stampField(root: string, field: string, value: unknown): void {
  const path = join(root, 'dist', 'build.json')
  const stamp = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  if (value === undefined) delete stamp[field]
  else stamp[field] = value
  writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`)
}

function run(root: string, checks = 0) {
  const out: string[] = []
  let calls = 0
  const code = gate(root, {
    log: (line) => out.push(line),
    error: (line) => out.push(line),
    runChecks: () => {
      calls += 1
      return checks
    },
  })
  return { code, out: out.join('\n'), calls }
}

test('a missing build is blocked before a single check runs', () => {
  const { root, cleanup } = workspace()
  try {
    const result = run(root)
    assert.equal(result.code, 1)
    assert.equal(result.calls, 0)
    assert.match(result.out, /no build in dist/i)
    assert.equal(existsSync(manifestPath(root)), false)
  } finally {
    cleanup()
  }
})

test('a build older than its source is blocked, names the file and clears the old manifest', () => {
  const { root, cleanup } = workspace()
  try {
    build(root)
    writeFileSync(manifestPath(root), '{"stale":true}\n')
    writeFileSync(join(root, 'src', 'app.ts'), 'export const answer = 43\n')

    const verdict = assess(root)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.ok ? '' : verdict.code, 'stale-build')
    assert.deepEqual(verdict.ok ? [] : verdict.changed, ['src/app.ts'])

    const result = run(root)
    assert.equal(result.code, 1)
    assert.equal(result.calls, 0)
    assert.match(result.out, /older than 1 source change/)
    assert.match(result.out, /src\/app\.ts/)
    assert.equal(existsSync(manifestPath(root)), false, 'a failed gate must leave nothing to deploy')
  } finally {
    cleanup()
  }
})

test('failing checks block the manifest even when the build is current', () => {
  const { root, cleanup } = workspace()
  try {
    build(root)
    assert.equal(assess(root).ok, true)

    const result = run(root, 1)
    assert.equal(result.code, 1)
    assert.equal(result.calls, 1)
    assert.match(result.out, /release checks failed/)
    assert.equal(existsSync(manifestPath(root)), false)
  } finally {
    cleanup()
  }
})

test('a current build with passing checks writes the manifest the deploy tool needs', () => {
  const { root, cleanup } = workspace()
  try {
    build(root)
    const result = run(root, 0)
    assert.equal(result.code, 0)
    assert.equal(result.calls, 1)
    assert.match(result.out, /Manifest written/)

    const written = JSON.parse(readFileSync(manifestPath(root), 'utf8')) as ReturnType<typeof manifestFor>
    const stamp = readStamp(root)
    assert.ok(stamp)
    assert.deepEqual(written, manifestFor(stamp))
    assert.equal(written.entrypoint, 'index.js')
    assert.equal(written.compatibilityDate, '2026-09-29')
    assert.deepEqual(written.modules, [{ name: 'index.js', type: 'esm', path: './red_queen/index.js' }])
    assert.equal(written.assetsDirectory, './client')
    assert.equal(written.spa, true)

    // Paths in the manifest resolve next to it, inside dist/.
    for (const entry of written.modules) assert.ok(existsSync(join(root, 'dist', entry.path)))
    assert.ok(existsSync(join(root, 'dist', written.assetsDirectory, 'index.html')))
  } finally {
    cleanup()
  }
})

test('a new build invalidates the manifest written by an earlier gate', () => {
  const { root, cleanup } = workspace()
  try {
    build(root)
    assert.equal(run(root, 0).code, 0)
    assert.equal(existsSync(manifestPath(root)), true)

    // Rebuilding replaces the bytes the checks ran against, so the manifest
    // cannot simply carry over — even though it would still look current.
    build(root)
    assert.equal(existsSync(manifestPath(root)), false, 'rebuilt bytes must not be deployable without the gate')
  } finally {
    cleanup()
  }
})

test('the stamp follows content, so an edit and its revert leave the build valid', () => {
  const { root, cleanup } = workspace()
  try {
    const first = hashInputs(root)
    writeFileSync(join(root, 'src', 'app.ts'), 'export const answer = 43\n')
    const edited = hashInputs(root)
    assert.notEqual(edited.hash, first.hash)
    assert.notEqual(edited.files['src/app.ts'], first.files['src/app.ts'])

    writeFileSync(join(root, 'src', 'app.ts'), 'export const answer = 42\n')
    assert.equal(hashInputs(root).hash, first.hash, 'a reverted edit should not count as drift')

    // Files that do not feed the build must not force a rebuild.
    mkdirSync(join(root, 'tests'), { recursive: true })
    writeFileSync(join(root, 'tests', 'something.test.ts'), 'test("x", () => {})\n')
    writeFileSync(join(root, 'README.md'), '# notes\n')
    assert.equal(hashInputs(root).hash, first.hash)
  } finally {
    cleanup()
  }
})

test('a changed Node pin invalidates the build, since the bytes were produced on that runtime', () => {
  const { root, cleanup } = workspace()
  try {
    writeFileSync(join(root, '.nvmrc'), '24\n')
    build(root)
    assert.equal(assess(root).ok, true)

    writeFileSync(join(root, '.nvmrc'), '26\n')
    const verdict = assess(root)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.ok ? '' : verdict.code, 'stale-build')
    assert.deepEqual(verdict.ok ? [] : verdict.changed, ['.nvmrc'])

    const result = run(root)
    assert.equal(result.code, 1)
    assert.equal(result.calls, 0, 'a build from a different runtime must not reach the checks')
    assert.match(result.out, /\.nvmrc/)
  } finally {
    cleanup()
  }
})

test('a build made on another runtime is blocked even when its inputs match', () => {
  const { root, cleanup } = workspace()
  try {
    build(root, 'v22.12.0')

    const verdict = assess(root)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.ok ? '' : verdict.code, 'runtime-mismatch')
    assert.match(verdict.ok ? '' : verdict.message, /Node 22\.12\.0.*pins 24/)

    const result = run(root)
    assert.equal(result.code, 1)
    assert.equal(result.calls, 0, 'a build from another runtime must not reach the checks')
    assert.equal(existsSync(manifestPath(root)), false)

    // Rebuilt on the pinned runtime, the same tree is publishable.
    build(root)
    assert.equal(run(root, 0).code, 0)
    assert.equal(existsSync(manifestPath(root)), true)
  } finally {
    cleanup()
  }
})

test('a build that does not record the Node it ran on is blocked, not assumed good', () => {
  const { root, cleanup } = workspace()
  try {
    build(root)
    stampField(root, 'node', undefined)

    const verdict = assess(root)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.ok ? '' : verdict.code, 'unverified-runtime')
    assert.match(verdict.ok ? '' : verdict.message, /does not record which Node/)

    const result = run(root)
    assert.equal(result.code, 1)
    assert.equal(result.calls, 0)
    assert.equal(existsSync(manifestPath(root)), false)
  } finally {
    cleanup()
  }
})

test('a build whose artefacts have gone missing is blocked', () => {
  const { root, cleanup } = workspace()
  try {
    build(root)
    rmSync(join(root, 'dist', 'client', 'index.html'))
    const verdict = assess(root)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.ok ? '' : verdict.code, 'missing-artifact')

    const result = run(root)
    assert.equal(result.code, 1)
    assert.equal(result.calls, 0)
    assert.match(result.out, /asset entry is missing/)
    assert.equal(existsSync(manifestPath(root)), false)
  } finally {
    cleanup()
  }
})
