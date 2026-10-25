// Red Queen ships as source, data and generated SVG covers — no tool binaries.
// That keeps the repository (and the deployable build) inside the 100 MB budget
// this project promises. Run `npm run size` to check it.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const BUDGET = 100 * 1024 * 1024
const ROOT = join(import.meta.dirname, '..')
const EXCLUDED = new Set(['node_modules', '.git', 'dist', '.wrangler', '.freebuff'])

interface Found {
  path: string
  size: number
}

function walk(dir: string, skip: Set<string> = EXCLUDED): Found[] {
  const out: Found[] = []
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) out.push(...walk(path, skip))
    else if (stat.isFile()) out.push({ path: relative(ROOT, path), size: stat.size })
  }
  return out
}

function format(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

const files = walk(ROOT)
const repositorySize = files.reduce((total, file) => total + file.size, 0)

const top = new Map<string, number>()
for (const file of files) {
  const group = file.path.split('/')[0]
  top.set(group, (top.get(group) ?? 0) + file.size)
}

const distDir = join(ROOT, 'dist')
const buildSize = existsSync(distDir) ? walk(distDir, new Set()).reduce((total, file) => total + file.size, 0) : 0

console.log('Red Queen base-program size budget')
console.log('')
for (const [group, size] of [...top.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${group.padEnd(16)} ${format(size).padStart(10)}`)
}
console.log('')
console.log(`  base program     ${format(repositorySize).padStart(10)}  (${files.length} files, excluding node_modules, .git, dist)`)
console.log(`  build output     ${buildSize ? format(buildSize).padStart(10) : '    not built'}`)
console.log(`  cap              ${format(BUDGET).padStart(10)}`)
console.log(`  headroom         ${format(Math.max(0, BUDGET - Math.max(repositorySize, buildSize))).padStart(10)}`)
console.log('')

const oversized = [
  ...files.filter((file) => file.size > 5 * 1024 * 1024).map((file) => `${file.path} (${format(file.size)})`),
]

if (oversized.length) {
  console.error('Files over 5 MB — host tool binaries upstream, not in this repository:')
  for (const entry of oversized) console.error(`  ${entry}`)
}

if (repositorySize > BUDGET || buildSize > BUDGET) {
  console.error('Over the 100 MB cap for the base program. Remove the large files above or move them out of the repository.')
  process.exit(1)
}

console.log('Within budget.')
