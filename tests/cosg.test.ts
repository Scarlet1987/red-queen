import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Each fixture is a throwaway project in the OS temp directory, scanned by the
// real CLI. Nothing here reaches into the repository or re-implements a rule.
const repo = fileURLToPath(new URL('..', import.meta.url))
const cli = join(repo, 'scripts', 'cosg.ts')
const scratch: string[] = []

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'red-queen-cosg-'))
  scratch.push(root)
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
  return root
}

interface Finding {
  rule: string
  severity: string
  file?: string
  line?: number
}

interface Report {
  total: number
  findings: Record<'C' | 'O' | 'S' | 'G', Finding[]>
}

function scan(root: string): { status: number | null; report: Report; stderr: string } {
  const result = spawnSync(process.execPath, [cli, root, '--json'], { cwd: repo, encoding: 'utf8' })
  assert.ok(result.stdout, `COS-G printed no JSON. stderr: ${result.stderr}`)
  return { status: result.status, report: JSON.parse(result.stdout) as Report, stderr: result.stderr }
}

after(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true })
})

const gitignore = 'node_modules\n'

test('a clean project produces no findings', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'src/main.ts': 'export const answer = 42\n',
  })
  const { status, report } = scan(root)
  assert.equal(report.total, 0)
  assert.equal(status, 0)
})

test('a declaration file is scanned as types, not transpiled as JavaScript', () => {
  // A .d.ts emits no JavaScript, so the transpiler behind the syntax rule throws
  // on one instead of reporting a parse error. Ambient declarations have to be
  // allowed in a project the checker can run over.
  const root = fixture({
    '.gitignore': gitignore,
    'src/globals.d.ts': 'declare const __VERSION__: string\n',
    'src/main.ts': 'export const answer = 42\n',
  })
  const { status, report } = scan(root)
  assert.deepEqual(report.findings.S, [])
  assert.equal(report.total, 0)
  assert.equal(status, 0)
})

test('C catches an unguarded parse and an empty catch', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'src/main.ts': "export function read(input: string) {\n  const value = JSON.parse(input)\n  try {\n    return value\n  } catch {}\n}\n",
  })
  const { report } = scan(root)
  const rules = report.findings.C.map((finding) => finding.rule)
  assert.ok(rules.includes('unguarded-json'))
  assert.ok(rules.includes('empty-catch'))
  assert.ok(report.findings.C.some((finding) => finding.file === 'src/main.ts' && finding.line === 2))
})

test('a regex exec is not mistaken for a child process', () => {
  const pattern = fixture({
    '.gitignore': gitignore,
    'src/main.ts': "export const digits = (text: string) => /\\d+/.exec(text)?.[0] ?? ''\n",
  })
  assert.equal(
    scan(pattern).report.findings.C.some((finding) => finding.rule === 'child-process'),
    false,
    'RegExp.exec is not a child process',
  )

  const process = fixture({
    '.gitignore': gitignore,
    'src/main.ts': "import { execSync } from 'node:child_process'\nexport const out = execSync('ls', { encoding: 'utf8' })\n",
  })
  assert.ok(
    scan(process).report.findings.C.some((finding) => finding.rule === 'child-process'),
    'a real child-process call must still be reported',
  )
})

test('a parse inside try is not reported', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'src/main.ts': 'export function read(input: string) {\n  try {\n    return JSON.parse(input)\n  } catch {\n    return null\n  }\n}\n',
  })
  const { report } = scan(root)
  assert.ok(!report.findings.C.some((finding) => finding.rule === 'unguarded-json'))
})

test('O catches an unreachable source file and an unused asset, not the used one', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'src/main.ts': "import { used } from './used'\nexport const value = used()\n",
    'src/used.ts': 'export const used = () => 1\n',
    'src/lonely.ts': 'export const lonely = 2\n',
    'public/unused.svg': '<svg xmlns="http://www.w3.org/2000/svg" />\n',
  })
  const { report } = scan(root)
  assert.ok(report.findings.O.some((finding) => finding.rule === 'unused-source' && finding.file === 'src/lonely.ts'))
  assert.ok(report.findings.O.some((finding) => finding.rule === 'unused-asset' && finding.file === 'public/unused.svg'))
  assert.ok(!report.findings.O.some((finding) => finding.file === 'src/used.ts'))
})

test('S catches a parse error, invalid JSON and a merge marker, and fails the run', () => {
  const root = fixture({
    '.gitignore': gitignore,
    'src/main.ts': 'export const broken = (\n',
    'data.json': '{ "a": 1, }\n',
    'src/conflict.ts': '<<<<<<< HEAD\nexport const a = 1\n=======\nexport const a = 2\n>>>>>>> other\n',
  })
  const { status, report } = scan(root)
  const rules = report.findings.S.map((finding) => finding.rule)
  assert.ok(rules.includes('parse-error'))
  assert.ok(rules.includes('invalid-json'))
  assert.ok(rules.includes('merge-marker'))
  assert.equal(status, 1)
})

test('G catches an unignored secret, a git hook and a symlink leaving the tree', () => {
  const root = fixture({
    '.gitignore': gitignore,
    '.env': 'TOKEN=not-a-real-secret\n',
    '.git/hooks/pre-commit': '#!/bin/sh\necho hook\n',
  })
  const outside = join(tmpdir(), `red-queen-outside-${process.pid}-${Date.now()}.txt`)
  writeFileSync(outside, 'outside\n')
  scratch.push(outside)
  symlinkSync(outside, join(root, 'leak'))

  const { report } = scan(root)
  const secret = report.findings.G.find((finding) => finding.rule === 'secret-file')
  assert.ok(secret, 'secret file is reported')
  assert.equal(secret.severity, 'error')
  assert.ok(report.findings.G.some((finding) => finding.rule === 'git-hook'))
  const link = report.findings.G.find((finding) => finding.rule === 'symlink')
  assert.ok(link, 'symlink is reported')
  assert.equal(link.severity, 'error')
})
