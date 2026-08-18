// Vercel serverless entry.
//
// Deliberately plain JavaScript that re-exports the compiled bundle: Vercel
// builds files under `api/` with esbuild, and esbuild does not emit the
// decorator metadata NestJS dependency injection relies on. `nest build` uses
// tsc, which does, so the real application is compiled ahead of time by the
// build command in vercel.json and simply loaded here.
module.exports = require('../dist/serverless.js').default;
