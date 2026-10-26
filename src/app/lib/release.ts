// The release this copy is. vite.config.ts substitutes both values at build
// time, the same values /api/health answers with, so the footer can name the
// running copy without asking a server — useful offline, and on a page whose
// only server is the static file that served it.
//
// `typeof` rather than a bare read: a bundle built without the defines (a
// stripped config, an odd plugin) leaves the identifiers in place, and a bare
// read would throw and take the page down with it. An unknown release says so
// instead of crashing.
export const RELEASE_VERSION = typeof __RED_QUEEN_VERSION__ === 'string' ? __RED_QUEEN_VERSION__ : ''

/** The tag the bytes were built from, or '' when no tag describes them. */
export const RELEASE_TAG = typeof __RED_QUEEN_TAG__ === 'string' ? __RED_QUEEN_TAG__ : ''

/**
 * "1.0.1 · v1.0.1" for a tagged build. An untagged build says so: it is a fact
 * about the bytes, not a gap to paper over, and it stops a development copy
 * from looking like the released one. Arguments exist for the tests; the footer
 * calls it with the baked values.
 */
export function releaseLabel(version: string = RELEASE_VERSION, tag: string = RELEASE_TAG): string {
  if (!version) return 'Unstamped build'
  return tag ? `${version} · ${tag}` : `${version} · untagged build`
}
