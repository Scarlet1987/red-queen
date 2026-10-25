import { Hono } from 'hono'

import { bySlug, safetyMeta, type Tool } from '../data/tools.ts'
import { rackMarkdown, type RackTool } from '../lib/rack-markdown.ts'

// The Worker in front of the directory. The catalogue ships with the app as
// static data; this only handles the parts that want a server: health and
// exporting a saved rack as Markdown.
type Env = { ASSETS: Fetcher }

const app = new Hono<{ Bindings: Env }>()

// Health doubles as the deployment's nameplate: version and tag are baked in by
// the build (see vite.config.ts), so asking a deployment which release it is
// answers from the bytes themselves rather than from a file it might not have.
app.get('/api/health', (c) =>
  c.json({ ok: true, service: 'red-queen', version: __RED_QUEEN_VERSION__, tag: __RED_QUEEN_TAG__ }),
)

// Build a Markdown shortlist from the slugs the browser sends. The catalogue is
// the only source of truth: unknown slugs are dropped rather than echoed back,
// and the shared builder validates refinements before they reach the document.
app.post('/api/export', async (c) => {
  const body = await c.req.json<{ slugs?: unknown; refinements?: unknown }>().catch(() => null)
  const slugs = Array.isArray(body?.slugs) ? body.slugs.filter((slug): slug is string => typeof slug === 'string').slice(0, 200) : []
  const picked = slugs.map((slug) => bySlug(slug)).filter((tool): tool is Tool => Boolean(tool))
  if (picked.length === 0) return c.json({ error: 'Your rack is empty.' }, 400)

  const tools: RackTool[] = picked.map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    short: tool.short,
    license: tool.license,
    platforms: tool.platforms,
    repo: tool.repo,
    url: tool.url,
    safety: tool.safety,
  }))

  return c.text(rackMarkdown(tools, body?.refinements, { static: safetyMeta.static.label, sandbox: safetyMeta.sandbox.label, live: safetyMeta.live.label }), 200, {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': 'inline; filename="red-queen-rack.md"',
  })
})

app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))

export default app
