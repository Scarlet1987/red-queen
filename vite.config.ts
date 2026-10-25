import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { requireRuntime } from './scripts/check-runtime.ts'

// Vite loads this config before it reads a source file, so the check here bites
// a bare `vite` / `vite build` / `vite preview` even when the npm script that
// normally guards first is bypassed. A correct runtime passes silently.
requireRuntime(import.meta.dirname)

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: { port: 5173, strictPort: false },
})
