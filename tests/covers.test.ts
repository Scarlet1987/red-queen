import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { tools } from '../src/data/tools.ts'

// Every card in the directory, every tool page and every rack entry shows a
// specimen cover from public/images/tools/<slug>.svg. The covers are generated,
// so a new catalogue entry can ship artless without anything failing: the card
// simply renders with a broken image. These tests make that impossible.
const repo = fileURLToPath(new URL('..', import.meta.url))
const coverDir = join(repo, 'public', 'images', 'tools')
const covers = readdirSync(coverDir)
  .filter((name) => name.endsWith('.svg'))
  .map((name) => name.slice(0, -'.svg'.length))

test('every catalogue entry has a cover', () => {
  const missing = tools.filter((tool) => !covers.includes(tool.slug)).map((tool) => tool.slug)
  assert.deepEqual(missing, [], `no cover for: ${missing.join(', ')} — run \`npm run covers\` and commit the result`)
})

test('no cover is orphaned', () => {
  const slugs = new Set(tools.map((tool) => tool.slug))
  const orphans = covers.filter((cover) => !slugs.has(cover))
  assert.deepEqual(
    orphans,
    [],
    `covers with no catalogue entry: ${orphans.join(', ')} — delete them, or add the entry and re-run \`npm run covers\``,
  )
})

test('each cover is real art, at the filename the URL asks for', () => {
  for (const tool of tools) {
    assert.match(
      tool.slug,
      /^[a-z0-9][a-z0-9-]*$/,
      `slug "${tool.slug}" is not URL-safe, so /images/tools/${tool.slug}.svg would 404 on a case-sensitive host`,
    )

    const body = readFileSync(join(coverDir, `${tool.slug}.svg`), 'utf8')
    assert.match(body.trimStart(), /^<svg[\s>]/, `${tool.slug}.svg is not an SVG document`)
    assert.match(body, /viewBox=/, `${tool.slug}.svg has no viewBox, so it will not scale in the card`)
    assert.ok(body.length > 200, `${tool.slug}.svg is only ${body.length} bytes — empty art passes the filename check`)
  }
})

test('the covers are the generator’s output, not stray files', () => {
  // One generator owns this directory: every file is an SVG, and nothing is
  // hiding in there that the URL scheme would never serve.
  const strays = readdirSync(coverDir).filter((name) => !name.endsWith('.svg'))
  assert.deepEqual(strays, [], `not covers: ${strays.join(', ')} — \`npm run covers\` only writes <slug>.svg`)
  assert.equal(covers.length, tools.length, 'one cover per tool')
})
