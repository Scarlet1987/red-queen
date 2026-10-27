// Live smoke test for the published site. The deploy gate proves what goes up;
// this proves what came back down.
//
//   npm run smoke                                   the published preview
//   npm run smoke -- https://example.freebuff.page  another deployment
//   SMOKE_URL=https://... npm run smoke
//
// It fetches the shell, every page, the bundle, a cover, /api/health and two
// real rack exports the way a visitor would, and exits non-zero when the
// published site does not behave like the release that was just shipped. The
// served shell must be byte-identical to dist/client/index.html, so a deploy
// that quietly skipped the latest build fails even though every page answers.
// The bundle the shell loads must also carry the release /api/health reports: a
// Worker can be replaced without the assets beside it, and then the footer names
// a release the server no longer agrees with.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bySlug, safetyMeta } from '../src/data/tools.ts'
import { readStamp } from './build-stamp.ts'
import { tagOrNull } from './release-tag.ts'

export const DEFAULT_BASE = 'https://site-66228069b13847cc95a835f233ca293e.freebuff.page'

/** What a deployment should say it is: the version and tag baked into the build. */
export interface Release {
  version: string
  tag: string | null
}

/** The release dist/ was built as, or null when there is no build to compare with. */
export function buildRelease(root: string = ROOT): Release | null {
  const stamp = readStamp(root)
  return stamp ? { version: stamp.version, tag: tagOrNull(stamp.tag) } : null
}

/** The first slug of each safety level, so a section heading must appear. */
const SLUGS = ['ghidra', 'radare2', 'frida']
const ROUTES = ['/directory', '/tool/ghidra', '/rack', '/safety', '/cosg', '/cosg/worksheet']

/**
 * The checks a run makes, in order. RELEASES.md writes this list into every row
 * so a logged release proves what was checked, not merely how many passed; a
 * test pins it to the run itself so the two cannot drift.
 */
export function checkNames(): string[] {
  return [
    'shell',
    'deployment',
    'bundle',
    'styles',
    ...ROUTES.map((path) => `route ${path}`),
    'cover',
    'health',
    'footer',
    'export',
    'export empty',
  ]
}
const UNKNOWN = 'not-a-catalogue-tool'
const NOTE = 'Run it in the air-gapped VM, never on the host.'
const TIMEOUT_MS = 15_000

export interface Check {
  name: string
  ok: boolean
  detail: string
}

export interface SmokeOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** The local build to compare against; defaults to dist/client/index.html. */
  shellPath?: string
  /** The release to expect from /api/health; defaults to dist/build.json. */
  release?: Release
}

const ROOT = join(import.meta.dirname, '..')
const BUILD_SHELL = join(ROOT, 'dist', 'client', 'index.html')

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat ? ` — ${flat.slice(0, 120)}` : ''
}

/** Assert the status without consuming the body on the path that uses it. */
async function expectStatus(response: Response, expected: number): Promise<void> {
  if (response.status === expected) return
  const body = await response.text().catch(() => '')
  throw new Error(`expected ${expected}, got ${response.status}${preview(body)}`)
}

async function expectType(response: Response, fragment: string): Promise<void> {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes(fragment)) throw new Error(`content-type ${type || 'missing'}, expected ${fragment}`)
}

async function check(name: string, run: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await run() }
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function links(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((match) => match[1])
}

/** The asset filenames a shell references, so a mismatch names its cause. */
function assetsOf(html: string): string {
  const names = [
    ...links(html, /<script[^>]+src="([^"]+\.js)"/g),
    ...links(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g),
  ]
  if (names.length === 0) return 'no bundle'
  return names.map((name) => name.split('/').pop() ?? name).join(' + ')
}

function display(path: string): string {
  const inside = relative(ROOT, path)
  return inside && !inside.startsWith('..') ? inside : path
}

/**
 * Release-shaped tokens in the shipped bundle: `1.0.2`, `v1.0.2`, a tag that has
 * moved past its release like `v1.0.2-10-g6ba4f6a`, and library version strings
 * like `19.3.1`. The minifier keeps them as literals, whichever quote style it
 * settles on, so the token is what the footer can actually print. The describe
 * suffix is part of the token rather than a trailing version: a build logged
 * past its tag ships that whole string, so reading only `v1.0.2` out of it would
 * call a current bundle stale.
 */
export function releaseTokens(source: string): Set<string> {
  return new Set([...source.matchAll(/(?<![\w.])v?\d+\.\d+\.\d+(?:-\d+-g[0-9a-f]+)?(?![\w.])/g)].map((match) => match[0]))
}

/** The version-shaped tokens found, for an error message that names its cause. */
function versionsFound(tokens: Set<string>): string {
  const versions = [...tokens].filter((token) => !token.startsWith('v')).sort()
  if (versions.length === 0) return 'no version'
  return versions.slice(0, 3).join(', ') + (versions.length > 3 ? ', …' : '')
}

/**
 * Every check the release depends on, as plain data. The CLI prints the list
 * and turns failures into an exit code; the tests run the same list against a
 * local fixture, so a check that stops catching drift is caught itself.
 */
export async function smoke(base: string = DEFAULT_BASE, options: SmokeOptions = {}): Promise<Check[]> {
  const root = base.replace(/\/+$/, '')
  const fetched = options.fetchImpl ?? fetch
  const call = (path: string, init: RequestInit = {}) =>
    fetched(new URL(path, `${root}/`).toString(), {
      ...init,
      headers: { 'cache-control': 'no-cache', ...init.headers },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    })

  // Both nameplate checks — the Worker's and the bundle's — are compared against
  // the local build, so the site has to agree with one release, not merely agree
  // with itself.
  const expected = options.release ?? buildRelease()
  const checks: Check[] = []
  let html = ''
  let bundleSource = ''

  checks.push(
    await check('shell', async () => {
      const response = await call('/')
      await expectStatus(response, 200)
      await expectType(response, 'text/html')
      html = await response.text()
      for (const marker of ['<div id="root">', '<title>Red Queen']) {
        if (!html.includes(marker)) throw new Error(`the served HTML has no ${marker}`)
      }
      return `200 · html · ${html.length} bytes`
    }),
  )

  checks.push(
    await check('deployment', async () => {
      const shellPath = options.shellPath ?? BUILD_SHELL
      let built = ''
      try {
        built = readFileSync(shellPath, 'utf8')
      } catch {
        throw new Error(`no local build at ${display(shellPath)} — run npm run release first`)
      }
      if (!html) throw new Error('the shell did not load, so there is nothing to compare')
      const builtHash = createHash('sha256').update(built).digest('hex')
      const servedHash = createHash('sha256').update(html).digest('hex')
      if (servedHash !== builtHash) {
        throw new Error(`the served shell is not this build · local ${assetsOf(built)} · live ${assetsOf(html)}`)
      }
      return `identical to ${display(shellPath)} · sha256 ${builtHash.slice(0, 12)}…`
    }),
  )

  checks.push(
    await check('bundle', async () => {
      const scripts = links(html, /<script[^>]+src="([^"]+\.js)"/g)
      if (scripts.length === 0) throw new Error(html ? 'the shell loads no JavaScript bundle' : 'the shell did not load')
      const seen: string[] = []
      for (const path of scripts.slice(0, 3)) {
        const response = await call(path)
        await expectStatus(response, 200)
        await expectType(response, 'javascript')
        // Kept for the footer check: the nameplate is rendered by this code, so
        // this is the only place the page's own release is visible to a fetch.
        bundleSource += await response.text()
        seen.push(`${new URL(path, `${root}/`).pathname} 200`)
      }
      return seen.join(' · ')
    }),
  )

  checks.push(
    await check('styles', async () => {
      const sheets = links(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)
      if (sheets.length === 0) throw new Error(html ? 'the shell loads no stylesheet' : 'the shell did not load')
      const seen: string[] = []
      for (const path of sheets.slice(0, 3)) {
        const response = await call(path)
        await expectStatus(response, 200)
        await expectType(response, 'text/css')
        await response.arrayBuffer()
        seen.push(`${new URL(path, `${root}/`).pathname} 200`)
      }
      return seen.join(' · ')
    }),
  )

  for (const path of ROUTES) {
    checks.push(
      await check(`route ${path}`, async () => {
        const response = await call(path)
        await expectStatus(response, 200)
        await expectType(response, 'text/html')
        const body = await response.text()
        if (!body.includes('<div id="root">')) throw new Error('the SPA fallback did not return the app shell')
        return '200 · html shell'
      }),
    )
  }

  checks.push(
    await check('cover', async () => {
      const response = await call('/images/tools/ghidra.svg')
      await expectStatus(response, 200)
      await expectType(response, 'image/svg+xml')
      const body = await response.text()
      if (!body.includes('<svg')) throw new Error('the cover is not an SVG document')
      return '200 · image/svg+xml'
    }),
  )

  checks.push(
    await check('health', async () => {
      const response = await call('/api/health')
      await expectStatus(response, 200)
      await expectType(response, 'application/json')
      const body = (await response.json()) as { ok?: unknown; service?: unknown; version?: unknown; tag?: unknown }
      if (body.ok !== true || body.service !== 'red-queen') throw new Error(`unexpected body ${JSON.stringify(body)}`)

      // The site is expected to name its own release, so a deployment that is
      // not this build fails even when every page answers: the nameplate is
      // baked in at build time, which makes it the cheapest proof of identity.
      if (!expected) throw new Error('no local build at dist/build.json — run npm run release first')
      if (typeof body.version !== 'string' || body.version === '') {
        throw new Error('the site reports no version — it is serving a Worker built before the release nameplate')
      }
      if (body.version !== expected.version) {
        throw new Error(`the site reports ${body.version}, but this build is ${expected.version} — it is serving a different release`)
      }
      if (body.tag !== null && typeof body.tag !== 'string') {
        throw new Error(`unexpected tag ${JSON.stringify(body.tag)}; expected a tag name or null`)
      }
      const served = body.tag ?? null
      if (served !== expected.tag) {
        throw new Error(`the site reports ${served ?? 'no tag'}, but this build ships as ${expected.tag ?? 'no tag'} — it is serving a different release`)
      }
      return `200 · red-queen ${expected.version} · ${served ?? 'no tag'} — the release this build ships as`
    }),
  )

  checks.push(
    await check('footer', async () => {
      // The shell only carries `<div id="root">`; the footer is drawn by the
      // bundle afterwards. So the page's own nameplate can only be read in the
      // code that will print it — and a Worker that was replaced on its own can
      // leave an older bundle beside it, showing a release the API denies.
      if (!expected) throw new Error('no local build at dist/build.json — run npm run release first')
      if (!bundleSource) throw new Error('the shell loads no JavaScript bundle, so the footer cannot name the release here')
      if (!bundleSource.includes('untagged build')) {
        throw new Error('the bundle carries no release label — it predates the footer nameplate')
      }

      const tokens = releaseTokens(bundleSource)
      const label = `${expected.version}${expected.tag ? ` · ${expected.tag}` : ' · no tag'}`
      if (!tokens.has(expected.version)) {
        throw new Error(`the bundle names ${versionsFound(tokens)}, but this build is ${expected.version} — a stale bundle is outliving the Worker`)
      }
      if (expected.tag) {
        if (!tokens.has(expected.tag)) {
          const stale = [...tokens].filter((token) => token.startsWith('v') && /\d/.test(token)).sort()
          throw new Error(
            `the bundle names ${stale.length ? stale.slice(0, 3).join(', ') : 'no tag'}, but this build ships as ${label} — a stale bundle is outliving the Worker`,
          )
        }
        return `bundle names ${label} — the same release /api/health reports`
      }

      // An untagged build must not carry a tag, or the footer would claim a
      // release the API says does not exist.
      const stray = [...tokens].filter((token) => token.startsWith('v') && /\d/.test(token)).sort()
      if (stray.length) {
        throw new Error(`the bundle names ${stray.slice(0, 3).join(', ')}, but this build is ${label} — a stale bundle is outliving the Worker`)
      }
      return `bundle names ${label} — the same release /api/health reports`
    }),
  )

  checks.push(
    await check('export', async () => {
      const picked = SLUGS.map((slug) => bySlug(slug)).filter((tool) => tool !== undefined)
      if (picked.length !== SLUGS.length) throw new Error('the catalogue no longer has the smoke slugs')

      const response = await call('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slugs: [...SLUGS, UNKNOWN], refinements: { ghidra: { safety: 'sandbox', note: NOTE } } }),
      })
      await expectStatus(response, 200)
      await expectType(response, 'text/markdown')
      const markdown = await response.text()

      if (!markdown.startsWith('# Red Queen rack')) throw new Error('the document does not start with the rack heading')
      if (!markdown.includes(`${picked.length} tools from`)) {
        throw new Error(`expected ${picked.length} tools listed (the unknown slug dropped)`)
      }
      for (const tool of picked) {
        if (!markdown.includes(`[${tool.name}](`)) throw new Error(`the document is missing ${tool.name}`)
      }
      if (!markdown.includes(`## ${safetyMeta.sandbox.label}`)) throw new Error('the safety refinement was ignored')
      if (!markdown.includes(`Your note: ${NOTE}`)) throw new Error('the refinement note did not reach the document')
      if (markdown.includes(UNKNOWN)) throw new Error('an unknown slug was echoed into the document')
      return `200 · markdown · ${picked.length} tools · refinement kept`
    }),
  )

  checks.push(
    await check('export empty', async () => {
      const response = await call('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slugs: [] }),
      })
      await expectStatus(response, 400)
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null
      if (!body || typeof body.error !== 'string') throw new Error('the empty rack was refused without a JSON error')
      return `400 · "${body.error}"`
    }),
  )

  return checks
}

/** Print the results and return the process exit code. */
export function report(base: string, results: Check[], elapsedMs: number): number {
  const width = Math.max(...results.map((result) => result.name.length))
  const failed = results.filter((result) => !result.ok)

  console.log('Red Queen live smoke test')
  console.log(`  target  ${base}`)
  console.log('')
  for (const result of results) {
    console.log(`  ${(result.ok ? 'ok' : 'FAIL').padEnd(4)}  ${result.name.padEnd(width)}  ${result.detail}`)
  }
  console.log('')
  console.log(`  ${results.length - failed.length}/${results.length} checks passed in ${(elapsedMs / 1000).toFixed(1)} s`)

  if (failed.length === 0) return 0

  if (failed.some((result) => /got 503/.test(result.detail))) {
    console.log('  The host answered 503. That is usually a hosting pause rather than the app; retry in a minute.')
  }
  console.log('  The published site does not match the release. Do not announce it as live yet.')
  return 1
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const base = (process.env.SMOKE_URL ?? process.argv.slice(2).find((arg) => !arg.startsWith('-')) ?? DEFAULT_BASE).trim()
  if (!/^https?:\/\//i.test(base)) {
    console.error(`Not an http(s) address: ${base}`)
    process.exitCode = 2
  } else {
    const started = performance.now()
    const results = await smoke(base)
    process.exitCode = report(base, results, performance.now() - started)
  }
}
