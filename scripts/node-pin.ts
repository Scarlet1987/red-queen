// The runtime pin. `.nvmrc` names one Node version and `package.json`'s
// `engines` range is supposed to accept it; nothing in npm enforces that, and
// nothing at all records which runtime actually produced a build. Both the pin
// test and the deploy gate need the same answer to "is this runtime the pinned
// one?", so the reading and comparison live here rather than in a test file.
//
// The range reader is a deliberate subset of npm's semver: the forms this
// repository uses, plus an explicit refusal for anything else. An unreadable
// range or pin is a failure, never a silent pass, because a check that cannot
// read the pin would rot exactly the way the pin does.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Version {
  major: number
  minor: number
  patch: number
}

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string }

type Test = (version: Version) => boolean

const WILDCARD = /^[xX*]$/

const isWildcard = (part: string | undefined): boolean => part === undefined || WILDCARD.test(part)

const compare = (a: Version, b: Version): number =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch

const at = (major: number, minor = 0, patch = 0): Version => ({ major, minor, patch })

export const show = (version: Version): string => `${version.major}.${version.minor}.${version.patch}`

/** Read a pin such as `24`, `v24.17` or `24.17.0`. Only a numbered version is accepted. */
export function readPin(text: string): Result<Version> {
  const value = text.trim()
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value)
  if (!match) {
    return {
      ok: false,
      reason: `${JSON.stringify(value)} is not a numbered version — pin an exact one (24, 24.17 or 24.17.0) so the engine range, the workflows and a build's own runtime can be compared against it`,
    }
  }
  return { ok: true, value: at(Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)) }
}

const PART = /^(>=|<=|>|<|=|\^|~)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?\s*$/

/** Turn one comparator such as `>=24`, `^24.17.0` or `24.x` into a predicate. */
function comparator(token: string): Test | null {
  if (token === '*') return () => true
  const match = PART.exec(token)
  if (!match) return null
  const [, operator = '', majorText, minorText, patchText] = match

  // A wildcard major is only meaningful on its own (`*`, handled above).
  if (isWildcard(majorText)) return null

  const major = Number(majorText)
  const minor = isWildcard(minorText) ? null : Number(minorText)
  const patch = isWildcard(patchText) ? null : Number(patchText)
  const low = at(major, minor ?? 0, patch ?? 0)

  switch (operator) {
    case '>=':
      return (version) => compare(version, low) >= 0
    case '>':
      return (version) => compare(version, low) > 0
    case '<':
      return (version) => compare(version, low) < 0
    case '<=':
      return (version) => compare(version, low) <= 0
    case '=':
      return (version) => compare(version, low) === 0
    case '^': {
      // Caret holds the leftmost non-zero part: ^24 and ^24.1 both stay under 25,
      // ^0.2 stays under 0.3.
      const high = major > 0 ? at(major + 1) : (minor ?? 0) > 0 ? at(0, (minor ?? 0) + 1) : at(0, 0, (patch ?? 0) + 1)
      return (version) => compare(version, low) >= 0 && compare(version, high) < 0
    }
    case '~': {
      // Tilde holds the minor, so ~24.17.0 stays under 24.18.
      const high = minor === null ? at(major + 1) : at(major, minor + 1)
      return (version) => compare(version, low) >= 0 && compare(version, high) < 0
    }
    default:
      // A bare version is an x-range: 24 means 24.x, 24.17 means 24.17.x.
      if (minor === null) return (version) => version.major === major
      if (patch === null) return (version) => version.major === major && version.minor === minor
      return (version) => compare(version, low) === 0
  }
}

/** Read an engines range into one predicate per `||` alternative. */
function readRange(text: string): Result<Test[]> {
  const alternatives: Test[] = []
  for (const alternative of text.split('||')) {
    const tests: Test[] = []
    for (const token of alternative.trim().split(/\s+/).filter(Boolean)) {
      const test = comparator(token)
      if (!test) {
        return {
          ok: false,
          reason: `"${token}" is outside the subset this check reads — use comparators, a caret or tilde, or an x-range (for example ">=24", "^24.17.0", ">=24 <26")`,
        }
      }
      tests.push(test)
    }
    if (!tests.length) return { ok: false, reason: `"${text}" has an empty alternative` }
    alternatives.push((version) => tests.every((test) => test(version)))
  }
  return { ok: true, value: alternatives }
}

/** Whether a version falls inside a range, refusing any range it cannot read. */
export function accepts(range: string, version: Version): Result<boolean> {
  const alternatives = readRange(range)
  if (!alternatives.ok) return alternatives
  return { ok: true, value: alternatives.value.some((test) => test(version)) }
}

export interface PinConfig {
  /** The pin file's text, e.g. `24`. */
  text: string
  pin: Version
  engine: string
}

/**
 * Read the pin and the engine range this build is supposed to run under. A
 * missing pin or range is a refusal: neither the workflows nor the gate can
 * verify a runtime nobody wrote down.
 */
export function readPinConfig(root: string): Result<PinConfig> {
  let text: string
  try {
    text = readFileSync(join(root, '.nvmrc'), 'utf8')
  } catch {
    return { ok: false, reason: `there is no .nvmrc in ${root}, so no runtime is pinned` }
  }

  const pin = readPin(text)
  if (!pin.ok) return pin

  let engine: unknown
  try {
    engine = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { engines?: { node?: unknown } }).engines?.node
  } catch {
    return { ok: false, reason: 'package.json is missing or unreadable, so its engines.node cannot be checked against .nvmrc' }
  }
  if (typeof engine !== 'string' || engine.trim() === '') {
    return { ok: false, reason: 'package.json has no engines.node, so npm cannot warn when a checkout runs the wrong Node' }
  }

  return { ok: true, value: { text: text.trim(), pin: pin.value, engine } }
}
