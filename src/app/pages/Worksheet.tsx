import { ArrowLeft, ArrowRight, Check, ClipboardCopy, Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { Button, Container, inputClass } from '../components/ui'
import { cx } from '../lib/cx'
import {
  emptyDraft,
  letterNames,
  outcomeLabels,
  useWorksheets,
  worksheetsMarkdown,
  type CosgLetter,
  type Worksheet,
  type WorksheetDraft,
  type WorksheetOutcome,
} from '../lib/worksheet'

const steps = [
  { key: 'define', label: 'Define', hint: 'What exactly is wrong?' },
  { key: 'act', label: 'Act', hint: 'One course of action' },
  { key: 'test', label: 'Test', hint: 'The proof it worked' },
  { key: 'decide', label: 'Decide', hint: 'Implement or cycle' },
]

const letterHints: Record<CosgLetter, { define: string; act: string; test: string }> = {
  C: {
    define: 'Name the failure, the input that causes it and the line it happens on.',
    act: 'The smallest change that handles that failure — one change, not a rewrite.',
    test: 'Reproduce the crash first, then run the change against the reproduction.',
  },
  O: {
    define: 'What kind of orphan is it — a string, a directory, an asset, a script, a dependency or a program?',
    act: 'Reference it again, retire it, or archive it outside the tree.',
    test: 'Build, run the tests and search for surviving references.',
  },
  S: {
    define: 'The parser’s message, the type of error and the file and line it points at.',
    act: 'The smallest edit that makes it parse again.',
    test: 'Parse or build again after the edit. Keep the output.',
  },
  G: {
    define: 'What is present or running that should not be? Record who, what, when, where and how.',
    act: 'Contain it, disable it, remove it, or document it as required.',
    test: 'Prove the host is clean and the ghost is gone.',
  },
}

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function Worksheet() {
  const { items, save, remove, clear } = useWorksheets()
  const [draft, setDraft] = useState<WorksheetDraft>(() => emptyDraft())
  const [step, setStep] = useState(0)
  const [message, setMessage] = useState('')
  const [messageError, setMessageError] = useState(false)

  const editing = Boolean(draft.id)
  const canSave = draft.title.trim().length > 0
  const hint = letterHints[draft.letter]

  function update(patch: Partial<WorksheetDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setMessage('')
    setMessageError(false)
  }

  function edit(item: Worksheet) {
    setDraft({ ...item })
    setStep(0)
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startOver() {
    setDraft(emptyDraft())
    setStep(0)
    setMessage('')
  }

  function commit() {
    if (!canSave) return
    save(draft)
    setMessage(editing ? 'Worksheet updated in this browser.' : 'Worksheet saved in this browser.')
    setMessageError(false)
    setDraft(emptyDraft())
    setStep(0)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(worksheetsMarkdown(items))
      setMessage('Worksheet Markdown copied.')
      setMessageError(false)
    } catch {
      setMessage('Could not copy to the clipboard.')
      setMessageError(true)
    }
  }

  return (
    <Container className="pt-10 sm:pt-14">
      <div className="max-w-3xl">
        <p className="text-[14px] text-muted">COS-G · worksheet</p>
        <h1 className="font-display mt-2 text-[44px] leading-[1] text-balance sm:text-[56px]">Walk one finding through the loop</h1>
        <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-muted">
          Define the problem, pick one course of action, test it, then decide. Notes stay in this browser and export as Markdown you can keep beside <code className="rounded-[5px] bg-surface-2 px-1 py-0.5 text-[13px]">cosg-report.md</code>.
        </p>
        <Link to="/cosg" className="mt-4 inline-flex h-9 items-center gap-1.5 text-[14px] text-muted transition-colors hover:text-fg">
          <ArrowLeft className="size-4" />
          Back to the bible
        </Link>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px] lg:gap-16">
        <div className="rounded-card border border-line bg-surface p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted">{editing ? `Editing: ${draft.title || 'untitled'}` : 'New worksheet'}</p>
            {(editing || draft.definition || draft.action || draft.test || draft.notes) && (
              <Button variant="ghost" size="sm" onClick={startOver}>
                <Plus />
                Start over
              </Button>
            )}
          </div>

          <ol className="mt-5 flex flex-wrap gap-2">
            {steps.map((item, index) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => setStep(index)}
                  aria-current={step === index ? 'step' : undefined}
                  className={cx(
                    'flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] transition-colors',
                    step === index ? 'bg-fg text-bg' : 'bg-surface-2 text-muted hover:text-fg',
                  )}
                >
                  <span className="tabular-nums opacity-70">{index + 1}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ol>

          <div className="mt-7">
            {step === 0 && (
              <div className="flex flex-col gap-5">
                <div>
                  <p className="mb-1.5 text-[13px] font-medium">Which pass is this?</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['C', 'O', 'S', 'G'] as const).map((letter) => (
                      <button
                        key={letter}
                        type="button"
                        onClick={() => update({ letter })}
                        aria-pressed={draft.letter === letter}
                        className={cx(
                          'rounded-[12px] border px-3 py-2.5 text-left transition-colors',
                          draft.letter === letter ? 'border-fg bg-fg text-bg' : 'border-line-strong hover:border-fg',
                        )}
                      >
                        <span className="font-display block text-[24px] leading-none">{letter}</span>
                        <span className={cx('mt-1 block text-[11.5px] leading-tight', draft.letter === letter ? 'text-bg/70' : 'text-muted')}>
                          {letterNames[letter].split(' ')[0]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Finding</span>
                  <input
                    value={draft.title}
                    maxLength={160}
                    onChange={(event) => update({ title: event.target.value })}
                    placeholder="e.g. Export drops the last row when the rack is empty"
                    className={inputClass}
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Definition and evidence</span>
                  <textarea
                    value={draft.definition}
                    rows={4}
                    onChange={(event) => update({ definition: event.target.value })}
                    placeholder={hint.define}
                    className="w-full resize-y rounded-control border border-line-strong bg-bg px-4 py-3 text-[14.5px] leading-relaxed placeholder:text-faint focus:border-fg focus:outline-none"
                  />
                </label>
                <p className="text-[12.5px] text-faint">{hint.define}</p>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-4">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Course of action</span>
                  <textarea
                    value={draft.action}
                    rows={5}
                    onChange={(event) => update({ action: event.target.value })}
                    placeholder={hint.act}
                    className="w-full resize-y rounded-control border border-line-strong bg-bg px-4 py-3 text-[14.5px] leading-relaxed placeholder:text-faint focus:border-fg focus:outline-none"
                  />
                </label>
                <p className="text-[12.5px] text-faint">One course of action. If it fails, it goes back through the cycle — it does not become two changes.</p>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Test and result</span>
                  <textarea
                    value={draft.test}
                    rows={5}
                    onChange={(event) => update({ test: event.target.value })}
                    placeholder={hint.test}
                    className="w-full resize-y rounded-control border border-line-strong bg-bg px-4 py-3 text-[14.5px] leading-relaxed placeholder:text-faint focus:border-fg focus:outline-none"
                  />
                </label>
                <p className="text-[12.5px] text-faint">Write down the command, the request or the reproduction you used, and what it showed.</p>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-5">
                <div>
                  <p className="mb-2 text-[13px] font-medium">Outcome</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(['implemented', 'retry'] as WorksheetOutcome[]).map((outcome) => (
                      <button
                        key={outcome}
                        type="button"
                        onClick={() => update({ outcome })}
                        aria-pressed={draft.outcome === outcome}
                        className={cx(
                          'flex items-start gap-3 rounded-[12px] border p-4 text-left transition-colors',
                          draft.outcome === outcome ? 'border-fg bg-surface-2' : 'border-line-strong hover:border-fg',
                        )}
                      >
                        <span className={cx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border', draft.outcome === outcome ? 'border-fg bg-fg text-bg' : 'border-line-strong')}>
                          {draft.outcome === outcome && <Check className="size-3" />}
                        </span>
                        <span>
                          <span className="block text-[14px] font-medium">{outcomeLabels[outcome]}</span>
                          <span className="mt-0.5 block text-[12.5px] text-muted">
                            {outcome === 'implemented' ? 'The test passed; keep the change.' : 'The test failed; take it back through the cycle.'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium">Notes for next time</span>
                  <textarea
                    value={draft.notes}
                    rows={3}
                    onChange={(event) => update({ notes: event.target.value })}
                    placeholder="What the next person should know: the command, the trap, the follow-up."
                    className="w-full resize-y rounded-control border border-line-strong bg-bg px-4 py-3 text-[14.5px] leading-relaxed placeholder:text-faint focus:border-fg focus:outline-none"
                  />
                </label>

                <div className="flex flex-col gap-2 border-t border-line pt-5 sm:flex-row sm:items-center">
                  <Button onClick={commit} disabled={!canSave}>
                    <Check />
                    {editing ? 'Update worksheet' : 'Save worksheet'}
                  </Button>
                  <span className="text-[12.5px] text-faint">Saved in this browser, next to your rack.</span>
                </div>
                {!canSave && <p className="text-[12.5px] text-accent">Give the finding a title on step 1 before saving.</p>}
              </div>
            )}
          </div>

          <div className="mt-7 flex items-center justify-between border-t border-line pt-5">
            <Button variant="ghost" size="sm" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
              <ArrowLeft />
              Back
            </Button>
            {step < steps.length - 1 ? (
              <Button variant="secondary" size="sm" onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))} disabled={step === 0 && !canSave}>
                Next: {steps[step + 1].label}
                <ArrowRight />
              </Button>
            ) : (
              <span className="text-[12.5px] text-faint">Step {step + 1} of {steps.length}</span>
            )}
          </div>
          {message && <p className={cx('mt-3 text-[13px]', messageError ? 'text-accent' : 'text-static')}>{message}</p>}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-card border border-line bg-surface p-5">
            <h2 className="text-[16px] font-medium">Your worksheets</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              {items.length === 0 ? 'Nothing saved yet.' : `${items.length} finding${items.length === 1 ? '' : 's'} on record.`} Exports as <code className="rounded-[5px] bg-surface-2 px-1 py-0.5 text-[12px]">cosg-worksheet.md</code>.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Button size="md" className="w-full" onClick={() => download('cosg-worksheet.md', worksheetsMarkdown(items))} disabled={items.length === 0}>
                <Download />
                Download worksheet
              </Button>
              <Button variant="secondary" size="md" className="w-full" onClick={copy} disabled={items.length === 0}>
                <ClipboardCopy />
                Copy Markdown
              </Button>
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Delete every saved worksheet? This clears notes in this browser only.')) clear()
                }}
                className="mt-3 w-full text-center text-[13px] text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
              >
                Clear all worksheets
              </button>
            )}
          </div>

          {items.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id} className="rounded-card border border-line bg-surface p-4">
                  <div className="flex items-start gap-3">
                    <span className="font-display text-[22px] leading-none text-accent">{item.letter}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{item.title}</p>
                      <p className="mt-0.5 text-[12px] text-faint">
                        {outcomeLabels[item.outcome]} · {shortDate(item.updatedAt)}
                      </p>
                    </div>
                    <button type="button" onClick={() => edit(item)} aria-label={`Edit ${item.title}`} className="grid size-8 place-items-center rounded-[9px] text-muted transition-colors hover:bg-surface-2 hover:text-fg">
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        remove(item.id)
                        if (draft.id === item.id) startOver()
                      }}
                      aria-label={`Delete ${item.title}`}
                      className="grid size-8 place-items-center rounded-[9px] text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {item.definition && <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{item.definition}</p>}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </Container>
  )
}
