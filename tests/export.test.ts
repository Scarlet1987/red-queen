import assert from 'node:assert/strict'
import { test } from 'node:test'

import { worksheetsMarkdown, type Worksheet } from '../src/app/lib/worksheet.ts'
import app from '../src/worker/index.ts'

const worksheet = (overrides: Partial<Worksheet>): Worksheet => ({
  id: 'id',
  letter: 'C',
  title: 'A finding',
  definition: '',
  action: '',
  test: '',
  outcome: 'open',
  notes: '',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-02T00:00:00.000Z',
  ...overrides,
})

test('the worksheet Markdown is empty-state safe', () => {
  const markdown = worksheetsMarkdown([])
  assert.match(markdown, /# COS-G worksheet/)
  assert.match(markdown, /No worksheets saved yet/)
})

test('the worksheet Markdown groups findings and flattens newlines', () => {
  const markdown = worksheetsMarkdown([
    worksheet({ letter: 'C', title: 'Crash on boot\nwith empty config', definition: 'line one\nline two', outcome: 'implemented', notes: 'keep\nthis' }),
    worksheet({ id: 'two', letter: 'G', title: 'A ghost hook', outcome: 'retry' }),
    worksheet({ id: 'three', letter: 'C', outcome: 'open' }),
  ])
  assert.match(markdown, /## C — Crash risks/)
  assert.match(markdown, /## G — Ghosts/)
  assert.ok(markdown.indexOf('## C — Crash risks') < markdown.indexOf('## G — Ghosts'))
  assert.match(markdown, /### Crash on boot with empty config/)
  assert.match(markdown, /\*\*Defined:\*\* line one line two/)
  assert.match(markdown, /\*\*Outcome:\*\* Implemented/)
  assert.match(markdown, /\*\*Outcome:\*\* Back through the cycle/)
  assert.match(markdown, /\*\*Notes:\*\* keep this/)
  assert.match(markdown, /\*\*Updated:\*\* 2026-03-02/)
  assert.match(markdown, /Companion to cosg-report\.md/)
})

async function exportRack(body: unknown): Promise<Response> {
  return app.request('/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('the rack export returns Markdown for known slugs only', async () => {
  const response = await exportRack({
    slugs: ['ghidra', 'not-a-tool', 'frida', 42],
    refinements: {
      ghidra: { safety: 'live', note: 'Run it in a throwaway VM' },
      frida: { safety: 'not-a-level' },
      'not-a-tool': { note: 'should not appear' },
    },
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/markdown/)
  assert.match(response.headers.get('content-disposition') ?? '', /red-queen-rack\.md/)

  const markdown = await response.text()
  assert.match(markdown, /# Red Queen rack/)
  assert.match(markdown, /2 tools/)
  assert.match(markdown, /Ghidra/)
  assert.match(markdown, /Frida/)
  assert.match(markdown, /## Live attach/)
  assert.match(markdown, /\*\*\[Ghidra\]/) // refined into the live group
  assert.match(markdown, /Your note: Run it in a throwaway VM/)
  assert.ok(!markdown.includes('not-a-tool'))
  assert.ok(!markdown.includes('should not appear'))
  assert.match(markdown, /Nothing in this list was executed/)
})

test('an unknown refinement level keeps the catalogued safety level', async () => {
  const response = await exportRack({ slugs: ['ghidra'], refinements: { ghidra: { safety: 'nonsense' } } })
  const markdown = await response.text()
  assert.match(markdown, /## Static only/)
  assert.match(markdown, /Nothing in this list was executed/)
})

test('the rack export caps a note at 280 characters', async () => {
  const response = await exportRack({ slugs: ['ghidra'], refinements: { ghidra: { note: 'x'.repeat(400) } } })
  const markdown = await response.text()
  assert.ok(markdown.includes('Your note: ' + 'x'.repeat(280)))
  assert.ok(!markdown.includes('x'.repeat(281)))
})

test('an empty rack is rejected rather than exported', async () => {
  const empty = await exportRack({ slugs: [] })
  assert.equal(empty.status, 400)
  assert.deepEqual(await empty.json(), { error: 'Your rack is empty.' })

  const unknown = await exportRack({ slugs: ['not-a-tool'] })
  assert.equal(unknown.status, 400)
})
