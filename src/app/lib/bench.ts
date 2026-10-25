// The bench test is the in-app counterpart to `npm run smoke`: one button that
// proves this copy can do its job in the browser it is open in — storage, the
// catalogue, the covers, the export endpoint and (when one is configured) the
// model endpoint. It only reads: the single write is a probe key it removes
// again, and no project folder is touched.
import { categories, safetyMeta, tools } from '../../data/tools.ts'
import { cleanHarness, cleanRack, cleanRefinements } from './validate.ts'

export type BenchOutcome = 'pass' | 'fail' | 'skip'

export interface BenchCheck {
  id: string
  label: string
  outcome: BenchOutcome
  detail: string
}

export interface BenchReport {
  checks: BenchCheck[]
  passed: number
  failed: number
  skipped: number
  ms: number
  ranAt: string
}

export interface BenchModel {
  label: string
  baseUrl: string
}

const PROBE_KEY = 'red-queen-bench-probe'
const RACK_KEY = 'red-queen-rack'
const REFINE_KEY = 'red-queen-refinements'
const HARNESS_KEY = 'red-queen-harness'

function check(id: string, label: string, outcome: BenchOutcome, detail: string): BenchCheck {
  return { id, label, outcome, detail }
}

function storage(): BenchCheck {
  const id = 'storage'
  const label = 'Local storage'
  try {
    localStorage.setItem(PROBE_KEY, 'ok')
    const back = localStorage.getItem(PROBE_KEY)
    localStorage.removeItem(PROBE_KEY)
    if (back !== 'ok') return check(id, label, 'fail', 'Wrote a value and read back something else.')
    return check(id, label, 'pass', 'Readable and writable; the probe key was removed again.')
  } catch {
    return check(id, label, 'fail', 'This browser refuses storage, so the rack and refinements will not survive a reload.')
  }
}

// The saved values are pushed back through the same validators the app uses, so
// this reports what the app will actually load rather than what is on disk.
function saved(): BenchCheck {
  const id = 'saved'
  const label = 'Saved data'
  try {
    const rackRaw = localStorage.getItem(RACK_KEY)
    const rack = cleanRack(rackRaw ? JSON.parse(rackRaw) : [])
    const refineRaw = localStorage.getItem(REFINE_KEY)
    const refinements = cleanRefinements(refineRaw ? JSON.parse(refineRaw) : {})
    const harnessRaw = localStorage.getItem(HARNESS_KEY)
    const harness = cleanHarness(harnessRaw ? JSON.parse(harnessRaw) : null)
    const notes = Object.keys(refinements).length
    const models = harness.models.length
    if (rack.length === 0 && notes === 0 && models === 0) return check(id, label, 'pass', 'Nothing saved yet; the empty state validates.')
    const parts = [`${rack.length} tool${rack.length === 1 ? '' : 's'}`, `${notes} refinement${notes === 1 ? '' : 's'}`, `${models} model${models === 1 ? '' : 's'}`]
    return check(id, label, 'pass', `${parts.join(' · ')} — every saved value passes its validator.`)
  } catch {
    return check(id, label, 'fail', 'A saved value is not valid JSON, so the app will ignore it. Clear it from Safety → Forget everything on this device.')
  }
}

function catalogue(): BenchCheck {
  const id = 'catalogue'
  const label = 'Catalogue'
  const seen = new Set<string>()
  const problems: string[] = []
  for (const tool of tools) {
    if (seen.has(tool.slug)) problems.push(`duplicate slug ${tool.slug}`)
    seen.add(tool.slug)
    if (!tool.name || !tool.short || !tool.license) problems.push(`${tool.slug} is missing a field`)
    if (!safetyMeta[tool.safety]) problems.push(`${tool.slug} has an unknown safety level`)
    if (!categories.some((category) => category.key === tool.category)) problems.push(`${tool.slug} has an unknown category`)
  }
  if (problems.length > 0) return check(id, label, 'fail', problems.slice(0, 3).join('; '))
  return check(id, label, 'pass', `${tools.length} tools · ${categories.length} categories · ${Object.keys(safetyMeta).length} safety levels, every slug unique.`)
}

async function covers(): Promise<BenchCheck> {
  const id = 'covers'
  const label = 'Covers'
  const sample = [tools[0], tools[tools.length - 1]].filter(Boolean)
  const broken: string[] = []
  for (const tool of sample) {
    try {
      const response = await fetch(`/images/tools/${tool.slug}.svg`)
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok || !type.includes('svg')) broken.push(`${tool.slug} (${response.status})`)
    } catch {
      broken.push(`${tool.slug} (no answer)`)
    }
  }
  if (broken.length > 0) return check(id, label, 'fail', `No usable cover for ${broken.join(', ')}.`)
  return check(id, label, 'pass', `${sample.map((tool) => tool.slug).join(' and ')} load as SVG.`)
}

async function exportCheck(): Promise<BenchCheck> {
  const id = 'export'
  const label = 'Rack export'
  const slugs = tools.slice(0, 2).map((tool) => tool.slug)
  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slugs, refinements: { [slugs[0]]: { note: 'bench test' } } }),
    })
    if (!response.ok) return check(id, label, 'fail', `The export endpoint answered ${response.status}.`)
    const text = await response.text()
    if (!text.includes('# Red Queen rack') || !text.includes(tools[0].name) || !text.includes('bench test')) {
      return check(id, label, 'fail', 'The export answered, but the Markdown is missing its heading, a tool or the refinement note.')
    }
    return check(id, label, 'pass', `${slugs.join(' and ')} exported as Markdown, refinement note kept.`)
  } catch {
    return check(id, label, 'fail', 'Could not reach the export endpoint. This copy may be serving the app without its server.')
  }
}

async function health(): Promise<BenchCheck> {
  const id = 'health'
  const label = 'Server health'
  try {
    const response = await fetch('/api/health')
    if (!response.ok) return check(id, label, 'fail', `/api/health answered ${response.status}.`)
    const body = (await response.json()) as { ok?: unknown; service?: unknown; mode?: unknown }
    if (body.ok !== true) return check(id, label, 'fail', 'The health endpoint answered, but not with ok: true.')
    const mode = typeof body.mode === 'string' ? `${body.mode} mode` : 'hosted'
    return check(id, label, 'pass', `${String(body.service ?? 'red-queen')} · ${mode}`)
  } catch {
    return check(id, label, 'fail', '/api/health did not answer. The app is running without its server.')
  }
}

// Advisory: a bench test should not go red because a model server happens to be
// stopped, but it should say so plainly rather than pretend it checked.
async function modelCheck(model: BenchModel | null | undefined): Promise<BenchCheck> {
  const id = 'model'
  const label = 'Model endpoint'
  if (!model) return check(id, label, 'skip', 'No model configured yet; add one to check it here.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(`${model.baseUrl.replace(/\/$/, '')}/models`, { signal: controller.signal })
    return check(id, label, 'pass', `${model.label} answered (HTTP ${response.status}).`)
  } catch (caught) {
    const timedOut = caught instanceof DOMException && caught.name === 'AbortError'
    return check(id, label, 'skip', timedOut ? `${model.label} did not answer in four seconds.` : `${model.label} could not be reached from this page (offline, or the server does not allow this origin).`)
  } finally {
    clearTimeout(timer)
  }
}

export async function runBenchTest(options: { model?: BenchModel | null } = {}): Promise<BenchReport> {
  const started = performance.now()
  const checks: BenchCheck[] = [storage(), saved(), catalogue(), await covers(), await exportCheck(), await health(), await modelCheck(options.model)]
  const passed = checks.filter((entry) => entry.outcome === 'pass').length
  const failed = checks.filter((entry) => entry.outcome === 'fail').length
  const skipped = checks.filter((entry) => entry.outcome === 'skip').length
  return { checks, passed, failed, skipped, ms: Math.round(performance.now() - started), ranAt: new Date().toISOString() }
}
