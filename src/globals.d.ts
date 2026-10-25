// Substituted at build time by vite.config.ts. They are constants as far as the
// code is concerned: the build bakes in the version from package.json and the
// tag that describes the inputs, so /api/health can say which release a
// deployment is without reading anything at runtime (a Worker has no git).
declare const __RED_QUEEN_VERSION__: string
declare const __RED_QUEEN_TAG__: string | null
