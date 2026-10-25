import { motion } from 'motion/react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { Link } from 'react-router'

import { categoryLabel, type Tool } from '../../data/tools'
import { cx } from '../lib/cx'
import { useRack } from '../lib/rack'
import { useRefine } from '../lib/refine'
import { SafetyChip } from './ui'

export function ToolCard({ tool, index = 0, priority }: { tool: Tool; index?: number; priority?: boolean }) {
  const rack = useRack()
  const refine = useRefine()
  const saved = rack.has(tool.slug)
  const safety = refine.safetyOf(tool)
  const refined = refine.isRefined(tool.slug)

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -6% 0px' }}
      transition={{ duration: 0.7, delay: (index % 4) * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      <Link to={`/tool/${tool.slug}`} className="block">
        <div className="cover-frame relative aspect-[3/4] rounded-image">
          <img
            src={`/images/tools/${tool.slug}.svg`}
            alt={`${tool.name} cover`}
            loading={priority ? 'eager' : 'lazy'}
            className="size-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.03]"
          />
          <SafetyChip safety={safety} className="absolute left-3 top-3" />
        </div>
        <div className="mt-3.5">
          <h3 className="truncate text-[15px] font-medium">{tool.name}</h3>
          <p className="mt-0.5 truncate text-[13px] text-muted">{tool.short}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-faint">
            <span>{categoryLabel(tool.category)}</span>
            <span aria-hidden>·</span>
            <span>{tool.cost}</span>
            {refined && (
              <>
                <span aria-hidden>·</span>
                <span className="text-accent">refined</span>
              </>
            )}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => rack.toggle(tool.slug)}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${tool.name} from rack` : `Save ${tool.name} to rack`}
        className={cx(
          'absolute right-3 top-3 grid size-9 place-items-center rounded-[11px] backdrop-blur transition-colors',
          saved ? 'bg-accent text-bg hover:bg-accent/90' : 'bg-bg/85 text-fg hover:bg-bg',
        )}
      >
        {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
      </button>
    </motion.article>
  )
}
