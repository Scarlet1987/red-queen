import { AnimatePresence, motion } from 'motion/react'
import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { categoryLabel, safetyMeta, tools, type Safety } from '../../data/tools'
import { cx } from '../lib/cx'
import { useJump } from '../lib/jump'

interface Entry {
  id: string
  label: string
  hint: string
  group: 'Pages' | 'Safety levels' | 'Tools'
  to: string
  words: string
  pinned?: boolean
}

const pages: Entry[] = [
  { id: 'page-harness', label: 'Harness setup', hint: 'Model and directory', group: 'Pages', to: '/', words: 'home start harness setup model directory folder project', pinned: true },
  { id: 'page-workbench', label: 'Workbench', hint: 'Preview and conversation', group: 'Pages', to: '/workbench', words: 'workbench harness chat preview conversation ai', pinned: true },
  { id: 'page-directory', label: 'Directory', hint: `All ${tools.length} tools`, group: 'Pages', to: '/directory', words: 'directory tools catalogue search', pinned: true },
  { id: 'page-safety', label: 'Safety', hint: 'Rules and scope', group: 'Pages', to: '/safety', words: 'safety policy legal scope rules', pinned: true },
  { id: 'page-rack', label: 'Rack', hint: 'Your shortlist', group: 'Pages', to: '/rack', words: 'rack saved shortlist export', pinned: true },
  { id: 'page-cosg', label: 'Programming bible · COS-G', hint: 'Troubleshooting doctrine', group: 'Pages', to: '/cosg', words: 'cosg programming bible troubleshooting crash orphaned syntax ghost', pinned: true },
  { id: 'page-bible', label: 'The extended bible', hint: 'Laws and frameworks', group: 'Pages', to: '/cosg/bible', words: 'bible laws frameworks mdi lrr scnp hnsi dcsr startup runtime security concurrency regression', pinned: true },
  { id: 'page-worksheet', label: 'COS-G worksheet', hint: 'Work one finding through the loop', group: 'Pages', to: '/cosg/worksheet', words: 'cosg worksheet define act test implement notes report', pinned: true },
]

const levels: Entry[] = (['static', 'sandbox', 'live'] as const).map((level: Safety) => ({
  id: `level-${level}`,
  label: safetyMeta[level].label,
  hint: safetyMeta[level].blurb,
  group: 'Safety levels',
  to: `/directory?safety=${level}`,
  words: `safety level ${level} ${safetyMeta[level].label} ${safetyMeta[level].blurb}`,
  pinned: true,
}))

const toolEntries: Entry[] = tools.map((tool) => ({
  id: `tool-${tool.slug}`,
  label: tool.name,
  hint: `${categoryLabel(tool.category)} · ${safetyMeta[tool.safety].label}`,
  group: 'Tools',
  to: `/tool/${tool.slug}`,
  words: [tool.name, tool.short, tool.description, categoryLabel(tool.category), safetyMeta[tool.safety].label, tool.license, ...tool.tags].join(' '),
}))

const groupOrder: Record<Entry['group'], number> = { Pages: 0, 'Safety levels': 1, Tools: 2 }

function score(entry: Entry, needle: string): number {
  const label = entry.label.toLowerCase()
  if (!needle) return entry.pinned ? 1 : 0
  if (label === needle) return 100
  if (label.startsWith(needle)) return 80
  if (label.split(/\s+/).some((word) => word.startsWith(needle))) return 60
  if (label.includes(needle)) return 40
  if (entry.words.toLowerCase().includes(needle)) return 20
  return 0
}

export function QuickJump() {
  const { open, setOpen } = useJump()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!open)
      }
      if (event.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = ''
    }
  }, [open])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = [...pages, ...levels, ...toolEntries]
    const matched = all
      .map((entry) => ({ entry, value: score(entry, needle) }))
      .filter((hit) => hit.value > 0)
      .sort(
        (a, b) =>
          groupOrder[a.entry.group] - groupOrder[b.entry.group] ||
          b.value - a.value ||
          a.entry.label.localeCompare(b.entry.label),
      )
      .map((hit) => hit.entry)
    return needle ? matched.slice(0, 12) : matched.slice(0, 9)
  }, [query])

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, results.length - 1)))
  }, [results.length])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function choose(entry: Entry | undefined) {
    if (!entry) return
    setOpen(false)
    navigate(entry.to)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => (results.length ? (current + 1) % results.length : 0))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0))
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[active])
    }
  }

  let lastGroup = ''

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-fg/35 px-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Quick jump"
            initial={{ opacity: 0, y: -8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[560px] overflow-hidden rounded-dialog border border-line bg-bg shadow-drawer"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 shrink-0 text-faint" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
                placeholder="Jump to a tool, page or safety level…"
                aria-label="Jump to a tool, page or safety level"
                aria-controls="quick-jump-results"
                aria-activedescendant={results[active]?.id}
                className="h-14 w-full bg-transparent text-[15px] placeholder:text-faint focus:outline-none"
              />
              <kbd className="hidden shrink-0 rounded-[6px] border border-line-strong px-1.5 py-0.5 text-[11px] text-faint sm:block">esc</kbd>
            </div>

            <div id="quick-jump-results" ref={listRef} role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 && <p className="px-3 py-8 text-center text-[14px] text-muted">Nothing matches that. Try a tool name, a format or a tag.</p>}
              {results.map((entry, index) => {
                const heading = entry.group !== lastGroup ? entry.group : null
                lastGroup = entry.group
                return (
                  <div key={entry.id}>
                    {heading && <p className="px-3 pb-1 pt-3 text-[11px] uppercase tracking-[0.12em] text-faint first:pt-1">{heading}</p>}
                    <button
                      type="button"
                      id={entry.id}
                      data-index={index}
                      role="option"
                      aria-selected={index === active}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(entry)}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left transition-colors',
                        index === active ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium">{entry.label}</span>
                        <span className="block truncate text-[12.5px] text-muted">{entry.hint}</span>
                      </span>
                      {index === active && <CornerDownLeft className="size-3.5 shrink-0 text-faint" />}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[11.5px] text-faint">
              <span>↑↓ to move · ↵ to open</span>
              <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
