// The build stamp is what makes a deploy gate possible. Every build records a
// hash of the inputs it was produced from, so the gate can tell "built from this
// source" apart from "built from something that has since changed". The stamp
// and the deploy manifest are written into dist/, which is disposable: nothing
// here is committed and a failed gate leaves no manifest behind.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Inputs that change what a build produces. Tests, documentation and the gate
// itself are deliberately absent: editing them should not force a rebuild
// before publishing the same bytes. The Node pin is present: npm run build
// runs on that version, and the gate should not approve a build made on a
// runtime nobody pinned. Dotfiles are skipped inside directories, so .nvmrc is
// named here rather than arriving through one.
export const INPUTS = [
  'src',
  'public',
  'index.html',
  '.nvmrc',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'wrangler.jsonc',
  'scripts/postbuild.mjs',
  'scripts/build-offline.ts',
  'scripts/offline-server.mjs',
]

export interface Stamp {
  program: string
  version: string
  builtAt: string
  compatibilityDate: string
  /** Worker module path relative to dist/, e.g. red_queen/index.js. */
  worker: string
  /** Static asset directory relative to dist/, e.g. client. */
  assets: string
  /**
   * The Node that produced the build, e.g. v24.17.0 — empty for a stamp written
   * before this was recorded, which the gate refuses rather than assumes.
   */
  node: string
  /**
   * The release the bytes were baked with, e.g. v1.0.0, or empty when no tag
   * described them at build time. This is the value /api/health reports, so the
   * smoke test can compare what the site says against what was built.
   */
  tag: string
  /** Hash per input file, keyed by path relative to the repository root. */
  files: Record<string, string>
  hash: string
}

export interface StampMeta {
  version: string
  compatibilityDate: string
  worker: string
  assets: string
  /** The tag the build baked into /api/health; a dash when none describes it. */
  tag: string
}

function collect(root: string, target: string, into: Record<string, string>): void {
  if (!existsSync(target)) return
  const stat = statSync(target)
  if (stat.isDirectory()) {
    for (const name of readdirSync(target).sort()) {
      if (name.startsWith('.')) continue
      collect(root, join(target, name), into)
    }
    return
  }
  if (!stat.isFile()) return
  const key = relative(root, target).split(sep).join('/')
  into[key] = createHash('sha256').update(readFileSync(target)).digest('hex')
}

/** Content hashes for every build input, plus one hash over all of them. */
export function hashInputs(root: string): { files: Record<string, string>; hash: string } {
  const files: Record<string, string> = {}
  for (const entry of INPUTS) collect(root, join(root, entry), files)
  const digest = createHash('sha256')
  for (const key of Object.keys(files).sort()) digest.update(`${key}\u0000${files[key]}\n`)
  return { files, hash: `sha256:${digest.digest('hex')}` }
}

export const stampPath = (root: string) => join(root, 'dist', 'build.json')

/** The manifest the deploy tool reads. Only the gate writes it. */
export const manifestPath = (root: string) => join(root, 'dist', 'deploy.json')

/** The stamp of the build in dist/, or null when there is no usable build. */
export function readStamp(root: string): Stamp | null {
  let raw: string
  try {
    raw = readFileSync(stampPath(root), 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Stamp>
    if (parsed.program !== 'red-queen') return null
    if (typeof parsed.hash !== 'string' || typeof parsed.worker !== 'string' || typeof parsed.assets !== 'string') return null
    if (typeof parsed.compatibilityDate !== 'string' || !parsed.files || typeof parsed.files !== 'object') return null
    return {
      program: 'red-queen',
      version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : '',
      compatibilityDate: parsed.compatibilityDate,
      worker: parsed.worker,
      assets: parsed.assets,
      node: typeof parsed.node === 'string' ? parsed.node : '',
      tag: typeof parsed.tag === 'string' ? parsed.tag : '',
      files: parsed.files,
      hash: parsed.hash,
    }
  } catch {
    return null
  }
}

/** Record what this build was made from. Called at the end of the build. */
export function writeBuildStamp(root: string, meta: StampMeta): Stamp {
  const { files, hash } = hashInputs(root)
  const stamp: Stamp = {
    program: 'red-queen',
    version: meta.version,
    builtAt: new Date().toISOString(),
    compatibilityDate: meta.compatibilityDate,
    worker: meta.worker,
    assets: meta.assets,
    // The runtime is not part of the hash — the inputs are — but recording it
    // lets the gate tell a build made on the pinned Node from one made elsewhere.
    node: process.version,
    // Likewise the tag: the same inputs can be built before and after a tag is
    // cut, and the deployed bytes carry whichever value they were baked with.
    tag: meta.tag,
    files,
    hash,
  }
  // A new build invalidates any manifest from an earlier gate: the bytes on disk
  // are no longer the ones those checks ran against. Vite does not always empty
  // dist/, so this cannot wait for the gate to notice.
  rmSync(manifestPath(root), { force: true })
  writeFileSync(stampPath(root), JSON.stringify(stamp, null, 2) + '\n')
  return stamp
}
