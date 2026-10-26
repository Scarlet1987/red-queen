// The COS-G page's one server read: what this copy of Red Queen can see of the
// machine it is running on. A local install answers with a live sweep, the hosted
// copy answers that it has no machine — one route, two honest answers.
//
// The response is parsed as defensively as stored data is. A stale Worker, a
// server that is not running, and the hosted site's single-page fallback (which
// answers index.html for any path it does not know) all have to end as "no
// answer", never as a report a component would render as if it were read.
import { EMPTY_COUNTS, type HostFinding, type HostRule, type HostView } from '../../lib/host-view.ts'

export type HostResult = { status: 'ok'; view: HostView } | { status: 'unreachable'; message: string }

const RULES: HostRule[] = [
  'unbound-hardware',
  'blacklisted-driver',
  'blacklist-ineffective',
  'idle-driver',
  'stale-dkms',
  'dkms-not-built',
]

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0
}

function finding(value: unknown): HostFinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.rule !== 'string' || !RULES.includes(raw.rule as HostRule)) return null
  if (typeof raw.message !== 'string' || !raw.message.trim()) return null
  const file = text(raw.file)
  return {
    rule: raw.rule as HostRule,
    severity: raw.severity === 'warn' ? 'warn' : 'info',
    message: raw.message.trim(),
    ...(file ? { file } : {}),
  }
}

/** A view, or null when the answer is not one. */
export function cleanHostView(raw: unknown): HostView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value.available !== 'boolean' || !Array.isArray(value.findings)) return null
  const counts = value.counts && typeof value.counts === 'object' ? (value.counts as Record<string, unknown>) : {}
  return {
    available: value.available,
    reason: text(value.reason),
    mode: text(value.mode) || 'unknown',
    kernel: text(value.kernel),
    cell: text(value.cell),
    counts: {
      ...EMPTY_COUNTS,
      devices: count(counts.devices),
      blacklisted: count(counts.blacklisted),
      loaded: count(counts.loaded),
      dkms: count(counts.dkms),
    },
    findings: value.findings.map(finding).filter((entry): entry is HostFinding => entry !== null),
  }
}

export async function fetchHostView(): Promise<HostResult> {
  try {
    const response = await fetch('/api/host', { headers: { accept: 'application/json' } })
    if (!response.ok) return { status: 'unreachable', message: `/api/host answered ${response.status}, so there was nothing to read.` }
    const type = response.headers.get('content-type') ?? ''
    if (!type.includes('json')) {
      return { status: 'unreachable', message: 'The app is being served without its server, which is what happens when the pages are opened straight off disk.' }
    }
    const view = cleanHostView(await response.json())
    if (!view) return { status: 'unreachable', message: '/api/host answered, but not with a host report.' }
    return { status: 'ok', view }
  } catch {
    return { status: 'unreachable', message: 'Could not reach /api/host. This copy may be serving the app without its server.' }
  }
}
