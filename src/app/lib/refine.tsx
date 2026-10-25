import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { type Safety, type Tool } from '../../data/tools'
import { cleanRefinements, type Refinement } from './validate'

// A refinement is your version of an entry: the safety level that matches how
// you actually run the tool, and a note about how it fits your workflow. It
// lives in this browser until you export it; the catalogue itself never moves.
export type { Refinement }

interface RefineState {
  overrides: Record<string, Refinement>
  safetyOf: (tool: Tool) => Safety
  noteOf: (slug: string) => string
  isRefined: (slug: string) => boolean
  refinedCount: number
  set: (slug: string, patch: Refinement) => void
  reset: (slug: string) => void
  resetAll: () => void
}

const RefineContext = createContext<RefineState | null>(null)
const KEY = 'red-queen-refinements'

export function RefineProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, Refinement>>(() => {
    try {
      return cleanRefinements(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
    } catch {
      return {}
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(overrides))
    } catch {
      // Storage full or blocked: refinements still work for this session.
    }
  }, [overrides])

  const set = useCallback((slug: string, patch: Refinement) => {
    setOverrides((prev) => {
      const next = { ...prev }
      const merged = { ...next[slug], ...patch }
      if (patch.note !== undefined) merged.note = patch.note.slice(0, 280)
      if (patch.safety !== undefined) merged.safety = patch.safety
      if (merged.note !== undefined && !merged.note.trim()) delete merged.note
      if (!merged.safety && !merged.note) delete next[slug]
      else next[slug] = merged
      return next
    })
  }, [])

  const reset = useCallback((slug: string) => {
    setOverrides((prev) => {
      if (!prev[slug]) return prev
      const next = { ...prev }
      delete next[slug]
      return next
    })
  }, [])

  const resetAll = useCallback(() => setOverrides({}), [])

  const value = useMemo<RefineState>(
    () => ({
      overrides,
      safetyOf: (tool: Tool) => overrides[tool.slug]?.safety ?? tool.safety,
      noteOf: (slug: string) => overrides[slug]?.note ?? '',
      isRefined: (slug: string) => Boolean(overrides[slug]),
      refinedCount: Object.keys(overrides).length,
      set,
      reset,
      resetAll,
    }),
    [overrides, set, reset, resetAll],
  )

  return <RefineContext.Provider value={value}>{children}</RefineContext.Provider>
}

export function useRefine(): RefineState {
  const ctx = useContext(RefineContext)
  if (!ctx) throw new Error('useRefine outside RefineProvider')
  return ctx
}
