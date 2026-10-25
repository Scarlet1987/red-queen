import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { BUDGET, GATE, MARGIN, evaluate, format, measure } from '../scripts/check-size.ts'

// The 100 MB promise is only worth what enforces it. This file is that
// enforcement: it runs inside `npm test`, which `npm run check` and both
// workflows run, so the tree cannot grow past the gate without a red build.
//
// The rule is checked against numbers first — a real 90 MB file would make this
// suite slow and the repository enormous — and then against the tree that is
// actually shipping, which is the case that matters.
const MB = 1024 * 1024

test('the gate sits below the cap, so approaching it fails before it is broken', () => {
  assert.equal(BUDGET, 100 * MB, 'the documented promise')
  assert.equal(GATE, BUDGET - MARGIN)
  assert.ok(GATE < BUDGET, 'a gate at the cap is not a gate, it is an autopsy')
  assert.ok(GATE >= BUDGET * 0.8, `the gate (${format(GATE)}) is so far below the cap that the margin is unusable`)
})

test('a comfortably small tree and build pass', () => {
  const verdict = evaluate({ base: 3 * MB, build: 2 * MB })
  assert.deepEqual(verdict, { ok: true, problems: [] })
})

test('either number reaching the gate fails, and the message says which', () => {
  const base = evaluate({ base: GATE + 1, build: 1 * MB })
  assert.equal(base.ok, false)
  assert.equal(base.problems.length, 1)
  assert.match(base.problems[0], /the base program is /)
  assert.match(base.problems[0], /past the .* gate/)

  const build = evaluate({ base: 1 * MB, build: GATE + 1 })
  assert.equal(build.ok, false)
  assert.equal(build.problems.length, 1)
  assert.match(build.problems[0], /the build output is /)

  // A small repository that packs a huge bundle is just as far past the promise.
  const both = evaluate({ base: GATE + 1, build: GATE + 1 })
  assert.equal(both.problems.length, 2)
})

test('exactly at the gate still passes; one byte past does not', () => {
  assert.equal(evaluate({ base: GATE, build: 0 }).ok, true)
  assert.equal(evaluate({ base: GATE + 1, build: 0 }).ok, false)
})

test('the thresholds are arguments, so the rule can be proven without 90 MB on disk', () => {
  // A 20-byte budget with a 10-byte margin puts the gate at 10 bytes, which is
  // the whole rule at a scale a test can state exactly.
  assert.equal(evaluate({ base: 11, build: 0 }, { budget: 20, margin: 10 }).ok, false)
  assert.equal(evaluate({ base: 10, build: 0 }, { budget: 20, margin: 10 }).ok, true)
  assert.equal(evaluate({ base: 0, build: 11 }, { budget: 20, margin: 10 }).ok, false)
})

test('the tree that is shipping is inside the gate', () => {
  const sizes = measure()
  assert.ok(sizes.base > 0, 'measured nothing: the walk is looking at the wrong directory')
  assert.ok(sizes.files > 50, `only ${sizes.files} files counted; the walk is missing the tree`)

  const verdict = evaluate(sizes)
  assert.deepEqual(
    verdict.problems,
    [],
    `the program has grown past its budget: base ${format(sizes.base)}, build ${format(sizes.build)}, gate ${format(GATE)}`,
  )
})

test('the measurement sees a file that appears inside the tree', () => {
  // Guards the walk itself: a size check that cannot notice growth is worse
  // than none, because it reports safety it never verified.
  const dir = mkdtempSync(join(tmpdir(), 'red-queen-size-'))
  try {
    writeFileSync(join(dir, 'package.json'), '{}')
    const before = measure(dir)
    // A sparse file: 6 MB as far as the walk is concerned, nothing on disk.
    writeFileSync(join(dir, 'big.bin'), '')
    truncateSync(join(dir, 'big.bin'), 6 * MB)
    const after = measure(dir)
    assert.equal(after.base - before.base, 6 * MB)
    assert.equal(after.files, before.files + 1)
    assert.deepEqual(after.oversized.map((file) => file.path), ['big.bin'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
