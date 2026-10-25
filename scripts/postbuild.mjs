// Strips files the Sites uploader refuses (hidden files and source maps)
// from the build output, so the deploy manifest can point straight at dist/.
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

function clean(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name.startsWith('.') || name.endsWith('.map')) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    if (statSync(path).isDirectory()) clean(path)
  }
}

clean(join(import.meta.dirname, '..', 'dist'))
