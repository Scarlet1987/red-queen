import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { writeBuildStamp, type Stamp } from '../scripts/build-stamp.ts'
import {
  HEADER_ROW,
  newestBuild,
  place,
  record,
  refreshStatusFile,
  resolveTag,
  RUNTIME_UNKNOWN,
  rowFor,
  shortHash,
  STATUS,
  statusFor,
  TAG_UNKNOWN,
  verifyLog,
  withStatus,
} from '../scripts/release-log.ts'
import type { HostFinding, HostReport } from '../scripts/host-scan.ts'
import { checkNames, type Check } from '../scripts/smoke.ts'

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
  tag: 'v1.0.0',
  files: {},
  hash: 'sha256:429051402764d5408e23fa3182a186ddee821a1ae18ccbe578f60af65066d8bd',
  ...overrides,
})

function checks(failed: string[] = []): Check[] {
  return ['shell', 'deployment', 'health', 'export'].map((name) => ({ name, ok: !failed.includes(name), detail: '' }))
}

/** The suite as it stands, and the cell a row written now carries. */
const SUITE = checkNames()
const MADE = SUITE.join(', ')
const suiteChecks = (): Check[] => SUITE.map((name) => ({ name, ok: true, detail: '' }))

// What the sweep says on a quiet machine, as the cell and as the report it is
// summarised from. Two devices is enough to prove the count is carried over.
const HOST = 'clean — 2 devices on 7.2.6-76070206-generic'
const host = (findings: HostFinding[] = [], available = true): HostReport => ({
  available,
  reason: available ? '' : '/sys/bus/pci/devices is not readable — the host sweep needs Linux sysfs.',
  kernel: '7.2.6-76070206-generic',
  devices: available
    ? [
        { slot: '0000:00:02.0', kind: 'display', name: 'UHD Graphics', driver: 'i915', module: 'i915', modalias: '' },
        { slot: '0000:00:1f.0', kind: 'bridge', name: 'ISA bridge', driver: null, module: null, modalias: '' },
      ]
    : [],
  blacklists: [],
  loaded: [],
  dkms: [],
  findings,
})

const SEPARATOR = '| --- | --- | --- | --- | --- | --- | --- | --- |'

const HEADER = [
  '# Releases',
  '',
  HEADER_ROW,
  SEPARATOR,
  '| 2026-10-24 20:31 | preview | served shell `6d49ada3b198` | — | 14/14 |',
  '',
].join('\n')

test('the short hash is the twelve characters after the algorithm', () => {
  assert.equal(shortHash(stamp()), '429051402764')
  assert.equal(shortHash(stamp({ hash: 'sha256:abcdef0123456789' })), 'abcdef012345')
})

test('a passing run logs time, environment, build, tag, runtime, result, checks and host', () => {
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), host: HOST, at: '2026-10-24 21:18', tag: 'v1.0.0' })
  assert.equal(
    row,
    `| 2026-10-24 21:18 | production | \`429051402764\` — 1.0.0, built 21:13 | v1.0.0 | ${process.version} | 4/4 | shell, deployment, health, export | ${HOST} |`,
  )
  assert.ok(row.endsWith(`| ${HOST} |`), 'the host sweep is the last cell, so it can be appended without moving the rest')
})

test('a build no tag describes logs a dash rather than a guessed version', () => {
  const row = rowFor({ environment: 'preview', stamp: stamp(), checks: checks(), host: HOST, at: '2026-10-24 21:18' })
  assert.equal(
    row,
    `| 2026-10-24 21:18 | preview | \`429051402764\` — 1.0.0, built 21:13 | ${TAG_UNKNOWN} | ${process.version} | 4/4 | shell, deployment, health, export | ${HOST} |`,
  )
})

test('a stamp without a runtime logs a dash rather than the node running the tool', () => {
  const row = rowFor({ environment: 'preview', stamp: stamp({ node: '' }), checks: checks(), host: HOST, at: '2026-10-24 21:18', tag: 'v1.0.0' })
  assert.equal(
    row,
    `| 2026-10-24 21:18 | preview | \`429051402764\` — 1.0.0, built 21:13 | v1.0.0 | ${RUNTIME_UNKNOWN} | 4/4 | shell, deployment, health, export | ${HOST} |`,
  )
  assert.ok(!row.includes(process.version), 'the Node that ran release:log is not the build runtime')
})

test('a failing run names the checks that failed and still records them all', () => {
  const row = rowFor({ environment: 'preview', stamp: stamp(), checks: checks(['health', 'deployment']), host: HOST, at: '2026-10-24 22:05', tag: 'v1.0.0' })
  assert.equal(
    row,
    `| 2026-10-24 22:05 | preview | \`429051402764\` — 1.0.0, built 21:13 | v1.0.0 | ${process.version} | 2/4 — failed: deployment, health | shell, deployment, health, export | ${HOST} |`,
  )
})

test('a real run is recorded with every check it made, including the footer', () => {
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: suiteChecks(), host: HOST, at: '2026-10-24 21:18', tag: 'v1.0.0' })
  assert.ok(row.includes(`| ${SUITE.length}/${SUITE.length} | ${MADE} |`), 'the result and the check list travel together')
  assert.ok(row.includes('footer'), 'the footer check is named in the row')
  assert.ok(row.includes('health'), 'the health check is named in the row')
})

test('a new deployment goes directly under the header', () => {
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), host: HOST, at: '2026-10-24 21:18' })
  const result = place(HEADER, row, 'production', '429051402764')
  assert.equal(result.replaced, false)
  assert.deepEqual(result.markdown.split('\n').slice(0, 7), [
    '# Releases',
    '',
    HEADER_ROW,
    SEPARATOR,
    row,
    '| 2026-10-24 20:31 | preview | served shell `6d49ada3b198` | — | 14/14 |',
    '',
  ])
})

test('re-checking a logged build updates its row and keeps the deployment time', () => {
  const logged = [
    HEADER_ROW,
    SEPARATOR,
    '| 2026-10-24 21:18 | production | `429051402764` — 1.0.0, built 21:13 | v1.0.0 | v24.17.0 | 13/14 — failed: health |',
    '',
  ].join('\n')
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), host: HOST, at: '2026-10-24 22:40', tag: 'v1.0.0' })
  const result = place(logged, row, 'production', '429051402764')
  assert.equal(result.replaced, true)
  assert.equal(result.markdown.split('\n').filter((line) => line.startsWith('| 2026')).length, 1)
  const dataRow = result.markdown.split('\n').find((line) => line.startsWith('| 2026'))
  assert.equal(
    dataRow,
    `| 2026-10-24 21:18 | production | \`429051402764\` — 1.0.0, built 21:13 | v1.0.0 | ${process.version} | 4/4 | shell, deployment, health, export | ${HOST} |`,
  )
})

test('a row logged before the Node column is still found and gains one', () => {
  const legacy = [
    '| Deployed (UTC) | Environment | Build | Smoke |',
    '| --- | --- | --- | --- |',
    '| 2026-10-24 21:18 | production | `429051402764` — 1.0.0, built 21:13 | 14/14 |',
    '',
  ].join('\n')
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), host: HOST, at: '2026-10-25 09:00', tag: 'v1.0.0' })
  const result = place(legacy, row, 'production', '429051402764')
  assert.equal(result.replaced, true, 'an older row is still the same deployment')
  assert.equal(result.markdown.split('\n').filter((line) => line.startsWith('| 2026')).length, 1)
  const dataRow = result.markdown.split('\n').find((line) => line.startsWith('| 2026'))
  assert.equal(
    dataRow,
    `| 2026-10-24 21:18 | production | \`429051402764\` — 1.0.0, built 21:13 | v1.0.0 | ${process.version} | 4/4 | shell, deployment, health, export | ${HOST} |`,
    'the row is rewritten in the current shape',
  )
  assert.equal(dataRow?.split('|').length, 10, 'eight cells: time, environment, build, tag, node, smoke, checks, host')
})

test('logging into a legacy table repairs its header rather than leaving a short one', () => {
  const legacy = [
    '| Deployed (UTC) | Environment | Build | Smoke |',
    '| --- | --- | --- | --- |',
    '| 2026-10-24 21:18 | production | `429051402764` — 1.0.0, built 21:13 | 14/14 |',
    '| 2026-10-24 20:31 | preview | `6d49ada3b198` — 1.0.0, built 20:30 | 14/14 |',
    '',
  ].join('\n')
  const row = rowFor({ environment: 'production', stamp: stamp(), checks: checks(), host: HOST, at: '2026-10-25 09:00', tag: 'v1.0.0' })
  const placed = place(legacy, row, 'production', '429051402764')
  const lines = placed.markdown.split('\n')

  assert.equal(lines[0], HEADER_ROW, 'the header gains the columns rows are written with now')
  assert.equal(lines[1], SEPARATOR, 'and the rule under it matches its width')
  assert.equal(lines[2], placed.row, 'the re-logged row, in the current shape')
  assert.equal(
    lines[3],
    '| 2026-10-24 20:31 | preview | `6d49ada3b198` — 1.0.0, built 20:30 | 14/14 |',
    'history keeps the shape it was written in',
  )
})

test('the same environment on a different build is a second deployment', () => {
  const logged = `${HEADER_ROW}\n${SEPARATOR}\n| 2026-10-24 21:18 | production | \`429051402764\` — 1.0.0, built 21:13 | v1.0.0 | v24.17.0 | 14/14 |\n`
  const newer = rowFor({ environment: 'production', stamp: stamp({ hash: 'sha256:ffffffffffff0000' }), checks: checks(), host: HOST, at: '2026-10-25 09:00' })
  const result = place(logged, newer, 'production', 'ffffffffffff')
  assert.equal(result.replaced, false)
  assert.equal(result.markdown.split('\n').filter((line) => line.startsWith('| 2026')).length, 2)
  assert.ok(result.markdown.indexOf('ffffffffffff') < result.markdown.indexOf('429051402764'))
})

test('a log without the release table is refused instead of corrupted', () => {
  assert.throws(() => place('# Releases\n\nNothing here yet.\n', '| row |', 'production', 'abc'), /no release table/)
})

const LOGGED_ROW = `| 2026-10-24 21:29 | production | \`935e02c6b357\` — 1.0.0, built 21:28 | v1.0.0 | v24.17.0 | ${SUITE.length}/${SUITE.length} | ${MADE} | ${HOST} |`

const LOGGED = [
  '# Releases',
  '',
  HEADER_ROW,
  SEPARATOR,
  LOGGED_ROW,
  '| 2026-10-24 20:31 | preview | served shell `6d49ada3b198` | — | 14/14 |',
  '',
].join('\n')

const current = () => stamp({ hash: 'sha256:935e02c6b3571111111111111111111111111111111111111111111111111111' })

test('the newest logged build is the first row with a build hash', () => {
  assert.deepEqual(newestBuild(LOGGED), {
    short: '935e02c6b357',
    environment: 'production',
    at: '2026-10-24 21:29',
    tag: 'v1.0.0',
    node: 'v24.17.0',
    checks: SUITE,
    host: HOST,
  })
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
  assert.deepEqual(newestBuild(legacy), { short: '935e02c6b357', environment: 'production', at: '2026-10-24 21:29', tag: '', node: '', checks: [], host: '' })
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
    writeBuildStamp(root, { version: '1.0.0', compatibilityDate: '2026-09-29', worker: 'red_queen/index.js', assets: 'client', tag: 'v1.0.0' })

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

test('a current row from before the tag column fails until it is re-logged', () => {
  const { root, cleanup } = project()
  try {
    writeStampFile(root, current())
    // Five cells: the shape written between the Node column and this one.
    const older = LOGGED.replace('| v1.0.0 | v24.17.0 |', '| v24.17.0 |').replace(`| ${SUITE.length}/${SUITE.length} | ${MADE} |`, '| 14/14 |')
    writeFileSync(join(root, 'RELEASES.md'), withStatus(older, current()))

    const verdict = verifyLog(root)
    assert.equal(verdict.ok, false, 'a row that never names a version is not evidence of one')
    assert.match(verdict.problems.join('\n'), /does not record the release tag — re-log the deployment/)

    // A dash is an answer, not a gap: a build with no tag still passes.
    const dashed = LOGGED.replace('| v1.0.0 |', `| ${TAG_UNKNOWN} |`)
    writeFileSync(join(root, 'RELEASES.md'), withStatus(dashed, current()))
    assert.deepEqual(verifyLog(root).problems, [])
  } finally {
    cleanup()
  }
})

test('a current row that names fewer checks than the suite fails', () => {
  const { root, cleanup } = project()
  try {
    writeStampFile(root, current())

    // A row whose run never looked at the footer is not evidence the footer was
    // checked, even when it reports every check it did make as green.
    const shortened = LOGGED.replace('footer, ', '').replace(`${SUITE.length}/${SUITE.length}`, `${SUITE.length - 1}/${SUITE.length - 1}`)
    writeFileSync(join(root, 'RELEASES.md'), withStatus(shortened, current()))
    const verdict = verifyLog(root)
    assert.equal(verdict.ok, false)
    assert.match(verdict.problems.join('\n'), /records 14 smoke checks, but the suite makes 15 — missing: footer — re-log the deployment/)

    // A name no longer in the suite says the row is from another version of it.
    const padded = LOGGED.replace(`| ${MADE} |`, `| ${MADE}, legacy check |`)
    writeFileSync(join(root, 'RELEASES.md'), withStatus(padded, current()))
    assert.match(verifyLog(root).problems.join('\n'), /no longer in the suite: legacy check/)
  } finally {
    cleanup()
  }
})

test('a current row written before the check column fails until it is re-logged', () => {
  const { root, cleanup } = project()
  try {
    writeStampFile(root, current())
    // Six cells: time, environment, build, tag, node, smoke — the shape that
    // existed before the row had to say which checks it made.
    const before = LOGGED.replace(
      LOGGED_ROW,
      '| 2026-10-24 21:29 | production | `935e02c6b357` — 1.0.0, built 21:28 | v1.0.0 | v24.17.0 | 14/14 |',
    )
    writeFileSync(join(root, 'RELEASES.md'), withStatus(before, current()))
    const verdict = verifyLog(root)
    assert.equal(verdict.ok, false)
    assert.match(verdict.problems.join('\n'), /does not record which smoke checks ran — re-log the deployment to name them/)

    // Re-logging the same deployment adds the list and keeps its time.
    const rewritten = place(before, rowFor({ environment: 'production', stamp: current(), checks: suiteChecks(), host: HOST, at: '2026-10-25 09:00' }), 'production', '935e02c6b357').markdown
    writeFileSync(join(root, 'RELEASES.md'), withStatus(rewritten, current()))
    assert.deepEqual(verifyLog(root).problems, [])
    assert.match(readFileSync(join(root, 'RELEASES.md'), 'utf8'), /\| 2026-10-24 21:29 \| production \|.*footer, export, export empty \|/, 'the re-logged row names the suite')
  } finally {
    cleanup()
  }
})

test('a current row from before the host column fails until it is re-logged', () => {
  const { root, cleanup } = project()
  try {
    writeStampFile(root, current())
    // Seven cells: the shape written before the row had to say what the host
    // sweep found. Its checks cell is in the same place, so the only gap is Host.
    const before = LOGGED.replace(LOGGED_ROW, LOGGED_ROW.replace(`| ${HOST} |`, '|'))
    writeFileSync(join(root, 'RELEASES.md'), withStatus(before, current()))
    const verdict = verifyLog(root)
    assert.equal(verdict.ok, false)
    assert.match(verdict.problems.join('\n'), /does not record what the host sweep reported — re-log the deployment to fill the column/)

    // Re-logging fills the column and keeps the deployment time.
    const rewritten = place(before, rowFor({ environment: 'production', stamp: current(), checks: suiteChecks(), host: HOST, at: '2026-10-25 09:00' }), 'production', '935e02c6b357').markdown
    writeFileSync(join(root, 'RELEASES.md'), withStatus(rewritten, current()))
    assert.deepEqual(verifyLog(root).problems, [])
    assert.match(readFileSync(join(root, 'RELEASES.md'), 'utf8'), /\| 2026-10-24 21:29 \| production \|.*\| clean — 2 devices on 7\.2\.6-76070206-generic \|/)
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
    const row = rowFor({ environment: 'production', stamp: current(), checks: suiteChecks(), host: HOST, at: '2026-10-25 09:00' })
    const rewritten = place(legacy, row, 'production', '935e02c6b357').markdown
    writeFileSync(join(root, 'RELEASES.md'), withStatus(rewritten, current()))
    assert.deepEqual(verifyLog(root).problems, [])
  } finally {
    cleanup()
  }
})

function recordable(): { root: string; logPath: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-record-'))
  writeStampFile(root, current())
  const logPath = join(root, 'RELEASES.md')
  writeFileSync(logPath, HEADER)
  return { root, logPath, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('a dry run prepares the row and leaves the log alone', async () => {
  const { root, logPath, cleanup } = recordable()
  try {
    const before = readFileSync(logPath, 'utf8')
    const result = await record({ environment: 'preview', at: '2026-10-25 09:00', dryRun: true }, { root, run: async () => suiteChecks(), scan: () => host() })

    assert.equal(result.written, false, 'a dry run says it wrote nothing')
    assert.equal(result.replaced, false, 'this build is not in the log yet, so the row would be added')
    assert.equal(readFileSync(logPath, 'utf8'), before, 'the log is byte-identical after a dry run')
    assert.match(result.row, /^\| 2026-10-25 09:00 \| preview \| `935e02c6b357` — 1\.0\.0, built 21:13 \| v1\.0\.0 \|/)
    assert.ok(result.row.includes(`| ${SUITE.length}/${SUITE.length} | ${MADE} |`), 'the row names every check, ready to be written')
  } finally {
    cleanup()
  }
})

test('a dry run of an already logged build says it would update that row', async () => {
  const { root, logPath, cleanup } = recordable()
  try {
    writeFileSync(logPath, LOGGED)
    const before = readFileSync(logPath, 'utf8')
    const result = await record({ environment: 'production', dryRun: true }, { root, run: async () => suiteChecks(), scan: () => host() })

    assert.equal(result.written, false)
    assert.equal(result.replaced, true, 'the deployment is already logged; the row would be updated in place')
    assert.match(result.row, /^\| 2026-10-24 21:29 \| production \|/, 'the deployment time is kept')
    assert.equal(readFileSync(logPath, 'utf8'), before)
  } finally {
    cleanup()
  }
})

test('a dry run writes nothing even when the smoke test failed', async () => {
  const { root, logPath, cleanup } = recordable()
  try {
    const before = readFileSync(logPath, 'utf8')
    const failing = suiteChecks().map((check) => (check.name === 'footer' ? { ...check, ok: false, detail: 'stale bundle' } : check))
    const result = await record({ environment: 'preview', at: '2026-10-25 09:00', dryRun: true }, { root, run: async () => failing, scan: () => host() })

    assert.equal(result.written, false)
    assert.match(result.row, new RegExp(`\\| ${SUITE.length - 1}/${SUITE.length} — failed: footer \\|`))
    assert.equal(readFileSync(logPath, 'utf8'), before, 'a failed dry run is not a release record')
  } finally {
    cleanup()
  }
})

test('recording for real writes the row and the status line', async () => {
  const { root, logPath, cleanup } = recordable()
  try {
    const result = await record({ environment: 'preview', at: '2026-10-25 09:00' }, { root, run: async () => suiteChecks(), scan: () => host() })

    assert.equal(result.written, true)
    const written = readFileSync(logPath, 'utf8')
    assert.ok(written.includes(result.row), 'the row it reported is the row on disk')
    assert.match(written, /\*\*Build status:\*\*/)
    assert.match(written, /footer/, 'the recorded row proves the footer was checked')
    assert.ok(written.includes(`| ${HOST} |`), 'and that the machine was swept')
  } finally {
    cleanup()
  }
})

test('the host warnings a release was made with are written into its row', async () => {
  const { root, logPath, cleanup } = recordable()
  try {
    const findings: HostFinding[] = [
      { rule: 'unbound-hardware', severity: 'warn', message: '0000:6f:00.0 RTL8125 2.5GbE Controller (network) has no driver bound and no module in /lib/modules/7.2.6 claims it.' },
      { rule: 'dkms-not-built', severity: 'warn', message: 'DKMS module system76 is built for 7.0.11 but not for 7.2.6 — after a reboot into 7.2.6 it will not be there.' },
      // Info is context, not a fault: it must not turn into a warning in the row.
      { rule: 'blacklisted-driver', severity: 'info', message: 'r8169 is blacklisted in r8125.conf, but 0000:6f:00.0 is served by r8125.' },
    ]
    const result = await record(
      { environment: 'preview', at: '2026-10-25 09:00', dryRun: true },
      { root, run: async () => suiteChecks(), scan: () => host(findings) },
    )

    assert.equal(result.host, '2 warnings — unbound-hardware, dkms-not-built on 7.2.6-76070206-generic')
    assert.equal(result.warnings.length, 2, 'the info finding is not counted as a warning')
    assert.ok(result.row.endsWith(`| ${result.host} |`), 'the row says what the machine reported')
    assert.match(readFileSync(logPath, 'utf8'), /\| Checks \| Host \|/, 'the log it would go into has the column')
  } finally {
    cleanup()
  }
})

test('a release from a machine without sysfs says so instead of claiming a clean sweep', async () => {
  const { root, logPath, cleanup } = recordable()
  try {
    const result = await record(
      { environment: 'preview', at: '2026-10-25 09:00' },
      { root, run: async () => suiteChecks(), scan: () => host([], false) },
    )

    assert.equal(result.host, 'unavailable — no sysfs')
    assert.deepEqual(result.warnings, [])
    assert.ok(readFileSync(logPath, 'utf8').includes('| unavailable — no sysfs |'))
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

// A fake repository is the only honest way to test tag resolution: the answer
// depends on commits, tags and uncommitted edits, not on this checkout.
function taggedRepo(): { root: string; git: (...args: string[]) => void; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-tag-'))
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Red Queen',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Red Queen',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
  const git = (...args: string[]): void => {
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', env, timeout: 20_000 })
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  }
  git('init', '-q')
  return { root, git, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('the logged tag is the release, not whatever commit the log ran on', () => {
  const repo = taggedRepo()
  try {
    mkdirSync(join(repo.root, 'src'), { recursive: true })
    writeFileSync(join(repo.root, 'src', 'app.ts'), 'export const a = 1\n')
    writeFileSync(join(repo.root, 'README.md'), '# app\n')
    repo.git('add', '.')
    repo.git('commit', '-qm', 'app')
    repo.git('tag', '-a', 'v1.0.0', '-m', 'release')
    assert.equal(resolveTag(repo.root), 'v1.0.0', 'a tagged HEAD is that tag')

    // Documentation, tests and the installer are not build inputs, so the bytes
    // a clone gets are still the tagged ones and the bare tag is the honest name.
    writeFileSync(join(repo.root, 'README.md'), '# app, edited\n')
    repo.git('commit', '-qam', 'docs')
    assert.equal(resolveTag(repo.root), 'v1.0.0')

    // A changed input is a different build: the tag no longer describes it, and
    // the described form says exactly how far past the tag this tree is.
    writeFileSync(join(repo.root, 'src', 'app.ts'), 'export const a = 2\n')
    repo.git('commit', '-qam', 'code')
    assert.match(resolveTag(repo.root), /^v1\.0\.0-2-g[0-9a-f]+$/, 'two commits past the tag, which the described form says')

    // An uncommitted edit to an input is not the tagged bytes either.
    writeFileSync(join(repo.root, 'src', 'app.ts'), 'export const a = 3\n')
    assert.equal(resolveTag(repo.root), TAG_UNKNOWN)
  } finally {
    repo.cleanup()
  }
})

test('an untagged repository, and no repository at all, log a dash', () => {
  const repo = taggedRepo()
  try {
    writeFileSync(join(repo.root, 'README.md'), '# app\n')
    repo.git('add', '.')
    repo.git('commit', '-qm', 'app')
    assert.equal(resolveTag(repo.root), TAG_UNKNOWN, 'no tags means no version to name')
  } finally {
    repo.cleanup()
  }

  const bare = mkdtempSync(join(tmpdir(), 'red-queen-nogit-'))
  try {
    assert.equal(resolveTag(bare), TAG_UNKNOWN)
  } finally {
    rmSync(bare, { recursive: true, force: true })
  }
})
