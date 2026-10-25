// Every entry point that builds or serves starts here, so a wrong Node never
// gets as far as producing output. The gate refuses a build made elsewhere, but
// that verdict arrives after the work is done; this arrives before it starts,
// and names the version to install.
//
//   npm run dev · npm run build · npm run offline   (all begin with this)
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { accepts, readPin, readPinConfig, show } from './node-pin.ts'

const ROOT = resolve(import.meta.dirname, '..')

export type RuntimeVerdict = { ok: true; runtime: string; pin: string } | { ok: false; message: string }

/** Whether a Node version — `process.version` by default — satisfies the pin. */
export function verdictFor(root: string, runtime: string = process.version): RuntimeVerdict {
  const config = readPinConfig(root)
  if (!config.ok) return { ok: false, message: `The runtime cannot be checked: ${config.reason}.` }

  const running = readPin(runtime)
  if (!running.ok) {
    return { ok: false, message: `This is ${runtime}, which cannot be compared to .nvmrc: ${running.reason}.` }
  }

  const pinned = accepts(config.value.text, running.value)
  if (!pinned.ok) return { ok: false, message: `The runtime pin cannot be read: ${pinned.reason}.` }

  if (!pinned.value) {
    return {
      ok: false,
      message:
        `This is Node ${show(running.value)}, but .nvmrc pins ${config.value.text} — nothing this project runs should use an unpinned runtime.\n` +
        `Switch to the pinned version (nvm use, or install Node ${config.value.text}) and try again.`,
    }
  }

  return { ok: true, runtime, pin: config.value.text }
}

/**
 * Refuse from inside a build entry point, for the paths that do not go through
 * the npm scripts: a bare `vite` loads vite.config.ts and a bare
 * `node scripts/build-offline.ts` is this builder's own entry, and neither is
 * covered by a prefix someone has to remember to write.
 */
export function requireRuntime(root: string, runtime: string = process.version): void {
  const verdict = verdictFor(root, runtime)
  if (!verdict.ok) throw new Error(`Build refused: ${verdict.message}`)
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const verdict = verdictFor(ROOT)
  if (!verdict.ok) {
    console.error(`Build refused: ${verdict.message}`)
    process.exitCode = 1
  } else {
    console.log(`Runtime ok: ${verdict.runtime} (pinned ${verdict.pin})`)
  }
}
