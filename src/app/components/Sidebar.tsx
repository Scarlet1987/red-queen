import { Link, useLocation } from 'react-router'

import { cx } from '../lib/cx'
import { useHarness } from '../lib/harness'

// The rail carries destinations only. Every entry already exists as a page, so
// it adds structure without adding surface area.
interface Item {
  id: string
  label: string
  to: string
  hint?: string
}

const groups: { title: string; items: Item[] }[] = [
  {
    title: 'Harness',
    items: [
      { id: 'setup', label: 'Setup', to: '/' , hint: 'Model and folder' },
      { id: 'workbench', label: 'Workbench', to: '/workbench', hint: 'Preview and conversation' },
    ],
  },
  {
    title: 'Directory',
    items: [
      { id: 'directory', label: 'Browse', to: '/directory', hint: '38 tools' },
      { id: 'rack', label: 'Rack', to: '/rack', hint: 'Your shortlist' },
    ],
  },
  {
    title: 'Doctrine',
    items: [
      { id: 'cosg', label: 'COS-G', to: '/cosg', hint: 'The four passes' },
      { id: 'bible', label: 'Bible', to: '/cosg/bible', hint: 'Laws and frameworks' },
      { id: 'worksheet', label: 'Worksheet', to: '/cosg/worksheet', hint: 'Work one finding' },
    ],
  },
]

function sectionOf(pathname: string): string {
  if (pathname === '/') return 'setup'
  if (pathname.startsWith('/workbench')) return 'workbench'
  if (pathname.startsWith('/tool/') || pathname.startsWith('/directory')) return 'directory'
  if (pathname.startsWith('/rack')) return 'rack'
  if (pathname.startsWith('/cosg/worksheet')) return 'worksheet'
  if (pathname.startsWith('/cosg/bible')) return 'bible'
  if (pathname.startsWith('/cosg')) return 'cosg'
  if (pathname.startsWith('/safety')) return 'safety'
  return ''
}

export function Sidebar() {
  const { pathname } = useLocation()
  const harness = useHarness()
  const current = sectionOf(pathname)

  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-6.5rem)] w-[216px] shrink-0 self-start flex-col border-r border-line px-5 py-7 xl:flex">
      <nav aria-label="Sections" className="flex flex-1 flex-col gap-7">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-2 text-[10.5px] uppercase tracking-[0.16em] text-faint">{group.title}</p>
            <ul className="mt-2 flex flex-col">
              {group.items.map((item) => (
                <li key={item.id}>
                  <Link
                    to={item.to}
                    aria-current={current === item.id ? 'page' : undefined}
                    className={cx(
                      'block rounded-[9px] px-2 py-1.5 transition-colors',
                      current === item.id ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                    )}
                  >
                    <span className="block text-[13.5px] font-medium leading-tight">{item.label}</span>
                    {item.hint && <span className="mt-0.5 block text-[11px] leading-tight text-faint">{item.hint}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line pt-4">
        <Link
          to="/safety"
          aria-current={current === 'safety' ? 'page' : undefined}
          className={cx('block px-2 text-[12.5px] transition-colors hover:text-fg', current === 'safety' ? 'text-fg' : 'text-muted')}
        >
          Safety
        </Link>
        <div className="mt-3 px-2 text-[11px] leading-relaxed text-faint">
          {harness.active && harness.directory ? (
            <>
              <p className="truncate text-muted">{harness.directory.name}</p>
              <p className="truncate">{harness.active.model}</p>
            </>
          ) : (
            <p>No model or folder yet</p>
          )}
          <p className="mt-2.5">Version 1.0</p>
        </div>
      </div>
    </aside>
  )
}
