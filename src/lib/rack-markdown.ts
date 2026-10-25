// The rack export, as pure data in and Markdown out. The Worker and the
// offline server both call this, so a saved rack exports the same way whether
// it was requested from the hosted site or a local copy. No Node, no DOM.
export type RackSafety = 'static' | 'sandbox' | 'live'

export interface RackTool {
  slug: string
  name: string
  short: string
  license: string
  platforms: string[]
  repo?: string
  url: string
  safety: RackSafety
}

const SAFETY_LEVELS: RackSafety[] = ['static', 'sandbox', 'live']
const NOTE_LIMIT = 280

interface Refinement {
  safety?: RackSafety
  note?: string
}

// Unknown slugs, unknown safety levels and overlong notes are dropped or
// repaired here rather than echoed into a document.
function refinementsFor(raw: unknown, slugs: string[]): Map<string, Refinement> {
  const out = new Map<string, Refinement>()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!slugs.includes(slug) || !value || typeof value !== 'object') continue
    const entry = value as { safety?: unknown; note?: unknown }
    const refinement: Refinement = {}
    if (typeof entry.safety === 'string' && SAFETY_LEVELS.includes(entry.safety as RackSafety)) refinement.safety = entry.safety as RackSafety
    if (typeof entry.note === 'string' && entry.note.trim()) refinement.note = entry.note.trim().slice(0, NOTE_LIMIT)
    if (refinement.safety || refinement.note) out.set(slug, refinement)
  }
  return out
}

export function rackMarkdown(tools: RackTool[], refinements: unknown, labels: Record<RackSafety, string>): string {
  const refinementsBySlug = refinementsFor(refinements, tools.map((tool) => tool.slug))
  const safetyOf = (tool: RackTool): RackSafety => refinementsBySlug.get(tool.slug)?.safety ?? tool.safety
  const groups = SAFETY_LEVELS.map((key) => ({ key, tools: tools.filter((tool) => safetyOf(tool) === key) })).filter((group) => group.tools.length > 0)

  const lines = [
    '# Red Queen rack',
    '',
    `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'} from [Red Queen](../), a safe reverse-engineering directory.`,
    '',
  ]

  for (const group of groups) {
    lines.push(`## ${labels[group.key]}`, '')
    for (const tool of group.tools) {
      lines.push(`- **[${tool.name}](${tool.url})** — ${tool.short} · ${tool.license} · ${tool.platforms.join(', ')}${tool.repo ? ` · [source](${tool.repo})` : ''}`)
      const note = refinementsBySlug.get(tool.slug)?.note
      if (note) lines.push(`  - _Your note: ${note.replace(/\n+/g, ' ')}_`)
    }
    lines.push('')
  }

  lines.push('---', '', '_Nothing in this list was executed to produce it._', '')
  return lines.join('\n')
}
