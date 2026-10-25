// Red Queen ships as source, data and generated SVG covers — no tool binaries.
// That keeps the repository (and the deployable build) inside the 100 MB budget
// this project promises.
//
// The budget is a gate, not an aspiration: `npm run check` runs this, so a
// change that grows the tree or the build fails before it can merge. It fails
// at the gate, not at the cap, because a promise is worth keeping with room to
// spare — 100 MB minus a 10 MB margin, so there is somewhere to stand when the
// warning turns red.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUDGET = 100 * 1024 * 1024
/** Held back from the cap, so growth is caught while it is still easy to undo. */
export const MARGIN = 10 * 1024 * 1024
export const GATE = BUDGET - MARGIN

const ROOT = join(import.meta.dirname, '..')
const EXCLUDED = new Set(['node_modules', '.git', 'dist', '.wrangler', '.freebuff'])

interface Found {
  path: string
  size: number
}

export interface Sizes {
  /** Source, data, covers and docs — everything that is not built. */
  base: number
  /** The build output, or 0 when there is none. */
  build: number
  files: number
  /** Bytes per top-level entry, largest first. */
  groups: [string, number][]
  /** Files large enough to be worth naming. */
  oversized: Found[]
}

export interface Verdict {
  ok: boolean
  problems: string[]
}

function walk(base: string, dir: string, skip: Set<string> = EXCLUDED): Found[] {
  const out: Found[] = []
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...walk(base, path, skip))
    else if (stat.isFile()) out.push({ path: relative(base, path), size: stat.size })
  }
  return out
}

export function format(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export function measure(root = ROOT): Sizes {
  const files = walk(root, root)
  const base = files.reduce((total, file) => total + file.size, 0)

  const groups = new Map<string, number>()
  for (const file of files) {
    const group = file.path.split('/')[0]
    groups.set(group, (groups.get(group) ?? 0) + file.size)
  }

  const distDir = join(root, 'dist')
  const build = existsSync(distDir) ? walk(root, distDir, new Set()).reduce((total, file) => total + file.size, 0) : 0

  return {
    base,
    build,
    files: files.length,
    groups: [...groups.entries()].sort((a, b) => b[1] - a[1]),
    oversized: files.filter((file) => file.size > 5 * 1024 * 1024),
  }
}

/**
 * The rule, without touching the disk: neither number may reach the gate. Both
 * are checked separately — a small repository that builds a huge bundle is just
 * as far past the promise as a repository full of stray files.
 */
export function evaluate(sizes: Pick<Sizes, 'base' | 'build'>, options: { budget?: number; margin?: number } = {}): Verdict {
  const budget = options.budget ?? BUDGET
  const margin = options.margin ?? MARGIN
  const gate = budget - margin
  const problems: string[] = []

  if (sizes.base > gate) {
    problems.push(
      `the base program is ${format(sizes.base)}, past the ${format(gate)} gate (cap ${format(budget)}, ${format(margin)} held back) — remove the large files or move them out of the repository.`,
    )
  }
  if (sizes.build > gate) {
    problems.push(
      `the build output is ${format(sizes.build)}, past the ${format(gate)} gate (cap ${format(budget)}, ${format(margin)} held back) — fix what the build packs, rather than raising the gate.`,
    )
  }
  return { ok: problems.length === 0, problems }
}

export function report(root = ROOT): number {
  const sizes = measure(root)
  const verdict = evaluate(sizes)

  console.log('Red Queen base-program size budget')
  console.log('')
  for (const [group, size] of sizes.groups) {
    console.log(`  ${group.padEnd(16)} ${format(size).padStart(10)}`)
  }
  console.log('')
  console.log(`  base program     ${format(sizes.base).padStart(10)}  (${sizes.files} files, excluding node_modules, .git, dist)`)
  console.log(`  build output     ${sizes.build ? format(sizes.build).padStart(10) : '    not built'}`)
  console.log(`  gate             ${format(GATE).padStart(10)}  (cap ${format(BUDGET)} − ${format(MARGIN)} margin)`)
  console.log(`  headroom         ${format(Math.max(0, GATE - Math.max(sizes.base, sizes.build))).padStart(10)}  to the gate`)
  console.log('')

  if (sizes.oversized.length) {
    console.error('Files over 5 MB — host tool binaries upstream, not in this repository:')
    for (const file of sizes.oversized) console.error(`  ${file.path} (${format(file.size)})`)
    console.error('')
  }

  if (!verdict.ok) {
    for (const problem of verdict.problems) console.error(`FAIL  ${problem}`)
    return 1
  }

  console.log(`Within budget — ${format(BUDGET)} cap, ${format(GATE)} gate.`)
  return 0
}

// Importing this module (from a test) must not print or exit.
const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exitCode = report(ROOT)
