import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, FolderOpen, Gauge, Minus, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { Button, Container } from '../components/ui'
import { runBenchTest, type BenchReport } from '../lib/bench'
import { cx } from '../lib/cx'
import { modelPresets, useHarness, type ModelProvider } from '../lib/harness'

function ModelBrowser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { models, active, addModel, removeModel, setActive } = useHarness()
  const [provider, setProvider] = useState<ModelProvider>('ollama')
  const [baseUrl, setBaseUrl] = useState(modelPresets[0].baseUrl)
  const [label, setLabel] = useState('')
  const [model, setModel] = useState('')
  const [discovered, setDiscovered] = useState<string[]>([])
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setProvider('ollama')
    setBaseUrl(modelPresets[0].baseUrl)
    setLabel('')
    setModel('')
    setDiscovered([])
    setMessage('')
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  async function scan(nextBase = baseUrl, nextProvider = provider) {
    const base = nextBase.trim()
    if (!base) {
      setMessage('Enter the endpoint first.')
      return
    }
    setScanning(true)
    setMessage('')
    setDiscovered([])
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 4000)
    try {
      let ids: string[] = []
      try {
        const response = await fetch(`${base.replace(/\/$/, '')}/models`, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const body = (await response.json()) as { data?: { id?: unknown }[] }
        ids = (body.data ?? []).map((entry) => entry?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
      } catch (first) {
        if (nextProvider !== 'ollama') throw first
        const origin = new URL(base).origin
        const response = await fetch(`${origin}/api/tags`, { signal: controller.signal })
        if (!response.ok) throw first
        const body = (await response.json()) as { models?: { name?: unknown }[] }
        ids = (body.models ?? []).map((entry) => entry?.name).filter((id): id is string => typeof id === 'string' && id.length > 0)
      }
      setDiscovered(ids)
      if (ids.length > 0) setModel(ids[0])
      else setMessage('The endpoint answered but listed no models. Add the model id manually.')
    } catch (caught) {
      setMessage(
        caught instanceof DOMException && caught.name === 'AbortError'
          ? 'The endpoint did not answer in time.'
          : 'Could not reach the endpoint from this page (offline, or the server does not allow this origin). Add the model id manually.',
      )
    } finally {
      window.clearTimeout(timer)
      setScanning(false)
    }
  }

  function choosePreset(next: ModelProvider) {
    const preset = modelPresets.find((entry) => entry.provider === next)!
    setProvider(next)
    setBaseUrl(preset.baseUrl)
    setModel('')
    setDiscovered([])
    setMessage('')
    if (preset.baseUrl) void scan(preset.baseUrl, next)
    else setMessage('Enter the base URL and model id for your endpoint.')
  }

  function add() {
    if (!baseUrl.trim() || !model.trim()) {
      setMessage('A base URL and a model id are required.')
      return
    }
    const preset = modelPresets.find((entry) => entry.provider === provider)
    const created = addModel({
      provider,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      label: label.trim() || `${preset?.label ?? 'Endpoint'} · ${model.trim()}`,
    })
    setActive(created.id)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-fg/35 px-4 py-10 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Browse models"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-[620px] rounded-dialog border border-line bg-bg p-6 shadow-drawer"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[13px] text-muted">Harness · model</p>
                <h2 className="font-display mt-1 text-[30px] leading-none">Browse models</h2>
              </div>
              <button type="button" aria-label="Close" onClick={onClose} className="grid size-10 place-items-center rounded-control text-muted hover:bg-surface-2 hover:text-fg">
                <X className="size-5" />
              </button>
            </div>

            <p className="mt-4 text-[13.5px] leading-relaxed text-muted">
              Red Queen talks to OpenAI-compatible endpoints directly from this page. Nothing is proxied and no key leaves this browser.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              {modelPresets.map((preset) => (
                <button
                  key={preset.provider}
                  type="button"
                  onClick={() => choosePreset(preset.provider)}
                  aria-pressed={provider === preset.provider}
                  className={cx(
                    'rounded-[12px] border p-3 text-left transition-colors',
                    provider === preset.provider ? 'border-fg bg-surface-2' : 'border-line-strong hover:border-fg',
                  )}
                >
                  <span className="block text-[14px] font-medium">{preset.label}</span>
                  <span className="mt-0.5 block text-[11.5px] text-faint">{preset.note}</span>
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-col gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[12.5px] font-medium">Base URL</span>
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="http://localhost:11434/v1"
                  spellCheck={false}
                  className="h-11 w-full rounded-[12px] border border-line-strong bg-surface px-3 font-mono text-[13px] focus:border-fg focus:outline-none"
                />
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="block flex-1">
                  <span className="mb-1.5 block text-[12.5px] font-medium">Model id</span>
                  <input
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="llama3.1:8b"
                    spellCheck={false}
                    list="harness-models"
                    className="h-11 w-full rounded-[12px] border border-line-strong bg-surface px-3 font-mono text-[13px] focus:border-fg focus:outline-none"
                  />
                </label>
                <label className="block flex-1">
                  <span className="mb-1.5 block text-[12.5px] font-medium">Label (optional)</span>
                  <input
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Coder on the lab box"
                    className="h-11 w-full rounded-[12px] border border-line-strong bg-surface px-3 text-[13.5px] focus:border-fg focus:outline-none"
                  />
                </label>
              </div>
              <datalist id="harness-models">
                {discovered.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => void scan()} loading={scanning}>
                <RefreshCw />
                Check this endpoint
              </Button>
              <Button size="sm" onClick={add} disabled={!baseUrl.trim() || !model.trim()}>
                <Plus />
                Add model
              </Button>
            </div>

            {message && <p className="mt-3 text-[12.5px] leading-relaxed text-accent">{message}</p>}

            {models.length > 0 && (
              <div className="mt-6 border-t border-line pt-4">
                <p className="text-[12px] uppercase tracking-[0.12em] text-faint">Configured</p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {models.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setActive(entry.id)}
                        aria-pressed={active?.id === entry.id}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <span className={cx('grid size-4 shrink-0 place-items-center rounded-full border', active?.id === entry.id ? 'border-fg bg-fg text-bg' : 'border-line-strong')}>
                          {active?.id === entry.id && <Check className="size-2.5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-medium">{entry.label}</span>
                          <span className="block truncate font-mono text-[11.5px] text-faint">{entry.model}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeModel(entry.id)}
                        aria-label={`Remove ${entry.label}`}
                        className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-fg"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// One button, seven checks, the same answer `npm run smoke` gives from outside:
// does this copy actually work where it is running? Results stay on screen so
// they can be read out in a bug report.
function BenchTest({ model }: { model: { label: string; baseUrl: string } | null }) {
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<BenchReport | null>(null)

  async function run() {
    setRunning(true)
    try {
      setReport(await runBenchTest({ model }))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="mt-12 rounded-card border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-lg">
          <p className="text-[11px] uppercase tracking-[0.12em] text-faint">Bench test</p>
          <h2 className="font-display mt-1 text-[28px] leading-none">Check this copy</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            Storage, saved data, the catalogue, covers, the export endpoint and your model endpoint — checked here, in this browser. Nothing is written and no project file is touched.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void run()} loading={running}>
          <Gauge />
          {report ? 'Run again' : 'Run bench test'}
        </Button>
      </div>

      {report && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-[13.5px] font-medium">
              {report.passed} of {report.checks.length} passed{report.skipped > 0 ? `, ${report.skipped} skipped` : ''} · {report.ms} ms
            </p>
            <button type="button" onClick={() => setReport(null)} className="text-[12.5px] text-muted transition-colors hover:text-fg">
              Clear
            </button>
          </div>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {report.checks.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2.5 rounded-[10px] border border-line px-3 py-2">
                <span
                  className={cx(
                    'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full',
                    entry.outcome === 'pass' ? 'bg-static-soft text-static' : entry.outcome === 'fail' ? 'bg-live-soft text-live' : 'bg-surface-2 text-faint',
                  )}
                >
                  {entry.outcome === 'pass' ? <Check className="size-2.5" /> : entry.outcome === 'fail' ? <X className="size-2.5" /> : <Minus className="size-2.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{entry.label}</span>
                  <span className="block text-[12px] leading-relaxed text-muted">{entry.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          {report.failed > 0 && (
            <p className="mt-3 text-[12.5px] leading-relaxed text-accent">
              {report.failed} check{report.failed === 1 ? '' : 's'} failed. Nothing was changed — reload and run it again, or reinstall this copy before reporting the result.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export function Harness() {
  const harness = useHarness()
  const navigate = useNavigate()
  const [browserOpen, setBrowserOpen] = useState(false)
  const [picking, setPicking] = useState(false)

  async function pickDirectory() {
    setPicking(true)
    await harness.chooseDirectory()
    setPicking(false)
  }

  return (
    <Container className="pt-10 sm:pt-16">
      <div className="max-w-2xl">
        <p className="text-[14px] text-muted">Red Queen · programming harness</p>
        <h1 className="font-display mt-3 text-[52px] leading-[0.98] text-balance sm:text-[72px]">Point the harness at a model and a directory</h1>
        <p className="mt-5 max-w-lg text-[16.5px] leading-relaxed text-muted">
          One model, one folder. Nothing runs until both are chosen. The rest of Red Queen stays where it is.
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <section className="flex flex-col rounded-card border border-line bg-surface p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-faint">01 · Model</p>
              <h2 className="font-display mt-1 text-[30px] leading-none">Models</h2>
            </div>
            <span className="rounded-[8px] bg-surface-2 px-2 py-1 text-[11.5px] text-muted">
              {harness.models.length} configured
            </span>
          </div>

          {harness.active ? (
            <div className="mt-5">
              <p className="text-[15px] font-medium">{harness.active.label}</p>
              <p className="mt-0.5 font-mono text-[12px] text-muted">{harness.active.model}</p>
              <p className="mt-0.5 truncate font-mono text-[11.5px] text-faint">{harness.active.baseUrl}</p>
              {harness.models.length > 1 && (
                <label className="mt-4 block">
                  <span className="sr-only">Active model</span>
                  <select
                    value={harness.active.id}
                    onChange={(event) => harness.setActive(event.target.value)}
                    className="h-10 w-full appearance-none rounded-[10px] border border-line-strong bg-transparent px-3 text-[13px] focus:border-fg focus:outline-none"
                  >
                    {harness.models.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ) : (
            <p className="mt-5 flex-1 text-[14px] leading-relaxed text-muted">No model yet. Browse a local server or add any OpenAI-compatible endpoint.</p>
          )}

          <Button variant="secondary" className="mt-6 self-start" onClick={() => setBrowserOpen(true)}>
            <Plus />
            {harness.models.length > 0 ? 'Browse models' : 'Add a model'}
          </Button>
          {window.location.protocol === 'https:' && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
              This copy is served over HTTPS, so the browser blocks plain-http model servers. Use an HTTPS endpoint here, or run Red Queen locally for Ollama on your own machine.
            </p>
          )}
        </section>

        <section className="flex flex-col rounded-card border border-line bg-surface p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.12em] text-faint">02 · Directory</p>
              <h2 className="font-display mt-1 text-[30px] leading-none">Project</h2>
            </div>
            {harness.directory && <span className="rounded-[8px] bg-static-soft px-2 py-1 text-[11.5px] text-static">Ready</span>}
          </div>

          {harness.directory ? (
            <div className="mt-5 flex flex-1 flex-col">
              <p className="font-mono text-[14px]">{harness.directory.name}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">The folder where the finished project will be seated.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => void pickDirectory()} loading={picking}>
                  <FolderOpen />
                  Change folder
                </Button>
                <Button variant="ghost" size="sm" onClick={harness.forgetDirectory}>
                  Forget
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex flex-1 flex-col">
              <p className="text-[14px] leading-relaxed text-muted">No directory yet. Choose the empty folder the harness should work in.</p>
              <Button variant="secondary" className="mt-4 self-start" onClick={() => void pickDirectory()} loading={picking}>
                <FolderOpen />
                Browse directory
              </Button>
            </div>
          )}
        </section>
      </div>

      <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Button size="lg" disabled={!harness.ready} onClick={() => navigate('/workbench')}>
          Enter the workbench
          <ArrowRight />
        </Button>
        <p className="text-[13px] text-faint">
          {harness.ready ? 'Model and directory set. The workbench is open.' : 'Add a model and choose a directory to continue.'}
        </p>
      </div>

      <BenchTest model={harness.active ? { label: harness.active.label, baseUrl: harness.active.baseUrl } : null} />

      {harness.error && (
        <div className="mt-4 flex items-start justify-between gap-4 rounded-[12px] border border-line bg-surface px-4 py-3 text-[13px] text-accent">
          <p>{harness.error}</p>
          <button type="button" aria-label="Dismiss" onClick={harness.clearError} className="text-muted hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6 text-[13px]">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-muted">
          <Link to="/directory" className="transition-colors hover:text-fg">
            Browse the tool directory
          </Link>
          <Link to="/cosg" className="transition-colors hover:text-fg">
            COS-G bible
          </Link>
          <Link to="/safety" className="transition-colors hover:text-fg">
            Safety rules
          </Link>
        </div>
        {(harness.models.length > 0 || harness.directory) && (
          <button type="button" onClick={harness.resetHarness} className="text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
            Reset harness
          </button>
        )}
      </div>

      <ModelBrowser open={browserOpen} onClose={() => setBrowserOpen(false)} />
    </Container>
  )
}
