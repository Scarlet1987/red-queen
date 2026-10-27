// COS-G — a read-only troubleshooting pass over a project directory.
//
//   C  crash risks          patterns in source that fail at runtime
//   O  orphans              files, assets, deps and scripts nothing reaches
//   S  syntax errors        TypeScript/JavaScript/JSON that will not parse
//   G  ghosts               things parasitic to the host or the repository
//
// `--host` extends G from the tree to the machine: PCI hardware with no driver,
// driver modules blocked from loading, and DKMS records with no source left.
//
//   npm run cosg -- ../my-project
//   npm run cosg -- . --json
//   npm run cosg -- . --report cosg-report.md
//   npm run cosg -- . --strict
//   npm run cosg -- . --host         and the machine: drivers, blacklists, DKMS
//   npm run cosg -- . --host --fix   the same machine's remedies, as a script
//
// The checker never executes, edits or deletes the code it scans, and it never
// runs a remedy. It only reads files, and writes a report, a fix script, or the
// findings the fix script came from when you ask for one.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

import { blacklistSummary, hostRuleLabels, type HostRemedy, type HostReport } from '../src/lib/host-view.ts'
import { extended, labels, playbooks, type Category } from './doctrine.ts'
import { scanHost } from './host-scan.ts'

type Severity = 'error' | 'warn' | 'info'

interface Finding {
  rule: string
  severity: Severity
  message: string
  file?: string
  line?: number
  /**
   * The command that clears it, carried by `--host` findings and by nothing
   * else: a crash risk in a source file is not fixed by pasting a line, and
   * inventing one for it would be a remedy the sweep never read.
   */
  remedy?: HostRemedy
}

interface Entry {
  abs: string
  rel: string
  size: number
  isDir: boolean
  isSymlink: boolean
  mode: number
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.wrangler', '.freebuff', '.next', '.svelte-kit', 'vendor'])
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const DECLARATION = /\.d\.ts$/
const TEXT_EXT = new Set([...CODE_EXT, '.css', '.json', '.md', '.html', '.yml', '.yaml', '.toml', '.jsonc'])
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_FILES = 5000
const MAX_FINDINGS = 40
const SELF = 'scripts/cosg.ts'

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const strict = args.includes('--strict')
const hostFlag = args.includes('--host')
const reportFlag = args.indexOf('--report')
const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : null
const fixFlag = args.indexOf('--fix')
const fixValue = fixFlag >= 0 ? args[fixFlag + 1] : undefined
// A path given to a flag is not the directory to scan, whatever it looks like.
const flagValues = new Set([reportFlag, fixFlag].filter((index) => index >= 0).map((index) => index + 1))
const target = args.find((arg, index) => !arg.startsWith('--') && !flagValues.has(index)) ?? '.'
const root = resolve(process.cwd(), target)

/**
 * The script beside the report when one was asked for — they are read together —
 * and a named file in the working directory otherwise.
 */
function defaultFixPath(report: string | null): string {
  const base = report ? report.replace(/\.[^./\\]*$/, '') : 'cosg-fixes'
  return `${base}.sh`
}

const fixPath = fixFlag < 0 ? null : fixValue && !fixValue.startsWith('--') ? fixValue : defaultFixPath(reportPath)

// The remedies come from the sweep, so a fix script without `--host` could only
// be empty — or worse, invented. Refuse before scanning anything.
if (fixPath && !hostFlag) {
  console.error('COS-G: --fix writes the host remedies, so it needs --host. Nothing was written.')
  process.exit(2)
}

if (args.includes('--rules')) {
  console.log('COS-G rules')
  console.log('')
  for (const category of ['C', 'O', 'S', 'G'] as const) {
    console.log(`${category} — ${labels[category]}`)
    console.log(`  ${playbooks[category].definition}`)
    playbooks[category].steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`))
    console.log('')
  }
  console.log('Extended bible')
  console.log('  Laws: no parasites or bloat · build for the intermediate beginner · nothing deeper than three clicks.')
  for (const [code, area, letters] of extended) console.log(`  ${code.padEnd(8)} ${area.padEnd(9)} ${letters}`)
  console.log('  Reference: /cosg/bible')
  console.log('')
  process.exit(0)
}

if (!safeIsDir(root)) {
  console.error(`COS-G: ${root} is not a directory.`)
  process.exit(2)
}

function safeIsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

const entries: Entry[] = []
const skipped: string[] = []
let truncated = false

function walk(dir: string) {
  if (entries.length >= MAX_FILES) {
    truncated = true
    return
  }
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) {
      skipped.push(relative(root, join(dir, name)) || name)
      continue
    }
    const abs = join(dir, name)
    let stat
    try {
      stat = lstatSync(abs)
    } catch {
      continue
    }
    entries.push({
      abs,
      rel: relative(root, abs),
      size: stat.isFile() ? stat.size : 0,
      isDir: stat.isDirectory(),
      isSymlink: stat.isSymbolicLink(),
      mode: stat.mode,
    })
    if (stat.isDirectory()) walk(abs)
    if (entries.length >= MAX_FILES) {
      truncated = true
      return
    }
  }
}

walk(root)

const files = entries.filter((entry) => !entry.isDir && !entry.isSymlink)
const dirs = entries.filter((entry) => entry.isDir && !entry.isSymlink)
const texts = new Map<string, string>()

function textOf(entry: Entry): string | null {
  const cached = texts.get(entry.abs)
  if (cached !== undefined) return cached
  if (entry.size > MAX_FILE_BYTES || !TEXT_EXT.has(extname(entry.abs))) return null
  try {
    const text = readFileSync(entry.abs, 'utf8')
    if (text.includes('\u0000')) return null
    texts.set(entry.abs, text)
    return text
  } catch {
    return null
  }
}

function lineAt(text: string, index: number): number {
  return text.slice(0, Math.max(0, index)).split('\n').length
}

const findings: Record<Category, Finding[]> = { C: [], O: [], S: [], G: [] }

function add(category: Category, finding: Finding) {
  if (findings[category].length >= MAX_FINDINGS) return
  findings[category].push(finding)
}

// ---------------------------------------------------------------------------
// C — crash risks
// ---------------------------------------------------------------------------

const crashPatterns: { rule: string; source: string; message: string; severity?: Severity; unless?: string }[] = [
  { rule: 'empty-catch', source: 'catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}', message: 'Empty catch — the failure is now silent.' },
  { rule: 'dynamic-code', source: '\\beval\\s*\\(|new\\s+Function\\s*\\(', message: 'Dynamic code execution — treat the input as hostile.' },
  // The lookbehind keeps `pattern.exec(text)` — a regex, not a process — out of
  // this rule. A method call on an object (`cp.spawn(`) is left to the reader;
  // flagging every `.exec(` would bury the real ones under regex matches.
  { rule: 'child-process', source: '(?<![.\\w$])(?:exec|execSync|spawn|spawnSync)\\s*\\(', message: 'Child process — handle a missing binary, a hang and a non-zero exit.' },
  { rule: 'unbounded-loop', source: 'while\\s*\\(\\s*true\\s*\\)|for\\s*\\(\\s*;\\s*;\\s*\\)', message: 'Unbounded loop — make sure there is a break, a deadline or a cap.' },
  { rule: 'raw-html', source: 'dangerouslySetInnerHTML', message: 'Raw HTML injection point — sanitise the value.' },
  { rule: 'dom-assertion', source: '(?:getElementById|querySelector(?:All)?)\\([^)]*\\)\\s*!', message: 'Non-null assertion on a DOM lookup — the element may not exist yet.' },
  { rule: 'hard-exit', source: 'process\\.exit\\s*\\(', message: 'Hard exit — fine in a CLI entry point, risky inside a library.', severity: 'info' },
  { rule: 'unchecked-fetch', source: 'await\\s+fetch\\s*\\(', message: 'Network call — confirm response.ok is checked before trusting the body.', unless: '.ok' },
]

// JSON.parse is checked on the syntax tree so a guarded parse inside try is not
// reported. The regex pass below cannot see structure.
function scanJsonParse(entry: Entry, text: string) {
  if (entry.rel === SELF) return
  const kind = entry.abs.endsWith('.tsx') ? ts.ScriptKind.TSX : entry.abs.endsWith('.jsx') ? ts.ScriptKind.JSX : entry.abs.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(entry.abs, text, ts.ScriptTarget.Latest, true, kind)
  const visit = (node: ts.Node, inTry: boolean) => {
    if (ts.isTryStatement(node)) {
      ts.forEachChild(node.tryBlock, (child) => visit(child, true))
      if (node.catchClause) visit(node.catchClause, inTry)
      if (node.finallyBlock) visit(node.finallyBlock, inTry)
      return
    }
    if (
      !inTry &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'parse' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'JSON'
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart())
      add('C', {
        rule: 'unguarded-json',
        severity: 'warn',
        message: 'JSON.parse outside a try — decide what an invalid payload means before it throws.',
        file: entry.rel,
        line: line + 1,
      })
    }
    ts.forEachChild(node, (child) => visit(child, inTry))
  }
  visit(sourceFile, false)
}

for (const entry of files) {
  if (!CODE_EXT.has(extname(entry.abs)) || entry.rel === SELF) continue
  // Test sources deliberately carry broken fixtures inside string literals, so
  // the crash patterns would flag the data rather than the test.
  if (entry.rel.startsWith('tests/')) continue
  const text = textOf(entry)
  if (!text) continue
  scanJsonParse(entry, text)
  for (const pattern of crashPatterns) {
    if (pattern.unless && text.includes(pattern.unless)) continue
    const matcher = new RegExp(pattern.source, 'g')
    let match: RegExpExecArray | null
    while ((match = matcher.exec(text))) {
      add('C', {
        rule: pattern.rule,
        severity: pattern.severity ?? 'warn',
        message: pattern.message,
        file: entry.rel,
        line: lineAt(text, match.index),
      })
    }
  }
}

// ---------------------------------------------------------------------------
// S — syntax errors
// ---------------------------------------------------------------------------

const compilerOptions: ts.CompilerOptions = {
  allowJs: true,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
}

for (const entry of files) {
  const ext = extname(entry.abs)
  const text = textOf(entry)
  if (!text) continue

  // A declaration file is types only: there is no JavaScript to emit, so asking
  // the transpiler for output fails outright rather than reporting a syntax
  // error. Typecheck covers it; the crash, orphan and ghost rules still read it.
  if (CODE_EXT.has(ext) && !DECLARATION.test(entry.abs)) {
    const result = ts.transpileModule(text, { fileName: entry.abs, reportDiagnostics: true, compilerOptions })
    for (const diagnostic of result.diagnostics ?? []) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue
      const start = diagnostic.start ?? 0
      add('S', {
        rule: 'parse-error',
        severity: 'error',
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        file: entry.rel,
        line: lineAt(text, start),
      })
    }
  }

  if (ext === '.json') {
    try {
      JSON.parse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON'
      const position = Number(message.match(/position (\d+)/)?.[1] ?? 0)
      add('S', { rule: 'invalid-json', severity: 'error', message, file: entry.rel, line: lineAt(text, position) })
    }
  }

  const conflict = text.match(/^(<{7}|={7}|>{7})(?: |$)/m)
  if (conflict && conflict.index !== undefined) {
    add('S', { rule: 'merge-marker', severity: 'error', message: 'Merge conflict marker left in the file.', file: entry.rel, line: lineAt(text, conflict.index) })
  }
}

// ---------------------------------------------------------------------------
// O — orphans
// ---------------------------------------------------------------------------

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(join(root, fromFile, '..'), specifier)
  const candidates = [base]
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']) candidates.push(base + ext)
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.css']) candidates.push(join(base, `index${ext}`))
  return candidates.find((candidate) => files.some((file) => file.abs === candidate)) ?? null
}

const importPatterns = [
  /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const imported = new Set<string>()
for (const entry of files) {
  if (!CODE_EXT.has(extname(entry.abs))) continue
  const text = textOf(entry)
  if (!text) continue
  for (const pattern of importPatterns) {
    const matcher = new RegExp(pattern.source, 'g')
    let match: RegExpExecArray | null
    while ((match = matcher.exec(text))) {
      const resolved = resolveImport(entry.rel, match[1])
      if (resolved) imported.add(resolved)
    }
  }
}

const entryPoints = new Set(
  files
    .filter((entry) => /^(src[\\/](main|worker\/index)|vite\.config|scripts[\\/])/.test(entry.rel) || /^src[\\/]worker[\\/]index\./.test(entry.rel))
    .map((entry) => entry.abs),
)

for (const entry of files) {
  if (!entry.abs.startsWith(join(root, 'src'))) continue
  // A declaration file is never imported: tsconfig includes it, and the ambient
  // globals it declares are found by the compiler. Flagging it as unused would
  // say the opposite of what is true about how it is used.
  if (DECLARATION.test(entry.abs)) continue
  if (!CODE_EXT.has(extname(entry.abs)) && extname(entry.abs) !== '.css') continue
  if (entryPoints.has(entry.abs) || imported.has(entry.abs)) continue
  add('O', { rule: 'unused-source', severity: 'warn', message: 'Nothing imports this file from an entry point.', file: entry.rel })
}

// Public assets: referenced literally, or covered by a dynamic template prefix
// such as `/images/tools/${slug}.svg`.
const allText = [...texts.values()].join('\n')
const dynamicPrefixes = [...allText.matchAll(/`(\/[^`$]*?)\$\{/g)].map((match) => match[1])
const publicDir = join(root, 'public')
if (safeIsDir(publicDir)) {
  for (const entry of files) {
    if (!entry.abs.startsWith(publicDir + '/')) continue
    const url = '/' + relative(publicDir, entry.abs).split('\\').join('/')
    const literal = allText.includes(url)
    const dynamic = dynamicPrefixes.some((prefix) => url.startsWith(prefix))
    if (!literal && !dynamic) {
      add('O', { rule: 'unused-asset', severity: 'warn', message: `Nothing references ${url}.`, file: entry.rel })
    }
  }
}

// Dependencies that never appear in the code or config.
const pkgPath = join(root, 'package.json')
let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> } | null = null
if (safeIsDir(root) && files.some((entry) => entry.rel === 'package.json')) {
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch {
    pkg = null
  }
}

if (pkg?.dependencies) {
  // Text of everything except the manifest and its lockfile, so a dependency
  // cannot count itself as usage.
  const configText = [...texts.entries()]
    .filter(([abs]) => !abs.endsWith('package.json') && !abs.endsWith('package-lock.json'))
    .map(([, text]) => text)
    .join('\n')
  for (const name of Object.keys(pkg.dependencies)) {
    if (!configText.includes(name)) {
      add('O', { rule: 'unused-dependency', severity: 'warn', message: `Declared in package.json but never referenced: ${name}.` })
    }
  }
}

// Stale scripts: a package script that points at a file that is not there.
if (pkg?.scripts) {
  for (const [name, command] of Object.entries(pkg.scripts)) {
    const match = command.match(/node\s+(scripts\/[^\s]+)/)
    if (match && !files.some((entry) => entry.rel === match[1])) {
      add('O', { rule: 'dead-script', severity: 'warn', message: `Script "${name}" points at ${match[1]}, which does not exist.` })
    }
  }
}

// Leftover copies, backups and OS droppings.
const strayPattern = /(?:^|\/)(?:.*(?: copy(?: \d+)?|\(\d+\)|\.bak|\.orig|\.tmp|\.swp|~)|\.DS_Store|Thumbs\.db)$/i
for (const entry of files) {
  if (strayPattern.test(entry.rel)) add('O', { rule: 'stray-file', severity: 'info', message: 'Backup or copy — confirm it is not a second source of truth.', file: entry.rel })
}

for (const entry of dirs) {
  try {
    if (readdirSync(entry.abs).length === 0) add('O', { rule: 'empty-directory', severity: 'info', message: 'Empty directory.', file: entry.rel })
  } catch {
    // unreadable directory: ignore
  }
}

// ---------------------------------------------------------------------------
// G — ghosts
// ---------------------------------------------------------------------------

for (const entry of entries.filter((item) => item.isSymlink)) {
  let target = ''
  try {
    target = realpathSync(entry.abs)
  } catch {
    target = ''
  }
  const outside = target !== '' && target !== root && !target.startsWith(root + sep)
  add('G', {
    rule: 'symlink',
    severity: outside ? 'error' : 'warn',
    message: outside ? `Symlink points outside the project (${target}).` : 'Symlink in the tree — confirm what it is for.',
    file: entry.rel,
  })
}

if (pkg?.scripts) {
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']) {
    if (pkg.scripts[hook]) {
      add('G', { rule: 'lifecycle-script', severity: 'warn', message: `"${hook}" runs automatically on install: ${pkg.scripts[hook]}`, file: 'package.json' })
    }
  }
}

const hooksDir = join(root, '.git', 'hooks')
if (safeIsDir(hooksDir)) {
  for (const name of readdirSync(hooksDir)) {
    if (name.endsWith('.sample')) continue
    add('G', { rule: 'git-hook', severity: 'warn', message: 'Git hook will run on commit or checkout — read it before you trust it.', file: relative(root, join(hooksDir, name)) })
  }
}

const secrets = files.filter((entry) => /(^|\/)(\.env(\..+)?|\.dev\.vars(\..+)?|id_rsa|id_ed25519|.*\.pem)$/.test(entry.rel))
// .gitignore has no extension, so read it directly rather than through textOf.
let ignoreText = ''
try {
  ignoreText = readFileSync(join(root, '.gitignore'), 'utf8')
} catch {
  ignoreText = ''
}
for (const entry of secrets) {
  const ignored = /(^|\n)(\.env|\.dev\.vars|\*\.pem|id_rsa)/.test(ignoreText) || ignoreText.includes(entry.rel.split('/').pop() ?? '')
  add('G', {
    rule: 'secret-file',
    severity: ignored ? 'info' : 'error',
    message: ignored ? 'Local secrets file — ignored by git, keep it that way.' : 'Secrets file is not covered by .gitignore.',
    file: entry.rel,
  })
}

if (!ignoreText.includes('node_modules')) {
  add('G', { rule: 'ignored-installs', severity: 'warn', message: 'node_modules is not listed in .gitignore.', file: '.gitignore' })
}

for (const entry of files) {
  if (entry.size > 5 * 1024 * 1024) {
    add('G', { rule: 'large-file', severity: 'warn', message: `Large file (${(entry.size / 1024 / 1024).toFixed(1)} MB) — host binaries upstream.`, file: entry.rel })
  }
  if ((entry.mode & 0o111) !== 0 && !entry.rel.startsWith('scripts/')) {
    add('G', { rule: 'executable', severity: 'info', message: 'Executable file in the repository — confirm it belongs.', file: entry.rel })
  }
}

const knownHidden = new Set(['.git', '.github', '.vscode', '.idea', '.wrangler', '.freebuff', '.dev.vars', '.env', '.gitignore', '.mailmap', '.editorconfig'])
for (const entry of entries.filter((item) => item.isDir)) {
  const name = entry.rel.split('/')[0]
  if (name.startsWith('.') && !entry.rel.includes('/') && !knownHidden.has(name)) {
    add('G', { rule: 'hidden-directory', severity: 'info', message: 'Hidden directory at the root — confirm what created it.', file: entry.rel })
  }
}

// ---------------------------------------------------------------------------
// Host (opt-in)
// ---------------------------------------------------------------------------

// `--host` widens the ghost pass from the repository to the machine under it:
// hardware with no driver, drivers blocked from loading, DKMS records that have
// lost their source. Opt-in, because a project's findings are about the tree;
// whichever machine happens to run the check is somebody's business only when
// they ask. The sweep is read-only, so asking costs nothing.
let host: HostReport | null = null
if (hostFlag) {
  host = scanHost()
  for (const finding of host.findings) {
    add('G', { rule: finding.rule, severity: finding.severity, message: finding.message, file: finding.file, remedy: finding.remedy })
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const counts = {
  C: findings.C.length,
  O: findings.O.length,
  S: findings.S.length,
  G: findings.G.length,
}
const total = counts.C + counts.O + counts.S + counts.G
const scanned = { files: files.length, dirs: dirs.length, truncated, skipped }

function markdown(): string {
  const lines = [
    `# COS-G report`,
    '',
    `Target: \`${root}\``,
    '',
    `${files.length} files scanned · C ${counts.C} · O ${counts.O} · S ${counts.S} · G ${counts.G}`,
    '',
    '## How to work a finding',
    '',
    'Every pass runs the same loop: define the problem, select one course of action, test it, implement on success or take it back through the cycle.',
    '',
    ...(['C', 'O', 'S', 'G'] as const).map((category) => `- **${category} — ${labels[category]}**: ${playbooks[category].definition}`),
    '',
  ]
  for (const category of ['C', 'O', 'S', 'G'] as const) {
    lines.push(`## ${category} — ${labels[category]}`, '')
    if (findings[category].length === 0) {
      lines.push('No findings.', '')
      continue
    }
    for (const finding of findings[category]) {
      const where = finding.file ? `\`${finding.file}${finding.line ? `:${finding.line}` : ''}\` ` : ''
      lines.push(`- ${finding.severity.toUpperCase()} ${where}${finding.message} _(${finding.rule})_`)
      if (finding.remedy) lines.push(`  - Fix: \`${finding.remedy.command}\`${finding.remedy.root ? ' (needs root)' : ''}`)
    }
    lines.push('')
  }
  if (host) {
    lines.push('## Host — drivers, blacklists and DKMS', '')
    if (!host.available) {
      lines.push(`Skipped: ${host.reason}`, '')
    } else {
      const dark = host.devices.filter((device) => !device.driver).length
      lines.push(`${host.devices.length} PCI devices on kernel ${host.kernel} · ${dark} with no driver`, '')
      for (const device of host.devices) {
        lines.push(`- \`${device.slot}\` ${device.kind} · ${device.driver ?? 'no driver'} · ${device.name}`)
      }
      lines.push('')
      lines.push(`Blacklisted: ${blacklistSummary(host.blacklists)}.`)
      lines.push(`${host.loaded.length} modules loaded right now.`)
      lines.push('')
      for (const record of host.dkms) {
        const built = record.built.length === 0 ? 'built for no kernel' : `built for ${record.built.join(', ')}`
        lines.push(`- DKMS ${record.name} ${record.version} — ${record.conf ? 'source present' : 'source missing'}; ${built}`)
      }
      lines.push('')
    }
  }
  lines.push('_Read-only scan: nothing was executed, edited or deleted._', '')
  return lines.join('\n')
}

if (asJson) {
  console.log(JSON.stringify({ root, generatedAt: new Date().toISOString(), scanned, counts, total, playbooks, host, findings }, null, 2))
} else {
  console.log(`COS-G · ${root}`)
  console.log(`${scanned.files} files · ${scanned.dirs} directories${truncated ? ` (stopped at ${MAX_FILES})` : ''}`)
  console.log('Loop: define → select a course of action → test it → implement, or take it back through the cycle. (`--rules`)')
  console.log('')
  for (const category of ['C', 'O', 'S', 'G'] as const) {
    const list = findings[category]
    console.log(`${category} — ${labels[category]} · ${list.length === 0 ? 'clear' : `${list.length} finding${list.length === 1 ? '' : 's'}`}`)
    for (const finding of list.slice(0, 12)) {
      const where = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : ''
      console.log(`  ${finding.severity.padEnd(5)} ${where}${where ? ' — ' : ''}${finding.message}`)
      // The command the COS-G page offers for the same finding, so the terminal
      // hands over what to run rather than only what is wrong.
      if (finding.remedy) console.log(`        fix: ${finding.remedy.command}${finding.remedy.root ? ' (needs root)' : ''}`)
    }
    if (list.length > 12) console.log(`  …and ${list.length - 12} more`)
    console.log('')
  }
  if (host) {
    console.log('Host — drivers, blacklists and DKMS')
    if (!host.available) {
      console.log(`  skipped: ${host.reason}`)
    } else {
      const dark = host.devices.filter((device) => !device.driver).length
      console.log(`  ${host.devices.length} PCI devices on kernel ${host.kernel} · ${dark} with no driver`)
      for (const device of host.devices) {
        console.log(`  ${device.slot}  ${device.kind.padEnd(18)} ${(device.driver ?? '—').padEnd(18)} ${device.name}`)
      }
      console.log(`  blacklisted: ${blacklistSummary(host.blacklists)}`)
      console.log(`  loaded: ${host.loaded.length} modules right now`)
      for (const record of host.dkms) {
        const built = record.built.length === 0 ? 'built for no kernel' : `built for ${record.built.join(', ')}`
        console.log(`  dkms ${record.name} ${record.version}: ${record.conf ? 'source present' : 'source missing'}; ${built}`)
      }
    }
    console.log('')
  }
  console.log(`Total: ${total} finding${total === 1 ? '' : 's'}. Read-only: nothing was executed, edited or deleted.`)
  if (truncated) console.log(`Stopped after ${MAX_FILES} files; point COS-G at a narrower directory for a full pass.`)
}

/**
 * What the sweep said about a finding, in the shape a file keeps. A finding is
 * identified by its rule and its message — the message names the device, module
 * or path — so a copy can be compared with a sweep run weeks later, when the
 * machine, the kernel or the driver on it has moved.
 */
interface KeptFinding {
  rule: string
  severity: string
  message: string
  file?: string
}

interface Snapshot {
  generatedAt: string
  kernel: string
  available: boolean
  findings: KeptFinding[]
}

/** Marks the copy as ours, so an unrelated fixes.json is not read as one. */
const SNAPSHOT_KIND = 'red-queen/host-findings'

/** Which findings a later sweep found gone, new, or still there. */
interface Delta {
  at: string
  cleared: KeptFinding[]
  added: KeptFinding[]
  unchanged: number
}

const findingKey = (finding: KeptFinding) => `${finding.rule}\u0000${finding.message}`

/**
 * The warnings, and only the warnings: an info finding is a note that needed no
 * action when it was written, so it cannot have been cleared later.
 */
function keptFindings(report: HostReport): KeptFinding[] {
  return report.findings
    .filter((finding) => finding.severity === 'warn')
    .map((finding) => ({
      rule: finding.rule,
      severity: finding.severity,
      message: finding.message,
      ...(finding.file ? { file: finding.file } : {}),
    }))
}

/** The copy beside the script, or null when there is none to read. */
function readSnapshot(path: string): Snapshot | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.kind !== SNAPSHOT_KIND || typeof value.generatedAt !== 'string') return null
  const findings = (Array.isArray(value.findings) ? value.findings : []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    if (typeof record.rule !== 'string' || !record.rule) return []
    if (typeof record.message !== 'string' || !record.message.trim()) return []
    const file = typeof record.file === 'string' && record.file ? record.file : undefined
    return [
      {
        rule: record.rule,
        severity: typeof record.severity === 'string' && record.severity ? record.severity : 'warn',
        message: record.message.trim(),
        ...(file ? { file } : {}),
      },
    ]
  })
  return {
    generatedAt: value.generatedAt,
    kernel: typeof value.kernel === 'string' ? value.kernel : '',
    available: value.available === true,
    findings,
  }
}

/** UTC to the minute, the way a release row writes time. */
function stampOf(at: string): string {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? at : date.toISOString().slice(0, 16).replace('T', ' ')
}

/** A rule's label, or the rule itself when a copy names one this build does not know. */
function labelOf(rule: string): string {
  return (hostRuleLabels as Record<string, string | undefined>)[rule] ?? rule
}

function compareFindings(before: KeptFinding[], after: KeptFinding[], at: string): Delta {
  const now = new Set(after.map(findingKey))
  const then = new Set(before.map(findingKey))
  return {
    at,
    cleared: before.filter((finding) => !now.has(findingKey(finding))),
    added: after.filter((finding) => !then.has(findingKey(finding))),
    unchanged: after.filter((finding) => then.has(findingKey(finding))).length,
  }
}

/**
 * The host remedies as a shell script. Written, never run: the sweep reads the
 * machine, and these commands change it, so the file is something to read first
 * — which is also why every line says what it is for and what it needs.
 */
function fixScript(report: HostReport, delta: Delta | null): string {
  const lines = [
    '#!/bin/sh',
    "# Red Queen — the commands that clear this machine's host findings.",
    '#',
    '# Written by: npm run cosg -- . --host --fix',
    '# Nothing here has been run. The sweep only reads the machine, so read this',
    '# before pasting anything out of it; set -e stops at the first failure.',
    '#',
  ]
  if (!report.available) {
    lines.push(`# The sweep could not read this machine: ${report.reason}`, '# Nothing to run.', 'set -eu', '')
    return lines.join('\n')
  }

  const warnings = report.findings.filter((finding) => finding.severity === 'warn')
  const runnable = warnings.filter((finding) => finding.remedy)
  const manual = warnings.filter((finding) => !finding.remedy)
  lines.push(`# ${warnings.length} warning${warnings.length === 1 ? '' : 's'} on kernel ${report.kernel} · ${runnable.length} with a command`)
  // What changed since the copy this was built against, so the script says what
  // the last run's commands did rather than only what is left.
  if (delta) {
    lines.push(
      `# Since ${stampOf(delta.at)}: ${delta.cleared.length} cleared, ${delta.added.length} new, ${delta.unchanged} unchanged.`,
    )
  }
  lines.push('set -eu', '')
  for (const finding of runnable) {
    lines.push(`# ${hostRuleLabels[finding.rule]} — ${finding.message}`, finding.remedy?.command ?? '', '')
  }
  // A warning nothing can fix is named rather than dropped: the file accounts
  // for the sweep, so a missing command does not read as a missing finding.
  if (manual.length > 0) {
    lines.push('# No command clears these — they need a decision rather than a paste:', '#')
    for (const finding of manual) lines.push(`#   ${hostRuleLabels[finding.rule]} — ${finding.message}`)
    lines.push('')
  }
  if (runnable.length === 0) lines.push('# Nothing to run: no warning on this machine has a command.')
  return lines.join('\n')
}

if (reportPath) {
  writeFileSync(resolve(process.cwd(), reportPath), markdown())
  if (!asJson) console.log(`Report written to ${reportPath}.`)
}

if (fixPath && host) {
  const scriptTarget = resolve(process.cwd(), fixPath)
  // Beside the script, under the same name: the two are read together, and a
  // copy with no script next to it would be a findings file with no fix.
  const keptTarget = scriptTarget.replace(/\.[^./\\]*$/, '') + '.json'
  const keptLabel = fixPath.replace(/\.[^./\\]*$/, '') + '.json'
  const present = existsSync(keptTarget)
  const before = present ? readSnapshot(keptTarget) : null
  // Only two readable sweeps can be compared: a copy from a machine that could
  // not be read says nothing about what has changed on one that can.
  const delta = before && before.available && host.available ? compareFindings(before.findings, keptFindings(host), before.generatedAt) : null

  writeFileSync(scriptTarget, fixScript(host, delta))
  if (!asJson) console.log(`Fixes written to ${fixPath}. Nothing in it has been run.`)

  if (host.available) {
    const snapshot = { program: 'Red Queen', kind: SNAPSHOT_KIND, generatedAt: new Date().toISOString(), kernel: host.kernel, available: true, findings: keptFindings(host) }
    writeFileSync(keptTarget, JSON.stringify(snapshot, null, 2) + '\n')
    if (asJson) {
      // Nothing to say on a JSON run: the answer is the JSON.
    } else if (delta && (delta.cleared.length > 0 || delta.added.length > 0)) {
      console.log(`Findings kept in ${keptLabel}.`)
      console.log(`  since   ${stampOf(delta.at)} · ${delta.cleared.length} cleared, ${delta.added.length} new, ${delta.unchanged} unchanged`)
      for (const finding of delta.cleared) console.log(`  gone    ${labelOf(finding.rule)} — ${finding.message}`)
      for (const finding of delta.added) console.log(`  new     ${labelOf(finding.rule)} — ${finding.message}`)
    } else if (delta) {
      console.log(`Findings kept in ${keptLabel}.`)
      console.log(`  since   ${stampOf(delta.at)} · nothing changed: ${delta.unchanged} warning${delta.unchanged === 1 ? '' : 's'} as before`)
    } else if (present) {
      console.log(`Findings kept in ${keptLabel}. The copy already there could not be read, so nothing here is compared with it.`)
    } else {
      console.log(`Findings kept in ${keptLabel}, for a later run to compare against.`)
    }
  } else if (!asJson) {
    console.log('The sweep could not read this machine, so there were no findings to keep.')
  }
}

const failedSyntax = counts.S > 0
process.exit(failedSyntax || (strict && total > 0) ? 1 : 0)
