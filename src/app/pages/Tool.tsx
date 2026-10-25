import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Bookmark, BookmarkCheck, ChevronDown, ExternalLink, Minus, Plus, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { bySlug, categoryLabel, safetyMeta, tools } from '../../data/tools'
import { ToolCard } from '../components/ToolCard'
import { Button, buttonClass, Container, SafetyChip } from '../components/ui'
import { cx } from '../lib/cx'
import { useRack } from '../lib/rack'
import { useRefine } from '../lib/refine'

export function ToolPage() {
  const { slug } = useParams()
  const tool = slug ? bySlug(slug) : undefined
  const rack = useRack()
  const refine = useRefine()
  const [open, setOpen] = useState<number | null>(null)
  const [refineOpen, setRefineOpen] = useState(false)

  if (!tool) return <Navigate to="/directory" replace />

  const saved = rack.has(tool.slug)
  const effectiveSafety = refine.safetyOf(tool)
  const safety = safetyMeta[effectiveSafety]
  const refinement = refine.overrides[tool.slug]
  const note = refinement?.note ?? ''
  const related = [
    ...tools.filter((t) => t.slug !== tool.slug && t.category === tool.category),
    ...tools.filter((t) => t.slug !== tool.slug && t.category !== tool.category && t.featured),
  ].slice(0, 4)

  const sections = [
    {
      title: 'At a glance',
      body: tool.facts,
    },
    {
      title: 'Safety and scope',
      body: [safety.blurb, tool.safetyNote, 'If you are unsure, work on a copy of the file, offline, in a machine you can throw away.'],
    },
    {
      title: 'Licence and platforms',
      body: [`${tool.license} · ${tool.cost}`, `Runs on ${tool.platforms.join(', ')}.`, 'Licence terms can change — check the project page before you rely on them.'],
    },
    {
      title: 'Where to get it',
      body: [tool.url, ...(tool.repo && tool.repo !== tool.url ? [tool.repo] : [])],
    },
  ]

  return (
    <Container className="pt-6 sm:pt-10">
      <Link to="/directory" className="inline-flex h-9 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-fg">
        <ArrowLeft className="size-4" />
        Directory
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
        <div>
          <div className="cover-frame relative aspect-[3/4] rounded-image">
            <img src={`/images/tools/${tool.slug}.svg`} alt={`${tool.name} cover`} className="size-full object-cover" />
            <SafetyChip safety={effectiveSafety} className="absolute left-4 top-4" />
          </div>

          <div className="mt-4 rounded-card border border-line bg-surface p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-surface-2">
                <ShieldAlert className="size-4" />
              </span>
              <div>
                <p className="text-[14px] font-medium">{safety.label}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{safety.blurb}</p>
              </div>
            </div>
            <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-muted">{tool.safetyNote}</p>
            {refinement?.safety && (
              <p className="mt-2 text-[12.5px] text-accent">Refined: you label this {safetyMeta[refinement.safety].label.toLowerCase()} ({safetyMeta[tool.safety].label.toLowerCase()} as catalogued).</p>
            )}
            {note && <p className="mt-3 rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-muted">“{note}”</p>}
          </div>
        </div>

        <div className="lg:pt-4">
          <p className="text-[14px] text-muted">
            <Link to={`/directory?category=${tool.category}`} className="capitalize transition-colors hover:text-fg">
              {categoryLabel(tool.category)}
            </Link>
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-display text-[44px] leading-[1] sm:text-[56px]">{tool.name}</h1>
            {refine.isRefined(tool.slug) && <span className="rounded-[8px] bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">Refined</span>}
          </div>
          <p className="mt-4 text-[15px] text-muted">
            {tool.cost} · {tool.license}
          </p>
          <p className="mt-6 text-pretty text-[16px] leading-relaxed text-muted">{tool.description}</p>

          <ul className="mt-6 flex flex-wrap gap-2">
            {tool.tags.map((tag) => (
              <li key={tag}>
                <Link to={`/directory?q=${encodeURIComponent(tag)}`} className="inline-flex h-7 items-center rounded-[9px] bg-surface-2 px-2.5 text-[12.5px] text-muted transition-colors hover:text-fg">
                  {tag}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a href={tool.url} target="_blank" rel="noreferrer noopener" className={buttonClass({ size: 'md', className: 'w-full sm:w-auto' })}>
              Official page
              <ExternalLink />
            </a>
            <Button variant="secondary" size="md" className="w-full sm:w-auto" onClick={() => rack.toggle(tool.slug)} aria-pressed={saved}>
              {saved ? <BookmarkCheck /> : <Bookmark />}
              {saved ? 'In your rack' : 'Save to rack'}
            </Button>
          </div>
          <p className="mt-3 text-[13px] text-faint">
            {tool.platforms.join(' · ')} · Added {new Date(tool.added).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>

          <ul className="mt-10 divide-y divide-line border-y border-line">
            {sections.map((section, i) => {
              const isOpen = open === i
              return (
                <li key={section.title}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i)} className="flex h-14 w-full items-center justify-between text-left text-[15px] font-medium">
                    {section.title}
                    {isOpen ? <Minus className="size-4 text-muted" /> : <Plus className="size-4 text-muted" />}
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <ul className="flex flex-col gap-1.5 pb-5 text-[14.5px] leading-relaxed text-muted">
                          {section.body.map((line) => (
                            <li key={line} className="break-words">
                              {line}
                            </li>
                          ))}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              )
            })}
          </ul>

        </div>
      </div>

      <section className="mt-16 rounded-[32px] border border-line bg-surface p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-lg">
            <p className="text-[14px] text-muted">Refine</p>
            <h2 className="font-display mt-2 text-[28px] leading-[1.05] sm:text-[32px]">Make this entry match how you work</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-muted">Change its safety label or keep a note. Everything stays in this browser.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setRefineOpen((value) => !value)} aria-expanded={refineOpen} aria-controls="refine-panel">
            {refineOpen ? 'Hide refine' : refine.isRefined(tool.slug) ? 'Edit refinement' : 'Open refine'}
            <ChevronDown className={cx('transition-transform', refineOpen && 'rotate-180')} />
          </Button>
        </div>
        {refineOpen && (
          <div id="refine-panel" className="mt-6 grid gap-5 border-t border-line pt-6 lg:grid-cols-[1fr_1.2fr] lg:gap-12">
            <div className="flex flex-col items-start gap-3">
              <p className="max-w-sm text-[14px] leading-relaxed text-muted">
                Refinements stay in this browser and travel with your exports. The catalogue itself is untouched.
              </p>
              {refine.isRefined(tool.slug) && (
                <Button variant="secondary" size="sm" onClick={() => refine.reset(tool.slug)}>
                  Reset to catalogue
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-5">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Safety label</span>
              <span className="relative block">
                <select
                  value={refinement?.safety ?? ''}
                  onChange={(e) => {
                    const next = e.target.value as typeof effectiveSafety | ''
                    refine.set(tool.slug, { safety: next && next !== tool.safety ? next : undefined })
                  }}
                  className="h-11 w-full appearance-none rounded-[12px] border border-line-strong bg-bg pl-4 pr-9 text-[14.5px] focus:border-fg focus:outline-none"
                >
                  <option value="">As catalogued — {safetyMeta[tool.safety].label}</option>
                  {(['static', 'sandbox', 'live'] as const).map((level) => (
                    <option key={level} value={level}>
                      {safetyMeta[level].label}
                    </option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium">
                How you use it
                <span className="text-[12px] font-normal tabular-nums text-faint">{note.length}/280</span>
              </span>
              <textarea
                value={note}
                maxLength={280}
                rows={3}
                onChange={(e) => refine.set(tool.slug, { note: e.target.value })}
                placeholder="e.g. Only for APKs from my own test devices — decompile in a throwaway VM."
                className="w-full resize-y rounded-control border border-line-strong bg-bg px-4 py-3 text-[14.5px] leading-relaxed placeholder:text-faint focus:border-fg focus:outline-none"
              />
            </label>
              <p className="text-[12.5px] leading-relaxed text-faint">Catalogue label: {safetyMeta[tool.safety].label}. Nothing here is sent to the catalogue or other readers.</p>
            </div>
          </div>
        )}
      </section>

      <section className="pt-24 sm:pt-32">
        <h2 className="font-display text-[36px] sm:text-[44px]">Pair it with</h2>
        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4 lg:gap-x-6">
          {related.map((item, i) => (
            <ToolCard key={item.slug} tool={item} index={i} />
          ))}
        </div>
      </section>
    </Container>
  )
}
