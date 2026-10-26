// The host half of COS-G's ghost pass: `npm run cosg -- . --host` adds this to
// the report. It answers three questions about the machine the project sits on.
//
//   Which PCI hardware has a driver, and which is present but dark?
//   Which driver modules are blocked from loading, and is that blocking
//   hardware that is currently without one — or is the block not taking
//   effect because the module is loaded anyway?
//   Which DKMS records have lost the source behind them, so `dkms status`
//   errors instead of reporting — and which are not built for the kernel you
//   are running, so their modules will not be there after a reboot?
//
// Read-only, like the rest of the checker: it reads sysfs, /etc/modprobe.d,
// /lib/modules, /var/lib/dkms and pci.ids. Nothing is loaded, unloaded,
// rebuilt or written, so running it cannot change the host it inspects.
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { release } from 'node:os'
import { basename, join } from 'node:path'

export type HostRule = 'unbound-hardware' | 'blacklisted-driver' | 'blacklist-ineffective' | 'stale-dkms' | 'dkms-not-built'

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

export interface HostOptions {
  /** Defaults to /sys/bus/pci/devices. */
  pci?: string
  /** Defaults to /etc/modprobe.d. */
  modprobe?: string
  /** Defaults to /var/lib/dkms. */
  dkms?: string
  /** Defaults to /lib/modules/<running kernel>. */
  modules?: string
  /** Defaults to /proc/modules. */
  procModules?: string
  /** Defaults to the pci.ids files a distro ships. */
  ids?: string[]
  /** Defaults to the running kernel. */
  kernel?: string
}

// The PCI class byte, as far as a reader needs it. Anything else prints the
// raw class, so the report never invents a name.
const KINDS: Record<string, string> = {
  '01': 'storage',
  '02': 'network',
  '03': 'display',
  '04': 'multimedia',
  '05': 'memory',
  '06': 'bridge',
  '07': 'communication',
  '08': 'base system',
  '09': 'input',
  '0a': 'docking',
  '0b': 'processor',
  '0c': 'serial bus',
  '0d': 'wireless',
  '0f': 'satellite',
  '10': 'encryption',
  '11': 'signal processing',
  '12': 'processing accelerator',
  '13': 'instrumentation',
  '40': 'coprocessor',
}

// Classes where an empty driver link means hardware someone expects to use is
// dark. A bridge, a memory controller or an unclaimed serial controller with no
// driver is ordinary, and reporting it would bury the finding that matters.
const NEEDS_DRIVER = new Set(['storage', 'network', 'display', 'multimedia', 'wireless'])

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

function names(path: string): string[] {
  try {
    return readdirSync(path).sort()
  } catch {
    return []
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function driverOf(dir: string): string | null {
  try {
    return basename(readlinkSync(join(dir, 'driver')))
  } catch {
    return null
  }
}

/** A built module, whether or not the distro compressed it. */
const MODULE_FILE = /\.ko(\.(?:zst|xz|gz))?$/

/** `a, b and c` — for messages that name two or three things. */
function list(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * Names from pci.ids when the distro ships one, so a device reads as
 * "RTL8125 2.5GbE Controller" rather than "10ec:8125". Absent, the ids stand in.
 */
function readIds(paths: string[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const path of paths) {
    const text = read(path)
    if (!text) continue
    let vendor = ''
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('#')) continue
      const device = line.match(/^\t([0-9a-fA-F]{4})\s+(.+)$/)
      if (device) {
        if (vendor) names.set(`${vendor}:${device[1].toLowerCase()}`, device[2].trim())
        continue
      }
      // Subsystem lines are a third level of indentation and are not needed.
      if (line.startsWith('\t')) continue
      const head = line.match(/^([0-9a-fA-F]{4})\s+(.+)$/)
      if (head) {
        vendor = head[1].toLowerCase()
        names.set(vendor, head[2].trim())
      }
    }
    // One readable table is enough; do not merge a second copy over the first.
    if (names.size > 0) break
  }
  return names
}

interface Alias {
  module: string
  matcher: RegExp
}

/**
 * modules.alias maps a modalias pattern to the module that claims it: the only
 * honest way to say which driver a device would use while that driver is not
 * loaded. Patterns use shell wildcards, so `*` and `?` are translated and every
 * other character is escaped.
 */
function readAliases(path: string): Alias[] {
  const text = read(path)
  if (!text) return []
  const aliases: Alias[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^alias\s+(\S+)\s+(\S+)$/)
    if (!match) continue
    let pattern = '^'
    for (const char of match[1]) {
      pattern += char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    aliases.push({ module: match[2], matcher: new RegExp(`${pattern}$`) })
  }
  return aliases
}

/** Blacklist lines, including the `install <module> /bin/false` idiom. */
function readBlacklists(dir: string): HostBlacklist[] {
  const entries: HostBlacklist[] = []
  for (const name of names(dir)) {
    if (!name.endsWith('.conf')) continue
    const file = join(dir, name)
    if (!isDir(file) && !existsSync(file)) continue
    const text = read(file)
    if (!text) continue
    text.split('\n').forEach((line, index) => {
      const match =
        line.match(/^\s*blacklist\s+([\w-]+)/) ?? line.match(/^\s*install\s+([\w-]+)\s+\/bin\/(?:true|false)\b/)
      if (match) entries.push({ module: match[1], file, line: index + 1 })
    })
  }
  return entries
}

/**
 * DKMS keeps every record under /var/lib/dkms/<name>/<version>, with a
 * `<kernel>/<arch>/module/*.ko` tree per built kernel. A record whose source is
 * gone makes `dkms status` exit with an error, which is what breaks the kernel
 * post-install step rather than anything visible.
 */
function readDkms(root: string): HostDkms[] {
  const records: HostDkms[] = []
  for (const name of names(root)) {
    const versions = join(root, name)
    if (!isDir(versions)) continue
    for (const version of names(versions)) {
      // dkms also writes empty `kernel-<kernelver>-<arch>` markers beside the
      // version records when it installs or uninstalls for a kernel. They are
      // per-kernel bookkeeping, not a package version: reading one as a record
      // would report a healthy host as ten sourceless DKMS entries.
      if (version.startsWith('kernel-')) continue
      const dir = join(versions, version)
      if (!isDir(dir)) continue
      const built: string[] = []
      for (const kernel of names(dir)) {
        if (kernel === 'source' || kernel === 'build') continue
        const arches = names(join(dir, kernel))
        const hasModule = arches.some((arch) =>
          names(join(dir, kernel, arch, 'module')).some((file) => MODULE_FILE.test(file)),
        )
        if (hasModule) built.push(kernel)
      }
      records.push({ name, version, path: dir, conf: existsSync(join(dir, 'source', 'dkms.conf')), built })
    }
  }
  return records
}

/**
 * /proc/modules, one line per loaded module: `name size instances deps state
 * address`. The deps field is `-` or a comma list, which is how a module a
 * blacklist should have kept out can still be named as somebody's dependency.
 */
function readModules(path: string): HostModule[] {
  const text = read(path)
  if (!text) return []
  const lines = text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 4)
  const modules: HostModule[] = lines.map((parts) => {
    const used = Number.parseInt(parts[2], 10)
    return { name: parts[0], used: Number.isNaN(used) ? 0 : used, dependents: [] }
  })
  const byName = new Map(modules.map((module) => [module.name, module]))
  for (const parts of lines) {
    if (!parts[3] || parts[3] === '-') continue
    for (const dep of parts[3].split(',')) byName.get(dep.trim())?.dependents.push(parts[0])
  }
  return modules.sort((a, b) => a.name.localeCompare(b.name))
}

/** The modules whose aliases claim a device, loaded or not. */
function claimants(aliases: Alias[], modalias: string): string[] {
  if (!modalias) return []
  const modules = new Set<string>()
  for (const alias of aliases) {
    if (alias.matcher.test(modalias)) modules.add(alias.module)
  }
  return [...modules].sort()
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
  const head = ranked.slice(0, shown).map(([file, count]) => `${basename(file)} (${count})`)
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

/**
 * A module a blacklist should have kept out, found in /proc/modules. The state
 * names what is holding it, because the remedy differs: a softdep or an
 * explicit modprobe has to be fixed at its source, while a module nothing needs
 * can simply be unloaded.
 */
function loadedAnyway(module: string, live: HostModule, blacklists: HostBlacklist[]): HostFinding {
  const files = [...new Set(blacklists.filter((entry) => entry.module === module).map((entry) => basename(entry.file)))]
  const why =
    live.dependents.length > 0
      ? ` (pulled in by ${list(live.dependents)})`
      : live.used > 0
        ? ` (in use by ${live.used})`
        : ' (nothing depends on it)'
  return {
    rule: 'blacklist-ineffective',
    severity: 'warn',
    message: `${module} is blacklisted in ${list(files)} but is loaded right now${why} — a blacklist only stops alias loading, so a softdep or an explicit modprobe still gets it in. rmmod ${module} once nothing needs it, or fix whatever loads it.`,
    file: blacklists.find((entry) => entry.module === module)?.file,
  }
}

export function scanHost(options: HostOptions = {}): HostReport {
  const pciRoot = options.pci ?? '/sys/bus/pci/devices'
  const modprobeRoot = options.modprobe ?? '/etc/modprobe.d'
  const dkmsRoot = options.dkms ?? '/var/lib/dkms'
  const kernel = options.kernel ?? release()
  const modulesRoot = options.modules ?? `/lib/modules/${kernel}`

  if (!isDir(pciRoot)) {
    return {
      available: false,
      reason: `${pciRoot} is not readable — the host sweep needs Linux sysfs.`,
      kernel,
      devices: [],
      blacklists: [],
      loaded: [],
      dkms: [],
      findings: [],
    }
  }

  const ids = readIds(options.ids ?? ['/usr/share/misc/pci.ids', '/usr/share/hwdata/pci.ids'])
  const devices: HostDevice[] = []
  for (const slot of names(pciRoot)) {
    const dir = join(pciRoot, slot)
    const klass = read(join(dir, 'class')) ?? ''
    const vendor = (read(join(dir, 'vendor')) ?? '').replace(/^0x/, '').toLowerCase()
    const device = (read(join(dir, 'device')) ?? '').replace(/^0x/, '').toLowerCase()
    const vendorName = ids.get(vendor)
    const deviceName = ids.get(`${vendor}:${device}`)
    devices.push({
      slot,
      kind: KINDS[klass.slice(2, 4).toLowerCase()] ?? `class ${klass || 'unknown'}`,
      name: deviceName ?? (vendorName ? `${vendorName} device ${device || 'unknown'}` : `${vendor || 'vendor'} ${device || 'device'}`.trim()),
      driver: driverOf(dir),
      modalias: read(join(dir, 'modalias')) ?? '',
    })
  }

  const blacklists = readBlacklists(modprobeRoot)
  const loaded = readModules(options.procModules ?? '/proc/modules')
  const live = new Map(loaded.map((module) => [module.name, module]))
  const dkms = readDkms(dkmsRoot)
  const aliases = readAliases(join(modulesRoot, 'modules.alias'))
  const findings: HostFinding[] = []

  const claims = new Map<string, string[]>()
  for (const device of devices) claims.set(device.slot, claimants(aliases, device.modalias))

  const blocked = new Map<string, HostBlacklist>()
  for (const entry of blacklists) if (!blocked.has(entry.module)) blocked.set(entry.module, entry)

  // A device with no driver is the finding that matters, so it is reported once:
  // as a blacklisted driver when a blocked module claims it, and as unbound
  // hardware when nothing in this kernel's module table claims it at all.
  const explained = new Set<string>()
  for (const device of devices) {
    if (device.driver || !NEEDS_DRIVER.has(device.kind)) continue
    const candidates = claims.get(device.slot) ?? []
    const blockedHere = candidates.filter((module) => blocked.has(module))
    if (blockedHere.length > 0) {
      for (const module of blockedHere) explained.add(module)
      const files = [...new Set(blockedHere.map((module) => basename(blocked.get(module)?.file ?? '')))]
      const candidates =
        blockedHere.length === 1
          ? `candidate driver ${blockedHere[0]} is`
          : `candidate drivers ${list(blockedHere)} are`
      findings.push({
        rule: 'blacklisted-driver',
        severity: 'warn',
        message: `${device.slot} ${device.name} (${device.kind}) has no driver — ${candidates} blacklisted (${files.join(', ')}).`,
      })
      continue
    }
    if (candidates.length === 0) {
      findings.push({
        rule: 'unbound-hardware',
        severity: 'warn',
        message: `${device.slot} ${device.name} (${device.kind}) has no driver bound and no module in ${modulesRoot} claims it — the hardware may be unsupported or its module missing.`,
      })
      continue
    }
    findings.push({
      rule: 'unbound-hardware',
      severity: 'warn',
      message: `${device.slot} ${device.name} (${device.kind}) has no driver bound; ${list(candidates)} ${candidates.length === 1 ? 'claims' : 'claim'} it but ${candidates.length === 1 ? 'is not' : 'are not'} blacklisted.`,
    })
  }

  // A blacklist is not only a fault: blocking one driver so another can own the
  // device is the intended setup. Say so, rather than leave the entry unread —
  // unless the blocked module is loaded anyway, which is the finding that
  // matters: the block is not doing anything.
  for (const device of devices) {
    if (!device.driver) continue
    for (const module of claims.get(device.slot) ?? []) {
      const entry = blocked.get(module)
      if (!entry || explained.has(module)) continue
      explained.add(module)
      const running = live.get(module)
      if (running) {
        findings.push(loadedAnyway(module, running, blacklists))
        continue
      }
      findings.push({
        rule: 'blacklisted-driver',
        severity: 'info',
        message: `${module} is blacklisted in ${entry.file}, but ${device.slot} ${device.name} is served by ${device.driver} — the block is deliberate; re-check it after a kernel upgrade.`,
        file: entry.file,
      })
    }
  }

  // Modules a blacklist should have kept out that are loaded right now. A
  // `blacklist` line only stops alias-driven autoloading, so a softdep, an
  // explicit modprobe or a load from before the file was written leaves the
  // module running; nothing else in the sweep would notice.
  for (const module of blocked.keys()) {
    if (explained.has(module)) continue
    const running = live.get(module)
    if (!running) continue
    explained.add(module)
    findings.push(loadedAnyway(module, running, blacklists))
  }

  for (const record of dkms) {
    if (record.conf) continue
    findings.push({
      rule: 'stale-dkms',
      severity: 'warn',
      message: `DKMS record ${record.name} ${record.version} has no source/dkms.conf, so dkms status fails on it. Remove ${record.path} once nothing owns it.`,
      file: record.path,
    })
  }

  // A DKMS package is a driver, and a driver with no build for the kernel you
  // are running is not in the boot you are about to take. This is judged per
  // package rather than per record: dkms keeps superseded versions around, and
  // an old one that was never rebuilt is harmless while a current one is.
  const packages = new Map<string, HostDkms[]>()
  for (const record of dkms) {
    const versions = packages.get(record.name) ?? []
    versions.push(record)
    packages.set(record.name, versions)
  }
  for (const [name, records] of packages) {
    if (records.some((record) => record.built.includes(kernel))) continue
    // Every record broken is already reported above; a rebuild could not help
    // until the source is back, so saying it twice would only add noise.
    if (!records.some((record) => record.conf)) continue
    const built = [...new Set(records.flatMap((record) => record.built))].sort()
    const state =
      built.length === 0
        ? `has never been built for any kernel`
        : `is built for ${built.join(', ')} but not for ${kernel}`
    findings.push({
      rule: 'dkms-not-built',
      severity: 'warn',
      message: `DKMS module ${name} ${state} — after a reboot into ${kernel} it will not be there. sudo dkms autoinstall rebuilds every record that still has source.`,
      // Point at the version a rebuild would act on, not at a broken sibling
      // that happens to sort first.
      file: records.find((record) => record.conf)?.path,
    })
  }

  return { available: true, reason: '', kernel, devices, blacklists, loaded, dkms, findings }
}
