// Record a deployment in RELEASES.md: run the live smoke test, then put the
// build hash, environment, release tag and result at the top of the log.
//
//   npm run release:log -- production
//   npm run release:log -- preview
//   npm run release:log -- preview --url https://… --at "2026-10-24 21:18"
//   npm run release:log -- --status     refresh the build status line only
//   npm run release:log -- --verify     fail when the log and the build disagree
//
// The build hash comes from dist/build.json, written by npm run release, so the
// row names the build the gate approved rather than whatever is on disk. A
// build that is already logged for that environment is updated in place — its
// deployment time is kept — instead of being logged twice.
//
// The tag is resolved from git, not typed in: it names the release whose build
// inputs are this build's, so logging a deploy a commit or two after the tag
// still says `v1.0.0` instead of `v1.0.0-2-gabc1234`. A build no tag describes
// logs a dash, which is a fact rather than a gap.
//
// A status line above the table says whether dist/build.json still matches the
// newest logged build. The gate refreshes it as part of npm run release, so a
// rebuild that has not been deployed shows up in the log instead of being
// mistaken for the published one.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { INPUTS, readStamp, type Stamp } from './build-stamp.ts'
import { DEFAULT_BASE, smoke, type Check } from './smoke.ts'

const ROOT = join(import.meta.dirname, '..')

export type Environment = 'preview' | 'production'

export const ENVIRONMENTS: Environment[] = ['preview', 'production']

export const URLS: Record<Environment, string> = {
  preview: DEFAULT_BASE,
  production: 'https://site-7b563dd9b57543d58f4ee10986624b94.freebuff.page',
}

export const LOG_PATH = join(ROOT, 'RELEASES.md')

export const STATUS = '> **Build status:**'

/** A row logged before the runtime column existed, or by a stamp that lost it. */
export const RUNTIME_UNKNOWN = '—'

/**
 * No tag describes this build: the tree is untagged, has moved past its tag
 * with a changed input, or git could not be asked. A dash is a fact here.
 */
export const TAG_UNKNOWN = '—'

/** Deployed, Environment, Build, Tag, Node, Smoke: the shape written now. */
const COLUMNS = 6
export const HEADER_ROW = '| Deployed (UTC) | Environment | Build | Tag | Node | Smoke |'

/**
 * A row keeps the shape it was written in; a missing column is filled in when
 * that deployment is logged again, never by rewriting history. Six cells is
 * current, five predates the tag, four also predates the Node.
 */
const SHAPES = [COLUMNS, COLUMNS - 1, COLUMNS - 2]

function isReleaseRow(parts: string[]): boolean {
  return SHAPES.includes(parts.length)
}

/** Where the Node sits depends on the shape of the row it is in. */
function nodeCell(parts: string[]): string {
  if (parts.length === COLUMNS) return parts[4]
  if (parts.length === COLUMNS - 1) return parts[3]
  return ''
}

/** UTC, minute precision: "2026-10-24 21:18". */
function utc(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

export function shortHash(stamp: Stamp): string {
  return stamp.hash.replace(/^sha256:/, '').slice(0, 12)
}

/**
 * One git call, with every way it can fail folded into `ok: false`: git absent,
 * killed for hanging past the timeout, or exiting non-zero. A log row is not
 * worth crashing a release over.
 */
function git(root: string, args: string[]): { ok: boolean; out: string } {
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

function cells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
}

/** One Markdown table row, or a readable result when checks failed. */
export function rowFor(input: { environment: Environment; stamp: Stamp; checks: Check[]; at?: string; tag?: string }): string {
  const failed = input.checks.filter((check) => !check.ok)
  const total = input.checks.length
  const result = failed.length === 0 ? `${total}/${total}` : `${total - failed.length}/${total} — failed: ${failed.map((check) => check.name).join(', ')}`
  const build = `\`${shortHash(input.stamp)}\` — ${input.stamp.version}, built ${utc(input.stamp.builtAt).slice(11)}`
  // The stamp is written by the build itself, so this is the Node that produced
  // these bytes — not whichever Node happens to run this script.
  const node = input.stamp.node || RUNTIME_UNKNOWN
  // The tag describes the build, so a caller that knows it may pass it in; the
  // log command resolves it from git instead of trusting the operator's memory.
  const tag = input.tag ?? TAG_UNKNOWN
  return `| ${input.at ?? utc(new Date().toISOString())} | ${input.environment} | ${build} | ${tag} | ${node} | ${result} |`
}

export interface Placed {
  markdown: string
  replaced: boolean
  /** The row as it now appears in the log, after any kept deployment time. */
  row: string
}

/** Put a row under the table header, updating the same environment + build if present. */
export function place(markdown: string, row: string, environment: string, short: string): Placed {
  const lines = markdown.split('\n')
  const separator = lines.findIndex((line) => /^\|\s*-{3,}/.test(line))
  if (separator === -1) throw new Error('RELEASES.md has no release table (no "| --- |" header row)')

  const existing = lines.findIndex((line, index) => {
    if (index <= separator) return false
    const parts = cells(line)
    // parts[1] and parts[2] are the environment and build either side of the
    // Node column, so an old row and a new one are matched the same way.
    return isReleaseRow(parts) && parts[1] === environment && parts[2].includes(`\`${short}\``)
  })

  if (existing !== -1) {
    // A re-check is not a new deployment: keep the time the release happened.
    const time = cells(lines[existing])[0]
    const kept = row.replace(/^\|[^|]*\|/, `| ${time} |`)
    lines[existing] = kept
    return { markdown: lines.join('\n'), replaced: true, row: kept }
  }

  lines.splice(separator + 1, 0, row)
  return { markdown: lines.join('\n'), replaced: false, row }
}

export interface NewestBuild {
  short: string
  environment: string
  at: string
  /**
   * The tag cell as written: a tag name, or `—` when no tag describes the
   * build. Empty only when the row predates the column, which the release
   * check treats as something to re-log rather than as a build with no tag.
   */
  tag: string
  /**
   * The Node cell as logged, or empty when the row records none: a row written
   * before the column, or a dash written by a stamp that had no runtime.
   */
  node: string
}

/** The build in the first data row: the most recent deployment logged. */
export function newestBuild(markdown: string): NewestBuild | null {
  const lines = markdown.split('\n')
  const separator = lines.findIndex((line) => /^\|\s*-{3,}/.test(line))
  if (separator === -1) return null
  for (let index = separator + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.startsWith('|')) break
    const parts = cells(line)
    if (!isReleaseRow(parts)) continue
    const match = parts[2].match(/`([0-9a-f]{6,64})` — /)
    if (!match) continue
    const tag = parts.length === COLUMNS ? parts[3] : ''
    const node = nodeCell(parts)
    return { short: match[1], environment: parts[1], at: parts[0], tag, node: node === RUNTIME_UNKNOWN ? '' : node }
  }
  return null
}

/** One line that says whether the build on disk is the build that was logged. */
export function statusFor(markdown: string, stamp: Stamp | null): string {
  const newest = newestBuild(markdown)
  if (!stamp && !newest) return `${STATUS} no build in \`dist/\` and no deployment logged yet.`
  if (!stamp) return `${STATUS} no build in \`dist/\`; the newest logged build is \`${newest?.short}\` (${newest?.environment}, ${newest?.at}).`
  // The hash only: builtAt changes on every rebuild of the same inputs, so it
  // cannot be part of a line that a fresh CI build has to reproduce.
  const built = `\`dist/build.json\` is \`${shortHash(stamp)}\``
  if (!newest) return `${STATUS} ${built} and no deployment has been logged yet.`
  if (newest.short === shortHash(stamp)) return `${STATUS} ${built}, which matches the newest logged build.`
  return `${STATUS} ${built}, but the newest logged build is \`${newest.short}\` (${newest.environment}, ${newest.at}) — this build has not been deployed and logged.`
}

/** Put the status line above the table, replacing it if it is already there. */
export function withStatus(markdown: string, stamp: Stamp | null): string {
  const lines = markdown.split('\n')
  const status = statusFor(markdown, stamp)
  const existing = lines.findIndex((line) => line.startsWith(STATUS))
  if (existing !== -1) {
    lines[existing] = status
    return lines.join('\n')
  }
  const header = lines.findIndex((line) => /^\|\s*Deployed\b/.test(line))
  if (header === -1) return markdown
  lines.splice(header, 0, status, '')
  return lines.join('\n')
}

/** Refresh the status line in an existing log; null when there is no log. */
export function refreshStatusFile(root: string = ROOT, file?: string): { status: string; changed: boolean } | null {
  const logPath = file ?? join(root, 'RELEASES.md')
  if (!existsSync(logPath)) return null
  const before = readFileSync(logPath, 'utf8')
  const stamp = readStamp(root)
  const status = statusFor(before, stamp)
  const after = withStatus(before, stamp)
  if (after !== before) writeFileSync(logPath, after)
  return { status, changed: after !== before }
}

export interface VerifyResult {
  ok: boolean
  logPath: string
  build: string | null
  newest: NewestBuild | null
  status: string
  problems: string[]
}

/**
 * Read-only release check for CI: the newest logged build must be the build in
 * dist/, and the status line must be the one that comparison would write. A
 * freshly written mismatch line is still a failure — the flag being honest does
 * not make an unlogged build publishable.
 */
export function verifyLog(root: string = ROOT, file?: string): VerifyResult {
  const logPath = file ?? join(root, 'RELEASES.md')
  const stamp = readStamp(root)
  const build = stamp ? shortHash(stamp) : null

  if (!existsSync(logPath)) {
    return { ok: false, logPath, build, newest: null, status: statusFor('', stamp), problems: [`${display(logPath)} is missing.`] }
  }

  const markdown = readFileSync(logPath, 'utf8')
  const newest = newestBuild(markdown)
  const status = statusFor(markdown, stamp)
  const problems: string[] = []

  if (!stamp) problems.push('no build in dist/ (dist/build.json is missing) — run npm run release.')
  if (!newest) problems.push('no deployment is logged in the release table.')
  if (build && newest && newest.short !== build) {
    problems.push(`dist/build.json is \`${build}\` but the newest logged build is \`${newest.short}\` (${newest.environment}, ${newest.at}).`)
  }
  // The row for the build in dist/ has to say which Node produced it. A stamp
  // without a runtime cannot produce such a row, and the gate refuses those, so
  // an empty Node cell here means the row predates the column or was edited.
  if (build && newest && newest.short === build && !newest.node) {
    problems.push(
      `the newest logged row for \`${build}\` (${newest.environment}, ${newest.at}) does not record the Node that built it — re-log the deployment to fill the column.`,
    )
  }
  // The tag column has to be there for the current build too. A dash passes —
  // plenty of builds ship before any tag exists — but a row from before the
  // column, or one someone trimmed, says nothing about what version shipped.
  if (build && newest && newest.short === build && !newest.tag) {
    problems.push(
      `the newest logged row for \`${build}\` (${newest.environment}, ${newest.at}) does not record the release tag — re-log the deployment to fill the column.`,
    )
  }

  const line = markdown.split('\n').find((entry) => entry.startsWith(STATUS))
  if (!line) problems.push('the build status line is missing — run npm run release:log -- --status.')
  else if (line.trim() !== status) problems.push(`the build status line is stale — it should read: ${status}`)

  return { ok: problems.length === 0, logPath, build, newest, status, problems }
}

export interface RecordInput {
  environment: Environment
  url?: string
  at?: string
  file?: string
  /** Resolved from git when omitted; a test can name one instead. */
  tag?: string
}

export interface RecordResult {
  environment: Environment
  url: string
  row: string
  checks: Check[]
  logPath: string
  replaced: boolean
}

/**
 * Smoke the deployment, then log it. The row is written even when the smoke
 * test fails — a failed release belongs in the record — and the caller decides
 * the exit code from `checks`.
 */
export async function record(input: RecordInput): Promise<RecordResult> {
  if (!ENVIRONMENTS.includes(input.environment)) throw new Error(`Unknown environment "${input.environment}". Use preview or production.`)

  const stamp = readStamp(ROOT)
  if (!stamp) throw new Error('No build in dist/ (no build.json). Run npm run release first.')

  const url = input.url ?? URLS[input.environment]
  const logPath = resolve(input.file ?? LOG_PATH)
  const checks = await smoke(url)
  const row = rowFor({ environment: input.environment, stamp, checks, at: input.at, tag: input.tag ?? resolveTag(ROOT) })
  const placed = place(readFileSync(logPath, 'utf8'), row, input.environment, shortHash(stamp))
  writeFileSync(logPath, withStatus(placed.markdown, stamp))

  return { environment: input.environment, url, row: placed.row, checks, logPath, replaced: placed.replaced }
}

function display(path: string): string {
  const inside = relative(ROOT, path)
  return inside && !inside.startsWith('..') ? inside : path
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const args = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`)
    if (index >= 0) return args[index + 1]
    return args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  }

  const environment = args.find((arg) => !arg.startsWith('-')) as Environment | undefined
  if (args.includes('--verify')) {
    const verdict = verifyLog(ROOT, resolve(flag('file') ?? LOG_PATH))
    console.log('Red Queen release check')
    console.log(`  log     ${display(verdict.logPath)}`)
    console.log(`  build   ${verdict.build ?? 'none'}`)
    console.log(`  newest  ${verdict.newest ? `${verdict.newest.short} (${verdict.newest.environment}, ${verdict.newest.at})` : 'none'}`)
    // The runtime the deployment was logged with, not the one running this check.
    if (verdict.newest) console.log(`  runtime ${verdict.newest.node || 'not recorded'}`)
    if (verdict.newest) console.log(`  tag     ${verdict.newest.tag || 'not recorded'}`)
    console.log('')
    if (verdict.ok) {
      console.log(`  ok      ${verdict.status.replace(`${STATUS} `, '')}`)
      process.exitCode = 0
    } else {
      for (const problem of verdict.problems) console.error(`  FAIL    ${problem}`)
      console.error('')
      console.error('  Release record does not match the build. Deploy and log this build, or rebuild the logged one.')
      process.exitCode = 1
    }
  } else if (args.includes('--status')) {
    const refreshed = refreshStatusFile(ROOT, resolve(flag('file') ?? LOG_PATH))
    if (!refreshed) {
      console.error('No RELEASES.md to update.')
      process.exitCode = 1
    } else {
      console.log(refreshed.status.slice(STATUS.length).trim())
      process.exitCode = 0
    }
  } else if (!environment || !ENVIRONMENTS.includes(environment)) {
    console.error(`Usage: npm run release:log -- ${ENVIRONMENTS.join('|')} [--url URL] [--at "YYYY-MM-DD HH:MM"] [--file PATH]`)
    console.error('       npm run release:log -- --status [--file PATH]')
    process.exitCode = 2
  } else {
    const started = performance.now()
    try {
      const result = await record({ environment, url: flag('url'), at: flag('at'), file: flag('file') })
      const passed = result.checks.filter((check) => check.ok).length
      const failed = result.checks.filter((check) => !check.ok)
      console.log('Red Queen release log')
      console.log(`  target  ${result.url}`)
      console.log(`  result  ${passed}/${result.checks.length} checks passed in ${((performance.now() - started) / 1000).toFixed(1)} s`)
      console.log(`  logged  ${display(result.logPath)} (${result.replaced ? 'updated the existing row' : 'new row at the top'})`)
      console.log('')
      console.log(`  ${result.row}`)
      if (failed.length > 0) {
        console.log('')
        for (const check of failed) console.log(`  failed  ${check.name}  ${check.detail}`)
      }
      process.exitCode = failed.length === 0 ? 0 : 1
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
