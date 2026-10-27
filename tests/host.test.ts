import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { scanHost } from '../scripts/host-scan.ts'
import { blacklistSummary, hostRuleLabels, summarizeHost, type HostFinding, type HostReport } from '../src/lib/host-view.ts'

// The host sweep reads real sysfs, /etc/modprobe.d and /var/lib/dkms by default.
// Every test here points it at a throwaway tree shaped the way Linux shapes the
// real ones, so a fixture can say "this NIC is unbound and its driver is
// blacklisted" without needing that machine.
const repo = fileURLToPath(new URL('..', import.meta.url))
const cli = join(repo, 'scripts', 'cosg.ts')
const scratch: string[] = []

const GPU_MODALIAS = 'pci:v00001002d000067DFsv00001DA2sd0000E366bc03sc00i00'
const NIC_MODALIAS = 'pci:v000010ECd00008125sv00001043sd000087D7bc02sc00i00'

const ALIASES = [
  'alias pci:v00001002d000067DFsv*sd*bc*sc*i* amdgpu',
  'alias pci:v000010ECd00008125sv*sd*bc*sc*i* r8125',
  'alias pci:v000010ECd00008125sv*sd*bc*sc*i* r8169',
].join('\n')

function fixture(files: Record<string, string>, links: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-host-'))
  scratch.push(root)
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  for (const [path, target] of Object.entries(links)) {
    const abs = join(root, path)
    mkdirSync(dirname(abs), { recursive: true })
    symlinkSync(target, abs)
  }
  return root
}

/** The sysfs attributes the sweep reads, per PCI slot. */
function device(slot: string, klass: string, vendor: string, deviceId: string, modalias: string) {
  return {
    [`sys/${slot}/class`]: `0x${klass}\n`,
    [`sys/${slot}/vendor`]: `0x${vendor}\n`,
    [`sys/${slot}/device`]: `0x${deviceId}\n`,
    [`sys/${slot}/modalias`]: `${modalias}\n`,
  }
}

function scan(root: string) {
  return scanHost({
    pci: join(root, 'sys'),
    modprobe: join(root, 'etc', 'modprobe.d'),
    dkms: join(root, 'var', 'lib', 'dkms'),
    modules: join(root, 'lib', 'modules', '7.2.6'),
    procModules: join(root, 'proc', 'modules'),
    kernel: '7.2.6',
    // No pci.ids in a fixture: the ids stand in, and the test asserts on those.
    ids: [],
  })
}

after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true })
})

test('an unbound NIC whose drivers are both blacklisted is one finding, not three', () => {
  // No `driver` link in the slot at all: that is how sysfs shows a device whose
  // driver has not been bound, and the sweep must not mistake it for a name.
  const root = fixture({
    ...device('0000:6f:00.0', '020000', '10ec', '8125', NIC_MODALIAS),
    'etc/modprobe.d/blacklist-r8125.conf': 'blacklist r8125\n',
    'etc/modprobe.d/r8125.conf': '# the in-tree driver, blocked for the vendor one\nblacklist r8169\n',
    'lib/modules/7.2.6/modules.alias': ALIASES,
  })

  const report = scan(root)
  assert.equal(report.available, true)
  assert.equal(report.devices.length, 1)
  assert.equal(report.devices[0].driver, null)
  assert.equal(report.devices[0].kind, 'network')
  assert.deepEqual(
    report.findings.map((finding) => finding.rule),
    ['blacklisted-driver'],
    'the device is reported once, as a blacklisted driver rather than also as unbound hardware',
  )
  const [finding] = report.findings
  assert.equal(finding.severity, 'warn')
  for (const name of ['0000:6f:00.0', 'r8125', 'r8169', 'blacklist-r8125.conf', 'r8125.conf']) {
    assert.ok(finding.message.includes(name), `the finding names ${name}: ${finding.message}`)
  }
  // The remedy is the paste, not the diagnosis: a blacklist stops alias loading
  // rather than an explicit load, so one of these drives the device regardless
  // of the files that block it. Both candidates are tried, in the sweep's order,
  // because which of them takes depends on hardware the sweep cannot weigh.
  assert.deepEqual(finding.remedy, { command: 'sudo modprobe r8125 || sudo modprobe r8169', root: true })
})

test('bound hardware is reported as bound, and an unclaimed bridge is not a finding', () => {
  const root = fixture(
    {
      ...device('0000:0b:00.0', '030000', '1002', '67df', GPU_MODALIAS),
      ...device('0000:00:01.0', '060400', '1022', '1453', 'pci:v00001022d00001453sv*sd*bc*sc*i*'),
      'lib/modules/7.2.6/modules.alias': ALIASES,
    },
    { 'sys/0000:0b:00.0/driver': '../drivers/amdgpu' },
  )

  const report = scan(root)
  const gpu = report.devices.find((entry) => entry.slot === '0000:0b:00.0')
  assert.equal(gpu?.driver, 'amdgpu')
  assert.equal(gpu?.kind, 'display')
  assert.deepEqual(report.findings, [], 'a bound GPU and an unclaimed bridge need no action')
})

test('hardware with no candidate module and no blacklist says so', () => {
  const root = fixture({
    ...device('0000:6f:00.0', '020000', '10ec', '8125', NIC_MODALIAS),
    'lib/modules/7.2.6/modules.alias': 'alias pci:v00001002d000067DFsv*sd*bc*sc*i* amdgpu\n',
  })

  const [finding] = scan(root).findings
  assert.equal(finding.rule, 'unbound-hardware')
  assert.match(finding.message, /no module in .*lib\/modules\/7\.2\.6 claims it/)
  // Nothing in this kernel claims the device, so there is no load to suggest:
  // a remedy here would be a guess at a module the sweep cannot see.
  assert.equal(finding.remedy, undefined)
})

test('a loaded PCI driver driving nothing on this machine is a ghost', () => {
  const root = fixture(
    {
      ...device('0000:0b:00.0', '030000', '1002', '67df', GPU_MODALIAS),
      // nouveau claims a class of NVIDIA hardware; this machine has none of it.
      'lib/modules/7.2.6/modules.alias': `${ALIASES}\nalias pci:v000010DEd00001C82sv*sd*bc*sc*i* nouveau`,
      'proc/modules': 'nouveau 1234567 0 - Live 0x0\n',
    },
    { 'sys/0000:0b:00.0/driver': '../drivers/amdgpu' },
  )

  const report = scan(root)
  assert.deepEqual(report.findings.map((finding) => finding.rule), ['idle-driver'])
  assert.equal(report.findings[0].severity, 'warn')
  assert.match(report.findings[0].message, /^nouveau is loaded but driving nothing here — its aliases match no device on this machine/)
  assert.match(report.findings[0].message, /rmmod nouveau frees it/)
  assert.deepEqual(report.findings[0].remedy, { command: 'sudo rmmod nouveau', root: true })
})

test('a loaded driver whose hardware another driver serves names what serves it', () => {
  const root = fixture(
    {
      ...device('0000:6f:00.0', '020000', '10ec', '8125', NIC_MODALIAS),
      'lib/modules/7.2.6/modules.alias': ALIASES,
      'proc/modules': 'r8125 1234567 0 - Live 0x0\nr8169 987654 0 - Live 0x0\n',
    },
    { 'sys/0000:6f:00.0/driver': '../drivers/r8125' },
  )

  const report = scan(root)
  assert.deepEqual(report.findings.map((finding) => finding.rule), ['idle-driver'])
  assert.equal(report.findings[0].message.startsWith('r8169 is loaded'), true, 'the bound driver is not the ghost')
  assert.match(report.findings[0].message, /the hardware it claims \(0000:6f:00\.0\) is served by r8125 instead/)
})

test('a driver bound under another name is not called idle, and neither is a module held open', () => {
  const root = fixture(
    {
      ...device('0000:00:1f.4', '0c0500', '8086', 'a323', 'pci:v00008086d0000A323sv*sd*bc*sc*i*'),
      'lib/modules/7.2.6/modules.alias': [
        'alias pci:v00008086d0000A323sv*sd*bc*sc*i* i2c_i801',
        // Claims Intel SPI hardware this machine does not have, but spi_intel
        // depends on it, so it is not a leftover anyone could unload.
        'alias pci:v00008086d0000A0A4sv*sd*bc*sc*i* spi_intel_pci',
        // A USB alias: this sweep reads PCI only, so it is not its business.
        'alias usb:v1D6Bp0002d*dc*dsc*dp*ic*isc*ip* usbhid',
      ].join('\n'),
      'proc/modules': 'i2c_i801 1 0 - Live 0x0\nspi_intel_pci 1 0 - Live 0x0\nspi_intel 1 0 spi_intel_pci, Live 0x0\nusbhid 1 0 - Live 0x0\n',
    },
    {
      // The driver is a symlink into the driver tree, whose own `module` link
      // names the module that provides it.
      'sys/drivers/i801_smbus/module': '../module/i2c_i801',
      'sys/0000:00:1f.4/driver': '../drivers/i801_smbus',
    },
  )

  const report = scan(root)
  assert.deepEqual(report.findings, [], 'no ghost: the module drives the SMBus under a different driver name')
  assert.equal(report.devices[0].driver, 'i801_smbus')
  assert.equal(report.devices[0].module, 'i2c_i801', 'sysfs says which module that driver belongs to')
})

test('a blacklisted module that is loaded anyway is a ghost, not a deliberate block', () => {
  // The block is written, the module is running, and it is running because the
  // driver that does own the NIC pulls it in — the block lost to a dependency.
  const root = fixture(
    {
      ...device('0000:6f:00.0', '020000', '10ec', '8125', NIC_MODALIAS),
      'etc/modprobe.d/blacklist-r8169.conf': 'blacklist r8169\n',
      'lib/modules/7.2.6/modules.alias': ALIASES,
      // r8125's deps field names r8169, so r8169 is the one being pulled in.
      'proc/modules': 'r8125 1234567 0 r8169, Live 0x0\nr8169 987654 1 - Live 0x0\n',
    },
    { 'sys/0000:6f:00.0/driver': '../drivers/r8125' },
  )

  const report = scan(root)
  assert.deepEqual(report.findings.map((finding) => finding.rule), ['blacklist-ineffective'], 'the deliberate-block note is replaced, not doubled')
  const [finding] = report.findings
  assert.equal(finding.severity, 'warn')
  assert.match(finding.message, /^r8169 is blacklisted in blacklist-r8169\.conf but is loaded right now \(pulled in by r8125\)/)
  assert.match(finding.message, /rmmod r8169 once nothing needs it/)
  assert.equal(finding.file?.endsWith('blacklist-r8169.conf'), true, 'the file named is the one that blocks it')
  assert.deepEqual(report.loaded.map((module) => module.name), ['r8125', 'r8169'], 'the loaded table is carried too')
  assert.deepEqual(finding.remedy, { command: 'sudo rmmod r8169', root: true })
})

test('a blacklisted module nothing depends on reports what is holding it', () => {
  const root = fixture(
    {
      ...device('0000:0b:00.0', '030000', '1002', '67df', GPU_MODALIAS),
      'etc/modprobe.d/blacklist.conf': 'blacklist pcspkr\nblacklist floppy\n',
      'lib/modules/7.2.6/modules.alias': ALIASES,
      'proc/modules': 'pcspkr 16384 2 - Live 0x0\n',
    },
    { 'sys/0000:0b:00.0/driver': '../drivers/amdgpu' },
  )

  const report = scan(root)
  assert.deepEqual(report.findings.map((finding) => finding.rule), ['blacklist-ineffective'])
  assert.match(report.findings[0].message, /pcspkr is blacklisted in blacklist\.conf but is loaded right now \(in use by 2\)/)
  assert.ok(!report.findings[0].message.includes('floppy'), 'a block that is working is not reported')
})

test('a blacklist over hardware served by another driver is information, not a fault', () => {
  const root = fixture(
    {
      ...device('0000:6f:00.0', '020000', '10ec', '8125', NIC_MODALIAS),
      'etc/modprobe.d/r8125.conf': 'blacklist r8169\n',
      'lib/modules/7.2.6/modules.alias': ALIASES,
    },
    { 'sys/0000:6f:00.0/driver': '../drivers/r8125' },
  )

  const report = scan(root)
  assert.equal(report.devices[0].driver, 'r8125')
  const [finding] = report.findings
  assert.equal(finding.rule, 'blacklisted-driver')
  assert.equal(finding.severity, 'info')
  assert.equal(finding.file, join(root, 'etc', 'modprobe.d', 'r8125.conf'))
  assert.match(finding.message, /served by r8125/)
  // The block is doing its job — this is the intended setup — so there is
  // nothing to undo and no command to offer.
  assert.equal(finding.remedy, undefined)
})

test('a blacklist file without .conf is ignored, as modprobe ignores it', () => {
  const root = fixture({
    ...device('0000:6f:00.0', '020000', '10ec', '8125', NIC_MODALIAS),
    'etc/modprobe.d/blacklist-r8125': 'blacklist r8125\n',
    'lib/modules/7.2.6/modules.alias': ALIASES,
  })

  const report = scan(root)
  assert.deepEqual(report.blacklists, [])
  assert.equal(report.findings[0].rule, 'unbound-hardware')
})

test('a DKMS record with no source is flagged; a healthy one is listed and left alone', () => {
  const root = fixture(
    {
      'var/lib/dkms/system76/1.0.22~stale/7.0.11/x86_64/module/system76_acpi.ko': '',
      'var/lib/dkms/system76/1.0.22~good/source/dkms.conf': 'PACKAGE_NAME="system76"\n',
      // Ubuntu compresses DKMS modules, so a build that worked ships .ko.zst.
      'var/lib/dkms/system76/1.0.22~good/7.2.6/x86_64/module/system76.ko.zst': '',
      // Bookkeeping dkms writes next to the records: an empty per-kernel marker.
      'var/lib/dkms/system76/kernel-7.2.6-76070206-generic-x86_64/.keep': '',
    },
    { 'sys/0000:0b:00.0/driver': '../drivers/amdgpu' },
  )

  const report = scan(root)
  const stale = report.dkms.find((record) => record.version === '1.0.22~stale')
  const good = report.dkms.find((record) => record.version === '1.0.22~good')
  assert.equal(stale?.conf, false)
  assert.deepEqual(stale?.built, ['7.0.11'])
  assert.equal(good?.conf, true)
  assert.deepEqual(good?.built, ['7.2.6'])

  assert.deepEqual(
    report.dkms.map((record) => record.version),
    ['1.0.22~good', '1.0.22~stale'],
    'the per-kernel marker is not read as a version record',
  )

  const rule = report.findings.filter((finding) => finding.rule === 'stale-dkms')
  assert.equal(rule.length, 1)
  assert.equal(rule[0].severity, 'warn')
  assert.equal(rule[0].file, join(root, 'var', 'lib', 'dkms', 'system76', '1.0.22~stale'))
  assert.match(rule[0].message, /dkms status fails/)
  // Moving the record, not deleting it: the finding is that dkms cannot report,
  // which says nothing about whether the driver is wanted on this machine.
  assert.deepEqual(rule[0].remedy, {
    command: `sudo mkdir -p /var/backups/red-queen && sudo mv ${join(root, 'var', 'lib', 'dkms', 'system76', '1.0.22~stale')} /var/backups/red-queen/`,
    root: true,
  })
})

test('a DKMS package with no build for the running kernel is reported as gone at the next boot', () => {
  const root = fixture(
    {
      // The current version, built for the kernel in use: nothing to say.
      'var/lib/dkms/r8125/9.011.01/source/dkms.conf': 'PACKAGE_NAME="r8125"\n',
      'var/lib/dkms/r8125/9.011.01/7.2.6/x86_64/module/r8125.ko': '',
      // A superseded version that was never rebuilt is harmless while the
      // current one works, so the rule judges the package, not each record.
      'var/lib/dkms/r8125/9.010.00/source/dkms.conf': 'PACKAGE_NAME="r8125"\n',
      'var/lib/dkms/r8125/9.010.00/7.1.5/x86_64/module/r8125.ko': '',
      // A driver stuck on the older kernel: absent after a reboot into 7.2.6.
      'var/lib/dkms/nvidia/550.1/source/dkms.conf': 'PACKAGE_NAME="nvidia"\n',
      'var/lib/dkms/nvidia/550.1/7.1.5/x86_64/module/nvidia.ko.zst': '',
      // Source present but no kernel build at all.
      'var/lib/dkms/ack/1.0/source/dkms.conf': 'PACKAGE_NAME="ack"\n',
      // Sourceless record: already a stale-dkms finding, not a second one.
      'var/lib/dkms/legacy/1.0/7.1.5/x86_64/module/legacy.ko': '',
      ...device('0000:01:00.0', '030000', '1002', '67df', GPU_MODALIAS),
    },
    { 'sys/0000:01:00.0/driver': '../drivers/amdgpu' },
  )

  const report = scan(root)
  const notBuilt = report.findings.filter((finding) => finding.rule === 'dkms-not-built')
  assert.equal(notBuilt.length, 2, 'one finding per package, not per version or per kernel')

  const nvidia = notBuilt.find((finding) => finding.message.includes('nvidia'))
  assert.ok(nvidia, 'the driver pinned to the older kernel is reported')
  assert.equal(nvidia.severity, 'warn')
  assert.match(nvidia.message, /built for 7\.1\.5 but not for 7\.2\.6/)
  assert.match(nvidia.message, /after a reboot into 7\.2\.6 it will not be there/)
  // One command for the whole machine, not one per package: this is the command
  // that rebuilds every record the source is still there for.
  assert.deepEqual(nvidia.remedy, { command: 'sudo dkms autoinstall', root: true })

  const ack = notBuilt.find((finding) => finding.message.includes('ack'))
  assert.ok(ack, 'a package that was never built is reported too')
  assert.match(ack.message, /never been built for any kernel/)

  assert.ok(!notBuilt.some((finding) => /r8125|legacy/.test(finding.message)), 'a working or already-broken package is not repeated')
  assert.deepEqual(
    report.findings.filter((finding) => finding.rule === 'stale-dkms').map((finding) => finding.file?.split('/').slice(-2).join('/')),
    ['legacy/1.0'],
  )
})

test('a package whose module the kernel itself carries is redundant, not missing', () => {
  const root = fixture(
    {
      // The platform driver moved into the kernel: the package excludes 7.2 by
      // its own rule, and the kernel tree ships system76_acpi.ko, so warning
      // that it will not survive the next boot would simply be untrue.
      'var/lib/dkms/system76_acpi/1.0.2/source/dkms.conf':
        'PACKAGE_NAME="system76_acpi"\nBUILT_MODULE_NAME[0]="system76_acpi"\nBUILD_EXCLUSIVE_KERNEL_MAX=7.1\n',
      // A copy under updates/ is something DKMS installed, not the kernel
      // carrying it, so this package is still reported.
      'var/lib/dkms/foo/1.0/source/dkms.conf': 'PACKAGE_NAME="foo"\nBUILT_MODULE_NAME[0]="foo"\n',
      // Real modules.dep lines are absolute; the DKMS-installed copy of foo sits
      // under updates/, which is what makes it not the kernel carrying it.
      'lib/modules/7.2.6/modules.dep':
        '/lib/modules/7.2.6/kernel/drivers/platform/x86/system76_acpi.ko.zst:\n/lib/modules/7.2.6/updates/dkms/foo.ko.zst:\n',
      ...device('0000:01:00.0', '030000', '1002', '67df', GPU_MODALIAS),
    },
    { 'sys/0000:01:00.0/driver': '../drivers/amdgpu' },
  )

  const report = scan(root)
  assert.deepEqual(
    report.findings.map((finding) => finding.rule),
    ['dkms-not-built'],
    'only the package the kernel does not carry is reported',
  )
  assert.equal(report.findings[0].severity, 'warn')
  assert.match(report.findings[0].message, /^DKMS module foo /)

  // The record's own claim about itself is carried into the report, which is
  // what the rule reads to tell a missing build from one nobody asked for.
  const record = report.dkms.find((entry) => entry.name === 'system76_acpi')
  assert.deepEqual(record?.modules, ['system76_acpi'])
  assert.deepEqual(record?.exclusive, { min: '', max: '7.1' })
})

test('a package that excludes this kernel by its own rule is a note, not a warning', () => {
  const root = fixture(
    {
      'var/lib/dkms/system76/1.0.22/source/dkms.conf':
        'PACKAGE_NAME="system76"\nBUILT_MODULE_NAME[0]="system76"\nBUILD_EXCLUSIVE_KERNEL_MIN=6.0\nBUILD_EXCLUSIVE_KERNEL_MAX=7.1\n',
      ...device('0000:01:00.0', '030000', '1002', '67df', GPU_MODALIAS),
    },
    { 'sys/0000:01:00.0/driver': '../drivers/amdgpu' },
  )

  const report = scan(root)
  const [finding] = report.findings
  assert.equal(finding.rule, 'dkms-not-built')
  assert.equal(finding.severity, 'info', 'a build that was never asked for is not a failure')
  assert.match(finding.message, /BUILD_EXCLUSIVE_KERNEL_MIN=6\.0 and MAX=7\.1/)
  assert.match(finding.message, /nothing to rebuild/)
  assert.equal(finding.remedy, undefined, 'a build nobody asked for cannot be rebuilt')

  // A note is not a warning: the cell a release row carries counts warnings.
  assert.equal(summarizeHost(report).cell, 'clean — 1 device on 7.2.6')
})

test('a kernel inside the declared range keeps the warning, because dkms owed a build', () => {
  // MIN=7.2 with 7.2.6 running: inside the range, so nothing excused the absent
  // build and the warning stands.
  const root = fixture(
    {
      'var/lib/dkms/foo/1.0/source/dkms.conf': 'PACKAGE_NAME="foo"\nBUILT_MODULE_NAME[0]="foo"\nBUILD_EXCLUSIVE_KERNEL_MIN=7.2\n',
      ...device('0000:01:00.0', '030000', '1002', '67df', GPU_MODALIAS),
    },
    { 'sys/0000:01:00.0/driver': '../drivers/amdgpu' },
  )

  const report = scan(root)
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0].severity, 'warn')
  assert.match(report.findings[0].message, /never been built for any kernel/)
})

test('the blacklist summary counts files instead of listing a distro s worth of modules', () => {
  const entries = [
    { module: 'r8169', file: '/etc/modprobe.d/r8125.conf', line: 1 },
    { module: 'floppy', file: '/etc/modprobe.d/blacklist.conf', line: 4 },
    { module: 'pcspkr', file: '/etc/modprobe.d/blacklist.conf', line: 46 },
  ]
  assert.equal(blacklistSummary([]), 'no blacklisted modules')
  assert.equal(
    blacklistSummary(entries),
    '3 modules in 2 files — blacklist.conf (2), r8125.conf (1)',
  )
  assert.match(blacklistSummary(entries, 1), /and 1 more file$/)
})

test('a machine without PCI sysfs is skipped, not guessed at', () => {
  const root = fixture({ 'etc/modprobe.d/blacklist.conf': 'blacklist floppy\n' })
  const report = scan(root)
  assert.equal(report.available, false)
  assert.match(report.reason, /needs Linux sysfs/)
  assert.deepEqual(report.findings, [])
})

test('a quiet machine summarises as clean, naming the kernel and how much was looked at', () => {
  const root = fixture(
    {
      ...device('0000:0b:00.0', '030000', '1002', '67df', GPU_MODALIAS),
      'lib/modules/7.2.6/modules.alias': ALIASES,
    },
    { 'sys/0000:0b:00.0/driver': '../drivers/amdgpu' },
  )

  const summary = summarizeHost(scan(root))
  assert.equal(summary.cell, 'clean — 1 device on 7.2.6')
  assert.deepEqual(summary.warnings, [])
})

test('the summary counts warnings by rule, names the kernel, and collapses repeats', () => {
  const root = fixture({
    ...device('0000:6f:00.0', '020000', '10ec', '8125', NIC_MODALIAS),
    'etc/modprobe.d/blacklist-r8125.conf': 'blacklist r8125\n',
    'lib/modules/7.2.6/modules.alias': ALIASES,
  })

  const summary = summarizeHost(scan(root))
  assert.equal(summary.cell, '1 warning — blacklisted-driver on 7.2.6')
  assert.equal(summary.warnings.length, 1)

  // Two findings of one rule are one rule in the cell: the count carries the
  // size, the rule names the kind, and the console prints the detail.
  const warn = (rule: HostFinding['rule']): HostFinding => ({ rule, severity: 'warn', message: rule })
  const report: HostReport = {
    available: true,
    reason: '',
    kernel: '7.2.6',
    devices: [],
    blacklists: [],
    loaded: [],
    dkms: [],
    findings: [warn('dkms-not-built'), warn('dkms-not-built'), warn('unbound-hardware')],
  }
  assert.equal(summarizeHost(report).cell, '3 warnings — dkms-not-built, unbound-hardware on 7.2.6')
})

test('a machine the sweep could not read summarises as unavailable, not clean', () => {
  const root = fixture({ 'etc/modprobe.d/blacklist.conf': 'blacklist floppy\n' })
  assert.equal(summarizeHost(scan(root)).cell, 'unavailable — no sysfs')
})

/** What the CLI's JSON carries for a remedy, and what a test reads back. */
interface CliRemedy {
  command: string
  root: boolean
}

interface CliFinding {
  rule: string
  severity: string
  message: string
  remedy?: CliRemedy
}

/** A scan of a throwaway project with only a source file to find. */
function plainProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(root)
  writeFileSync(join(root, '.gitignore'), 'node_modules\n')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'main.ts'), 'export const answer = 42\n')
  return root
}

test('--host adds the machine to the report and does not fail the run', () => {
  const root = plainProject('red-queen-host-cli-')

  const result = spawnSync(process.execPath, [cli, root, '--json', '--host'], { cwd: repo, encoding: 'utf8' })
  assert.ok(result.stdout, `COS-G printed no JSON. stderr: ${result.stderr}`)
  const report = JSON.parse(result.stdout) as {
    total: number
    counts: { G: number }
    host: { available: boolean; devices: unknown[]; findings: CliFinding[] } | null
    findings: { G: CliFinding[] }
  }
  assert.equal(result.status, 0, 'host findings are warnings, not a failing exit')
  assert.ok(report.host, 'the report carries a host section when asked for one')
  if (process.platform === 'linux') {
    assert.equal(report.host.available, true)
    assert.ok(report.host.devices.length > 0, 'a Linux machine lists its PCI devices')
  }
  assert.ok(report.counts.G >= report.host.findings.length)

  // A remedy is a whole command or none at all. These are what the COS-G page
  // offers as a Copy button and what the report prints for a paste, so a half
  // filled one would send someone to a terminal with nothing to run.
  for (const finding of report.host.findings) {
    if (!finding.remedy) continue
    assert.ok(finding.remedy.command.trim(), `the remedy for ${finding.rule} carries a command`)
    assert.equal(typeof finding.remedy.root, 'boolean', `the remedy for ${finding.rule} says whether it needs root`)
  }

  // The terminal hands over the same command the page shows: one `fix:` line per
  // printed finding that carries a remedy, and none invented for one that does
  // not. The counts are compared rather than the text, since which faults a
  // machine has is the machine's business; the printed findings are the ones the
  // console actually reaches, since it stops after twelve.
  const carried = report.findings.G.slice(0, 12).filter((finding) => finding.remedy).length
  const reportFile = join(root, 'report.md')
  const printed = spawnSync(process.execPath, [cli, root, '--host', '--report', reportFile], { cwd: repo, encoding: 'utf8' })
  assert.ok(printed.stdout, `COS-G printed no report. stderr: ${printed.stderr}`)
  assert.equal((printed.stdout.match(/^\s+fix: /gm) ?? []).length, carried, 'the console prints one fix line per remedy')
  assert.equal((readFileSync(reportFile, 'utf8').match(/^  - Fix: /gm) ?? []).length, carried, 'the Markdown report prints one fix line per remedy')
})

test('--fix writes the remedies as a script, and refuses without --host', () => {
  const root = plainProject('red-queen-fix-')

  // The remedies come from the sweep, so without --host there is no machine to
  // have any: the run stops rather than writing a script that could only be
  // empty, or worse, invented.
  const refused = spawnSync(process.execPath, [cli, root, '--fix'], { cwd: repo, encoding: 'utf8' })
  assert.equal(refused.status, 2, 'a fix script without a machine to sweep is refused')
  assert.match(refused.stderr, /needs --host/)
  assert.ok(!existsSync(join(repo, 'cosg-fixes.sh')), 'nothing is written when the run is refused')

  // What the report says about this machine is what the script has to carry.
  const json = spawnSync(process.execPath, [cli, root, '--json', '--host'], { cwd: repo, encoding: 'utf8' })
  assert.ok(json.stdout, `COS-G printed no JSON. stderr: ${json.stderr}`)
  const report = JSON.parse(json.stdout) as { host: { findings: CliFinding[] } }
  const remedies = report.host.findings.flatMap((finding) => (finding.remedy ? [finding.remedy.command] : []))

  const script = join(root, 'fixes.sh')
  const written = spawnSync(process.execPath, [cli, root, '--host', '--fix', script], { cwd: repo, encoding: 'utf8' })
  assert.equal(written.status, 0, written.stderr)
  assert.match(written.stdout, /Fixes written to /)

  const text = readFileSync(script, 'utf8')
  assert.ok(text.startsWith('#!/bin/sh\n'), 'the script is meant for a shell')
  // The commands are the remedies and nothing else. A line nothing read would be
  // a line someone could run, which is the one thing a written file must not be.
  const commands = text.split('\n').filter((line) => line.length > 0 && !line.startsWith('#'))
  assert.deepEqual(commands, ['set -eu', ...remedies])
  // A warning no command clears is named in the file rather than dropped from it,
  // so the script accounts for the sweep it came from.
  for (const finding of report.host.findings) {
    if (finding.severity !== 'warn' || finding.remedy) continue
    assert.ok(text.includes(finding.message), `the script accounts for: ${finding.message}`)
  }
})

test('--fix without a path lands beside the report, under one name', () => {
  const root = plainProject('red-queen-fix-beside-')
  mkdirSync(join(root, 'reports'), { recursive: true })
  const reportFile = join(root, 'reports', 'cosg.md')

  const run = spawnSync(process.execPath, [cli, root, '--host', '--report', reportFile, '--fix'], { cwd: repo, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /Report written to /)
  // The report and the script are read together, so they are written together.
  assert.ok(existsSync(join(root, 'reports', 'cosg.sh')), 'the script sits beside the report')
  assert.match(run.stdout, /Fixes written to .*cosg\.sh\. Nothing in it has been run\./)
})

/**
 * The remedy tests below read what the sweep found on this machine, so a machine
 * it cannot read is a failure to say out loud rather than a quiet pass.
 */
function requireHostSweep(): void {
  assert.equal(process.platform, 'linux', 'the host sweep reads Linux sysfs')
}

/** The warnings the sweep reports right now, as the CLI's own JSON describes them. */
function currentWarnings(root: string): CliFinding[] {
  const json = spawnSync(process.execPath, [cli, root, '--json', '--host'], { cwd: repo, encoding: 'utf8' })
  assert.ok(json.stdout, `COS-G printed no JSON. stderr: ${json.stderr}`)
  const report = JSON.parse(json.stdout) as { host: { available: boolean; kernel: string; findings: CliFinding[] } }
  assert.equal(report.host.available, true, 'the fixture project should sweep this machine')
  return report.host.findings.filter((finding) => finding.severity === 'warn')
}

test('a fix run keeps the findings beside the script, and the next one compares with them', () => {
  requireHostSweep()
  const root = plainProject('red-queen-fix-kept-')
  const script = join(root, 'fixes.sh')
  const kept = join(root, 'fixes.json')
  const warnings = currentWarnings(root)

  const first = spawnSync(process.execPath, [cli, root, '--host', '--fix', script], { cwd: repo, encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  assert.ok(existsSync(kept), 'the findings are kept beside the script')
  assert.match(first.stdout, /Findings kept in .*fixes\.json, for a later run to compare against\./)
  assert.ok(!/^  since {3}/m.test(first.stdout), 'a first run has nothing to compare with')

  // The copy holds the warnings, and only the warnings: a note needed no action
  // when it was written, so it cannot be reported as cleared later.
  const copy = JSON.parse(readFileSync(kept, 'utf8')) as { kind: string; kernel: string; findings: { message: string }[] }
  assert.equal(copy.kind, 'red-queen/host-findings')
  assert.deepEqual(copy.findings.map((finding) => finding.message), warnings.map((finding) => finding.message))

  // The same command later: the machine has not moved, so neither has what it
  // says — which is the answer a run weeks from now has to be able to give.
  const second = spawnSync(process.execPath, [cli, root, '--host', '--fix', script], { cwd: repo, encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, new RegExp(`since\\s+\\S+ \\S+ · nothing changed: ${warnings.length} warnings? as before`))
  const again = JSON.parse(readFileSync(kept, 'utf8')) as { generatedAt: string }
  assert.ok(again.generatedAt, 'the copy is rewritten from the latest sweep')
})

test('a kept copy from an earlier run says what has changed since', () => {
  requireHostSweep()
  const root = plainProject('red-queen-fix-since-')
  const script = join(root, 'fixes.sh')
  const kept = join(root, 'fixes.json')
  const warnings = currentWarnings(root)

  // A copy from a machine that had a ghost this one does not: the run has to say
  // that one is cleared, and everything it does have is new against that copy.
  writeFileSync(
    kept,
    JSON.stringify(
      {
        program: 'Red Queen',
        kind: 'red-queen/host-findings',
        generatedAt: '2026-01-02T03:04:05.000Z',
        kernel: '6.1.0',
        available: true,
        findings: [{ rule: 'idle-driver', severity: 'warn', message: 'ghost-driver is loaded but driving nothing here — from an earlier run.' }],
      },
      null,
      2,
    ) + '\n',
  )

  const run = spawnSync(process.execPath, [cli, root, '--host', '--fix', script], { cwd: repo, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const counts = `1 cleared, 0 still there, ${warnings.length} new`
  assert.ok(
    run.stdout.includes(`  since   2026-01-02 03:04 · ${counts}`),
    `the console dates the comparison: ${run.stdout.split('\n').find((line) => line.includes('since')) ?? 'no since line'}`,
  )
  assert.match(run.stdout, /gone\s+Driver doing nothing — ghost-driver is loaded but driving nothing here/)
  assert.ok(readFileSync(script, 'utf8').includes(`# Since 2026-01-02 03:04: ${counts}.`), 'the script carries the comparison too')
  // Every warning this machine does have is named as new against that copy, by
  // rule and message rather than by a bare count. The verdict is padded to seven
  // so the messages line up under each other.
  for (const finding of warnings) {
    const label = hostRuleLabels[finding.rule as keyof typeof hostRuleLabels]
    assert.ok(run.stdout.includes(`  ${'new'.padEnd(7)}${label} — ${finding.message}`), `the delta names it as new: ${finding.message}`)
  }

  // The copy is replaced, so the next run compares against this one rather than
  // reporting the same clearing every time it is asked.
  const replaced = JSON.parse(readFileSync(kept, 'utf8')) as { findings: { message: string }[] }
  assert.deepEqual(replaced.findings.map((finding) => finding.message), warnings.map((finding) => finding.message))
  assert.ok(!readFileSync(kept, 'utf8').includes('ghost-driver'), 'a clearing is not reported twice')
})

test('a kept copy that cannot be read is replaced without a claimed comparison', () => {
  requireHostSweep()
  const root = plainProject('red-queen-fix-unreadable-')
  // Written outside the scanned tree: a broken JSON file inside it is a syntax
  // finding of its own, which is the checker doing its job, not what this tests.
  const out = mkdtempSync(join(tmpdir(), 'red-queen-fix-out-'))
  scratch.push(out)
  const script = join(out, 'fixes.sh')
  const kept = join(out, 'fixes.json')
  writeFileSync(kept, 'this is not the findings file\n')

  const run = spawnSync(process.execPath, [cli, root, '--host', '--fix', script], { cwd: repo, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /could not be read, so nothing here is compared with it/)
  assert.ok(!/^  since {3}/m.test(run.stdout), 'an unreadable copy invents no comparison')
  const replaced = JSON.parse(readFileSync(kept, 'utf8')) as { kind: string }
  assert.equal(replaced.kind, 'red-queen/host-findings', 'the unreadable copy is replaced with a readable one')
})

/** A throwaway directory for a fix script and its copy: never the scanned tree. */
function fixOut(prefix: string): string {
  const out = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(out)
  return out
}

/** The copy beside a script, derived the way the CLI derives it. */
function keptOf(script: string): string {
  return script.replace(/\.[^./\\]*$/, '') + '.json'
}

function check(root: string, script: string, extra: string[] = []): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [cli, root, '--host', '--fix', script, '--check', ...extra], { cwd: repo, encoding: 'utf8' })
}

test('a check says what the commands cleared, and fails while any of it is still there', () => {
  requireHostSweep()
  const root = plainProject('red-queen-check-')
  const out = fixOut('red-queen-check-out-')
  const script = join(out, 'fixes.sh')
  const kept = join(out, 'fixes.json')
  const warnings = currentWarnings(root)
  assert.ok(warnings.length > 0, 'this test needs a machine with something to check against')

  const fix = spawnSync(process.execPath, [cli, root, '--host', '--fix', script], { cwd: repo, encoding: 'utf8' })
  assert.equal(fix.status, 0, fix.stderr)
  const scriptBefore = readFileSync(script, 'utf8')

  // Nothing has been run, so every kept warning is still there — which is the
  // answer the check exists to give, and it fails rather than reporting a pass.
  const first = check(root, script)
  assert.equal(first.status, 1, 'a check fails while a kept warning is still there')
  assert.match(first.stdout, /^Check — against the findings kept \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/m)
  assert.match(first.stdout, new RegExp(`  0 cleared, ${warnings.length} still there, 0 new\\.`))
  for (const warning of warnings) {
    const label = hostRuleLabels[warning.rule as keyof typeof hostRuleLabels]
    assert.ok(first.stdout.includes(`  still  ${label} — ${warning.message}`), `the check names it as still there: ${warning.message}`)
    if (warning.remedy) {
      assert.ok(
        first.stdout.includes(`        fix: ${warning.remedy.command}`),
        'a still-there warning carries the command that was meant to clear it',
      )
    }
  }
  assert.equal(readFileSync(script, 'utf8'), scriptBefore, 'a check rewrites no script')

  // The copy is the before and this sweep is the after, so a cleared finding can
  // only be one the copy remembers and the machine no longer has: a copy with a
  // ghost in it is a machine where that command worked.
  const copy = JSON.parse(readFileSync(kept, 'utf8')) as { findings: unknown[] }
  const ghost = { rule: 'idle-driver', severity: 'warn', message: 'ghost-driver is loaded but driving nothing here — from the copy made weeks ago.' }
  writeFileSync(kept, JSON.stringify({ ...copy, findings: [...copy.findings, ghost] }, null, 2) + '\n')
  const partly = check(root, script)
  assert.equal(partly.status, 1, 'the rest are still there, so the check still fails')
  assert.ok(
    partly.stdout.includes(`  1 cleared, ${warnings.length} still there, 0 new.`),
    partly.stdout.split('\n').find((line) => line.includes('cleared,')) ?? 'no counts line',
  )
  assert.ok(partly.stdout.includes(`  gone   ${hostRuleLabels['idle-driver']} — ${ghost.message}`), 'the cleared one is named as gone')

  // A copy every one of whose findings is gone from the machine: the check
  // passes, even though this sweep has warnings the copy never knew about — the
  // question it answers is whether the commands it was written for worked.
  writeFileSync(kept, JSON.stringify({ ...copy, findings: [ghost] }, null, 2) + '\n')
  const clean = check(root, script)
  assert.equal(clean.status, 0, 'a check passes when nothing the copy held is still there')
  assert.ok(clean.stdout.includes(`  1 cleared, 0 still there, ${warnings.length} new.`))
})

test('a check with nothing to check against is refused, and writes nothing', () => {
  requireHostSweep()
  const root = plainProject('red-queen-check-none-')
  const out = fixOut('red-queen-check-none-out-')
  const script = join(out, 'fixes.sh')

  // Without --fix there is no script to find a copy beside.
  const withoutFix = spawnSync(process.execPath, [cli, root, '--host', '--check'], { cwd: repo, encoding: 'utf8' })
  assert.equal(withoutFix.status, 2)
  assert.match(withoutFix.stderr, /needs --host --fix/)

  // And with a path but nothing kept there, a check has nothing to compare with,
  // so it refuses rather than writing a fresh copy and calling it a comparison.
  const nothingKept = check(root, script)
  assert.equal(nothingKept.status, 2)
  assert.match(nothingKept.stderr, /nothing is kept at/)
  assert.ok(!existsSync(script), 'a refused check writes no script')
  assert.ok(!existsSync(keptOf(script)), 'and keeps no findings')
})

test('a check is carried in the JSON and in the report when both are asked for', () => {
  requireHostSweep()
  const root = plainProject('red-queen-check-forms-')
  const out = fixOut('red-queen-check-forms-out-')
  const script = join(out, 'fixes.sh')
  const warnings = currentWarnings(root)

  const fix = spawnSync(process.execPath, [cli, root, '--host', '--fix', script], { cwd: repo, encoding: 'utf8' })
  assert.equal(fix.status, 0, fix.stderr)

  const json = check(root, script, ['--json'])
  const payload = JSON.parse(json.stdout) as { check: { cleared: number; stillThere: number; new: number; ok: boolean; comparedAt: string } | null }
  assert.deepEqual(
    payload.check && { cleared: payload.check.cleared, stillThere: payload.check.stillThere, new: payload.check.new, ok: payload.check.ok },
    { cleared: 0, stillThere: warnings.length, new: 0, ok: false },
    'the verdict a script would read is in the JSON',
  )
  assert.match(payload.check?.comparedAt ?? '', /^\d{4}-\d{2}-\d{2}T/, 'and says which copy it compared with')

  const reportFile = join(out, 'check.md')
  const withReport = check(root, script, ['--report', reportFile])
  assert.equal(withReport.status, 1)
  const markdown = readFileSync(reportFile, 'utf8')
  assert.match(markdown, /## Check — against the findings kept \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  assert.equal((markdown.match(/^- STILL /gm) ?? []).length, warnings.length, 'the report carries the comparison it just made')
})
