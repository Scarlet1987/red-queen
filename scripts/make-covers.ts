// Generates the specimen covers for the directory: one dark card per tool.
// Deterministic, so covers only change when the catalogue (or the seed) does.
//
//   npm run covers
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tools, type Category } from '../src/data/tools.ts'

const INK = '#f4e9dd'
const ACCENT = '#d1503f'
const ACCENT_DEEP = '#8e1f28'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const SERIF = "'Instrument Serif', 'Iowan Old Style', Georgia, serif"

const OUT = join(import.meta.dirname, '..', 'public', 'images')

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number) {
  let a = seed || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (r: () => number, min: number, max: number) => min + r() * (max - min)

function hexBlock(r: () => number, x: number, y: number, rows: number, cols: number, size = 12) {
  const glyphs = '0123456789abcdef'
  // one monospace advance at this size, plus the letter-spacing below
  const step = size * 0.6 + 1
  let marks = ''
  let text = ''
  for (let row = 0; row < rows; row++) {
    let line = ''
    for (let col = 0; col < cols; col++) {
      line += glyphs[Math.floor(r() * 16)] + glyphs[Math.floor(r() * 16)] + ' '
      if (r() > 0.94) {
        marks += `<rect x="${(x + col * step * 3 - 2).toFixed(1)}" y="${y + row * (size + 8) - size + 1}" width="${(step * 2).toFixed(1)}" height="${size + 1}" rx="2" fill="${ACCENT}" opacity="0.8"/>`
      }
    }
    text += `<text x="${x}" y="${y + row * (size + 8)}" fill="${INK}" opacity="0.3" font-family="${MONO}" font-size="${size}" letter-spacing="1">${line.trim()}</text>`
  }
  return marks + text
}

function motif(category: Category, r: () => number, cx: number, cy: number, scale: number) {
  const a = ACCENT
  const dim = ACCENT_DEEP
  const g = (body: string) => `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke-width="1.6" stroke-linecap="round">${body}</g>`

  switch (category) {
    case 'disassembly': {
      let bars = ''
      for (let i = 0; i < 7; i++) {
        const w = pick(r, 90, 250)
        bars += `<rect x="${-150 + (i % 3) * 14}" y="${-90 + i * 28}" width="${w}" height="8" rx="4" stroke="${i === 3 ? a : INK}" opacity="${i === 3 ? 0.9 : 0.22}"/>`
      }
      return g(`<line x1="-170" y1="-104" x2="-170" y2="104" stroke="${dim}" opacity="0.8"/>${bars}`)
    }
    case 'decompilation': {
      const brace = (s: number) =>
        `<path d="M ${20 * s} ${-90 * s} q ${-40 * s} 0 ${-40 * s} ${40 * s} v ${100 * s} q 0 ${40 * s} ${-40 * s} ${40 * s} q ${40 * s} 0 ${40 * s} ${40 * s} v ${100 * s} q 0 ${40 * s} ${40 * s} ${40 * s}" stroke="${INK}"/>`
      return g(
        `<g opacity="0.25">${brace(1.05)}</g><g transform="scale(-1 1)" opacity="0.25">${brace(1.05)}</g>` +
          `<g opacity="0.85" stroke="${a}">${brace(0.55)}</g><g transform="scale(-1 1)" opacity="0.85" stroke="${a}">${brace(0.55)}</g>`,
      )
    }
    case 'debugging': {
      let ticks = ''
      for (let i = -3; i <= 3; i++) ticks += `<line x1="${i * 46}" y1="-10" x2="${i * 46}" y2="10" stroke="${INK}" opacity="0.25"/>`
      return g(
        `<line x1="-190" y1="0" x2="190" y2="0" stroke="${INK}" opacity="0.3"/>${ticks}` +
          `<path d="M 46 0 l 14 -14 l 14 14 l -14 14 z" fill="${a}" stroke="${a}" opacity="0.95"/>` +
          `<line x1="60" y1="-14" x2="60" y2="-120" stroke="${a}" stroke-dasharray="5 7" opacity="0.6"/>` +
          `<circle cx="60" cy="-120" r="5" fill="${a}" stroke="none" opacity="0.9"/>`,
      )
    }
    case 'dynamic': {
      let arcs = ''
      for (let i = 0; i < 4; i++) {
        const rad = 52 + i * 38
        arcs += `<circle cx="-70" cy="60" r="${rad}" stroke="${i === 1 ? a : INK}" opacity="${i === 1 ? 0.9 : 0.18}" stroke-dasharray="${i === 1 ? '0' : '4 10'}"/>`
      }
      return g(arcs + `<circle cx="-70" cy="60" r="6" fill="${a}" stroke="none"/>`)
    }
    case 'formats': {
      const layer = (y: number, w: number) =>
        `<path d="M ${-w} ${y - 22} L 0 ${y - 58} L ${w} ${y - 22} L 0 ${y + 14} Z" stroke="${INK}" opacity="0.3"/>`
      return g(
        layer(20, 140) +
          layer(58, 165) +
          layer(96, 190) +
          `<path d="M -140 96 L 0 160 L 140 96" stroke="${a}" opacity="0.9"/>` +
          `<path d="M 0 160 L 0 190" stroke="${a}" opacity="0.5"/>`,
      )
    }
    case 'hex': {
      let dots = ''
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 11; col++) {
          const hot = r() > 0.9
          dots += `<rect x="${-165 + col * 31}" y="${-120 + row * 31}" width="13" height="13" rx="3" fill="${hot ? a : INK}" opacity="${hot ? 0.9 : 0.22}" stroke="none"/>`
        }
      }
      return g(dots)
    }
    case 'forensics': {
      let dots = ''
      for (let i = 0; i < 34; i++) {
        const big = r() > 0.88
        dots += `<circle cx="${pick(r, -190, 190).toFixed(1)}" cy="${pick(r, -120, 120).toFixed(1)}" r="${big ? 4 : 2}" fill="${big ? a : INK}" opacity="${big ? 0.9 : 0.25}" stroke="none"/>`
      }
      return g(dots + `<rect x="-190" y="-6" width="380" height="34" fill="${a}" opacity="0.1" stroke="none"/>`)
    }
    case 'firmware': {
      let pins = ''
      for (let i = 0; i < 5; i++) {
        pins += `<line x1="${-70 + i * 35}" y1="-100" x2="${-70 + i * 35}" y2="-130" stroke="${INK}" opacity="0.3"/>`
        pins += `<line x1="${-70 + i * 35}" y1="100" x2="${-70 + i * 35}" y2="130" stroke="${INK}" opacity="0.3"/>`
        pins += `<line x1="-130" y1="${-70 + i * 35}" x2="-100" y2="${-70 + i * 35}" stroke="${INK}" opacity="0.3"/>`
        pins += `<line x1="130" y1="${-70 + i * 35}" x2="100" y2="${-70 + i * 35}" stroke="${INK}" opacity="0.3"/>`
      }
      return g(
        pins +
          `<rect x="-100" y="-100" width="200" height="200" rx="10" stroke="${INK}" opacity="0.4"/>` +
          `<rect x="-52" y="-52" width="104" height="104" rx="6" stroke="${a}" opacity="0.9"/>` +
          `<circle cx="0" cy="0" r="10" stroke="${a}" opacity="0.5"/>`,
      )
    }
    case 'network': {
      const nodes = [
        [-160, -60],
        [-40, -110],
        [90, -70],
        [160, 40],
        [30, 90],
        [-110, 60],
      ]
      let lines = ''
      let circles = ''
      nodes.forEach(([x, y], i) => {
        const [nx, ny] = nodes[(i + 2) % nodes.length]
        lines += `<line x1="${x}" y1="${y}" x2="${nx}" y2="${ny}" stroke="${INK}" opacity="0.15"/>`
      })
      nodes.forEach(([x, y], i) => {
        circles += `<circle cx="${x}" cy="${y}" r="${i === 3 ? 8 : 5}" fill="none" stroke="${i === 3 ? a : INK}" opacity="${i === 3 ? 0.95 : 0.4}"/>`
      })
      return g(lines + `<line x1="${nodes[0][0]}" y1="${nodes[0][1]}" x2="${nodes[3][0]}" y2="${nodes[3][1]}" stroke="${a}" opacity="0.6"/>` + circles)
    }
    case 'mobile': {
      return g(
        `<rect x="-78" y="-140" width="156" height="280" rx="24" stroke="${INK}" opacity="0.35"/>` +
          `<rect x="-60" y="-112" width="120" height="210" rx="6" stroke="${INK}" opacity="0.16"/>` +
          `<line x1="-30" y1="-128" x2="30" y2="-128" stroke="${a}" opacity="0.9"/>` +
          `<line x1="-44" y1="-60" x2="44" y2="-60" stroke="${INK}" opacity="0.2"/>` +
          `<line x1="-44" y1="-34" x2="18" y2="-34" stroke="${INK}" opacity="0.2"/>` +
          `<line x1="-44" y1="-8" x2="34" y2="-8" stroke="${a}" opacity="0.5"/>` +
          `<line x1="-44" y1="18" x2="-4" y2="18" stroke="${INK}" opacity="0.2"/>` +
          `<circle cx="0" cy="124" r="7" stroke="${INK}" opacity="0.3"/>`,
      )
    }
  }
}

function cover(seed: string, category: Category, label: string, width: number, height: number) {
  const r = rng(hash(seed))
  const cx = width / 2
  const cy = height * 0.36
  const initial = label.trim().charAt(0).toUpperCase()

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="#191111"/>
      <stop offset="0.62" stop-color="#241416"/>
      <stop offset="1" stop-color="#120c0c"/>
    </linearGradient>
    <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse">
      <path d="M36 0H0V36" fill="none" stroke="${INK}" stroke-opacity="0.045"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#grid)"/>
  <ellipse cx="${cx}" cy="${cy}" rx="${width * 0.44}" ry="${height * 0.26}" fill="${ACCENT_DEEP}" opacity="0.14"/>
  ${motif(category, r, cx, cy, Math.min(width, height) / 640)}
  ${hexBlock(r, 40, height - 210, 6, Math.max(6, Math.floor((width - 80) / 78)), 12)}
  <g font-family="${MONO}" fill="${INK}">
    <text x="40" y="54" font-size="11" letter-spacing="3" opacity="0.5">${label.toUpperCase()}</text>
    <text x="40" y="${height - 34}" font-size="11" letter-spacing="3" opacity="0.32">RED QUEEN · SAFE RE DIRECTORY</text>
  </g>
  <text x="${width - 34}" y="${height - 24}" text-anchor="end" font-family="${SERIF}" font-size="150" font-style="italic" fill="${ACCENT}" opacity="0.16">${initial}</text>
  <rect x="0" y="0" width="3" height="${height}" fill="${ACCENT}" opacity="0.5"/>
</svg>
`
}

mkdirSync(join(OUT, 'tools'), { recursive: true })

for (const tool of tools) {
  writeFileSync(join(OUT, 'tools', `${tool.slug}.svg`), cover(tool.slug, tool.category, tool.name, 600, 800))
}

console.log(`Wrote ${tools.length} tool covers.`)
