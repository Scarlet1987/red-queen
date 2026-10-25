import { Bookmark, Check, ClipboardCopy, Download, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { categoryLabel } from '../../data/tools'
import { Button, ButtonLink, Container, SafetyChip } from '../components/ui'
import { useRack } from '../lib/rack'
import { useRefine } from '../lib/refine'

type ExportState = 'idle' | 'copying' | 'copied' | 'downloading' | 'error'

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function Rack() {
  const rack = useRack()
  const refine = useRefine()
  const [state, setState] = useState<ExportState>('idle')
  const [message, setMessage] = useState('')

  async function markdown(): Promise<string> {
    const refinements = Object.fromEntries(rack.slugs.map((slug) => [slug, refine.overrides[slug]]).filter(([, value]) => value))
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slugs: rack.slugs, refinements }),
    })
    if (!response.ok) throw new Error('The export endpoint refused that request.')
    return response.text()
  }

  async function copy() {
    setState('copying')
    setMessage('')
    try {
      const text = await markdown()
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'Could not copy to the clipboard.')
    }
  }

  async function saveMarkdown() {
    setState('downloading')
    setMessage('')
    try {
      download('red-queen-rack.md', await markdown(), 'text/markdown')
      setState('idle')
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : 'Could not build the Markdown file.')
    }
  }

  function saveJson() {
    const payload = {
      program: 'Red Queen',
      label: 'red-queen',
      exportedAt: new Date().toISOString(),
      tools: rack.items.map((tool) => ({
        name: tool.name,
        category: tool.category,
        safety: refine.safetyOf(tool),
        cataloguedSafety: tool.safety,
        note: refine.noteOf(tool.slug) || null,
        licence: tool.license,
        platforms: tool.platforms,
        url: tool.url,
        repo: tool.repo ?? null,
      })),
    }
    download('red-queen-rack.json', JSON.stringify(payload, null, 2), 'application/json')
  }

  return (
    <Container className="pt-10 sm:pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[14px] text-muted">Rack</p>
          <h1 className="font-display mt-2 text-[44px] sm:text-[56px]">
            Your shortlist <span className="text-[24px] text-faint">{rack.items.length}</span>
          </h1>
          <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">
            Saved in this browser. Export it as Markdown for a README, or as JSON for whatever comes next.
          </p>
        </div>
        {rack.items.length > 0 && (
          <Button variant="ghost" size="sm" onClick={rack.clear}>
            <Trash2 />
            Clear rack
          </Button>
        )}
      </div>

      {rack.items.length === 0 ? (
        <div className="mt-16 flex flex-col items-center rounded-card border border-line bg-surface px-6 py-20 text-center">
          <span className="grid size-12 place-items-center rounded-[14px] bg-surface-2">
            <Bookmark className="size-5 text-muted" />
          </span>
          <p className="font-display mt-5 text-[32px]">Nothing racked yet</p>
          <p className="mt-2 max-w-sm text-[14.5px] leading-relaxed text-muted">Tap the bookmark on any tool to keep it here while you build a workflow.</p>
          <ButtonLink to="/directory" className="mt-7">
            Browse the directory
          </ButtonLink>
        </div>
      ) : (
        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px] lg:gap-16">
          <ul className="divide-y divide-line border-y border-line">
            {rack.items.map((tool) => (
              <li key={tool.slug} className="flex items-start gap-4 py-5">
                <Link to={`/tool/${tool.slug}`} aria-label={`Open ${tool.name}`} className="cover-frame block aspect-[3/4] w-16 shrink-0 rounded-[14px]">
                  <img src={`/images/tools/${tool.slug}.svg`} alt="" className="size-full object-cover" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <Link to={`/tool/${tool.slug}`} className="text-[16px] font-medium hover:text-accent">
                      {tool.name}
                    </Link>
                    <button
                      type="button"
                      onClick={() => rack.remove(tool.slug)}
                      aria-label={`Remove ${tool.name}`}
                      className="grid size-8 place-items-center rounded-[10px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <p className="mt-0.5 text-[13.5px] text-muted">{tool.short}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <SafetyChip safety={refine.safetyOf(tool)} />
                    <span className="text-[12.5px] text-faint">
                      {categoryLabel(tool.category)} · {tool.cost}
                    </span>
                  </div>
                  {refine.noteOf(tool.slug) && (
                    <p className="mt-2 rounded-[10px] bg-surface-2 px-3 py-1.5 text-[12.5px] leading-relaxed text-muted">{refine.noteOf(tool.slug)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-card border border-line bg-surface p-6">
              <h2 className="text-[16px] font-medium">Export</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">One row per tool, grouped by what it does to your file.</p>
              <div className="mt-5 flex flex-col gap-2">
                <Button size="md" className="w-full" onClick={copy} loading={state === 'copying'}>
                  {state === 'copied' ? <Check /> : <ClipboardCopy />}
                  {state === 'copied' ? 'Copied to clipboard' : 'Copy Markdown'}
                </Button>
                <Button variant="secondary" size="md" className="w-full" onClick={saveMarkdown} loading={state === 'downloading'}>
                  <Download />
                  Download .md
                </Button>
              </div>
              <button type="button" onClick={saveJson} className="mt-3 w-full text-center text-[13px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
                Download JSON instead
              </button>
              {state === 'error' && <p className="mt-3 text-[13px] text-accent">{message}</p>}
              <p className="mt-5 border-t border-line pt-4 text-[12.5px] leading-relaxed text-faint">
                Red Queen stores your rack in localStorage only. Nothing is sent anywhere except the slugs you export.
              </p>
            </div>
          </aside>
        </div>
      )}
    </Container>
  )
}
