import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// A public repository's licence is a promise, so it is worth a test: the file
// must be the real MIT text and name a holder, the README must say the same
// thing, and package.json must never quietly disagree with it.
const repo = fileURLToPath(new URL('..', import.meta.url))
const licensePath = join(repo, 'LICENSE')

function licenseText(): string {
  assert.ok(existsSync(licensePath), 'LICENSE is missing: the repository is public and MIT')
  return readFileSync(licensePath, 'utf8')
}

test('LICENSE is the MIT text and names a copyright holder', () => {
  const text = licenseText()
  assert.match(text.trimStart(), /^MIT License/)
  assert.match(text, /Copyright \(c\) \d{4} \S+/, 'the copyright line must name a holder and a year')
  // The two clauses that make MIT MIT, rather than a similar-looking notice.
  assert.match(text, /permission is hereby granted, free of charge/i)
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/)
  assert.match(text, /The above copyright notice and this permission notice shall be included in all/)
})

test('the README states the licence, links the file and scopes it to this program', () => {
  const readme = readFileSync(join(repo, 'README.md'), 'utf8')
  const section = readme.split(/^## Licence$/m)[1]
  assert.ok(section, 'README has no "## Licence" section')
  assert.match(section, /\*\*MIT\*\*/)
  assert.match(section, /\[LICENSE\]\(LICENSE\)/, 'the section must link the licence file')
  // The catalogue points at other people's tools; their licences are not ours.
  assert.match(section, /not the tools it lists/)
})

test('package.json never contradicts LICENSE', () => {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { license?: string }
  // It is absent on purpose: package.json is a build input, and the licence is
  // not something a rebuild should be needed to change. If it appears, it has
  // to agree with the file that everyone actually reads.
  if (pkg.license !== undefined) {
    assert.equal(pkg.license, 'MIT', 'package.json declares a licence that LICENSE does not')
    assert.match(licenseText(), /^MIT License/)
  }
})
