// The footer names the release a copy is running, from constants baked in at
// build time. These cover the three things that label can say, including the
// untagged case a development build must not dress up as a release.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RELEASE_TAG, RELEASE_VERSION, releaseLabel } from '../src/app/lib/release.ts'

test('a tagged build names its version and its tag', () => {
  assert.equal(releaseLabel('1.0.1', 'v1.0.1'), '1.0.1 · v1.0.1')
})

test('an untagged build says so rather than implying a release', () => {
  assert.equal(releaseLabel('1.0.1', ''), '1.0.1 · untagged build')
})

test('a bundle built without the defines reports itself instead of going blank', () => {
  assert.equal(releaseLabel('', ''), 'Unstamped build')
})

// Node imports this module with no build step, so the identifiers are absent:
// the constants have to fall back rather than throw, which is exactly the path a
// misconfigured bundle would take.
test('the module survives an unstamped import', () => {
  assert.equal(RELEASE_VERSION, '')
  assert.equal(RELEASE_TAG, '')
  assert.equal(releaseLabel(), 'Unstamped build')
})
