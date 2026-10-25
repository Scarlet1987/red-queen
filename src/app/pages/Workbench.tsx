import { ArrowLeft, ExternalLink, KeyRound, Maximize2, Minimize2, Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { Button, Container } from '../components/ui'
import { cx } from '../lib/cx'
import { useHarness } from '../lib/harness'

interface Message {
  role: 'user' | 'assistant'
  content: string
  at: string
}

const CONVERSATION_KEY = 'red-queen-conversation'
const PREVIEW_KEY = 'red-queen-preview-url'
const KEY_KEY = 'red-queen-endpoint-key'

function cleanMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Message => Boolean(item && typeof item === 'object' && typeof (item as Message).content === 'string' && ((item as Message).role === 'user' || (item as Message).role === 'assistant')))
    .slice(-40)
}

function chatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

export function Workbench() {
  const harness = useHarness()
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      return cleanMessages(JSON.parse(localStorage.getItem(CONVERSATION_KEY) ?? '[]'))
    } catch {
      return []
    }
  })
  const [previewUrl, setPreviewUrl] = useState(() => localStorage.getItem(PREVIEW_KEY) ?? '')
  const [previewSrc, setPreviewSrc] = useState(() => localStorage.getItem(PREVIEW_KEY) ?? '')
  const [detached, setDetached] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem(KEY_KEY) ?? '')
  const previewWindow = useRef<Window | null>(null)
  const transcript = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(CONVERSATION_KEY, JSON.stringify(messages.slice(-40)))
    } catch {
      // Storage blocked: conversation survives in memory for this tab.
    }
  }, [messages])

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  if (!harness.ready || !harness.active || !harness.directory) return <Navigate to="/" replace />

  const model = harness.active
  const directory = harness.directory

  function openPreview(event: React.FormEvent) {
    event.preventDefault()
    const url = previewUrl.trim()
    if (!url) return
    setPreviewSrc(url)
    try {
      localStorage.setItem(PREVIEW_KEY, url)
    } catch {
      // Ignore storage failures; the preview still loads.
    }
  }

  function detach() {
    if (!previewSrc) return
    const popup = window.open(previewSrc, 'red-queen-preview', 'popup=yes,width=1200,height=900')
    if (!popup) {
      setError('The browser blocked the preview window. Allow popups for this page.')
      return
    }
    previewWindow.current = popup
    setDetached(true)
  }

  function reattach() {
    previewWindow.current?.close()
    previewWindow.current = null
    setDetached(false)
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    const history: Message[] = [...messages, { role: 'user', content: text, at: new Date().toISOString() }]
    setMessages(history)
    setInput('')
    setSending(true)
    setError('')
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch(chatUrl(model.baseUrl), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model.model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: [
                'You are Red Queen, a programming harness.',
                `The developer's project directory is "${directory.name}".`,
                'Use the COS-G doctrine when troubleshooting: C crash risks, O orphaned strings, directories and programs, S syntax errors, G ghosts (anything parasitic to the host).',
                'You cannot read or edit files yet. Ask for the relevant snippet or error output, then give one concrete next action, how to test it, and what to do if it fails.',
                'Keep answers short and calm. Do not claim to have run or changed anything.',
              ].join(' '),
            },
            ...history.map((message) => ({ role: message.role, content: message.content })),
          ],
        }),
      })
      if (!response.ok) throw new Error(`The model endpoint returned ${response.status}.`)
      const body = (await response.json()) as { choices?: { message?: { content?: unknown } }[] }
      const content = body.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('The endpoint returned no message.')
      setMessages([...history, { role: 'assistant', content, at: new Date().toISOString() }])
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The request failed.'
      setError(
        caught instanceof DOMException && caught.name === 'AbortError'
          ? 'The endpoint did not answer within two minutes. Check that the model is loaded, then send again.'
          : caught instanceof TypeError
            ? `Could not reach ${model.baseUrl} from the browser. The server may be offline or not allow this origin (CORS).`
            : message,
      )
    } finally {
      window.clearTimeout(timer)
      setSending(false)
    }
  }

  function clearConversation() {
    setMessages([])
    setError('')
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <Container className="pt-6 sm:pt-8">
      <div>
        <Link to="/" className="inline-flex h-8 items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-fg">
          <ArrowLeft className="size-3.5" />
          Harness setup
        </Link>
        <h1 className="font-display mt-2 text-[38px] leading-none sm:text-[48px]">Workbench</h1>
        <p className="mt-2 text-[13.5px] text-muted">
          {directory.name} · {model.label} · {model.model}
        </p>
        <p className="mt-1 text-[12.5px] text-faint">Preview and conversation. The harness cannot edit files yet.</p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="overflow-hidden rounded-card border border-line bg-surface">
          <form onSubmit={openPreview} className="flex items-center gap-2 border-b border-line px-3 py-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Preview URL</span>
              <input
                value={previewUrl}
                onChange={(event) => setPreviewUrl(event.target.value)}
                placeholder="http://localhost:3000"
                spellCheck={false}
                className="h-9 w-full rounded-[9px] border border-line-strong bg-bg px-3 font-mono text-[12.5px] focus:border-fg focus:outline-none"
              />
            </label>
            <Button type="submit" variant="secondary" size="sm" disabled={!previewUrl.trim()}>
              Preview
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={detach} disabled={!previewSrc}>
              {detached ? <Minimize2 /> : <Maximize2 />}
              {detached ? 'Detached' : 'Detach'}
            </Button>
          </form>

          <div className="relative h-[62vh] min-h-[380px] bg-bg">
            {previewSrc && !detached ? (
              <iframe src={previewSrc} title="Project preview" className="size-full" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center px-6 text-center">
                <p className="font-display text-[26px]">{detached ? 'Preview detached' : 'No preview yet'}</p>
                <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted">
                  {detached ? 'The preview is in its own window. Bring it back when you want it beside the conversation.' : 'Point the harness at your project’s dev server to watch the work happen.'}
                </p>
                <div className="mt-5 flex items-center gap-2">
                  {detached ? (
                    <Button variant="secondary" size="sm" onClick={reattach}>
                      <Minimize2 />
                      Bring it back
                    </Button>
                  ) : previewSrc ? (
                    <a href={previewSrc} target="_blank" rel="noreferrer noopener" className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-line-strong px-4 text-[13.5px] transition-colors hover:border-fg">
                      Open in a tab
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </div>
                {previewSrc && !detached && <p className="mt-4 text-[12px] text-faint">If the frame stays blank, the app may refuse to be embedded.</p>}
              </div>
            )}
          </div>
        </section>

        <section className="flex h-[calc(62vh+56px)] min-h-[436px] flex-col overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium">Harness conversation</p>
              <p className="truncate text-[11.5px] text-faint">{model.model}</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={clearConversation} aria-label="Clear conversation" className="grid size-8 place-items-center rounded-[8px] text-muted transition-colors hover:bg-surface-2 hover:text-fg">
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>

          <div ref={transcript} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !sending ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="font-display text-[24px]">Ask about the project</p>
                <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted">
                  Paste an error or a snippet and work the COS-G loop with the model you selected.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((message, index) => (
                  <li key={`${message.at}-${index}`} className={cx('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cx(
                        'max-w-[88%] whitespace-pre-wrap rounded-[14px] px-3.5 py-2.5 text-[13.5px] leading-relaxed',
                        message.role === 'user' ? 'bg-fg text-bg' : 'bg-surface-2 text-fg',
                      )}
                    >
                      {message.content}
                    </div>
                  </li>
                ))}
                {sending && (
                  <li className="flex justify-start">
                    <div className="rounded-[14px] bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">Thinking…</div>
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="border-t border-line p-3">
            {error && <p className="mb-2 text-[12.5px] leading-relaxed text-accent">{error}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={onComposerKeyDown}
                rows={2}
                placeholder="Describe the finding, or paste the error…"
                aria-label="Message the harness"
                className="max-h-32 min-h-[46px] flex-1 resize-y rounded-[12px] border border-line-strong bg-bg px-3 py-2.5 text-[13.5px] leading-relaxed placeholder:text-faint focus:border-fg focus:outline-none"
              />
              <Button size="sm" onClick={() => void send()} loading={sending} disabled={!input.trim()} className="h-[46px]">
                <Send />
              </Button>
            </div>
            <details className="mt-2">
              <summary className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-faint">
                <KeyRound className="size-3" />
                Endpoint key (this session only)
              </summary>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value)
                  try {
                    sessionStorage.setItem(KEY_KEY, event.target.value)
                  } catch {
                    // Ignore storage failures; the key stays in memory.
                  }
                }}
                placeholder="Optional bearer token"
                className="mt-2 h-9 w-full rounded-[9px] border border-line-strong bg-bg px-3 font-mono text-[12px] focus:border-fg focus:outline-none"
              />
            </details>
          </div>
        </section>
      </div>
    </Container>
  )
}
