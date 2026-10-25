// The doctrine the checker prints and the site links to. Pure data, no clock,
// no filesystem: the CLI and the regression tests both read it from here.
export type Category = 'C' | 'O' | 'S' | 'G'

export const labels: Record<Category, string> = {
  C: 'Crash risks',
  O: 'Orphaned strings, directories and programs',
  S: 'Syntax errors',
  G: 'Ghosts',
}

// Each pass is the same loop: define, choose one course of action, test it,
// then implement or take it back through.
export const playbooks: Record<Category, { definition: string; steps: string[] }> = {
  C: {
    definition: 'A crash risk is a path that throws, hangs, exits or corrupts state when it meets an input it did not expect.',
    steps: [
      'Define the crash risk: name the failure, the input and the line.',
      'Select one course of action: the smallest change that handles that failure.',
      'Test it: reproduce the crash, then run the change against the reproduction.',
      'Successful course of action → implement it.',
      'Unsuccessful course of action → take it back through the cycle.',
    ],
  },
  O: {
    definition: 'An orphan is a string, directory, asset, script, dependency or program that nothing reaches and nobody owns.',
    steps: [
      'Define the type of orphan.',
      'Select one course of action: reference it, retire it, or archive it outside the tree.',
      'Test it: build, run the tests and search for surviving references.',
      'Successful course of action → implement it, in its own change.',
      'Unsuccessful course of action → take it back through the cycle. Never delete what you did not create.',
    ],
  },
  S: {
    definition: 'A syntax error is anything the parser, the type checker or the build refuses to accept as written.',
    steps: [
      'Define the error from the parser output, not from memory.',
      'Identify the type of syntax error: parse, type, JSON, merge marker or generated file.',
      'Find where it occurred: file, line and column.',
      'Decide how to fix it, and whether it is fixable in this pass.',
      'If it is fixable, test the fix by parsing or building again.',
      'Successful fix → implement it.',
      'Unsuccessful fix → attempt to solve it again from the parser output.',
    ],
  },
  G: {
    definition: 'A ghost is anything parasitic to the host: a process, hook, link, script or secret that outlives the work that created it.',
    steps: [
      'Define the ghost: what is present or running that should not be.',
      'Answer who, what, when, where and how: owner, artefact, start time, location, mechanism.',
      'Select one course of action: contain it, disable it, remove it or document it as required.',
      'Test it: prove the host is clean and the ghost is gone.',
      'Successful course of action → implement it.',
      'Unsuccessful course of action → take it back through the cycle.',
    ],
  },
}

// The extended bible. COS-G names four kinds of trouble; these name the
// failures inside them.
export const extended: [code: string, area: string, letters: string][] = [
  ['MDI T', 'startup', 'missing dependencies · linker · initialization · uncaught config'],
  ['L R R', 'runtime', 'logic · runtime exceptions · resource and interface failures'],
  ['S C N P', 'systems', 'security · concurrency · network · performance'],
  ['H N S I', 'hardware', 'bus faults · link failures · signal corruption · integration'],
  ['D C S R', 'release', 'data integrity · concurrency conflicts · security gaps · regression'],
]
