// COS-G's ghost pass on the page rather than in a terminal. The sweep reads the
// machine under a local install, so the findings that used to need a shell are
// here: hardware with no driver, a block that is not holding, a driver doing
// nothing, a DKMS record with no build. One request when the page opens, one
// button to read it again, and nothing else added to the page.
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { hostRuleLabels, type HostView } from '../../lib/host-view.ts'
import { cx } from '../lib/cx'
import { fetchHostView } from '../lib/host'
import { Button } from './ui'

type State = { status: 'loading' } | { status: 'ok'; view: HostView } | { status: 'unreachable'; message: string }

const COMMAND = 'npm run cosg -- . --host'

function headline(state: State): string {
  if (state.status === 'loading') return 'Reading this machine…'
  if (state.status === 'unreachable') return 'No answer from this copy’s server'
  return state.view.available ? state.view.cell : 'The sweep cannot see this machine'
}

function detail(state: State): string {
  if (state.status === 'loading') return 'Read-only: nothing is loaded, unloaded or rebuilt to answer this.'
  if (state.status === 'unreachable') return state.message
  if (!state.view.available) return state.view.reason
  return `Read from the ${state.view.mode} copy, on kernel ${state.view.kernel}.`
}

function stats(view: HostView): { label: string; value: number }[] {
  return [
    { label: 'PCI devices', value: view.counts.devices },
    { label: 'Blocked', value: view.counts.blacklisted },
    { label: 'Loaded now', value: view.counts.loaded },
    { label: 'DKMS records', value: view.counts.dkms },
  ]
}

export function HostPanel() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [reading, setReading] = useState(true)

  const load = useCallback(async () => {
    setReading(true)
    const result = await fetchHostView()
    setState(result.status === 'ok' ? { status: 'ok', view: result.view } : { status: 'unreachable', message: result.message })
    setReading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const view = state.status === 'ok' ? state.view : null

  return (
    <div className="mt-8 rounded-card border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <p className="text-[15.5px] font-medium">{headline(state)}</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{detail(state)}</p>
        </div>
        <Button variant="secondary" size="sm" loading={reading} onClick={() => void load()}>
          <RefreshCw />
          Check again
        </Button>
      </div>

      {view?.available && (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 sm:grid-cols-4">
            {stats(view).map((stat) => (
              <div key={stat.label}>
                <dt className="text-[11.5px] uppercase tracking-[0.1em] text-faint">{stat.label}</dt>
                <dd className="mt-1 text-[15px] tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>

          {view.findings.length === 0 ? (
            <p className="mt-5 text-[14px] leading-relaxed text-muted">
              Nothing to report: every device that needs a driver has one, no block has lost, no loaded driver is driving nothing, and every DKMS record still has a build.
            </p>
          ) : (
            <ul className="mt-5 flex flex-col gap-2">
              {view.findings.map((finding, index) => (
                <li key={`${finding.rule}-${index}`} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-[14px] border border-line bg-surface-2/50 p-4">
                  <span
                    className={cx(
                      'inline-flex h-6 shrink-0 items-center rounded-[8px] px-2 text-[11.5px] font-medium',
                      finding.severity === 'warn' ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted',
                    )}
                  >
                    {hostRuleLabels[finding.rule]}
                  </span>
                  <p className="max-w-3xl flex-1 text-[14px] leading-relaxed text-muted">{finding.message}</p>
                  {finding.file && <code className="w-full text-[12px] text-faint">{finding.file}</code>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {state.status !== 'ok' || !state.view.available ? (
        <p className="mt-5 border-t border-line pt-4 text-[13.5px] leading-relaxed text-muted">
          The same sweep runs from the command line, anywhere the project is:{' '}
          <code className="rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-fg">{COMMAND}</code>
        </p>
      ) : null}
    </div>
  )
}
