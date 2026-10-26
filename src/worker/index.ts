import { Hono } from 'hono'

import { bySlug, safetyMeta, type Tool } from '../data/tools.ts'
import { HOSTED_CELL, HOSTED_REASON, hostUnavailable } from '../lib/host-view.ts'
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

// The COS-G page asks whatever copy of Red Queen it is loaded from what the
// machine looks like. A local install answers with a real sweep; this one has no
// filesystem at all, so it answers in the same shape saying so. The route is
// explicit because the alternative is a fall-through to the assets binding,
// where the single-page fallback answers index.html and the panel is left
// guessing whether it reached a server.
app.get('/api/host', (c) => c.json(hostUnavailable('hosted', HOSTED_REASON, HOSTED_CELL)))

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
