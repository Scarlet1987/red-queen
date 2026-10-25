import { motion } from 'motion/react'
import { Loader2 } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { Link } from 'react-router'

import { safetyMeta, type Safety } from '../../data/tools'
import { cx } from '../lib/cx'

type Variant = 'primary' | 'secondary' | 'ghost'
type Size = 'md' | 'lg' | 'sm'

const base =
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,color,transform,border-color] duration-200 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0'
const variants: Record<Variant, string> = {
  primary: 'bg-fg text-bg hover:bg-[#33302b]',
  secondary: 'border border-line-strong bg-transparent text-fg hover:border-fg',
  ghost: 'text-muted hover:text-fg',
}
// Heights pair with inputs: sm 40, md 48, lg 56.
const sizes: Record<Size, string> = {
  sm: 'h-10 rounded-[12px] px-4 text-[14px]',
  md: 'h-12 rounded-control px-6 text-[15px]',
  lg: 'h-14 rounded-[16px] px-7 text-[16px]',
}

export const buttonClass = ({ variant = 'primary', size = 'md', className }: { variant?: Variant; size?: Size; className?: string } = {}) =>
  cx(base, variants[variant], sizes[size], className)

type Props = { variant?: Variant; size?: Size; className?: string; children: ReactNode; loading?: boolean }

export function Button({ variant = 'primary', size = 'md', className, children, loading, ...rest }: Props & ComponentPropsWithoutRef<'button'>) {
  return (
    <button type="button" className={buttonClass({ variant, size, className })} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 className="animate-spin" /> : children}
    </button>
  )
}

export function ButtonLink({ variant = 'primary', size = 'md', className, children, to, ...rest }: Props & { to: string } & Omit<ComponentPropsWithoutRef<typeof Link>, 'to'>) {
  return (
    <Link to={to} className={buttonClass({ variant, size, className })} {...rest}>
      {children}
    </Link>
  )
}

export const inputClass =
  'h-12 w-full min-w-0 rounded-control border border-line-strong bg-surface px-4 text-[15px] text-fg placeholder:text-faint transition-colors focus:border-fg focus:outline-none'

export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('mx-auto w-full max-w-[1280px] px-5 sm:px-8', className)}>{children}</div>
}

export function Reveal({ children, delay = 0, className, y = 20 }: { children: ReactNode; delay?: number; className?: string; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function SectionTitle({ eyebrow, title, action, className }: { eyebrow?: string; title: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-end justify-between gap-6', className)}>
      <div>
        {eyebrow && <p className="mb-2 text-[13px] text-muted">{eyebrow}</p>}
        <h2 className="font-display text-balance text-[36px] sm:text-[44px]">{title}</h2>
      </div>
      {action}
    </div>
  )
}

const safetyTone: Record<Safety, string> = {
  static: 'bg-static-soft/95 text-static',
  sandbox: 'bg-sandbox-soft/95 text-sandbox',
  live: 'bg-live-soft/95 text-live',
}

export function SafetyChip({ safety, className }: { safety: Safety; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1 text-[12px] font-medium backdrop-blur', safetyTone[safety], className)}>
      <span className="round size-1.5 rounded-full bg-current" aria-hidden />
      {safetyMeta[safety].label}
    </span>
  )
}
