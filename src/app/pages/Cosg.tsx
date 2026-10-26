import { ArrowRight, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router'

import { HostPanel } from '../components/HostPanel'
import { ButtonLink, Container, Reveal, SectionTitle } from '../components/ui'

// Each pass runs the same loop: define, choose one course of action, test it,
// then implement on success or take it back through the cycle. S adds the step
// of locating the error and testing the fix before it is kept.
const passes = [
  {
    letter: 'C',
    title: 'Crash risks',
    question: 'Where would this fall over?',
    body: 'The failure waiting for a quiet Tuesday: an empty state nobody handled, a loop that trusts its input, an error swallowed so the next failure has no story. Find the crash before a user does.',
    catches: ['Null and empty paths', 'Unbounded loops', 'Swallowed errors', 'Unchecked writes', 'Leaked handles'],
    loop: [
      'Define the crash risk: name the failure, the input that causes it and the line it happens on.',
      'Select one course of action: the smallest change that handles that failure.',
      'Test the course of action: reproduce the crash first, then run the change against the reproduction.',
      'Successful course of action → implement it.',
      'Unsuccessful course of action → take it back through the cycle: redefine, choose again, test again.',
    ],
  },
  {
    letter: 'O',
    title: 'Orphaned strings, directories and programs',
    question: 'What is still here that nobody uses?',
    body: 'Dead strings, unused assets, empty directories, abandoned scripts and stray copies of programs. Orphans are not just clutter: they are the parts nobody tests, and the parts that keep running after you forgot them.',
    catches: ['Dead strings', 'Unused assets', 'Empty directories', 'Abandoned scripts', 'Unused dependencies'],
    loop: [
      'Define the type of orphan: a string, a directory, an asset, a script, a dependency or a whole program.',
      'Select a course of action: reference it again, retire it, or archive it outside the tree.',
      'Test the course of action: build, run the tests and search for surviving references.',
      'Successful course of action → implement it, in its own change.',
      'Unsuccessful course of action → take it back through the cycle. Never delete what you did not create.',
    ],
  },
  {
    letter: 'S',
    title: 'Syntax errors',
    question: 'What does the machine refuse to parse?',
    body: 'The cheapest pass, and the one most often skipped. Run the parser, the type checker and the build before reading code by eye. Merge markers, invalid JSON and stale generated files all live here.',
    catches: ['Parse errors', 'Invalid JSON', 'Merge markers', 'Type errors', 'Stale generated files'],
    loop: [
      'Define the error: its message, exactly as the parser printed it.',
      'Identify the type of syntax error: parse, type, JSON, merge marker or generated file.',
      'Find where the error occurred: file, line and column from the parser, never from memory.',
      'Decide how to fix the error, and whether it is fixable in this pass.',
      'If it is fixable, test the fix by parsing or building again.',
      'Successful fix → implement it.',
      'Unsuccessful fix → attempt to solve it again from the parser output, not from a guess.',
    ],
  },
  {
    letter: 'G',
    title: 'Ghosts',
    question: 'What is feeding on the host system?',
    body: 'Anything parasitic to the host: background processes, hooks, symlinks out of the tree, lifecycle scripts, secrets left where they can be read, binaries too large to belong. A ghost outlives the bug that created it.',
    catches: ['Background daemons', 'Outside symlinks', 'Git hooks', 'Install scripts', 'Unignored secrets'],
    loop: [
      'Define the ghost: what is present or running that should not be.',
      'Answer who, what, when, where and how: owner, artefact, start time, location and mechanism.',
      'Select a course of action: contain it, disable it, remove it or document it as required.',
      'Test the course of action: prove the host is clean and the ghost is gone.',
      'Successful course of action → implement it.',
      'Unsuccessful course of action → take it back through the cycle.',
    ],
  },
]

const applied = [
  {
    letter: 'C',
    text: 'Storage loaders parse JSON inside try/catch and every write is guarded against a full or blocked browser store. The DOM lookup in main.tsx is a guarded throw rather than an assertion, and every fetch checks response.ok with a timeout.',
  },
  {
    letter: 'O',
    text: 'The first COS-G run found studio.svg orphaned by the home redesign, plus ten category covers nothing rendered. They were removed, the generator was updated, and covers are now generated only for tools in the catalogue.',
  },
  {
    letter: 'S',
    text: 'The TypeScript parser is the referee. npm run typecheck, npm test and npm run cosg -- . all pass before any change is discussed — storage validators, doctrine and exports each carry their own checks.',
  },
  {
    letter: 'G',
    text: 'No binaries and no install lifecycle scripts; .env and .dev.vars are ignored. The checker re-tests symlinks, git hooks, secrets and oversized files on every run.',
  },
]

const functionRules = [
  'One job per function, with one failure branch for every parse, fetch, write or attach.',
  'If nothing calls it, it is an orphan — remove it in its own change.',
  'It compiles before it is discussed: tsc --noEmit is not optional.',
  'No hidden side effects: no global state, no network at import time, no work without an owner.',
  'Test the failure path and keep the reproduction. A green happy path is not a test.',
]

const commandments = [
  'Read the error before you read the code.',
  'One change at a time, then run the build again.',
  'A green build is not a pass — syntax is one letter of four.',
  'If you did not create it, do not delete it. Report it.',
  'A ghost outlives the bug: check the host before you trust the result.',
]

export function Cosg() {
  return (
    <Container className="pt-10 sm:pt-16">
      <div className="max-w-3xl">
        <p className="text-[14px] text-muted">The programming bible</p>
        <h1 className="font-display mt-3 text-[64px] leading-[0.95] text-balance sm:text-[96px]">
          COS<em className="italic text-accent">-G</em>
        </h1>
        <p className="mt-5 text-pretty text-[18px] leading-relaxed text-muted">
          Four passes for troubleshooting anything you build: check the crash risks, the orphans, the syntax, then the ghosts. Each pass runs the same loop — define it, choose one course of action, test it, then implement or go round again.
        </p>
      </div>

      <div className="mt-8 max-w-2xl">
        <pre className="overflow-x-auto rounded-card border border-line bg-fg px-5 py-4 text-[13px] leading-relaxed text-bg">
          <code>
            <span className="text-faint"># read-only: never runs, edits or deletes what it scans</span>
            {'\n'}npm run cosg -- ../my-project
            {'\n'}npm run cosg -- . --json
            {'\n'}npm run cosg -- . --report cosg-report.md
            {'\n'}npm run cosg -- . --host{'        '}and the machine: drivers, blacklists, DKMS
            {'\n'}npm run cosg -- --rules
            {'\n'}npm test
          </code>
        </pre>
        <p className="mt-3 text-[13.5px] leading-relaxed text-faint">
          The checker prints a C / O / S / G report with file and line references, and <code className="rounded-[5px] bg-surface-2 px-1 py-0.5">--rules</code> prints the loop for each pass. It exits non-zero only when syntax errors are found, unless you pass <code className="rounded-[5px] bg-surface-2 px-1 py-0.5">--strict</code>. <code className="rounded-[5px] bg-surface-2 px-1 py-0.5">npm test</code> runs the regression suite: storage validation, the doctrine itself, and both Markdown exports.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <ButtonLink to="/cosg/worksheet" variant="secondary">
            Open a worksheet
            <ArrowRight />
          </ButtonLink>
          <span className="text-[13px] text-faint">One finding at a time, saved in this browser.</span>
        </div>
      </div>

      <div className="mt-12 divide-y divide-line border-y border-line">
        {passes.map((pass) => (
          <Reveal key={pass.letter}>
            <section className="grid gap-8 py-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
              <div>
                <div className="flex items-baseline gap-4">
                  <span className="font-display text-[56px] leading-none text-accent">{pass.letter}</span>
                  <h2 className="text-[18px] font-medium leading-snug">{pass.title}</h2>
                </div>
                <p className="mt-3 text-[14px] italic text-muted">{pass.question}</p>
                <p className="mt-4 text-[15px] leading-relaxed text-muted">{pass.body}</p>
                <p className="mt-5 text-[11px] uppercase tracking-[0.12em] text-faint">Catches</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {pass.catches.map((item) => (
                    <li key={item} className="rounded-[8px] bg-surface-2 px-2 py-1 text-[12px] text-muted">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.12em] text-faint">The loop</p>
                <ol className="mt-3 flex flex-col gap-3">
                  {pass.loop.map((step, index) => (
                    <li key={step} className="flex gap-3 text-[14.5px] leading-relaxed text-muted">
                      <span className="round mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-[11px] tabular-nums text-fg">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          </Reveal>
        ))}
      </div>

      <section className="mt-20">
        <SectionTitle eyebrow="COS-G on the host" title="What this copy can see of this machine" />
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
          A ghost does not have to live in the tree. G reaches the machine under it: hardware present with no driver, a block in <code className="rounded-[5px] bg-surface-2 px-1 py-0.5">/etc/modprobe.d</code> that is not holding, a driver loaded for hardware that is not here, a DKMS record whose build will not survive the next reboot. A local install sweeps the computer it is installed on and answers here, so none of it needs a terminal first. The copy served from the website has no machine to read and says so.
        </p>
        <HostPanel />
      </section>

      <section className="mt-20">
        <SectionTitle eyebrow="The doctrine, applied" title="COS-G on Red Queen itself" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {applied.map((item, index) => (
            <Reveal key={item.letter} delay={index * 0.06}>
              <div className="flex h-full gap-4 rounded-card border border-line bg-surface p-5">
                <span className="font-display text-[30px] leading-none text-accent">{item.letter}</span>
                <p className="text-[14px] leading-relaxed text-muted">{item.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-20 grid gap-10 rounded-[32px] bg-surface-2/60 p-6 sm:p-10 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-faint">Own functions</p>
          <h2 className="font-display mt-2 text-[34px] leading-[1.05] sm:text-[42px]">The same four letters apply to every function we write</h2>
          <p className="mt-3 max-w-md text-[14.5px] leading-relaxed text-muted">
            COS-G is not only for the program under the debugger. It is the review we owe our own functions before anyone else has to troubleshoot them.
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {functionRules.map((rule, index) => (
            <li key={rule} className="flex gap-3 border-b border-line pb-3 text-[14.5px] leading-relaxed text-muted last:border-0 last:pb-0">
              <span className="font-display text-[20px] leading-none text-accent">{String(index + 1).padStart(2, '0')}</span>
              <span className="pt-0.5">{rule}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-20 grid gap-12 lg:grid-cols-[1fr_2fr]">
        <h2 className="font-display text-[34px] leading-[1.05]">The order is a suggestion</h2>
        <div className="flex flex-col gap-5 text-[16px] leading-relaxed text-muted">
          <p>
            The letters spell COS-G, so that is how you read them. The work does not always follow: when the build is red, jump straight to <strong className="font-medium text-fg">S</strong>. When a program dies without an error, start at <strong className="font-medium text-fg">C</strong>. Before you ship, sweep <strong className="font-medium text-fg">O</strong>, and before you trust a machine, sweep <strong className="font-medium text-fg">G</strong>.
          </p>
          <p>
            Each pass is deliberately small, and each loop ends the same way: keep the change if the test passes, put it back through the cycle if it does not. If a pass takes more than a few minutes, the program is telling you something about its shape, not about your troubleshooting.
          </p>
        </div>
      </section>

      <section className="mt-16 grid gap-12 lg:grid-cols-[1fr_2fr]">
        <h2 className="font-display text-[34px] leading-[1.05]">What the checker does</h2>
        <div className="flex flex-col gap-6 text-[16px] leading-relaxed text-muted">
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <div>
              <dt className="text-[15px] font-medium text-fg">C — crash patterns</dt>
              <dd className="mt-1 text-[14.5px]">Flags unguarded parsing, dynamic code, empty catch blocks, unbounded loops, fire-and-forget child processes and ignored exit paths.</dd>
            </div>
            <div>
              <dt className="text-[15px] font-medium text-fg">O — orphans</dt>
              <dd className="mt-1 text-[14.5px]">Follows imports from the real entry points, then reports source files, public assets, dependencies and leftover copies nothing reaches.</dd>
            </div>
            <div>
              <dt className="text-[15px] font-medium text-fg">S — syntax</dt>
              <dd className="mt-1 text-[14.5px]">Parses every TypeScript, JavaScript and JSON file with the compiler’s own parser and reports the line, not a guess.</dd>
            </div>
            <div>
              <dt className="text-[15px] font-medium text-fg">G — ghosts</dt>
              <dd className="mt-1 text-[14.5px]">Checks symlinks leaving the tree, git hooks, lifecycle scripts, unignored secrets, executable files and oversized blobs — and, with <code className="rounded-[5px] bg-surface-2 px-1 py-0.5">--host</code>, the machine itself: bound and unbound hardware, blacklists, idle drivers and DKMS.</dd>
            </div>
          </dl>
          <div className="flex items-start gap-3 rounded-card border border-line bg-surface p-5 text-[14px] leading-relaxed">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" />
            <p>
              The checker is read-only. It never executes the code it scans, never deletes a finding, never opens a network connection and never edits a file unless you explicitly ask for a report path.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-16">
        <SectionTitle eyebrow="Rules of thumb" title="Five commandments" />
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {commandments.map((rule, index) => (
            <li key={rule} className="rounded-card border border-line bg-surface p-5">
              <span className="font-display text-[26px] leading-none text-accent">{String(index + 1).padStart(2, '0')}</span>
              <p className="mt-3 text-[14px] leading-relaxed text-muted">{rule}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-20 grid gap-10 border-t border-line pt-10 lg:grid-cols-[1fr_2fr]">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-faint">The extended bible</p>
          <h2 className="font-display mt-2 text-[34px] leading-[1.05]">Three laws and the frameworks behind the letters</h2>
        </div>
        <div>
          <p className="text-[15.5px] leading-relaxed text-muted">
            COS-G names four kinds of trouble. The extended bible adds the laws the program answers to — no parasites or bloat, design for the real beginner, nothing deeper than three clicks — and five frameworks that name startup faults (MDI T), runtime faults (L R R), system faults (S C N P), hardware faults (H N S I) and release drift (D C S R).
          </p>
          <Link to="/cosg/bible" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium underline-offset-4 hover:underline">
            Read the extended bible
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section className="mt-20 flex flex-col items-start justify-between gap-6 rounded-[32px] bg-surface-2/60 p-6 sm:flex-row sm:items-center sm:p-10">
        <div>
          <h2 className="font-display text-[32px] leading-[1.05] sm:text-[40px]">Check before you reach for a tool</h2>
          <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-muted">
            COS-G is the pass that runs before the directory. When the host is clean and the build is still wrong, there is a tool here for it.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <ButtonLink to="/directory" size="lg">
            Open the directory
            <ArrowRight />
          </ButtonLink>
          <Link to="/safety" className="inline-flex h-14 items-center justify-center rounded-[16px] px-4 text-[15px] text-muted transition-colors hover:text-fg">
            Safety rules
          </Link>
        </div>
      </section>
    </Container>
  )
}
