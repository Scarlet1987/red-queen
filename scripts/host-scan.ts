// The host half of COS-G's ghost pass: `npm run cosg -- . --host` adds this to
// the report, and a local install serves it to the app at /api/host. It answers
// four questions about the machine the project sits on.
//
//   Which PCI hardware has a driver, and which is present but dark?
//   Which driver modules are blocked from loading, and is that blocking
//   hardware that is currently without one — or is the block not taking
//   effect because the module is loaded anyway?
//   Which DKMS records have lost the source behind them, so `dkms status`
//   errors instead of reporting — and which are not built for the kernel you
//   are running, so their modules will not be there after a reboot?
//   Which loaded drivers are serving nothing at all?
//
// Read-only, like the rest of the checker: it reads sysfs, /etc/modprobe.d,
// /lib/modules, /var/lib/dkms and pci.ids. Nothing is loaded, unloaded,
// rebuilt or written, so running it cannot change the host it inspects.
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { release } from 'node:os'
import { basename, join } from 'node:path'

// The report's shape, and the one-line readings of it, live in
// src/lib/host-view.ts: that module has no node imports, so the app and the
// hosted Worker can load it as well as this sweep. Type-only, deliberately —
// this file is transpiled on its own into the offline bundle, where an import of
// a value from src/lib could not be resolved.
import type { HostBlacklist, HostDevice, HostDkms, HostFinding, HostModule, HostReport } from '../src/lib/host-view.ts'

// Re-exported so the CLI, the release log and the tests keep reading the sweep's
// own types from the sweep.
export type { HostBlacklist, HostDevice, HostDkms, HostFinding, HostModule, HostReport, HostRule } from '../src/lib/host-view.ts'

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

/** The module providing a device's driver, when the driver is a module at all. */
function moduleOf(dir: string): string | null {
  try {
    return basename(readlinkSync(join(dir, 'driver', 'module')))
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
  /** Whether the pattern claims PCI hardware, as opposed to USB, platform, … */
  pci: boolean
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
    aliases.push({ module: match[2], matcher: new RegExp(`${pattern}$`), pci: match[1].startsWith('pci:') })
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
 * The few keys of a dkms.conf this sweep has an opinion about. The file is a
 * shell script, and these are assignments: which modules the package builds, and
 * whether the package itself declares this kernel out of range.
 */
function readDkmsConf(path: string): { present: boolean; modules: string[]; exclusive: { min: string; max: string } } {
  const modules: string[] = []
  const exclusive = { min: '', max: '' }
  const text = read(path)
  if (text === null) return { present: false, modules, exclusive }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z_]+)(?:\[\d+\])?\s*=\s*"?([^"#]*)"?\s*$/)
    if (!match) continue
    const value = match[2].trim()
    if (!value) continue
    if (match[1] === 'BUILT_MODULE_NAME') modules.push(value)
    else if (match[1] === 'BUILD_EXCLUSIVE_KERNEL_MIN') exclusive.min = value
    else if (match[1] === 'BUILD_EXCLUSIVE_KERNEL_MAX') exclusive.max = value
  }
  return { present: true, modules, exclusive }
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
      // What the record says about itself decides whether an absent build is a
      // problem: see the dkms-not-built rule below.
      const dkmsConf = readDkmsConf(join(dir, 'source', 'dkms.conf'))
      records.push({ name, version, path: dir, conf: dkmsConf.present, built, modules: dkmsConf.modules, exclusive: dkmsConf.exclusive })
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

/**
 * The modules the running kernel's own package carries, read from modules.dep.
 * A path under updates/ or extra/ is something a DKMS package installed; a path
 * under kernel/ is the kernel tree itself. The distinction is the whole point:
 * a driver the kernel ships is present whether or not a DKMS package builds a
 * copy of it, so an unbuilt DKMS record for it is redundant rather than missing.
 */
function kernelProvides(modulesRoot: string): Set<string> {
  const provided = new Set<string>()
  const text = read(join(modulesRoot, 'modules.dep'))
  if (!text) return provided
  for (const line of text.split('\n')) {
    const path = line.split(':')[0]?.trim()
    if (!path || !MODULE_FILE.test(path)) continue
    // Judged by path segment rather than by substring, so a relative path from a
    // hand-written modules.dep is classified the same way an absolute one is.
    const segments = path.split('/')
    if (segments.includes('updates') || segments.includes('extra')) continue
    provided.add(path.slice(path.lastIndexOf('/') + 1).replace(MODULE_FILE, '').replace(/-/g, '_'))
  }
  return provided
}

/** The numeric parts of a kernel name, for comparing one against a DKMS bound. */
function kernelParts(name: string): number[] {
  return (name.split('-')[0] ?? '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => !Number.isNaN(value))
}

/** Positive when a is newer than b, negative when older; missing parts are zero. */
function compareKernels(a: string, b: string): number {
  const left = kernelParts(a)
  const right = kernelParts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
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
 * A loaded PCI driver that is not driving anything on this machine: the
 * hardware it was loaded for is absent, unplugged, or held by another driver.
 * The two cases read differently because the remedy differs — a device that is
 * being served means another driver won, and nothing matching means the
 * hardware it wants is not here.
 */
function idleDriver(name: string, slots: string[], servers: string[]): HostFinding {
  const state =
    slots.length === 0
      ? 'its aliases match no device on this machine, so whatever it was loaded for is absent or unplugged'
      : `the hardware it claims (${list(slots)}) is served by ${list(servers)} instead`
  return {
    rule: 'idle-driver',
    severity: 'warn',
    message: `${name} is loaded but driving nothing here — ${state}, and nothing depends on it. rmmod ${name} frees it; check what loads it before blocking it in /etc/modprobe.d.`,
  }
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
      module: moduleOf(dir),
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

  // A driver that is loaded and driving nothing. Only modules whose aliases
  // claim PCI hardware are judged: this sweep enumerates PCI alone, and
  // modules.alias also maps USB, platform and serio devices, so calling a USB
  // driver idle for not matching a PCI device would be a lie. A module that is
  // in use or depended on is not a leftover and could not be unloaded anyway,
  // so it is left alone.
  const pciDrivers = new Set(aliases.filter((alias) => alias.pci).map((alias) => alias.module))
  // The module a driver belongs to, not its name: i2c_i801 is bound as
  // i801_smbus, and a tree that does not carry the link falls back to the name.
  const serving = new Set<string>()
  for (const device of devices) {
    if (!device.driver) continue
    serving.add(device.module ?? device.driver)
  }
  const claimed = new Map<string, string[]>()
  for (const device of devices) {
    for (const module of claims.get(device.slot) ?? []) {
      const slots = claimed.get(module) ?? []
      slots.push(device.slot)
      claimed.set(module, slots)
    }
  }
  for (const module of loaded) {
    if (!pciDrivers.has(module.name) || serving.has(module.name)) continue
    if (module.used > 0 || module.dependents.length > 0) continue
    const slots = claimed.get(module.name) ?? []
    const servers = [...new Set(slots.map((slot) => devices.find((device) => device.slot === slot)?.driver ?? 'nothing'))]
    findings.push(idleDriver(module.name, slots, servers))
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
  const carried = kernelProvides(modulesRoot)
  for (const [name, records] of packages) {
    if (records.some((record) => record.built.includes(kernel))) continue
    // Every record broken is already reported above; a rebuild could not help
    // until the source is back, so saying it twice would only add noise.
    if (!records.some((record) => record.conf)) continue

    // A package whose module the kernel itself ships needs no build here. The
    // platform drivers moved into the kernel, so packages that predate that are
    // left deliberately unbuilt — system76_acpi declares as much — while the
    // kernel loads its own copy. "It will not be there after a reboot" would be
    // false: it is there now, and the reboot cannot take it away.
    if (records.flatMap((record) => record.modules).some((module) => carried.has(module.replace(/-/g, '_')))) continue

    // The package's own statement that this kernel is out of range: a build that
    // was never asked for is not a build that failed, so this is a note about
    // why the module is absent rather than a warning to act on.
    const bound = records.find((record) => record.exclusive.max || record.exclusive.min)
    const lowest = bound?.exclusive.min ?? ''
    const highest = bound?.exclusive.max ?? ''
    const tooNew = highest !== '' && compareKernels(kernel, highest) > 0
    const tooOld = lowest !== '' && compareKernels(kernel, lowest) < 0
    if (tooNew || tooOld) {
      const clause = [lowest ? `MIN=${lowest}` : '', highest ? `MAX=${highest}` : ''].filter(Boolean).join(' and ')
      findings.push({
        rule: 'dkms-not-built',
        severity: 'info',
        message: `DKMS module ${name} is not built for ${kernel} because the package itself excludes it (BUILD_EXCLUSIVE_KERNEL_${clause}) — the build was never asked for, so there is nothing to rebuild.`,
        file: records.find((record) => record.conf)?.path,
      })
      continue
    }

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
