// The offline server: static app, health check, the rack export and the host
// sweep, using only Node's standard library. Copied into every install directory
// by build-offline, along with the catalogue, the Markdown builder, the sweep and
// its shared reading.
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scanHost } from './host-scan.mjs'
import { hostUnavailable, hostView, unavailableReason } from './host-view.mjs'
import { rackMarkdown } from './rack-markdown.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const clientRoot = resolve(here, '..', 'client')
const mode = process.env.RED_QUEEN_MODE ?? 'offline'
const host = '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

function portFrom(argv) {
  const index = argv.indexOf('--port')
  const inline = argv.find((arg) => arg.startsWith('--port='))
  const raw = inline ? inline.slice('--port='.length) : index >= 0 ? argv[index + 1] : process.env.PORT
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 4317
}

function loadCatalogue() {
  const raw = readFileSync(join(here, 'catalogue.json'), 'utf8')
  let catalogue = null
  try {
    catalogue = JSON.parse(raw)
  } catch {
    throw new Error('catalogue.json is not valid JSON')
  }
  if (!catalogue || !Array.isArray(catalogue.tools) || !catalogue.labels) throw new Error('catalogue.json is incomplete')
  return catalogue
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-length': Buffer.byteLength(body), ...headers })
  res.end(res.req.method === 'HEAD' ? undefined : body)
}

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body is too large.'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function main() {
  const catalogue = loadCatalogue()
  const port = portFrom(process.argv.slice(2))

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`)
      const path = url.pathname

      if (path === '/api/health') {
        send(res, 200, JSON.stringify({ ok: true, service: 'red-queen', mode, offline: true }), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        return
      }

      // The machine this copy is installed on, swept on request. This is the
      // only copy of Red Queen that has a machine to read: the hosted Worker has
      // no filesystem, so it answers the same route saying so. Read-only, and a
      // sweep that cannot look is a 200 with the reason rather than an error —
      // a sandbox install is confined to its own directory by design.
      if (path === '/api/host') {
        let view
        try {
          view = hostView(scanHost(), mode)
        } catch (error) {
          const why = `The sweep could not run: ${error instanceof Error ? error.message : String(error)}`
          view = hostUnavailable(mode, unavailableReason(why, mode))
        }
        send(res, 200, JSON.stringify(view), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        return
      }

      if (path === '/api/export' && req.method === 'POST') {
        let body = null
        try {
          body = JSON.parse(await readBody(req, 256 * 1024))
        } catch {
          send(res, 400, JSON.stringify({ error: 'Send a JSON body with a slugs array.' }), { 'content-type': 'application/json; charset=utf-8' })
          return
        }
        const requested = Array.isArray(body?.slugs) ? body.slugs.filter((slug) => typeof slug === 'string').slice(0, 200) : []
        const picked = requested.map((slug) => catalogue.tools.find((tool) => tool.slug === slug)).filter(Boolean)
        if (picked.length === 0) {
          send(res, 400, JSON.stringify({ error: 'Your rack is empty.' }), { 'content-type': 'application/json; charset=utf-8' })
          return
        }
        const markdown = rackMarkdown(picked, body?.refinements, catalogue.labels)
        send(res, 200, markdown, {
          'content-type': 'text/markdown; charset=utf-8',
          'content-disposition': 'inline; filename="red-queen-rack.md"',
          'cache-control': 'no-store',
        })
        return
      }

      if (path.startsWith('/api/')) {
        send(res, 404, JSON.stringify({ error: 'No such route.' }), { 'content-type': 'application/json; charset=utf-8' })
        return
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        send(res, 405, 'Method not allowed', { 'content-type': 'text/plain; charset=utf-8' })
        return
      }

      let decoded
      try {
        decoded = decodeURIComponent(path)
      } catch {
        send(res, 400, 'Bad request', { 'content-type': 'text/plain; charset=utf-8' })
        return
      }

      const target = resolve(clientRoot, `.${decoded}`)
      if (target !== clientRoot && !target.startsWith(clientRoot + sep)) {
        send(res, 403, 'Forbidden', { 'content-type': 'text/plain; charset=utf-8' })
        return
      }

      let file = target
      let info = null
      try {
        info = statSync(file)
        if (info.isDirectory()) {
          file = join(file, 'index.html')
          info = statSync(file)
        }
      } catch {
        info = null
      }

      // A path with no extension is a client route: hand it the SPA shell.
      if (!info && extname(decoded) === '') {
        file = join(clientRoot, 'index.html')
        try {
          info = statSync(file)
        } catch {
          info = null
        }
      }

      if (!info) {
        send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' })
        return
      }

      const extension = extname(file).toLowerCase()
      const immutable = decoded.startsWith('/assets/')
      res.writeHead(200, {
        'content-type': MIME[extension] ?? 'application/octet-stream',
        'content-length': info.size,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(file).pipe(res)
    } catch (error) {
      console.error(`Request failed: ${error instanceof Error ? error.message : String(error)}`)
      if (!res.headersSent) send(res, 500, 'Server error', { 'content-type': 'text/plain; charset=utf-8' })
      else res.end()
    }
  })

  server.on('error', (error) => {
    console.error(`Could not start on ${host}:${port}: ${error.message}`)
    process.exitCode = 1
  })

  server.listen(port, host, () => {
    console.log(`Red Queen · offline ${mode} copy`)
    console.log(`Open http://${host}:${port}`)
    console.log('Stop with Ctrl+C. Remove this install with ./red-queen uninstall.')
  })
}

try {
  main()
} catch (error) {
  console.error(`Red Queen could not start: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
