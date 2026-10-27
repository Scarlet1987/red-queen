import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { bySlug, safetyMeta } from '../src/data/tools.ts'
import { rackMarkdown, type RackTool } from '../src/lib/rack-markdown.ts'
import { checkNames, smoke, type Check } from '../scripts/smoke.ts'

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
  /** A health body to serve instead of the healthy one, to break one field. */
  healthBody?: Record<string, unknown>
  echoUnknown?: boolean
  emptyRack?: number
  noBundle?: boolean
  /** The shipped bundle's text, to make the footer name a different release. */
  bundleBody?: string
}

/** What dist/build.json says a healthy build is, in these tests. */
const RELEASE = { version: '1.0.0', tag: 'v1.0.0' }

/**
 * A bundle shaped like the minified one: the release from vite.config.ts baked
 * in as literals, and the footer's label builder that prints them. The real
 * output uses backticks, so this does too — the check has to survive whatever
 * quote style the minifier picks.
 */
function bundle(release: { version: string; tag: string | null } = RELEASE): string {
  const tag = release.tag === null ? 'null' : `\`${release.tag}\``
  return `var v=\`${release.version}\`,t=${tag};function l(e=v,g=t){return e?g?\`\${e} · \${g}\`:\`\${e} · untagged build\`:\`Unstamped build\`}`
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
      const body = faults.healthBody ?? { ok: true, service: 'red-queen', ...RELEASE }
      return send(200, JSON.stringify(body), 'application/json')
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
      return send(faults.bundle ?? 200, faults.bundleBody ?? bundle(), 'text/javascript; charset=utf-8')
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
    const checks = await smoke(base, { shellPath, release: RELEASE })
    assert.deepEqual(failures(checks), [])
    assert.equal(checks.length, 15)
    assert.match(find(checks, 'shell').detail, /200 · html/)
    assert.match(find(checks, 'deployment').detail, /identical to .*index\.html · sha256 [0-9a-f]{12}/)
    assert.match(find(checks, 'bundle').detail, /index-test\.js 200/)
    assert.match(find(checks, 'styles').detail, /index-test\.css 200/)
    assert.match(find(checks, 'health').detail, /red-queen 1\.0\.0 · v1\.0\.0 — the release this build ships as/)
    assert.match(find(checks, 'footer').detail, /bundle names 1\.0\.0 · v1\.0\.0 — the same release \/api\/health reports/)
    assert.match(find(checks, 'export').detail, /3 tools · refinement kept/)
    assert.match(find(checks, 'export empty').detail, /Your rack is empty/)
  })
})

test('the recorded check names are the checks a run actually makes', async () => {
  await withFixture({}, async (base, shellPath) => {
    const names = (await smoke(base, { shellPath, release: RELEASE })).map((entry) => entry.name)
    assert.deepEqual(names, checkNames(), 'RELEASES.md lists these names, so they cannot drift from the run')
  })
})

test('a deployment serving an older shell fails even though every page answers', async () => {
  const newer = shell({}).replace('index-test.js', 'index-new.js')
  await withFixture(
    {},
    async (base, shellPath) => {
      const checks = await smoke(base, { shellPath, release: RELEASE })
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
    const checks = await smoke(base, { shellPath: `${shellPath}.missing`, release: RELEASE })
    const deployment = find(checks, 'deployment')
    assert.equal(deployment.ok, false)
    assert.match(deployment.detail, /no local build at .*index\.html\.missing — run npm run release first/)
  })
})

test('a page that stops serving is caught while the rest still pass', async () => {
  await withFixture({ page: 500 }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
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
    const checks = await smoke(base, { shellPath, release: RELEASE })
    const health = find(checks, 'health')
    assert.equal(health.ok, false)
    assert.match(health.detail, /got 503/)
    assert.deepEqual(failures(checks), [`health: ${health.detail}`])
  })
})

test('a deployment serving an earlier release is caught by its nameplate', async () => {
  await withFixture({ healthBody: { ok: true, service: 'red-queen', version: '1.0.0', tag: 'v0.9.0' } }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    const health = find(checks, 'health')
    assert.equal(health.ok, false)
    assert.match(health.detail, /reports v0\.9\.0, but this build ships as v1\.0\.0 — it is serving a different release/)
    assert.deepEqual(failures(checks), [`health: ${health.detail}`])
  })
})

test('a site that cannot name its release fails instead of passing quietly', async () => {
  await withFixture({ healthBody: { ok: true, service: 'red-queen' } }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    const health = find(checks, 'health')
    assert.equal(health.ok, false)
    assert.match(health.detail, /reports no version — it is serving a Worker built before the release nameplate/)
  })
})

test('a version that drifts while the tag matches is still caught', async () => {
  await withFixture({ healthBody: { ok: true, service: 'red-queen', version: '1.1.0', tag: 'v1.0.0' } }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    assert.match(find(checks, 'health').detail, /reports 1\.1\.0, but this build is 1\.0\.0/)
  })
})

test('an untagged build passes when the site agrees there is no tag', async () => {
  const untagged = bundle({ version: '1.0.0', tag: null })
  await withFixture(
    { healthBody: { ok: true, service: 'red-queen', version: '1.0.0', tag: null }, bundleBody: untagged },
    async (base, shellPath) => {
      const checks = await smoke(base, { shellPath, release: { version: '1.0.0', tag: null } })
      assert.deepEqual(failures(checks), [])
      assert.match(find(checks, 'health').detail, /red-queen 1\.0\.0 · no tag/)
      assert.match(find(checks, 'footer').detail, /bundle names 1\.0\.0 · no tag/)
    },
  )
})

test('a stale bundle beside a fresh Worker is caught by the footer', async () => {
  await withFixture({ bundleBody: bundle({ version: '0.9.0', tag: 'v0.9.0' }) }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    assert.equal(find(checks, 'health').ok, true)
    assert.equal(find(checks, 'bundle').ok, true)
    const footer = find(checks, 'footer')
    assert.equal(footer.ok, false)
    assert.match(footer.detail, /the bundle names 0\.9\.0, but this build is 1\.0\.0 — a stale bundle is outliving the Worker/)
    assert.deepEqual(failures(checks), [`footer: ${footer.detail}`])
  })
})

test('a bundle that keeps the version but drops the tag is caught', async () => {
  await withFixture({ bundleBody: bundle({ version: '1.0.0', tag: null }) }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    const footer = find(checks, 'footer')
    assert.equal(footer.ok, false)
    assert.match(footer.detail, /the bundle names no tag, but this build ships as 1\.0\.0 · v1\.0\.0/)
  })
})

test('a build logged past its tag passes when the bundle names that whole tag', async () => {
  const past = { version: '1.0.0', tag: 'v1.0.0-10-g6ba4f6a' }
  await withFixture(
    { healthBody: { ok: true, service: 'red-queen', ...past }, bundleBody: bundle(past) },
    async (base, shellPath) => {
      const checks = await smoke(base, { shellPath, release: past })
      assert.deepEqual(failures(checks), [])
      assert.match(find(checks, 'footer').detail, /bundle names 1\.0\.0 · v1\.0\.0-10-g6ba4f6a — the same release \/api\/health reports/)
    },
  )
})

test('a bundle left one commit behind the tag this build carries is caught', async () => {
  const past = { version: '1.0.0', tag: 'v1.0.0-10-g6ba4f6a' }
  await withFixture(
    { healthBody: { ok: true, service: 'red-queen', ...past }, bundleBody: bundle({ version: '1.0.0', tag: 'v1.0.0-9-g0123456' }) },
    async (base, shellPath) => {
      const checks = await smoke(base, { shellPath, release: past })
      const footer = find(checks, 'footer')
      assert.equal(footer.ok, false)
      assert.match(footer.detail, /the bundle names v1\.0\.0-9-g0123456, but this build ships as 1\.0\.0 · v1\.0\.0-10-g6ba4f6a — a stale bundle is outliving the Worker/)
      assert.deepEqual(failures(checks), [`footer: ${footer.detail}`])
    },
  )
})

test('a bundle built before the footer nameplate is caught', async () => {
  await withFixture({ bundleBody: 'console.log("red queen")' }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    const footer = find(checks, 'footer')
    assert.equal(footer.ok, false)
    assert.match(footer.detail, /no release label — it predates the footer nameplate/)
  })
})

test('a site that drops the tag its build carries is caught', async () => {
  await withFixture({ healthBody: { ok: true, service: 'red-queen', version: '1.0.0', tag: null } }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    assert.match(find(checks, 'health').detail, /reports no tag, but this build ships as v1\.0\.0/)
  })
})

test('an export that echoes an unknown slug is caught', async () => {
  await withFixture({ echoUnknown: true }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    const exported = find(checks, 'export')
    assert.equal(exported.ok, false)
    assert.match(exported.detail, /unknown slug/)
  })
})

test('an empty rack answered with a document is caught', async () => {
  await withFixture({ emptyRack: 200 }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    const empty = find(checks, 'export empty')
    assert.equal(empty.ok, false)
    assert.match(empty.detail, /expected 400, got 200/)
  })
})

test('a shell with no bundle is caught', async () => {
  await withFixture({ noBundle: true }, async (base, shellPath) => {
    const checks = await smoke(base, { shellPath, release: RELEASE })
    assert.equal(find(checks, 'shell').ok, true)
    assert.match(find(checks, 'bundle').detail, /loads no JavaScript bundle/)
    assert.match(find(checks, 'footer').detail, /loads no JavaScript bundle, so the footer cannot name the release here/)
    assert.equal(find(checks, 'styles').ok, true)
    assert.equal(find(checks, 'deployment').ok, false)
  })
})

test('an unreachable host is reported, not thrown', async () => {
  const checks = await smoke('http://127.0.0.1:1', { timeoutMs: 2000, shellPath: `${join(tmpdir(), 'red-queen-smoke-absent')}/index.html` })
  assert.equal(checks.length, 15)
  assert.equal(checks.every((entry) => !entry.ok), true)
  assert.match(checks[0].detail, /fetch failed|ECONNREFUSED|connect/i)
})
