import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// install.sh clones a tag rather than the tip of main, so a test install in six
// months is the program that was released, not whatever landed that week. That
// promise is a single line in the script, and it fails in the worst place: the
// user's machine, at `git clone`, naming a tag that was never pushed. Nothing
// local notices — the script parses, the suite stays green, and only CI running
// on a commit that happens to be tagged looks fine too.
//
// So the pin is asked about directly: the tag must exist on the remote the
// installer clones from. The remote is the source of truth, not this checkout's
// ref list, because a clone fetches neither tags nor branches it does not name.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INSTALLER = join(ROOT, 'install.sh')

/** The value DEFAULT_REF is assigned, or null when the setting has been lost. */
export function defaultRef(body: string): string | null {
  const match = body.match(/^DEFAULT_REF=(?:"([^"]*)"|'([^']*)'|(\S+))[ \t]*$/m)
  if (!match) return null
  const value = (match[1] ?? match[2] ?? match[3] ?? '').trim()
  return value === '' ? null : value
}

/** The repository the installer clones when the user passes no --repo. */
export function defaultRepo(body: string): string | null {
  const match = body.match(/^DEFAULT_REPO=(?:"([^"]*)"|'([^']*)'|(\S+))[ \t]*$/m)
  if (!match) return null
  const value = (match[1] ?? match[2] ?? match[3] ?? '').trim()
  return value === '' ? null : value
}

/**
 * Whether the clone step reads the pin, rather than carrying its own default.
 * Without this a bumped DEFAULT_REF would be documentation: the installer would
 * keep cloning whatever `ref=` says.
 */
export function usesPin(body: string): boolean {
  return /^ref=\$\{RED_QUEEN_REF:-\$DEFAULT_REF\}[ \t]*$/m.test(body)
}

/** Tag names from `git ls-remote --tags`, peeled `^{}` entries folded away. */
export function tagsOf(output: string): string[] {
  const names = new Set<string>()
  for (const line of output.split('\n')) {
    const ref = line.split('\t')[1]?.trim()
    if (!ref?.startsWith('refs/tags/')) continue
    const name = ref.slice('refs/tags/'.length)
    if (name.endsWith('^{}')) continue
    names.add(name)
  }
  return [...names]
}

/**
 * Why the pin cannot be installed from, or null when it can. `tags` is every tag
 * name the remote reports; the check is existence, not that the tag is the
 * newest one, because a deliberate rollback is a legitimate pin.
 */
export function pinProblem(body: string, tags: Iterable<string>): string | null {
  const ref = defaultRef(body)
  if (!ref) return 'install.sh no longer sets DEFAULT_REF, so a clone has no version to reproduce.'
  if (!usesPin(body)) return `install.sh sets DEFAULT_REF=${ref} but the clone step does not read it — bumping the pin would change nothing.`

  const known = new Set(tags)
  if (!known.has(ref)) {
    return `DEFAULT_REF is "${ref}" but the remote has no tag of that name. Push it (git push origin ${ref}) or pin a tag that exists.`
  }
  return null
}

function askRemote(repo: string): { tags: string[] } | { error: string } {
  const result = spawnSync('git', ['ls-remote', '--tags', repo], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 })
  if (result.error) return { error: result.error.message }
  if (result.status !== 0) {
    const reason = (result.stderr || '').trim().split('\n').filter(Boolean).pop()
    return { error: reason ?? `git ls-remote exited ${result.status}` }
  }
  return { tags: tagsOf(result.stdout) }
}

test('the installer pins a release tag and reads it', () => {
  const body = readFileSync(INSTALLER, 'utf8')
  const ref = defaultRef(body)

  assert.ok(ref, 'install.sh has no DEFAULT_REF')
  assert.equal(usesPin(body), true, 'the clone step ignores DEFAULT_REF')
  // A branch is not a pin: `main` moves, which is the drift this exists to stop.
  assert.doesNotMatch(ref, /^(main|master|HEAD)$/, 'DEFAULT_REF points at a branch, not a release tag')
  assert.equal(defaultRepo(body), 'https://github.com/Scarlet1987/red-queen.git', 'the installer clones somewhere other than the published repository')
})

test('a pin that names no tag is refused, and the message says which', () => {
  const body = readFileSync(INSTALLER, 'utf8')
  const problem = pinProblem(body, ['v0.0.1', 'v0.0.2'])

  assert.ok(problem, 'a pin with no matching tag was accepted')
  assert.match(problem, new RegExp(`DEFAULT_REF is "${defaultRef(body)}"`))
  assert.match(problem, /git push origin v/)
})

test('a missing pin, or one the script does not read, is refused', () => {
  const body = readFileSync(INSTALLER, 'utf8')
  const ref = defaultRef(body)!

  assert.match(pinProblem(body.replace(/^DEFAULT_REF=.*$/m, ''), [ref]) ?? '', /no longer sets DEFAULT_REF/)
  assert.match(pinProblem(body.replace(/^ref=.*$/m, 'ref=${RED_QUEEN_REF:-main}'), [ref]) ?? '', /does not read it/)
})

test('peeled tag entries are folded into their tag name', () => {
  const output = [
    'f4484181ba847312722ea88116ade7413fd00486\trefs/tags/v1.0.0',
    '3fcb4182197f28d87298c9078f3fbcdf04144cb7\trefs/tags/v1.0.0^{}',
    'abc123\trefs/heads/main',
  ].join('\n')

  assert.deepEqual(tagsOf(output), ['v1.0.0'])
})

test('the pinned tag exists on the remote the installer clones from', () => {
  const body = readFileSync(INSTALLER, 'utf8')
  const repo = defaultRepo(body)
  assert.ok(repo, 'install.sh has no DEFAULT_REPO to check against')

  const remote = askRemote(repo)
  // An unanswered question is not a pass: the pin's whole point is that the tag
  // will be there on a machine that has nothing but a shell.
  if ('error' in remote) {
    assert.fail(`could not list tags on ${repo}: ${remote.error}. The pin cannot be verified without it.`)
  }

  assert.equal(pinProblem(body, remote.tags), null)
})
