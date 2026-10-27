import assert from 'node:assert/strict'
import { test } from 'node:test'

import { cleanHostView } from '../src/app/lib/host.ts'
import {
  HOSTED_CELL,
  HOST_UNAVAILABLE,
  blacklistSummary,
  hostRuleLabels,
  hostUnavailable,
  hostView,
  summarizeHost,
  unavailableReason,
  type HostReport,
} from '../src/lib/host-view.ts'
import app from '../src/worker/index.ts'

// The sweep itself is covered in tests/host.test.ts, against fixture trees. What
// is covered here is the reading of its report, which is what /api/host answers
// with and what the COS-G panel renders. It has three answers to get right: a
// machine that was read, a machine the sweep could not open, and no machine at
// all — and the three must not be confused for each other.

function report(overrides: Partial<HostReport> = {}): HostReport {
  return {
    available: true,
    reason: '',
    kernel: '7.2.6',
    devices: [
      { slot: '0000:0b:00.0', kind: 'display', name: 'Navi 10', driver: 'amdgpu', module: 'amdgpu', modalias: 'pci:v00001002' },
      { slot: '0000:6f:00.0', kind: 'network', name: 'RTL8125', driver: null, module: null, modalias: 'pci:v000010EC' },
    ],
    blacklists: [{ module: 'r8125', file: '/etc/modprobe.d/blacklist-r8125.conf', line: 3 }],
    loaded: [
      { name: 'amdgpu', used: 4, dependents: [] },
      { name: 'r8169', used: 0, dependents: [] },
    ],
    dkms: [{ name: 'r8125', version: '9.011.01', path: '/var/lib/dkms/r8125/9.011.01', conf: true, built: ['7.2.6'], modules: ['r8125'], exclusive: { min: '', max: '' } }],
    findings: [
      { rule: 'blacklisted-driver', severity: 'info', message: 'r8169 is blacklisted; the device is served by r8125.' },
      { rule: 'unbound-hardware', severity: 'warn', message: '0000:6f:00.0 RTL8125 (network) has no driver bound.' },
    ],
    ...overrides,
  }
}

test('the view counts what was looked at and carries the same cell a release row holds', () => {
  const view = hostView(report(), 'metal')
  assert.equal(view.available, true)
  assert.equal(view.mode, 'metal')
  assert.equal(view.kernel, '7.2.6')
  assert.equal(view.reason, '')
  assert.equal(view.cell, summarizeHost(report()).cell)
  assert.equal(view.cell, '1 warning — unbound-hardware on 7.2.6')
  // The counts are the sweep's reach, not a tally of unclaimed bridges: a device
  // with no driver is ordinary unless a finding names it.
  assert.deepEqual(view.counts, { devices: 2, blacklisted: 1, loaded: 2, dkms: 1 })
})

test('warnings lead the list, so the top of the panel is what has a remedy', () => {
  const view = hostView(report(), 'metal')
  assert.deepEqual(
    view.findings.map((finding) => finding.rule),
    ['unbound-hardware', 'blacklisted-driver'],
  )
  // Order within a severity is the sweep's own, which is where the findings sit
  // in the CLI report too.
  const info = view.findings.filter((finding) => finding.severity === 'info')
  assert.equal(info.length, 1)
})

test('a machine the sweep could not open is unavailable with the reason, never clean', () => {
  const blind = report({
    available: false,
    reason: '/sys/bus/pci/devices is not readable — the host sweep needs Linux sysfs.',
    devices: [],
    blacklists: [],
    loaded: [],
    dkms: [],
    findings: [],
  })
  const view = hostView(blind, 'metal')
  assert.equal(view.available, false)
  assert.equal(view.cell, HOST_UNAVAILABLE)
  assert.match(view.reason, /needs Linux sysfs/)
  assert.doesNotMatch(view.reason, /sandbox/)
  assert.deepEqual(view.counts, { devices: 0, blacklisted: 0, loaded: 0, dkms: 0 })
  assert.deepEqual(view.findings, [])
})

test('a sandbox install blames its confinement rather than claiming the host is clean', () => {
  const blind = report({ available: false, reason: '/sys/bus/pci/devices is not readable — the host sweep needs Linux sysfs.', devices: [], findings: [] })
  const view = hostView(blind, 'sandbox')
  assert.equal(view.available, false)
  assert.match(view.reason, /sandbox install/)
  assert.match(view.reason, /confines the server to its own directory/)
  assert.match(view.reason, /needs Linux sysfs/, 'the original reason is kept, not replaced')
  // The same sentence is used for a sweep that failed outright, so the two ways
  // a sandbox copy can end up blind read alike.
  assert.match(unavailableReason('The sweep could not run: access denied', 'sandbox'), /sandbox install/)
  assert.equal(unavailableReason('nothing readable', 'metal'), 'nothing readable')
})

test('a hosted copy is unavailable in the same shape, not an error and not a claim about a host', () => {
  const view = hostUnavailable('hosted', 'no machine here', HOSTED_CELL)
  assert.equal(view.available, false)
  assert.equal(view.mode, 'hosted')
  assert.equal(view.kernel, '')
  assert.equal(view.cell, HOSTED_CELL)
  assert.equal(view.reason, 'no machine here')
  assert.deepEqual(view.findings, [])
  assert.deepEqual(view.counts, { devices: 0, blacklisted: 0, loaded: 0, dkms: 0 })
})

test('every rule a finding can carry has a label for the panel to print', () => {
  const rules = ['unbound-hardware', 'blacklisted-driver', 'blacklist-ineffective', 'idle-driver', 'stale-dkms', 'dkms-not-built']
  for (const rule of rules) {
    assert.ok(hostRuleLabels[rule as keyof typeof hostRuleLabels], `${rule} has no label`)
  }
  assert.equal(Object.keys(hostRuleLabels).length, rules.length)
})

test('the blacklist line counts files rather than printing a distro’s worth of modules', () => {
  assert.equal(blacklistSummary([]), 'no blacklisted modules')
  assert.equal(
    blacklistSummary([
      { module: 'r8169', file: '/etc/modprobe.d/blacklist.conf', line: 1 },
      { module: 'floppy', file: '/etc/modprobe.d/blacklist.conf', line: 2 },
      { module: 'pcspkr', file: '/etc/modprobe.d/sound.conf', line: 1 },
    ]),
    '3 modules in 2 files — blacklist.conf (2), sound.conf (1)',
  )
})

test('a remedy arrives from the server whole, and one that says nothing is dropped', () => {
  const view = cleanHostView({
    available: true,
    reason: '',
    mode: 'metal',
    kernel: '7.2.6',
    cell: '2 warnings — idle-driver on 7.2.6',
    counts: { devices: 2, blacklisted: 0, loaded: 2, dkms: 0 },
    findings: [
      {
        rule: 'idle-driver',
        severity: 'warn',
        message: 'nouveau is loaded but driving nothing here.',
        remedy: { command: 'sudo rmmod nouveau', root: true },
      },
      // A remedy with no command is not an empty button to render.
      { rule: 'idle-driver', severity: 'warn', message: 'and another.', remedy: { command: '   ' } },
      // A command whose root claim cannot be read keeps the command and drops
      // the claim, rather than telling someone an app will not run for them.
      { rule: 'idle-driver', severity: 'warn', message: 'a third.', remedy: { command: 'rmmod nouveau' } },
      // A server answering with prose where an object goes is no remedy either.
      { rule: 'idle-driver', severity: 'warn', message: 'a fourth.', remedy: 'sudo rmmod nouveau' },
    ],
  })
  assert.ok(view, 'the answer did not pass the panel’s validation')
  assert.deepEqual(
    view.findings.map((finding) => finding.remedy),
    [
      { command: 'sudo rmmod nouveau', root: true },
      undefined,
      { command: 'rmmod nouveau', root: false },
      undefined,
    ],
  )
})

// --- the route -------------------------------------------------------------
//
// The hosted Worker has no filesystem, so this route is the one place a machine
// could be invented or a request could fall through to the assets binding, where
// the single-page fallback answers index.html and the panel is left guessing.

test('the hosted copy answers /api/host with a JSON view that says why it has no machine', async () => {
  const response = await app.request('/api/host')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  const body = (await response.json()) as Record<string, unknown>
  assert.equal(body.available, false)
  assert.equal(body.mode, 'hosted')
  assert.equal(body.cell, HOSTED_CELL)
  assert.deepEqual(body.findings, [])
  assert.match(String(body.reason), /no filesystem/)

  // The answer the page receives is one its own validator accepts.
  const view = cleanHostView(body)
  assert.ok(view, 'the hosted answer did not pass the panel’s validation')
  assert.equal(view.available, false)
  assert.match(view.reason, /no machine to read/)
})
