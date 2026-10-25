import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { writeBuildStamp, type Stamp } from '../scripts/build-stamp.ts'
import { HEADER_ROW, newestBuild, place, refreshStatusFile, RUNTIME_UNKNOWN, rowFor, shortHash, STATUS, statusFor, verifyLog, withStatus } from '../scripts/release-log.ts'
import type { Check } from '../scripts/smoke.ts'

// The release log is the only durable record of what was published, so the row
// format and the placement rules are pinned: newest first, one row per build per
// environment, deployments kept on re-checks, failures still written down.
const stamp = (overrides: Partial<Stamp> = {}): Stamp => ({
  program: 'red-queen',
  version: '1.0.0',
  builtAt: '2026-10-24T21:13:18.914Z',
  compatibilityDate: '2026-09-29',
  worker: 'red_queen/index.js',
  assets: 'client',
  node: process.version,
  files: {},
  hash: 'sha256:429051402764d5408e23fa3182a186ddee821a1ae18ccbe578f60af65066d8bd',
  ...overrides,
})

function checks(failed: string[] = []): Check[] {
  return ['shell', 'deployment', 'health', 'export'].map((name) => ({ name, ok: !failed.includes(name), detail: '' }))
}

const HEADER = [
  '# Releases',
  '',
  HEADER_ROW,
  '| --- | --- | --- | --- | --- |',
  '| 2026-10-24 20:31 | preview | served shell `6d49ada3b198` | — | 14/14 |',
  '',
].join('\n')

test('the short hash is the twelve characters after the algorithm', () => {
  assert.equal(shortHash(stamp()), '429051402764')
  assert.equal(shortHash(stamp({ hash: 'sha256:abcdef0123456789' })), 'abcdef012345')
})

test('a passing run logs time, environment, build, runtime and full result', () => {
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), at: '2026-10-24 21:18' })
  assert.equal(row, `| 2026-10-24 21:18 | production | \`429051402764\` — 1.0.0, built 21:13 | ${process.version} | 4/4 |`)
})

test('a stamp without a runtime logs a dash rather than the node running the tool', () => {
  const row = rowFor({ environment: 'preview', stamp: stamp({ node: '' }), checks: checks(), at: '2026-10-24 21:18' })
  assert.equal(row, `| 2026-10-24 21:18 | preview | \`429051402764\` — 1.0.0, built 21:13 | ${RUNTIME_UNKNOWN} | 4/4 |`)
  assert.ok(!row.includes(process.version), 'the Node that ran release:log is not the build runtime')
})

test('a failing run names the checks that failed', () => {
  const row = rowFor({ environment: 'preview', stamp: stamp(), checks: checks(['health', 'deployment']), at: '2026-10-24 22:05' })
  assert.equal(row, `| 2026-10-24 22:05 | preview | \`429051402764\` — 1.0.0, built 21:13 | ${process.version} | 2/4 — failed: deployment, health |`)
})

test('a new deployment goes directly under the header', () => {
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), at: '2026-10-24 21:18' })
  const result = place(HEADER, row, 'production', '429051402764')
  assert.equal(result.replaced, false)
  assert.deepEqual(result.markdown.split('\n').slice(0, 7), [
    '# Releases',
    '',
    HEADER_ROW,
    '| --- | --- | --- | --- | --- |',
    row,
    '| 2026-10-24 20:31 | preview | served shell `6d49ada3b198` | — | 14/14 |',
    '',
  ])
})

test('re-checking a logged build updates its row and keeps the deployment time', () => {
  const logged = [
    HEADER_ROW,
    '| --- | --- | --- | --- | --- |',
    '| 2026-10-24 21:18 | production | `429051402764` — 1.0.0, built 21:13 | v24.17.0 | 13/14 — failed: health |',
    '',
  ].join('\n')
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), at: '2026-10-24 22:40' })
  const result = place(logged, row, 'production', '429051402764')
  assert.equal(result.replaced, true)
  assert.equal(result.markdown.split('\n').filter((line) => line.startsWith('| 2026')).length, 1)
  const dataRow = result.markdown.split('\n').find((line) => line.startsWith('| 2026'))
  assert.equal(dataRow, `| 2026-10-24 21:18 | production | \`429051402764\` — 1.0.0, built 21:13 | ${process.version} | 4/4 |`)
})

test('a row logged before the Node column is still found and gains one', () => {
  const legacy = [
    '| Deployed (UTC) | Environment | Build | Smoke |',
    '| --- | --- | --- | --- |',
    '| 2026-10-24 21:18 | production | `429051402764` — 1.0.0, built 21:13 | 14/14 |',
    '',
  ].join('\n')
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), at: '2026-10-25 09:00' })
  const result = place(legacy, row, 'production', '429051402764')
  assert.equal(result.replaced, true, 'an older row is still the same deployment')
  assert.equal(result.markdown.split('\n').filter((line) => line.startsWith('| 2026')).length, 1)
  const dataRow = result.markdown.split('\n').find((line) => line.startsWith('| 2026'))
  assert.equal(dataRow, `| 2026-10-24 21:18 | production | \`429051402764\` — 1.0.0, built 21:13 | ${process.version} | 4/4 |`, 'the row is rewritten in the current shape')
  assert.equal(dataRow?.split('|').length, 7, 'five cells: time, environment, build, node, smoke')
})

test('the same environment on a different build is a second deployment', () => {
  const logged = `${HEADER_ROW}\n| --- | --- | --- | --- | --- |\n| 2026-10-24 21:18 | production | \`429051402764\` — 1.0.0, built 21:13 | v24.17.0 | 14/14 |\n`
  const newer = rowFor({ environment: 'production', stamp: stamp({ hash: 'sha256:ffffffffffff0000' }), checks: checks(), at: '2026-10-25 09:00' })
  const result = place(logged, newer, 'production', 'ffffffffffff')
  assert.equal(result.replaced, false)
  assert.equal(result.markdown.split('\n').filter((line) => line.startsWith('| 2026')).length, 2)
  assert.ok(result.markdown.indexOf('ffffffffffff') < result.markdown.indexOf('429051402764'))
})

test('a log without the release table is refused instead of corrupted', () => {
  assert.throws(() => place('# Releases\n\nNothing here yet.\n', '| row |', 'production', 'abc'), /no release table/)
})

const LOGGED = [
  '# Releases',
  '',
  HEADER_ROW,
  '| --- | --- | --- | --- | --- |',
  '| 2026-10-24 21:29 | production | `935e02c6b357` — 1.0.0, built 21:28 | v24.17.0 | 14/14 |',
  '| 2026-10-24 20:31 | preview | served shell `6d49ada3b198` | — | 14/14 |',
  '',
].join('\n')

const current = () => stamp({ hash: 'sha256:935e02c6b3571111111111111111111111111111111111111111111111111111' })

test('the newest logged build is the first row with a build hash', () => {
  assert.deepEqual(newestBuild(LOGGED), { short: '935e02c6b357', environment: 'production', at: '2026-10-24 21:29', node: 'v24.17.0' })
  assert.equal(newestBuild(HEADER), null, 'a row naming only a served shell is not a build')
  assert.equal(newestBuild('no table'), null)
})

test('a row logged before the Node column reports no runtime', () => {
  const legacy = [
    '| Deployed (UTC) | Environment | Build | Smoke |',
    '| --- | --- | --- | --- |',
    '| 2026-10-24 21:29 | production | `935e02c6b357` — 1.0.0, built 21:28 | 14/14 |',
    '',
  ].join('\n')
  assert.deepEqual(newestBuild(legacy), { short: '935e02c6b357', environment: 'production', at: '2026-10-24 21:29', node: '' })
})

test('a current build is reported as matching the newest logged build', () => {
  assert.equal(
    statusFor(LOGGED, current()),
    `${STATUS} \`dist/build.json\` is \`935e02c6b357\`, which matches the newest logged build.`,
  )
})

test('a rebuild that has not been deployed names both hashes and what to do', () => {
  const status = statusFor(LOGGED, stamp({ hash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }))
  assert.equal(
    status,
    `${STATUS} \`dist/build.json\` is \`ffffffffffff\`, but the newest logged build is \`935e02c6b357\` (production, 2026-10-24 21:29) — this build has not been deployed and logged.`,
  )
})

test('a missing build and an empty log both say so', () => {
  assert.equal(statusFor(LOGGED, null), `${STATUS} no build in \`dist/\`; the newest logged build is \`935e02c6b357\` (production, 2026-10-24 21:29).`)
  assert.equal(statusFor(HEADER, current()), `${STATUS} \`dist/build.json\` is \`935e02c6b357\` and no deployment has been logged yet.`)
  assert.equal(statusFor(HEADER, null), `${STATUS} no build in \`dist/\` and no deployment logged yet.`)
})

test('the status line sits above the table and is replaced, never duplicated', () => {
  const once = withStatus(LOGGED, current())
  const lines = once.split('\n')
  const header = lines.findIndex((line) => line.startsWith('| Deployed'))
  assert.equal(lines[header - 2], statusFor(LOGGED, current()))
  assert.equal(lines[header - 1], '')
  assert.equal(once.split('\n').filter((line) => line.startsWith(STATUS)).length, 1)

  assert.equal(withStatus(once, current()), once, 'refreshing an unchanged log is a no-op')

  const rebuilt = withStatus(once, stamp({ hash: 'sha256:ffffffffffff0000000000000000000000000000000000000000000000000000' }))
  assert.equal(rebuilt.split('\n').filter((line) => line.startsWith(STATUS)).length, 1)
  assert.match(rebuilt, /this build has not been deployed and logged/)
  assert.match(rebuilt, /\| 2026-10-24 21:29 \| production \|/, 'rows are untouched')
})

test('refreshing a log on disk writes the mismatch between build and record', () => {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-log-'))
  const logPath = join(root, 'RELEASES.md')
  try {
    writeFileSync(logPath, LOGGED)
    mkdirSync(join(root, 'dist'), { recursive: true })
    writeBuildStamp(root, { version: '1.0.0', compatibilityDate: '2026-09-29', worker: 'red_queen/index.js', assets: 'client' })

    const refreshed = refreshStatusFile(root)
    assert.ok(refreshed)
    assert.equal(refreshed.changed, true)

    const written = readFileSync(logPath, 'utf8')
    assert.match(written, /> \*\*Build status:\*\* `dist\/build\.json` is `[0-9a-f]{12}`, but the newest logged build is `935e02c6b357` \(production, 2026-10-24 21:29\) — this build has not been deployed and logged\./)
    assert.match(written, /\| 2026-10-24 21:29 \| production \| `935e02c6b357`/, 'the row survives')

    assert.equal(refreshStatusFile(root)?.changed, false, 'a second refresh rewrites nothing')

    // A log outside the project root is refreshed against this project's stamp.
    const elsewhere = join(root, 'copy.md')
    writeFileSync(elsewhere, LOGGED)
    assert.ok(refreshStatusFile(root, elsewhere))
    assert.match(readFileSync(elsewhere, 'utf8'), /Build status:.*newest logged build is `935e02c6b357`/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refreshing a project without a log is a no-op, not an error', () => {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-log-empty-'))
  try {
    assert.equal(refreshStatusFile(root), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function writeStampFile(root: string, value: Stamp): void {
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist', 'build.json'), JSON.stringify(value))
}

function project(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-verify-'))
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('a matching, freshly refreshed log passes the release check', () => {
  const { root, cleanup } = project()
  try {
    writeStampFile(root, current())
    writeFileSync(join(root, 'RELEASES.md'), withStatus(LOGGED, current()))

    const verdict = verifyLog(root)
    assert.deepEqual(verdict.problems, [])
    assert.equal(verdict.ok, true)
    assert.equal(verdict.build, '935e02c6b357')
    assert.equal(verdict.newest?.environment, 'production')
  } finally {
    cleanup()
  }
})

test('an unlogged build fails even when the status line says so honestly', () => {
  const { root, cleanup } = project()
  try {
    const rebuilt = stamp({ hash: 'sha256:ffffffffffff0000000000000000000000000000000000000000000000000000' })
    writeStampFile(root, rebuilt)
    writeFileSync(join(root, 'RELEASES.md'), withStatus(LOGGED, rebuilt))

    const verdict = verifyLog(root)
    assert.equal(verdict.ok, false)
    assert.match(verdict.problems.join('\n'), /dist\/build\.json is `ffffffffffff` but the newest logged build is `935e02c6b357` \(production, 2026-10-24 21:29\)/)
  } finally {
    cleanup()
  }
})

test('a logged build whose row lost the runtime fails the release check', () => {
  const { root, cleanup } = project()
  try {
    writeStampFile(root, current())
    const dashed = LOGGED.replace('| v24.17.0 |', `| ${RUNTIME_UNKNOWN} |`)
    writeFileSync(join(root, 'RELEASES.md'), withStatus(dashed, current()))

    const verdict = verifyLog(root)
    assert.equal(verdict.ok, false, 'a matching hash is not enough when the row is silent about the runtime')
    assert.equal(verdict.problems.length, 1, 'the hash matches, so this is the only problem')
    assert.match(verdict.problems[0], /newest logged row for `935e02c6b357` \(production, 2026-10-24 21:29\) does not record the Node that built it — re-log the deployment/)
  } finally {
    cleanup()
  }
})

test('a legacy row for the current build fails until it is re-logged', () => {
  const { root, cleanup } = project()
  try {
    const legacy = [
      '# Releases',
      '',
      '| Deployed (UTC) | Environment | Build | Smoke |',
      '| --- | --- | --- | --- |',
      '| 2026-10-24 21:29 | production | `935e02c6b357` — 1.0.0, built 21:28 | 14/14 |',
      '',
    ].join('\n')
    writeStampFile(root, current())
    writeFileSync(join(root, 'RELEASES.md'), withStatus(legacy, current()))
    assert.match(verifyLog(root).problems.join('\n'), /does not record the Node that built it/)

    // Re-logging rewrites that row in the current shape, and the check passes.
    const row = rowFor({ environment: 'production', stamp: current(), checks: checks(), at: '2026-10-25 09:00' })
    const rewritten = place(legacy, row, 'production', '935e02c6b357').markdown
    writeFileSync(join(root, 'RELEASES.md'), withStatus(rewritten, current()))
    assert.deepEqual(verifyLog(root).problems, [])
  } finally {
    cleanup()
  }
})

test('a runtime-less row for another build is the mismatch, not this check', () => {
  const { root, cleanup } = project()
  try {
    const rebuilt = stamp({ hash: 'sha256:ffffffffffff0000000000000000000000000000000000000000000000000000' })
    writeStampFile(root, rebuilt)
    const dashed = LOGGED.replace('| v24.17.0 |', `| ${RUNTIME_UNKNOWN} |`)
    writeFileSync(join(root, 'RELEASES.md'), withStatus(dashed, rebuilt))

    const verdict = verifyLog(root)
    assert.equal(verdict.ok, false)
    assert.doesNotMatch(verdict.problems.join('\n'), /does not record the Node/, 'the unlogged build is the real problem here')
    assert.match(verdict.problems.join('\n'), /dist\/build\.json is `ffffffffffff` but the newest logged build is `935e02c6b357`/)
  } finally {
    cleanup()
  }
})

test('a stale or missing status line fails the release check', () => {
  const { root, cleanup } = project()
  try {
    writeStampFile(root, current())
    writeFileSync(join(root, 'RELEASES.md'), LOGGED)
    assert.match(verifyLog(root).problems.join('\n'), /build status line is missing/)

    writeFileSync(join(root, 'RELEASES.md'), withStatus(LOGGED, stamp({ hash: 'sha256:ffffffffffff0000000000000000000000000000000000000000000000000000' })))
    const verdict = verifyLog(root)
    assert.equal(verdict.ok, false)
    assert.match(verdict.problems.join('\n'), /build status line is stale — it should read: .*matches the newest logged build/)
  } finally {
    cleanup()
  }
})

test('a missing log or a missing build each name the remedy', () => {
  const { root, cleanup } = project()
  try {
    assert.match(verifyLog(root).problems.join('\n'), /RELEASES\.md is missing/)

    writeFileSync(join(root, 'RELEASES.md'), withStatus(LOGGED, null))
    assert.match(verifyLog(root).problems.join('\n'), /no build in dist\/ .* run npm run release/)
  } finally {
    cleanup()
  }
})
