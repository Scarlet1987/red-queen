import { Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import { categories, categoryLabel, safetyMeta, tools, type Category, type Safety } from '../../data/tools'
import { ToolCard } from '../components/ToolCard'
import { Button, Container, inputClass } from '../components/ui'
import { cx } from '../lib/cx'
import { useRefine } from '../lib/refine'

const safetyOptions: { key: Safety; label: string }[] = [
  { key: 'static', label: safetyMeta.static.label },
  { key: 'sandbox', label: safetyMeta.sandbox.label },
  { key: 'live', label: safetyMeta.live.label },
]
const sortOptions = [
  { key: 'featured', label: 'Featured' },
  { key: 'new', label: 'Newest' },
  { key: 'az', label: 'Name, A to Z' },
  { key: 'safest', label: 'Safest first' },
]
const costOptions: { key: string; label: string }[] = [
  { key: 'open', label: 'Open source' },
  { key: 'free', label: 'Free to use' },
  { key: 'paid', label: 'Paid' },
]

const safetyRank: Record<Safety, number> = { static: 0, sandbox: 1, live: 2 }
// Twelve cards is enough to judge a filter without scrolling a wall of covers.
const PAGE = 12

export function Directory() {
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const refine = useRefine()

  const q = params.get('q') ?? ''
  const category = (params.get('category') ?? '') as Category | ''
  const safety = (params.get('safety') ?? '') as Safety | ''
  const cost = params.get('cost') ?? ''
  const sort = params.get('sort') ?? 'featured'

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) v ? merged.set(k, v) : merged.delete(k)
    setParams(merged, { replace: true })
  }

  useEffect(() => {
    setLimit(PAGE)
  }, [q, category, safety, cost, sort])

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let items = tools.filter((t) => !category || t.category === category)
    if (safety) items = items.filter((t) => refine.safetyOf(t) === safety)
    if (cost === 'open') items = items.filter((t) => t.cost === 'Free · open source')
    if (cost === 'free') items = items.filter((t) => t.cost === 'Free' || t.cost === 'Free tier')
    if (cost === 'paid') items = items.filter((t) => t.cost === 'Paid')
    if (needle) {
      items = items.filter((t) =>
        [t.name, t.short, t.description, categoryLabel(t.category), t.license, refine.noteOf(t.slug), ...t.tags]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    }
    if (sort === 'az') items = [...items].sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'new') items = [...items].sort((a, b) => b.added.localeCompare(a.added))
    if (sort === 'safest') items = [...items].sort((a, b) => safetyRank[refine.safetyOf(a)] - safetyRank[refine.safetyOf(b)] || a.name.localeCompare(b.name))
    if (sort === 'featured') items = [...items].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)))
    return items
  }, [q, category, safety, cost, sort, refine])

  const title = category ? categoryLabel(category) : safety ? safetyMeta[safety].label : 'All tools'
  const active = [
    ...(category ? [{ label: categoryLabel(category), clear: () => update({ category: '' }) }] : []),
    ...(safety ? [{ label: safetyMeta[safety].label, clear: () => update({ safety: '' }) }] : []),
    ...(cost ? [{ label: costOptions.find((c) => c.key === cost)?.label ?? cost, clear: () => update({ cost: '' }) }] : []),
    ...(q ? [{ label: `“${q}”`, clear: () => update({ q: '' }) }] : []),
  ]
  const filterCount = active.length
  const visible = list.slice(0, limit)

  return (
    <Container className="pt-10 sm:pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[14px] text-muted">Directory</p>
          <h1 className="font-display mt-2 text-[44px] sm:text-[56px]">
            {title} <span className="text-[24px] text-faint">{list.length}</span>
          </h1>
        </div>
        <label className="relative">
          <span className="sr-only">Sort</span>
          <select value={sort} onChange={(e) => update({ sort: e.target.value })} className="h-10 appearance-none rounded-[12px] border border-line-strong bg-transparent pl-4 pr-9 text-[14px] focus:border-fg focus:outline-none">
            {sortOptions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </label>
      </div>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <label className="relative block flex-1">
          <span className="sr-only">Search the directory</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Search by tool, format, licence or tag…"
            className={cx(inputClass, 'pl-11')}
          />
        </label>
        <Button variant="secondary" size="md" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="directory-filters">
          <SlidersHorizontal />
          Filters{filterCount > 0 && ` (${filterCount})`}
        </Button>
      </div>

      {active.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {active.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.clear}
              className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-surface-2 px-2.5 text-[12.5px] text-fg transition-colors hover:bg-line"
            >
              {chip.label}
              <X className="size-3.5 text-muted" />
            </button>
          ))}
          <button type="button" onClick={() => setParams(new URLSearchParams(), { replace: true })} className="text-[12.5px] text-muted underline underline-offset-4 hover:text-fg">
            Clear all
          </button>
          {refine.refinedCount > 0 && (
            <span className="text-[12.5px] text-faint">
              · {refine.refinedCount} refined <button type="button" onClick={refine.resetAll} className="underline underline-offset-4 hover:text-fg">reset</button>
            </span>
          )}
        </div>
      )}

      {filtersOpen && (
        <div id="directory-filters" className="mt-4 grid gap-8 rounded-card border border-line bg-surface p-5 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
          <FilterGroup label="Category">
            {[{ key: '', label: 'Everything' }, ...categories].map((c) => (
              <FilterOption key={c.key || 'all'} active={category === c.key} onClick={() => update({ category: c.key })}>
                {c.label}
                <span className="ml-auto text-[12.5px] tabular-nums text-faint">{c.key ? tools.filter((t) => t.category === c.key).length : tools.length}</span>
              </FilterOption>
            ))}
          </FilterGroup>
          <FilterGroup label="What it does to your file">
            {[{ key: '', label: 'Any level' }, ...safetyOptions].map((s) => (
              <FilterOption key={s.key || 'any'} active={safety === s.key} onClick={() => update({ safety: s.key })}>
                {s.label}
                <span className="ml-auto text-[12.5px] tabular-nums text-faint">{s.key ? tools.filter((t) => refine.safetyOf(t) === s.key).length : tools.length}</span>
              </FilterOption>
            ))}
          </FilterGroup>
          <FilterGroup label="Cost">
            {[{ key: '', label: 'Any' }, ...costOptions].map((c) => (
              <FilterOption key={c.key || 'any'} active={cost === c.key} onClick={() => update({ cost: c.key })}>
                {c.label}
              </FilterOption>
            ))}
          </FilterGroup>
          <div className="flex items-start sm:col-span-2 lg:col-span-1 lg:justify-end">
            <Button variant="ghost" size="sm" onClick={() => setFiltersOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 xl:grid-cols-3 xl:gap-x-6">
        {visible.map((tool, i) => (
          <ToolCard key={tool.slug} tool={tool} index={i} />
        ))}
      </div>

      {list.length === 0 && (
        <div className="py-20 text-center">
          <p className="font-display text-[32px]">Nothing matches that yet</p>
          <p className="mt-2 text-[14px] text-muted">Try a broader search, or clear the filters.</p>
          <Button variant="secondary" className="mt-6" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear filters
          </Button>
        </div>
      )}

      {list.length > visible.length && (
        <div className="mt-12 flex flex-col items-center gap-3">
          <p className="text-[13px] text-faint">
            Showing {visible.length} of {list.length}
          </p>
          <Button variant="secondary" size="md" onClick={() => setLimit((current) => current + PAGE)}>
            Show {Math.min(PAGE, list.length - visible.length)} more
          </Button>
        </div>
      )}
    </Container>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-medium">{label}</p>
      <ul className="mt-3 flex flex-col gap-0.5">{children}</ul>
    </div>
  )
}

function FilterOption({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cx('flex h-9 w-full items-center gap-2 rounded-[11px] px-2.5 text-left text-[14px] transition-colors', active ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')}
      >
        {children}
      </button>
    </li>
  )
}
