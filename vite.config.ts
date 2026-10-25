import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { requireRuntime } from './scripts/check-runtime.ts'
import { resolveTag, tagOrNull } from './scripts/release-tag.ts'

// Vite loads this config before it reads a source file, so the check here bites
// a bare `vite` / `vite build` / `vite preview` even when the npm script that
// normally guards first is bypassed. A correct runtime passes silently.
requireRuntime(import.meta.dirname)

// The release identity, baked in at build time: /api/health answers with these,
// so a visitor can ask a deployment which release it is, and the smoke test can
// compare that answer with dist/build.json. Resolved here rather than read from
// the stamp because the Worker is bundled before the stamp exists; the stamp
// records the same values afterwards.
const version = (JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
const tag = tagOrNull(resolveTag(import.meta.dirname))

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  define: {
    __RED_QUEEN_VERSION__: JSON.stringify(version),
    __RED_QUEEN_TAG__: JSON.stringify(tag),
  },
  server: { port: 5173, strictPort: false },
})
