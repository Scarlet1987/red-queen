import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'

import { ButtonLink, Container, Reveal, SectionTitle } from '../components/ui'

// The extended doctrine. COS-G stays the loop; these are the frameworks that
// name the failures COS-G finds, plus the three laws the whole program answers to.
const laws = [
  {
    number: '01',
    title: 'Zero-parasite, anti-bloat',
    line: 'Every line, dependency, service and asset justifies its exact existence.',
    points: [
      'No host parasites: no unrequested daemons, silent telemetry loops, startup hooks or idle CPU and RAM when closed.',
      'Clean uninstall: no orphaned keys, hidden config folders or unreferenced libraries left behind.',
      'Resource respect: boots instantly, runs cool, and stays inside the machine’s limits.',
    ],
  },
  {
    number: '02',
    title: 'Grounded reality, beginner focus',
    line: 'We build for the intermediate-to-beginner, not the 0.01% edge case.',
    points: [
      'The edge-case user is not the one downloading the program; the real user wants a tool that works out of the box.',
      'Anyone — a kid on a first machine, a grandparent, a first-week developer — should grasp the intent without a manual.',
      'A feature that depends on fragile conditions or hypothetical states is structurally flawed and gets simplified.',
    ],
  },
  {
    number: '03',
    title: 'Three clicks, zero clutter',
    line: 'Nothing important hides, and nothing sits deeper than three clicks from home.',
    points: [
      'At-a-glance clarity: primary metrics, controls and paths are visible without hunting through sub-menus.',
      'Click 1 is the category, click 2 the module, click 3 the exact tool, setting or action.',
      'No redundant buttons, ornament or jargon. Every pixel serves an operational purpose.',
    ],
  },
]

interface Framework {
  id: string
  code: string
  name: string
  scope: string
  items: { letter: string; name: string; define: string; move: string }[]
}

const frameworks: Framework[] = [
  {
    id: 'mdi-t',
    code: 'MDI T',
    name: 'Launch and startup failures',
    scope: 'Nothing runs yet: the build fails or the program dies as it boots. Reach here first when the screen stays dark.',
    items: [
      {
        letter: 'M',
        name: 'Missing dependencies or imports',
        define: 'A package, module, library or local asset the code references and cannot find: skipped installs, import typos, absent DLLs.',
        move: 'Verify the environment, install or repair the dependency, correct the path, then lock it into the manifest.',
      },
      {
        letter: 'D',
        name: 'Linker errors',
        define: 'The code compiles, but the linker cannot find the implementation of a referenced symbol: a header with no body, a missing library flag.',
        move: 'Add the implementation or link the library in the build script, then compile from scratch.',
      },
      {
        letter: 'I',
        name: 'Initialization and type mismatches',
        define: 'Boot fails on an unassigned pointer, a null or undefined value, or an incompatible type reaching a startup routine.',
        move: 'Guard the initialisation, supply safe defaults, enforce strict types, and dry-run the bootstrap.',
      },
      {
        letter: 'T',
        name: 'Uncaught configuration or environment',
        define: 'The program boots, looks for mandatory settings or environment values, and finds them missing, malformed or unreadable.',
        move: 'Supply the values, validate the config syntax, restart, and document exactly what is required.',
      },
    ],
  },
  {
    id: 'lrr',
    code: 'L R R',
    name: 'Internal code behaviour',
    scope: 'It runs, but it is wrong, it crashes mid-flight, or it slowly consumes the machine.',
    items: [
      {
        letter: 'L',
        name: 'Logic errors',
        define: 'The code runs without crashing and returns the wrong result: off-by-one bounds, operator precedence, bad state tracking.',
        move: 'Trace the algorithm on one input, turn the failing case into a test, then refactor until it passes.',
      },
      {
        letter: 'R',
        name: 'Runtime exceptions',
        define: 'Execution halts on an illegal operation: division by zero, an index out of bounds, a null dereference.',
        move: 'Reproduce with malformed input, validate at the boundary, and wrap the vulnerable path defensively.',
      },
      {
        letter: 'R',
        name: 'Resource and interface failures',
        define: 'Degradation when the program touches memory, files, networks or hardware: leaks, unclosed handles, failing queries, timeouts.',
        move: 'Close what you open, sanitise queries, bound every wait, and watch memory under load.',
      },
    ],
  },
  {
    id: 'scnp',
    code: 'S C N P',
    name: 'Security, concurrency, network, performance',
    scope: 'It works alone and fails together: deep system faults, shared state, distributed calls and speed.',
    items: [
      {
        letter: 'S',
        name: 'Security and access vulnerabilities',
        define: 'A path to unauthorised data, code execution or privilege escalation: injection, leaked tokens, hardcoded secrets, broken access control.',
        move: 'Sanitise input, enforce encryption in transit and at rest, and rotate every exposed key.',
      },
      {
        letter: 'C',
        name: 'Concurrency and threading failures',
        define: 'Shared state touched by more than one thread or process: race conditions, deadlocks, starvation, atomic corruption.',
        move: 'Serialise the critical section with a lock, a queue or message passing, and test under contention.',
      },
      {
        letter: 'N',
        name: 'Network and protocol failures',
        define: 'Communication breakdown between services: DNS failures, socket timeouts, dropped packets, serialisation mismatches.',
        move: 'Add bounded retries with backoff, heartbeat checks and a strict payload schema.',
      },
      {
        letter: 'P',
        name: 'Performance and bottlenecks',
        define: 'Resource consumption that slows execution or chokes the hardware: hot loops, unindexed queries, memory bloat, redundant rendering.',
        move: 'Profile before changing anything, then index, cache or remove the work that is actually measured.',
      },
    ],
  },
  {
    id: 'hnsi',
    code: 'H N S I',
    name: 'Hardware, network, signal, integration',
    scope: 'Only when the project touches physical hardware, embedded boards or a local link. Skip it for a pure web app.',
    items: [
      {
        letter: 'H',
        name: 'Hardware and bus faults',
        define: 'Electrical or bus-level failure: I2C or SPI lockups, GPIO voltage mismatch, shorts, power-rail faults.',
        move: 'Check continuity, verify pull-ups and logic levels, and audit the power rails before touching firmware.',
      },
      {
        letter: 'N',
        name: 'Network and link failures',
        define: 'Local links that drop node to node: Wi-Fi or Ethernet loss, mesh routing gaps, static-IP conflicts.',
        move: 'Ping the gateway, verify interface bindings, and restart the network daemon before blaming the code.',
      },
      {
        letter: 'S',
        name: 'Signal and data corruption',
        define: 'Distorted or lost data on a physical or wireless line: baud-rate mismatch, electromagnetic interference, checksum failures.',
        move: 'Match baud rates exactly, shield the cable, shorten the run, and verify checksums end to end.',
      },
      {
        letter: 'I',
        name: 'Integration and protocol mismatches',
        define: 'Friction where different hardware APIs, firmware versions or standards meet: broken contracts, stale drivers, 3.3 V against 5 V.',
        move: 'Flash compatible firmware, update the wrapper, and use a level shifter where the voltages disagree.',
      },
    ],
  },
  {
    id: 'dcsr',
    code: 'D C S R',
    name: 'Data, concurrency, security, regression',
    scope: 'Before you ship, and after every update: integrity of stored state, collisions, exposed edges and drift.',
    items: [
      {
        letter: 'D',
        name: 'Data integrity and corruption',
        define: 'Silent or fatal damage to stored records: malformed saves, incomplete migrations, truncation.',
        move: 'Write transactionally, validate against a schema, and take a backup before the migration runs.',
      },
      {
        letter: 'C',
        name: 'Concurrency conflicts',
        define: 'Collisions when several scripts, agents or users write the same resource: simultaneous config writes, locked SQLite tables.',
        move: 'Lock the file or route writes through a single writer queue.',
      },
      {
        letter: 'S',
        name: 'Security gaps',
        define: 'Oversight in permission boundaries or exposed endpoints: open debug ports, unvalidated requests, missing checks.',
        move: 'Bind debug services to localhost, validate every request, and check permissions on the server.',
      },
      {
        letter: 'R',
        name: 'Regression and build drift',
        define: 'An update breaks something that used to work: changed signatures, moved paths, loose version ranges.',
        move: 'Pin the versions, keep a regression suite, and rerun it before the change ships.',
      },
    ],
  },
]

const reachFor = [
  ['The build is red', 'S, then MDI T'],
  ['It will not start', 'MDI T'],
  ['It starts, but the answer is wrong', 'L R R'],
  ['It works alone, fails under load', 'S C N P'],
  ['It touches a board, bus or sensor', 'H N S I'],
  ['Before a release, or after an update', 'D C S R'],
  ['The machine itself is suspect', 'G, then COS-G'],
]

export function Bible() {
  return (
    <Container className="pt-10 sm:pt-16">
      <div className="max-w-3xl">
        <p className="text-[14px] text-muted">The programming bible · extended</p>
        <h1 className="font-display mt-3 text-balance text-[52px] leading-[0.98] sm:text-[72px]">
          Three laws, five frameworks, one loop
        </h1>
        <p className="mt-5 text-pretty text-[17px] leading-relaxed text-muted">
          COS-G is the loop you run on a finding. These are the laws the program answers to, and the frameworks that name
          the failures COS-G goes looking for — startup, runtime, systems, hardware and release.
        </p>
      </div>

      <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2 text-[12.5px]">
        {[
          ['Laws', '#laws'],
          ['MDI T', '#mdi-t'],
          ['L R R', '#lrr'],
          ['S C N P', '#scnp'],
          ['H N S I', '#hnsi'],
          ['D C S R', '#dcsr'],
          ['Which one', '#reach'],
        ].map(([label, href]) => (
          <a key={href} href={href} className="rounded-[8px] border border-line px-2.5 py-1 text-muted transition-colors hover:border-line-strong hover:text-fg">
            {label}
          </a>
        ))}
      </nav>

      <section id="laws" className="mt-16 scroll-mt-24">
        <SectionTitle eyebrow="The laws" title="What every build answers to" />
        <div className="mt-8 grid gap-3 lg:grid-cols-3">
          {laws.map((law, index) => (
            <Reveal key={law.number} delay={index * 0.06}>
              <div className="flex h-full flex-col rounded-card border border-line bg-surface p-6">
                <span className="font-display text-[30px] leading-none text-accent">{law.number}</span>
                <h3 className="mt-3 text-[17px] font-medium leading-snug">{law.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{law.line}</p>
                <ul className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
                  {law.points.map((point) => (
                    <li key={point} className="text-[13.5px] leading-relaxed text-muted">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <div className="mt-20 flex flex-col gap-16">
        {frameworks.map((framework) => (
          <section key={framework.code} id={framework.id} className="scroll-mt-24">
            <div className="flex flex-col gap-3 border-t border-line pt-8 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-[38px] leading-none sm:text-[46px]">{framework.code}</h2>
                <p className="mt-2 text-[15px] font-medium">{framework.name}</p>
              </div>
              <p className="max-w-md text-[13.5px] leading-relaxed text-muted">{framework.scope}</p>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {framework.items.map((item) => (
                <div key={`${framework.code}-${item.letter}-${item.name}`} className="flex gap-4 rounded-card border border-line bg-surface p-5">
                  <span className="font-display text-[26px] leading-none text-accent">{item.letter}</span>
                  <div className="min-w-0">
                    <h3 className="text-[14.5px] font-medium leading-snug">{item.name}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{item.define}</p>
                    <p className="mt-3 text-[13px] leading-relaxed text-fg">
                      <span className="mr-1.5 text-[11px] uppercase tracking-[0.1em] text-faint">First move</span>
                      {item.move}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section id="reach" className="mt-20 scroll-mt-24">
        <SectionTitle eyebrow="Which one" title="Reach for the framework that matches the failure" />
        <dl className="mt-8 divide-y divide-line border-y border-line">
          {reachFor.map(([situation, answer]) => (
            <div key={situation} className="flex flex-col justify-between gap-1 py-3.5 sm:flex-row sm:items-center">
              <dt className="text-[14.5px]">{situation}</dt>
              <dd className="font-mono text-[12.5px] text-muted">{answer}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-faint">
          The frameworks only name the failure. The work still runs the COS-G loop: define it, choose one course of action, test it,
          then implement or take it back through the cycle.
        </p>
      </section>

      <section className="mt-20 flex flex-col items-start justify-between gap-6 rounded-[32px] bg-surface-2/60 p-6 sm:flex-row sm:items-center sm:p-10">
        <div>
          <h2 className="font-display text-[32px] leading-[1.05] sm:text-[40px]">Start with the loop</h2>
          <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-muted">
            COS-G is the pass that runs first, and the worksheet is where one finding is worked through it.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <ButtonLink to="/cosg" size="lg">
            COS-G
            <ArrowRight />
          </ButtonLink>
          <Link to="/cosg/worksheet" className="inline-flex h-14 items-center justify-center rounded-[16px] px-4 text-[15px] text-muted transition-colors hover:text-fg">
            Open a worksheet
          </Link>
        </div>
      </section>
    </Container>
  )
}
