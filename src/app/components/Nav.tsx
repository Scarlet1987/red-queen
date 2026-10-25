import { AnimatePresence, motion } from 'motion/react'
import { Bookmark, Menu, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { useJump } from '../lib/jump'
import { useRack } from '../lib/rack'
import { cx } from '../lib/cx'

// Two links. Safety levels are a choice inside the directory, not a navigation
// bar the reader has to parse before they have seen a single tool.
const links = [
  { to: '/directory', label: 'Directory' },
  { to: '/safety', label: 'Safety' },
]

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cx('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 19h14M6.5 19 4 9l4 2.5L12 5l4 6.5L20 9l-2.5 10" />
        <circle cx="12" cy="3.6" r="0.9" />
      </svg>
      <span className="font-display text-[24px] leading-none">Red Queen</span>
    </Link>
  )
}

export function Nav() {
  const rack = useRack()
  const jump = useJump()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()
  const current = location.pathname + location.search

  useEffect(() => setOpen(false), [location])
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <Link to="/safety" className="block bg-fg text-bg transition-colors hover:bg-[#33302b]">
        <span className="mx-auto flex h-9 max-w-[1440px] items-center gap-2 px-4 text-center text-[12.5px]">
          <span className="hidden w-[200px] shrink-0 xl:block" aria-hidden />
          <span className="flex flex-1 items-center justify-center gap-2">
            <span className="round size-1.5 rounded-full bg-accent" aria-hidden />
            Static first — nothing here executes your files
          </span>
        </span>
      </Link>
      <header className={cx('sticky top-0 z-40 transition-[background-color,box-shadow,border-color] duration-300', scrolled ? 'border-b border-line bg-bg/85 backdrop-blur-xl' : 'bg-bg')}>
        <div className="mx-auto grid h-16 max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center px-5 sm:px-8 xl:pl-[216px]">
          <nav className="col-start-1 hidden items-center gap-1 lg:flex xl:hidden">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className={cx(
                  'inline-flex h-9 items-center rounded-[11px] px-3 text-[14px] transition-colors hover:bg-surface-2',
                  current === l.to ? 'text-fg' : 'text-muted hover:text-fg',
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <button type="button" aria-label="Menu" onClick={() => setOpen(true)} className="col-start-1 grid size-10 place-items-center rounded-control lg:hidden">
            <Menu className="size-5" />
          </button>

          <div className="col-start-2 justify-self-center">
            <Logo />
          </div>

          <div className="col-start-3 flex items-center justify-end gap-1 justify-self-end">
            <button
              type="button"
              onClick={() => jump.setOpen(true)}
              aria-label="Quick jump (Command or Control K)"
              className="hidden h-10 items-center gap-2 rounded-control px-2.5 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:inline-flex"
            >
              <Search className="size-4" />
              <kbd className="rounded-[5px] border border-line-strong px-1 py-0.5 text-[10.5px] leading-none">⌘K</kbd>
            </button>
            <Link to="/safety" className="hidden h-9 items-center rounded-[11px] px-3 text-[14px] text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:inline-flex lg:hidden">
              Safety
            </Link>
            <Link
              to="/rack"
              aria-label={`Rack, ${rack.count} saved tools`}
              className={cx(
                'relative inline-flex h-10 items-center gap-2 rounded-control px-3 text-[14px] transition-colors hover:bg-surface-2',
                location.pathname === '/rack' ? 'text-fg' : 'text-muted hover:text-fg',
              )}
            >
              <Bookmark className="size-5" />
              <span className="hidden sm:inline">Rack</span>
              <AnimatePresence>
                {rack.count > 0 && (
                  <motion.span
                    key={rack.count}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    className="round grid min-w-5 place-items-center rounded-full bg-fg px-1.5 text-[11px] font-semibold tabular-nums text-bg"
                  >
                    {rack.count}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 bg-fg/30 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.nav
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-y-2 left-2 flex w-[300px] flex-col rounded-dialog bg-bg p-5 shadow-drawer"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <Logo />
                <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid size-10 place-items-center rounded-control hover:bg-surface-2">
                  <X className="size-5" />
                </button>
              </div>
              <ul className="mt-8 flex flex-col gap-1">
                {[
                  { to: '/', label: 'Setup' },
                  { to: '/workbench', label: 'Workbench' },
                  { to: '/directory', label: 'Directory' },
                  { to: '/rack', label: `Rack${rack.count ? ` (${rack.count})` : ''}` },
                  { to: '/cosg', label: 'COS-G' },
                  { to: '/cosg/bible', label: 'Bible' },
                  { to: '/cosg/worksheet', label: 'Worksheet' },
                  { to: '/safety', label: 'Safety' },
                ].map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} className="flex h-12 items-center rounded-control px-3 font-display text-[28px] hover:bg-surface-2">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-auto px-3 text-[12.5px] leading-relaxed text-faint">
                A directory of tools that can read, emulate or attach to a binary. Bring your own sandbox.
              </p>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
