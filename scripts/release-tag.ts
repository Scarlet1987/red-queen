// Which release a build ships as. The release log writes the answer into
// RELEASES.md, the build bakes it into /api/health, and the stamp records what
// was baked — so all three have to agree, and all three ask here.
//
//   node -e "import('./scripts/release-tag.ts').then(m => console.log(m.resolveTag()))"
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { INPUTS } from './build-stamp.ts'

/**
 * No tag describes this build: the tree is untagged, has moved past its tag
 * with a changed input, or git could not be asked. A dash is a fact here, not
 * a gap: it says these bytes are not the tagged release.
 */
export const TAG_UNKNOWN = '—'

export const ROOT = join(import.meta.dirname, '..')

/**
 * One git call, with every way it can fail folded into `ok: false`: git absent,
 * killed for hanging past the timeout, or exiting non-zero. Neither a release
 * log row nor a build is worth crashing over a missing tag.
 */
export function git(root: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15_000 })
  if (result.error) return { ok: false, out: '' }
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

/**
 * Which release this build ships as. The tag, not the commit: a deployment
 * logged two commits after the tag — documentation, tests, the installer — is
 * still the tagged bytes, so the bare tag is the honest answer rather than
 * `v1.0.0-2-gabc1234`. Anything else (no tag, a tree past its tag with a changed
 * build input, an uncommitted edit, no git) is a dash instead of a guess.
 */
export function resolveTag(root: string = ROOT): string {
  if (!git(root, ['rev-parse', '--git-dir']).ok) return TAG_UNKNOWN
  const described = git(root, ['describe', '--tags'])
  if (!described.ok) return TAG_UNKNOWN

  // Uncommitted changes to an input mean these are not the tagged bytes, even
  // when HEAD is the tagged commit.
  const dirty = git(root, ['status', '--porcelain', '--', ...INPUTS])
  if (!dirty.ok || dirty.out !== '') return TAG_UNKNOWN

  const distance = described.out.match(/^(.*)-(\d+)-g([0-9a-f]+)$/)
  if (!distance) return described.out

  // Past the tag: only a tag whose inputs are untouched produced this build, and
  // the stamp hashes exactly those inputs. One diff answers it, without copying
  // the tree or rebuilding it.
  const unchanged = git(root, ['diff', '--quiet', `refs/tags/${distance[1]}`, 'HEAD', '--', ...INPUTS])
  return unchanged.ok ? distance[1] : described.out
}

/**
 * The tag as a JSON value: a name, or null when no tag describes the build. An
 * empty string is a stamp written before the tag was recorded, not a tag.
 */
export function tagOrNull(tag: string): string | null {
  return tag === TAG_UNKNOWN || tag === '' ? null : tag
}
