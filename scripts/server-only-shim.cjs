/**
 * `server-only` throws unconditionally when required outside Next.js's
 * compiler — see node_modules/server-only/index.js. That's fine inside the
 * app (webpack/turbopack strip the import there), but knex's CLI is a plain
 * Node process: `knexfile.ts` imports `lib/credentials.ts`, which imports
 * `server-only`, so any `knex migrate:*` command crashes the moment the CLI
 * loads the config file — before it even reaches a database.
 *
 * Loaded via `NODE_OPTIONS="--require ./scripts/server-only-shim.cjs"` on
 * every `migrate:*` npm script (see package.json). Mirrors the same
 * require-patch that scripts/rin5-import.ts and scripts/export.ts install
 * inline for their own standalone bundles.
 */
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id) {
  if (id === 'server-only') return {};
  return originalRequire.call(this, id);
};
