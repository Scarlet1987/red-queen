// Storage validators. Every value Red Queen reads back from localStorage goes
// through here, so a stale, hand-edited or half-written entry cannot reach a
// component. Pure functions only: no React, no DOM — which is what lets them
// carry a regression test.
import { bySlug, type Safety } from '../../data/tools.ts'

export const SAFETY_LEVELS: Safety[] = ['static', 'sandbox', 'live']

export type ModelProvider = 'ollama' | 'lmstudio' | 'llamacpp' | 'custom'
const PROVIDERS: ModelProvider[] = ['ollama', 'lmstudio', 'llamacpp', 'custom']

export interface Refinement {
  safety?: Safety
  note?: string
}

export interface StoredModel {
  id: string
  label: string
  provider: ModelProvider
  baseUrl: string
  model: string
}

export interface StoredHarness {
  models: StoredModel[]
  activeId: string | null
  directory: { name: string } | null
}

export type CosgLetter = 'C' | 'O' | 'S' | 'G'
export type WorksheetOutcome = 'open' | 'implemented' | 'retry'

export interface Worksheet {
  id: string
  letter: CosgLetter
  title: string
  definition: string
  action: string
  test: string
  outcome: WorksheetOutcome
  notes: string
  createdAt: string
  updatedAt: string
}

const LETTERS: CosgLetter[] = ['C', 'O', 'S', 'G']
const OUTCOMES: WorksheetOutcome[] = ['open', 'implemented', 'retry']
const NOTE_LIMIT = 280
const FIELD_LIMIT = 4000
const TITLE_LIMIT = 160

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function cleanRack(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const slug of raw) {
    if (typeof slug !== 'string' || !bySlug(slug) || seen.has(slug)) continue
    seen.add(slug)
    out.push(slug)
  }
  return out
}

export function cleanRefinements(raw: unknown): Record<string, Refinement> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, Refinement> = {}
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!bySlug(slug) || !value || typeof value !== 'object') continue
    const entry = value as { safety?: unknown; note?: unknown }
    const refinement: Refinement = {}
    if (typeof entry.safety === 'string' && SAFETY_LEVELS.includes(entry.safety as Safety)) refinement.safety = entry.safety as Safety
    if (typeof entry.note === 'string' && entry.note.trim()) refinement.note = entry.note.trim().slice(0, NOTE_LIMIT)
    if (refinement.safety || refinement.note) out[slug] = refinement
  }
  return out
}

export function cleanWorksheets(raw: unknown): Worksheet[] {
  if (!Array.isArray(raw)) return []
  const out: Worksheet[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    if (typeof value.title !== 'string' || !value.title.trim()) continue
    if (typeof value.letter !== 'string' || !LETTERS.includes(value.letter as CosgLetter)) continue
    const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string).slice(0, FIELD_LIMIT) : '')
    const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString()
    out.push({
      id: typeof value.id === 'string' && value.id ? value.id : newId(),
      letter: value.letter as CosgLetter,
      title: value.title.slice(0, TITLE_LIMIT),
      definition: text('definition'),
      action: text('action'),
      test: text('test'),
      outcome: typeof value.outcome === 'string' && OUTCOMES.includes(value.outcome as WorksheetOutcome) ? (value.outcome as WorksheetOutcome) : 'open',
      notes: text('notes'),
      createdAt,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : createdAt,
    })
  }
  return out
}

export function cleanHarness(raw: unknown): StoredHarness {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { models: [], activeId: null, directory: null }
  const value = raw as { models?: unknown; activeId?: unknown; directory?: unknown }
  const models: StoredModel[] = Array.isArray(value.models)
    ? value.models
        .filter((model): model is Record<string, unknown> => Boolean(model && typeof model === 'object' && !Array.isArray(model)))
        .filter(
          (entry) =>
            typeof entry.id === 'string' &&
            entry.id.length > 0 &&
            typeof entry.label === 'string' &&
            typeof entry.baseUrl === 'string' &&
            typeof entry.model === 'string' &&
            entry.model.length > 0,
        )
        .map((entry) => ({
          id: entry.id as string,
          label: entry.label as string,
          provider: PROVIDERS.includes(entry.provider as ModelProvider) ? (entry.provider as ModelProvider) : 'custom',
          baseUrl: (entry.baseUrl as string).replace(/\/$/, ''),
          model: entry.model as string,
        }))
    : []
  const activeId = typeof value.activeId === 'string' && models.some((model) => model.id === value.activeId) ? value.activeId : (models[0]?.id ?? null)
  const directory =
    value.directory && typeof value.directory === 'object' && !Array.isArray(value.directory) && typeof (value.directory as { name?: unknown }).name === 'string'
      ? { name: (value.directory as { name: string }).name }
      : null
  return { models, activeId, directory }
}
