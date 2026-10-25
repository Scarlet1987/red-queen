import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { requireRuntime, verdictFor } from '../scripts/check-runtime.ts'
import { accepts, readPin, readPinConfig, show } from '../scripts/node-pin.ts'

// The runtime is pinned in exactly one place, .nvmrc, and both workflows read
// that file. Nothing checks it for us: .nvmrc is read by nvm and setup-node,
// `engines` is only a warning during install, and the two never meet. So the pin
// can drift from the range it is supposed to satisfy — .nvmrc 24 against
// engines ">=26" — and every job stays green while npm prints EBADENGINE into a
// log nobody reads. These tests make that disagreement fail instead.
//
// The reading and comparison live in scripts/node-pin.ts because the deploy gate
// asks the same question of a build's own runtime; only the repository-wide
// assertions belong here.
const ROOT = fileURLToPath(new URL('..', import.meta.url))

function unwrap<T>(result: { ok: true; value: T } | { ok: false; reason: string }, subject: string): T {
  if (!result.ok) assert.fail(`${subject}: ${result.reason}`)
  return result.value
}

/** The `uses: actions/setup-node` steps of a workflow, one string each. */
function setupNodeSteps(source: string): string[] {
  const lines = source.split('\n')
  const steps: string[] = []
  lines.forEach((line, index) => {
    if (!/uses:\s*actions\/setup-node@/.test(line)) return
    const indent = line.search(/\S/)
    const block = [line]
    for (const next of lines.slice(index + 1)) {
      const nextIndent = next.search(/\S/)
      if (next.trim() && nextIndent < indent) break
      if (next.trim() && nextIndent === indent) break
      block.push(next)
    }
    steps.push(block.join('\n'))
  })
  return steps
}

const WORKFLOWS = ['ci.yml', 'pr.yml']

test('.nvmrc and package.json engines.node agree', () => {
  const config = unwrap(readPinConfig(ROOT), 'the runtime pin cannot be read')

  const verdict = accepts(config.engine, config.pin)
  assert.equal(verdict.ok, true, `engines.node cannot be read: ${verdict.ok ? '' : verdict.reason}`)
  assert.equal(
    verdict.ok && verdict.value,
    true,
    `.nvmrc pins Node ${show(config.pin)} but package.json engines.node is "${config.engine}", so CI and a local checkout run different runtimes — change whichever is wrong`,
  )
})

test('both workflows take the runtime from .nvmrc rather than repeating it', () => {
  for (const name of WORKFLOWS) {
    const path = join(ROOT, '.github', 'workflows', name)
    assert.equal(existsSync(path), true, `${name} is missing`)

    const source = readFileSync(path, 'utf8')
    assert.doesNotMatch(
      source,
      /^\s*node-version:/m,
      `${name} hardcodes node-version, which is the copy that drifts — use node-version-file: .nvmrc`,
    )

    const steps = setupNodeSteps(source)
    assert.ok(
      steps.length > 0,
      `${name} sets up no Node at all, so nothing enforces .nvmrc — add actions/setup-node with node-version-file: .nvmrc, or pin the runtime in whatever image replaced it`,
    )
    for (const step of steps) {
      assert.match(
        step,
        /node-version-file:\s*['"]?\.nvmrc/,
        `${name} sets up Node without node-version-file: .nvmrc, so CI can run a different version than a local checkout\n${step}`,
      )
    }
  }
})

test('every entry point that builds or serves starts with the runtime check', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
  const scripts = manifest.scripts ?? {}
  for (const name of ['dev', 'build', 'offline']) {
    assert.match(
      scripts[name] ?? '',
      /^node scripts\/check-runtime\.ts && /,
      `npm run ${name} does not check the runtime first, so it can run on a Node .nvmrc does not pin`,
    )
  }

  // The installer shells out to npm run build, so it inherits that guard rather
  // than needing its own.
  assert.match(scripts['install:red-queen'] ?? '', /scripts\/red-queen\.ts/)
})

test('a build on a runtime outside the pin is refused before it starts', () => {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-runtime-'))
  try {
    writeFileSync(join(root, '.nvmrc'), '24\n')
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({ engines: { node: '>=24' } })}\n`)

    const ok = verdictFor(root, 'v24.17.0')
    assert.deepEqual(ok, { ok: true, runtime: 'v24.17.0', pin: '24' })

    const wrong = verdictFor(root, 'v22.12.0')
    assert.equal(wrong.ok, false)
    assert.match(wrong.ok ? '' : wrong.message, /Node 22\.12\.0, but \.nvmrc pins 24/)
    assert.match(wrong.ok ? '' : wrong.message, /nvm use/, 'the refusal has to say how to fix it')

    // The builder form refuses by throwing, since it is called from inside a
    // script rather than owning the exit code.
    assert.throws(() => requireRuntime(root, 'v22.12.0'), /Build refused: This is Node 22\.12\.0/)
    assert.doesNotThrow(() => requireRuntime(root, 'v24.17.0'))

    // No pin means nothing to verify against, which is a refusal, not a pass.
    rmSync(join(root, '.nvmrc'))
    const missing = verdictFor(root, 'v24.17.0')
    assert.equal(missing.ok, false)
    assert.match(missing.ok ? '' : missing.message, /no \.nvmrc/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the builders check for themselves, so a bare command cannot skip the guard', () => {
  // A tripwire, not a style check: removing either line reopens the bypass the
  // test above describes, and the npm scripts cannot cover it.
  for (const [file, call] of [
    ['vite.config.ts', /^requireRuntime\(import\.meta\.dirname\)$/m],
    ['scripts/build-offline.ts', /^const runtime = verdictFor\(root\)$/m],
  ] as const) {
    assert.match(
      readFileSync(join(ROOT, file), 'utf8'),
      call,
      `${file} no longer checks the runtime itself, so running it without npm runs on any Node`,
    )
  }
})

test('the range reader is what it claims, so a disagreement cannot slip past it', () => {
  const cases: Array<[string, string, boolean]> = [
    // The pin this repository ships, against ranges that accept and reject it.
    ['24', '>=24', true],
    ['24', '>=26', false],
    ['24', '>=24 <25', true],
    ['24.17.0', '>=24 <24.17', false],
    ['24.17.0', '>=24.17.0 <25', true],
    ['24.17.0', '^24.17.0', true],
    ['24.17.0', '^25.0.0', false],
    ['25.0.0', '~24.17.0', false],
    ['24.17.0', '>=20 || ^26', true],
    ['24.17.0', '>=26 || ^27', false],
    ['24.9.0', '24.x', true],
    ['25.0.0', '24.x', false],
    ['24.17.0', '24.17.x', true],
    ['24.18.0', '24.17.x', false],
  ]

  for (const [pinText, range, expected] of cases) {
    const pin = unwrap(readPin(pinText), '.nvmrc cannot be read')
    const verdict = accepts(range, pin)
    assert.equal(verdict.ok, true, `"${range}" should be readable: ${verdict.ok ? '' : verdict.reason}`)
    assert.equal(verdict.ok && verdict.value, expected, `Node ${pinText} against "${range}"`)
  }

  // Forms it cannot read are failures, not passes.
  for (const range of ['24 - 26', 'lts/*', '>=24.0.0-rc.1', 'next']) {
    assert.equal(accepts(range, { major: 24, minor: 0, patch: 0 }).ok, false, `"${range}" should be refused rather than assumed compatible`)
  }
  for (const text of ['node', 'lts/*', '']) {
    assert.equal(readPin(text).ok, false, `${JSON.stringify(text)} should not be accepted as a pin`)
  }
})
