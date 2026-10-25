import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extended, labels, playbooks, type Category } from '../scripts/doctrine.ts'

const categories: Category[] = ['C', 'O', 'S', 'G']

test('every COS-G pass has a label, a definition and a full loop', () => {
  for (const category of categories) {
    assert.ok(labels[category].length > 0, `${category} has a label`)
    assert.ok(playbooks[category].definition.length > 40, `${category} defines the failure`)
    assert.ok(playbooks[category].steps.length >= 5, `${category} keeps the loop`)
    for (const step of playbooks[category].steps) assert.ok(step.trim().length > 0, `${category} has no empty step`)
    assert.ok(
      playbooks[category].steps.some((step) => step.toLowerCase().includes('define')),
      `${category} starts by defining the problem`,
    )
  }
})

test('C, O and G end by taking a failed action back through the cycle', () => {
  for (const category of ['C', 'O', 'G'] as const) {
    const last = playbooks[category].steps.at(-1) ?? ''
    assert.match(last, /cycle/i, `${category} closes the loop`)
  }
  assert.match(playbooks.S.steps.at(-1) ?? '', /attempt to solve/i)
})

test('the extended index names five frameworks with distinct codes', () => {
  assert.equal(extended.length, 5)
  const codes = extended.map(([code]) => code)
  assert.deepEqual(codes, ['MDI T', 'L R R', 'S C N P', 'H N S I', 'D C S R'])
  assert.equal(new Set(codes).size, 5)
  for (const [code, area, letters] of extended) {
    assert.ok(code.trim().length > 0)
    assert.ok(area.trim().length > 0, `${code} names an area`)
    assert.ok(letters.includes('·'), `${code} lists its letters`)
  }
})
