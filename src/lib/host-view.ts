// The host sweep's shape, and the reading of it, kept in one place — the way
// src/lib/rack-markdown.ts is shared. The sweep (scripts/host-scan.ts) reads the
// machine and imports these types; a local install serves this view from the
// machine it runs on; the hosted Worker answers the same route with no machine to
// read; and the COS-G page renders whichever answer arrives. Nothing here
// imports node, so the browser bundle can load it too.

export type HostRule =
  | 'unbound-hardware'
  | 'blacklisted-driver'
  | 'blacklist-ineffective'
  | 'idle-driver'
  | 'stale-dkms'
  | 'dkms-not-built'

export interface HostFinding {
  rule: HostRule
  /** Warn for hardware that is dark or a record that breaks a tool; info otherwise. */
  severity: 'warn' | 'info'
  message: string
  /** The file the finding is about, when it is about a file rather than a device. */
  file?: string
}

export interface HostDevice {
  /** PCI slot, e.g. 0000:0b:00.0. */
  slot: string
  /** Readable class name, e.g. display, or the raw class when it is unknown. */
  kind: string
  /** Device name from pci.ids, or the vendor and ids when that file is absent. */
  name: string
  /** The module bound to the device, or null when nothing is bound. */
  driver: string | null
  /**
   * The module behind that driver. A driver's name is often not its module's —
   * i2c_i801 provides i801_smbus — and only sysfs knows which module it is.
   */
  module: string | null
  modalias: string
}

export interface HostBlacklist {
  module: string
  /** The .conf that blocks it — modprobe ignores files without that suffix. */
  file: string
  line: number
}

export interface HostModule {
  name: string
  /** How many things hold a reference to it, from /proc/modules. */
  used: number
  /** Loaded modules that list it as a dependency. */
  dependents: string[]
}

export interface HostDkms {
  name: string
  version: string
  path: string
  /** Whether source/dkms.conf is still there; without it the record is broken. */
  conf: boolean
  /** Kernels the module is built for, newest name last. */
  built: string[]
  /** The modules the package builds, from BUILT_MODULE_NAME in its dkms.conf. */
  modules: string[]
  /** The kernel range the package refuses to build for; empty strings when unset. */
  exclusive: { min: string; max: string }
}

export interface HostReport {
  available: boolean
  /** Why the sweep did not run, when it did not. */
  reason: string
  kernel: string
  devices: HostDevice[]
  blacklists: HostBlacklist[]
  /** What is loaded right now, from /proc/modules. */
  loaded: HostModule[]
  dkms: HostDkms[]
  findings: HostFinding[]
}

/** One line per rule, so a panel reads as words rather than as kebab-case codes. */
export const hostRuleLabels: Record<HostRule, string> = {
  'unbound-hardware': 'Hardware with no driver',
  'blacklisted-driver': 'Driver blocked',
  'blacklist-ineffective': 'Block not holding',
  'idle-driver': 'Driver doing nothing',
  'stale-dkms': 'DKMS record broken',
  'dkms-not-built': 'DKMS not built for this kernel',
}

/** The last path segment — node's basename without importing node in here. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut < 0 ? path : path.slice(cut + 1)
}

/**
 * One line for the report. A stock distro blacklists a hundred modules across a
 * dozen files, so the count and the files say what is there without burying the
 * findings that name the modules claiming real hardware.
 */
export function blacklistSummary(entries: HostBlacklist[], shown = 6): string {
  if (entries.length === 0) return 'no blacklisted modules'
  const files = new Map<string, number>()
  for (const entry of entries) files.set(entry.file, (files.get(entry.file) ?? 0) + 1)
  const ranked = [...files.entries()].sort((a, b) => b[1] - a[1])
  const head = ranked.slice(0, shown).map(([file, count]) => `${baseName(file)} (${count})`)
  const rest = ranked.length - head.length
  const modules = `${entries.length} module${entries.length === 1 ? '' : 's'} in ${files.size} file${files.size === 1 ? '' : 's'}`
  return `${modules} — ${head.join(', ')}${rest > 0 ? `, and ${rest} more file${rest === 1 ? '' : 's'}` : ''}`
}

/** What a row says when the sweep could not look: a fact, like a dash tag. */
export const HOST_UNAVAILABLE = 'unavailable — no sysfs'

export interface HostSummary {
  /** The cell a release row carries: the sweep in one line. */
  cell: string
  /** The warnings behind that cell, for printing next to it. */
  warnings: HostFinding[]
}

/**
 * The sweep distilled to what a release row can hold. The kernel belongs in the
 * cell: "not built for the running kernel" only means something against a named
 * kernel, and a row read months later should not have to guess which one.
 */
export function summarizeHost(report: HostReport): HostSummary {
  if (!report.available) return { cell: HOST_UNAVAILABLE, warnings: [] }
  const warnings = report.findings.filter((finding) => finding.severity === 'warn')
  if (warnings.length === 0) {
    const devices = `${report.devices.length} device${report.devices.length === 1 ? '' : 's'}`
    return { cell: `clean — ${devices} on ${report.kernel}`, warnings }
  }
  const rules = [...new Set(warnings.map((finding) => finding.rule))]
  const count = `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
  return { cell: `${count} — ${rules.join(', ')} on ${report.kernel}`, warnings }
}

// What the panel shows as the sweep's reach. Deliberately not a count of devices
// with no driver: a bridge or a memory controller with none is ordinary, and a
// tally that included them would sit next to "nothing to report" saying four
// things are wrong. The devices that matter are the ones the findings name.
export interface HostCounts {
  devices: number
  blacklisted: number
  loaded: number
  dkms: number
}

/**
 * What the app panel renders, and what /api/host answers with — from either
 * server. The hosted copy has no machine, so it is a normal answer rather than
 * an error: `available: false` with the reason why.
 */
export interface HostView {
  available: boolean
  /** Why there is nothing to read, when there is nothing; empty otherwise. */
  reason: string
  /** Which copy answered: metal, sandbox, vm, offline (bundle run directly) or hosted. */
  mode: string
  kernel: string
  /** The sweep in one line — the same cell a release row carries. */
  cell: string
  counts: HostCounts
  /** Warnings first: a panel is read top down, and those are the ones with a remedy. */
  findings: HostFinding[]
}

export const EMPTY_COUNTS: HostCounts = { devices: 0, blacklisted: 0, loaded: 0, dkms: 0 }

/**
 * A sandbox install confines the server to its own directory, so the sweep
 * cannot open /sys or /proc at all. That is the confinement working, not a
 * broken sweep, and the reason should say so rather than blame sysfs. Exported
 * because a sweep that failed outright needs the same sentence.
 */
export function unavailableReason(reason: string, mode: string): string {
  if (mode !== 'sandbox') return reason
  return `${reason} This copy is a sandbox install, which confines the server to its own directory, so it cannot read the machine it runs on — a metal install on the same host can.`
}

/** The sweep's report as the panel and the endpoint show it. */
export function hostView(report: HostReport, mode: string): HostView {
  return {
    available: report.available,
    reason: report.available ? '' : unavailableReason(report.reason, mode),
    mode,
    kernel: report.kernel,
    cell: summarizeHost(report).cell,
    counts: {
      devices: report.devices.length,
      blacklisted: report.blacklists.length,
      loaded: report.loaded.length,
      dkms: report.dkms.length,
    },
    findings: [...report.findings].sort((a, b) => Number(a.severity !== 'warn') - Number(b.severity !== 'warn')),
  }
}

/** Where the hosted copy's silence comes from: it has no filesystem at all. */
export const HOSTED_REASON =
  'This copy is served by a Worker, which has no filesystem, so it has no machine to read. The sweep runs inside a local install, on the computer it is installed on, and answers there.'

/** The hosted copy's cell: it has no kernel and no sysfs to report on. */
export const HOSTED_CELL = 'unavailable — hosted copy'

/** The answer where no sweep ran at all: the hosted copy. */
export function hostUnavailable(mode: string, reason: string, cell: string = HOST_UNAVAILABLE): HostView {
  return { available: false, reason, mode, kernel: '', cell, counts: { ...EMPTY_COUNTS }, findings: [] }
}
