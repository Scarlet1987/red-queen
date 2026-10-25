import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { bySlug, safetyMeta } from '../src/data/tools.ts'
import { rackMarkdown, type RackTool } from '../src/lib/rack-markdown.ts'
import { smoke, type Check } from '../scripts/smoke.ts'

// The smoke test is the only check that sees the site after it is published, so
// it is tested the way it fails: a local fixture that behaves like the Worker
// on a good day, and then one fault at a time. A check that stops noticing a
// broken page, a dead API, an unfiltered export or a stale deployment fails
// here first.
const PAGES = new Set(['/directory', '/tool/ghidra', '/rack', '/safety', '/cosg', '/cosg/worksheet'])

interface Faults {
  page?: number
  bundle?: number
  health?: number
  echoUnknown?: boolean
  emptyRack?: number
  noBundle?: boolean
}

function shell(faults: Faults): string {
  const script = faults.noBundle ? '' : '<script type="module" src="/assets/index-test.js"></script>'
  return [
    '<!doctype html><html><head><meta charset="UTF-8" />',
    '<title>Red Queen — programming harness</title>',
    script,
    '<link rel="stylesheet" href="/assets/index-test.css" />',
    '</head><body><div id="root"></div></body></html>',
  ].join('')
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function handler(faults: Faults) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    const send = (status: number, body: string, type: string) => {
      response.writeHead(status, { 'content-type': type })
      response.end(body)
    }

    if (path === '/') return send(200, shell(faults), 'text/html; charset=utf-8')

    if (path === '/api/health') {
      if (faults.health) return send(faults.health, 'site temporarily unavailable', 'text/plain')
      return send(200, JSON.stringify({ ok: true, service: 'red-queen' }), 'application/json')
    }

    if (path === '/api/export' && request.method === 'POST') {
      let payload: { slugs?: unknown; refinements?: unknown } = {}
      try {
        payload = JSON.parse(await readBody(request)) as typeof payload
      } catch {
        // The smoke test only ever sends JSON; anything else is malformed.
      }
      const slugs = Array.isArray(payload.slugs) ? payload.slugs.filter((slug): slug is string => typeof slug === 'string') : []
      if (slugs.length === 0) {
        return send(faults.emptyRack ?? 400, JSON.stringify({ error: 'Your rack is empty.' }), 'application/json')
      }
      const tools: RackTool[] = slugs
        .map((slug) => bySlug(slug))
        .filter((tool) => tool !== undefined)
        .map((tool) => ({
          slug: tool.slug,
          name: tool.name,
          short: tool.short,
          license: tool.license,
          platforms: tool.platforms,
          repo: tool.repo,
          url: tool.url,
          safety: tool.safety,
        }))
      const labels = { static: safetyMeta.static.label, sandbox: safetyMeta.sandbox.label, live: safetyMeta.live.label }
      const markdown = rackMarkdown(tools, payload.refinements, labels) + (faults.echoUnknown ? '\n- not-a-catalogue-tool\n' : '')
      return send(200, markdown, 'text/markdown; charset=utf-8')
    }

    if (path === '/assets/index-test.js') {
      if (faults.noBundle) return send(404, 'not found', 'text/plain')
      return send(faults.bundle ?? 200, 'console.log("red queen")', 'text/javascript; charset=utf-8')
    }

    if (path === '/assets/index-test.css') return send(200, 'body { margin: 0 }', 'text/css; charset=utf-8')

    if (path === '/images/tools/ghidra.svg') {
      return send(200, '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>', 'image/svg+xml')
    }

    if (PAGES.has(path)) {
      const status = faults.page ?? 200
      return send(status, status === 200 ? shell(faults) : 'not found', 'text/html; charset=utf-8')
    }

    return send(404, 'not found', 'text/plain')
  }
}

function localShell(html: string): { path: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'red-queen-smoke-'))
  const path = join(directory, 'index.html')
  writeFileSync(path, html)
  return { path, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

async function withFixture(
  faults: Faults,
  run: (base: string, shellPath: string) => Promise<void>,
  builtShell: string = shell({}),
): Promise<void> {
  const local = localShell(builtShell)
  const server = createServer(handler(faults))
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}`, local.path)
  } finally {
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose())
      server.closeAllConnections()
    })
    local.cleanup()
  }
}

function find(checks: Check[], name: string): Check {
  const found = checks.find((entry) => entry.name === name)
  assert.ok(found, `no "${name}" check in: ${checks.map((entry) => entry.name).join(', ')}`)
  return found
}

function failures(checks: Check[]): string[] {
  return checks.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`)
}

test('a healthy site passes every check', async () => {
  await withFixture({}, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath })
    assert.deepEqual(failures(checks), [])
    assert.equal(checks.length, 14)
    assert.match(find(checks, 'shell').detail, /200 · html/)
    assert.match(find(checks, 'deployment').detail, /identical to .*index\.html · sha256 [0-9a-f]{12}/)
    assert.match(find(checks, 'bundle').detail, /index-test\.js 200/)
    assert.match(find(checks, 'styles').detail, /index-test\.css 200/)
    assert.match(find(checks, 'health').detail, /red-queen/)
    assert.match(find(checks, 'export').detail, /3 tools · refinement kept/)
    assert.match(find(checks, 'export empty').detail, /Your rack is empty/)
  })
})

test('a deployment serving an older shell fails even though every page answers', async () => {
  const newer = shell({}).replace('index-test.js', 'index-new.js')
  await withFixture(
    {},
    async (base, shellPath) => {
      const checks = await smoke(base, { shellPath })
      assert.equal(find(checks, 'shell').ok, true)
      assert.equal(find(checks, 'route /rack').ok, true)
      const deployment = find(checks, 'deployment')
      assert.equal(deployment.ok, false)
      assert.match(deployment.detail, /served shell is not this build/)
      assert.match(deployment.detail, /local index-new\.js/)
      assert.match(deployment.detail, /live index-test\.js/)
      assert.deepEqual(failures(checks), [`deployment: ${deployment.detail}`])
    },
    newer,
  )
})

test('a missing local build fails the comparison and names the remedy', async () => {
  await withFixture({}, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath: `${shellPath}.missing` })
    const deployment = find(checks, 'deployment')
    assert.equal(deployment.ok, false)
    assert.match(deployment.detail, /no local build at .*index\.html\.missing — run npm run release first/)
  })
})

test('a page that stops serving is caught while the rest still pass', async () => {
  await withFixture({ page: 500 }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath })
    assert.equal(find(checks, 'shell').ok, true)
    assert.equal(find(checks, 'deployment').ok, true)
    assert.equal(find(checks, 'health').ok, true)
    const route = find(checks, 'route /rack')
    assert.equal(route.ok, false)
    assert.match(route.detail, /expected 200, got 500/)
    assert.match(failures(checks).join('\n'), /route \/directory/)
  })
})

test('a failed health endpoint fails the run', async () => {
  await withFixture({ health: 503 }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath })
    const health = find(checks, 'health')
    assert.equal(health.ok, false)
    assert.match(health.detail, /got 503/)
    assert.deepEqual(failures(checks), [`health: ${health.detail}`])
  })
})

test('an export that echoes an unknown slug is caught', async () => {
  await withFixture({ echoUnknown: true }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath })
    const exported = find(checks, 'export')
    assert.equal(exported.ok, false)
    assert.match(exported.detail, /unknown slug/)
  })
})

test('an empty rack answered with a document is caught', async () => {
  await withFixture({ emptyRack: 200 }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath })
    const empty = find(checks, 'export empty')
    assert.equal(empty.ok, false)
    assert.match(empty.detail, /expected 400, got 200/)
  })
})

test('a shell with no bundle is caught', async () => {
  await withFixture({ noBundle: true }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath })
    assert.equal(find(checks, 'shell').ok, true)
    assert.match(find(checks, 'bundle').detail, /loads no JavaScript bundle/)
    assert.equal(find(checks, 'styles').ok, true)
    assert.equal(find(checks, 'deployment').ok, false)
  })
})

test('an unreachable host is reported, not thrown', async () => {
  const checks = await smoke('http://127.0.0.1:1', { timeoutMs: 2000, shellPath: `${join(tmpdir(), 'red-queen-smoke-absent')}/index.html` })
  assert.equal(checks.length, 14)
  assert.equal(checks.every((entry) => !entry.ok), true)
  assert.match(checks[0].detail, /fetch failed|ECONNREFUSED|connect/i)
})
