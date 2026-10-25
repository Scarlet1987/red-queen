import { ArrowRight, Scale, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { countBySafety, safetyMeta, tools, type Safety } from '../../data/tools'
import { clearLocalData, storedOnDevice } from '../lib/wipe'
import { ButtonLink, Container, Reveal, SafetyChip } from '../components/ui'

const levelCopy: Record<Safety, { detail: string; examples: string[] }> = {
  static: {
    detail:
      'Parsers, disassemblers, decompilers and signature scanners read the bytes and stop there. Even so, opening a hostile file is not risk-free: parsers have bugs, so keep the tool patched and the machine unremarkable.',
    examples: ['ghidra', 'lief', 'yara'],
  },
  sandbox: {
    detail:
      'Emulators, symbolic executors and instrumentation frameworks execute the sample inside a controlled runtime. Network access is still yours to switch off, and emulator escapes are rare but real: use a disposable VM underneath.',
    examples: ['qiling', 'angr', 'pwntools'],
  },
  live: {
    detail:
      'Debuggers, instrumentation and network tools attach to something already running. That is the highest-risk category, and the only one where the target could be a production system or a device holding real accounts.',
    examples: ['frida', 'x64dbg', 'mitmproxy'],
  },
}

const sections = [
  {
    id: 'about',
    title: 'What this directory is',
    paras: [
      'Red Queen is a catalogue of tools that inspect, decompile, emulate or instrument software. Every entry links to the tool’s own project — nothing is mirrored, bundled or hosted here, and this site never receives the file you are working on.',
      'The point of the directory is the label on each entry: what the tool does to your file when you use it. A parser you point at a binary is a different risk from a debugger that runs it, and the listings say which is which before you download anything.',
    ],
  },
  {
    id: 'scope',
    title: 'Scope, legality and consent',
    paras: [
      'Only analyse software you own, software you have written permission to examine, or software whose licence allows it. Many commercial licences forbid reverse engineering outright, and in some jurisdictions that restriction is enforceable.',
      'Do not use anything listed here against systems, accounts or devices that are not yours. Intercepting someone else’s traffic, attaching to a process on a machine you do not administer, or bypassing a technical measure to distribute someone else’s work is not research.',
      'Red Queen exists for interoperability, security review, malware defence, education and recovering your own data. If your use needs a lawyer, get one; this page is not legal advice.',
    ],
  },
  {
    id: 'vetting',
    title: 'How entries are checked',
    paras: [
      'Each entry records the upstream project page, repository where one exists, licence, supported platforms and the behaviour category. Links, licences and platform claims are compared against the project itself when an entry is added.',
      'There are no affiliate links, sponsored placements or paid entries. A tool is listed because it is useful, maintained enough to run, and has an upstream source you can verify in one click.',
      'Categories describe the tool, not a promise about your machine. A “static only” tool with a remote-analysis feature can still upload your sample — the notes call that out where it matters.',
    ],
  },
  {
    id: 'corrections',
    title: 'Corrections',
    paras: [
      'Licences change, projects go quiet, links rot. If an entry is wrong — a licence, a platform, a safety label — it should be treated as a bug in the directory rather than an opinion.',
      'Corrections live in the repository alongside DIRECTORY.md, so the catalogue can be diffed and reviewed like code. The web directory is generated from the same data file that produces that document.',
    ],
  },
  {
    id: 'contributing',
    title: 'Contributing an entry',
    paras: [
      'An entry needs: a name, a category, a safety level, a licence, supported platforms, an official link and a one-line answer to “what does it do?”. A repository link is welcome but not required.',
      'What will not be listed: hosted malware, keygens, tools whose only purpose is defeating licensing, scraped credential dumps, or anything that requires breaking into a system you do not own. “It can do anything” is a warning sign, not a selling point.',
    ],
  },
]

export function Safety() {
  const [confirming, setConfirming] = useState(false)

  function forget() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    clearLocalData()
    window.location.assign('/')
  }

  return (
    <Container className="pt-10 sm:pt-16">
      <div className="max-w-3xl">
        <p className="text-[14px] text-muted">The rules</p>
        <h1 className="font-display mt-3 text-balance text-[48px] leading-[1] sm:text-[72px]">Safe means the risk is named, not hidden</h1>
        <p className="mt-6 text-pretty text-[17px] leading-relaxed text-muted">
          Every tool in this directory is labelled with what it does to the file you give it. That label — not a disclaimer at the bottom — is the safety model.
        </p>
      </div>

      <Reveal className="mt-12">
        <dl className="grid gap-8 border-y border-line py-8 sm:grid-cols-4">
          {[
            ['Entries', String(tools.length)],
            ['Static only', String(countBySafety('static'))],
            ['Sandboxed', String(countBySafety('sandbox'))],
            ['Live attach', String(countBySafety('live'))],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[14px] text-muted">{label}</dt>
              <dd className="font-display mt-2 text-[44px] leading-none">{value}</dd>
            </div>
          ))}
        </dl>
      </Reveal>

      <section id="levels" className="mt-20 scroll-mt-24">
        <h2 className="font-display text-[38px] sm:text-[48px]">The three levels</h2>
        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {(['static', 'sandbox', 'live'] as const).map((level, i) => (
            <Reveal key={level} delay={i * 0.08}>
              <div className="flex h-full flex-col rounded-card border border-line bg-surface p-6">
                <SafetyChip safety={level} className="self-start" />
                <p className="mt-4 text-[15px] font-medium">{safetyMeta[level].blurb}</p>
                <p className="mt-3 flex-1 text-[14px] leading-relaxed text-muted">{levelCopy[level].detail}</p>
                <div className="mt-5 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-4 text-[13px]">
                  {levelCopy[level].examples.map((slug) => {
                    const tool = tools.find((t) => t.slug === slug)!
                    return (
                      <Link key={slug} to={`/tool/${slug}`} className="text-muted underline-offset-4 hover:text-fg hover:underline">
                        {tool.name}
                      </Link>
                    )
                  })}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="mt-6 flex items-start gap-3 rounded-card bg-surface-2/60 p-5 text-[14px] leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" />
          <p>
            Whatever the level, the safe habit is the same: work on a copy, disconnect the network, keep snapshots, and assume the file is hostile until it proves otherwise.
          </p>
        </div>
      </section>

      <section className="mt-20 grid gap-12 lg:grid-cols-[1fr_2fr]">
        <p className="font-display text-[32px] leading-[1.1]">A tool is not permission</p>
        <div className="flex flex-col gap-12">
          {sections.map((section) => (
            <div key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="flex items-center gap-2 text-[16px] font-medium">
                {section.id === 'scope' && <Scale className="size-4 text-muted" />}
                {section.title}
              </h2>
              <div className="mt-3 flex flex-col gap-3 text-[16px] leading-relaxed text-muted">
                {section.paras.map((para) => (
                  <p key={para}>{para}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="device" className="mt-20 grid scroll-mt-24 gap-8 rounded-card border border-line p-6 sm:p-8 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="font-display text-[32px] leading-[1.05]">Leaving is clean too</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
            Red Queen installs nothing and runs no background service. The only trace it keeps is local to this browser, and one action removes all of it.
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-faint">Stored on this device</p>
          <ul className="mt-3 flex flex-col gap-1.5 text-[14px] text-muted">
            {storedOnDevice.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={forget}
              className={`inline-flex h-10 items-center rounded-[12px] px-4 text-[14px] font-medium transition-colors ${confirming ? 'bg-accent text-white hover:bg-accent/90' : 'border border-line-strong hover:border-fg'}`}
            >
              {confirming ? 'Confirm: erase and reload' : 'Forget everything on this device'}
            </button>
            {confirming && (
              <button type="button" onClick={() => setConfirming(false)} className="text-[13px] text-muted hover:text-fg">
                Cancel
              </button>
            )}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-faint">
            This clears the rack, refinements, worksheets, the harness model list and folder handle, and the workbench conversation. Files in your project folder are never touched.
          </p>
        </div>
      </section>

      <section className="mt-20 rounded-[32px] bg-surface-2/60 p-6 sm:p-10">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-[32px] leading-[1.05] sm:text-[40px]">Start with the tools that only read</h2>
            <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-muted">{countBySafety('static')} of {tools.length} entries never execute the file you hand them.</p>
          </div>
          <ButtonLink to="/directory?safety=static" size="lg" className="shrink-0">
            Static only
            <ArrowRight />
          </ButtonLink>
        </div>
      </section>
    </Container>
  )
}
