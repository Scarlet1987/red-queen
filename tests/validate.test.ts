import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanHarness, cleanRack, cleanRefinements, cleanWorksheets } from '../src/app/lib/validate.ts'

// Storage validation is the boundary between a browser that may hold stale or
// hand-edited JSON and every component that renders it.

test('cleanRack keeps known slugs once and drops everything else', () => {
  assert.deepEqual(cleanRack(['ghidra', 'ghidra', 'not-a-tool', 42, null, { slug: 'ghidra' }]), ['ghidra'])
  assert.deepEqual(cleanRack(['frida', 'ghidra']), ['frida', 'ghidra'])
  assert.deepEqual(cleanRack('ghidra'), [])
  assert.deepEqual(cleanRack(null), [])
  assert.deepEqual(cleanRack({ 0: 'ghidra' }), [])
})

test('cleanRefinements drops unknown slugs, bad levels and empty notes', () => {
  const result = cleanRefinements({
    ghidra: { safety: 'live', note: '  my workflow  ' },
    frida: { safety: 'not-a-level', note: '' },
    'not-a-tool': { safety: 'static' },
    yara: { note: 42 },
    lief: { safety: 'sandbox' },
  })
  assert.deepEqual(result, {
    ghidra: { safety: 'live', note: 'my workflow' },
    lief: { safety: 'sandbox' },
  })
})

test('cleanRefinements caps a note at 280 characters', () => {
  const result = cleanRefinements({ ghidra: { note: 'x'.repeat(400) } })
  assert.equal(result.ghidra?.note?.length, 280)
})

test('cleanRefinements rejects non-objects and arrays', () => {
  assert.deepEqual(cleanRefinements(null), {})
  assert.deepEqual(cleanRefinements('ghidra'), {})
  assert.deepEqual(cleanRefinements(['ghidra']), {})
})

test('cleanWorksheets drops blank titles and unknown letters', () => {
  const input = [
    { letter: 'C', title: '   ' },
    { letter: 'X', title: 'Unknown letter' },
    { letter: 'G', title: 'Kept', outcome: 'not-an-outcome', definition: 'line one\nline two', createdAt: '2026-01-01T00:00:00.000Z', id: 'keep-me' },
    'not a worksheet',
  ]
  const result = cleanWorksheets(input)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'keep-me')
  assert.equal(result[0].outcome, 'open')
  assert.equal(result[0].updatedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(result[0].definition, 'line one\nline two')
  assert.deepEqual(cleanWorksheets(null), [])
})

test('cleanWorksheets caps fields and generates an id when one is missing', () => {
  const result = cleanWorksheets([{ letter: 'S', title: 'y'.repeat(200), notes: 'z'.repeat(5000) }])
  assert.equal(result.length, 1)
  assert.equal(result[0].title.length, 160)
  assert.equal(result[0].notes.length, 4000)
  assert.ok(result[0].id.length > 0)
})

test('cleanHarness rebuilds a snapshot and strips trailing slashes', () => {
  const result = cleanHarness({
    models: [
      { id: 'a', label: 'A', baseUrl: 'http://localhost:11434/v1/', model: 'qwen', provider: 'ollama' },
      { id: 'b', label: 'B', baseUrl: 'https://example.test/v1', model: '', provider: 'custom' },
      { id: 'c', label: 'C', baseUrl: 'https://example.test/v1', model: 'm', provider: 'weird' },
      { label: 'no id', baseUrl: 'http://x', model: 'm' },
      'nope',
    ],
    activeId: 'missing',
    directory: { name: 'red-queen', extra: true },
  })
  assert.equal(result.models.length, 2)
  assert.equal(result.models[0].baseUrl, 'http://localhost:11434/v1')
  assert.equal(result.models[1].provider, 'custom')
  assert.equal(result.activeId, 'a')
  assert.deepEqual(result.directory, { name: 'red-queen' })
})

test('cleanHarness survives garbage and keeps a valid active model', () => {
  for (const bad of [null, 'text', 42, [], { models: 'nope', directory: 7 }]) {
    assert.deepEqual(cleanHarness(bad), { models: [], activeId: null, directory: null })
  }
  const kept = cleanHarness({
    models: [
      { id: 'one', label: 'One', baseUrl: 'http://one/v1', model: 'm', provider: 'lmstudio' },
      { id: 'two', label: 'Two', baseUrl: 'http://two/v1', model: 'n', provider: 'llamacpp' },
    ],
    activeId: 'two',
    directory: { name: 'project' },
  })
  assert.equal(kept.activeId, 'two')
  assert.deepEqual(kept.directory, { name: 'project' })
})
