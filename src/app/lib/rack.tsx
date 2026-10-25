import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { bySlug, type Tool } from '../../data/tools'
import { cleanRack } from './validate'

interface RackState {
  slugs: string[]
  items: Tool[]
  count: number
  has: (slug: string) => boolean
  toggle: (slug: string) => void
  remove: (slug: string) => void
  clear: () => void
}

const RackContext = createContext<RackState | null>(null)
const KEY = 'red-queen-rack'

export function RackProvider({ children }: { children: ReactNode }) {
  const [slugs, setSlugs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? cleanRack(JSON.parse(raw)) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(slugs))
    } catch {
      // Storage full or blocked: the rack still works for this session.
    }
  }, [slugs])

  const toggle = useCallback((slug: string) => {
    setSlugs((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))
  }, [])

  const remove = useCallback((slug: string) => setSlugs((prev) => prev.filter((s) => s !== slug)), [])
  const clear = useCallback(() => setSlugs([]), [])

  const value = useMemo<RackState>(
    () => ({
      slugs,
      items: slugs.map((slug) => bySlug(slug)!).filter(Boolean),
      count: slugs.length,
      has: (slug: string) => slugs.includes(slug),
      toggle,
      remove,
      clear,
    }),
    [slugs, toggle, remove, clear],
  )

  return <RackContext.Provider value={value}>{children}</RackContext.Provider>
}

export function useRack(): RackState {
  const ctx = useContext(RackContext)
  if (!ctx) throw new Error('useRack outside RackProvider')
  return ctx
}
