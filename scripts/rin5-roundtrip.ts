/**
 * rin5 round-trip CLI — one command for the whole cycle.
 *
 * The generation worker (Ubuntu) needs `import → publish → export` as a single
 * step it can run per client, against the shared Supabase stack, with no Next
 * server up. That is what this script is: it wipes the client's schema and its
 * folder in the `assets` bucket, migrates the schema from zero, imports the
 * bundle, publishes it (the static export only ever reads `is_published`
 * rows), exports with original asset bytes into `--out-dir`, and drops a
 * `roundtrip.json` next to it with pages, assets, duration and a hash of the
 * bundle — see `hashBundle` for what that hash does and does not prove.
 *
 * Usage:
 *   npm run rin5:roundtrip -- --site-dir <in> --out-dir <out> --schema <s>
 *   npm run rin5:roundtrip -- --site-dir <in> --out-dir <out> --schema <s> --storage-prefix <p>
 *
 * `--schema public` is refused: this script drops the schema it is given, and
 * `public` is where the shared stack keeps everything else.
 *
 * The `❌ [Cache] Invalidation error: Invariant: static generation store
 * missing` line the publish step prints is expected — see scripts/rin5-publish.ts.
 */

// `lib/credentials.ts` calls `import 'server-only'`, which throws outside
// Next.js. Same require-shim the other three scripts install, and it must run
// BEFORE anything that transitively reaches it.
import { Module } from 'node:module'

type RequireFn = (id: string) => unknown
const moduleProto = Module.prototype as unknown as { require: RequireFn }
const originalRequire: RequireFn = moduleProto.require
moduleProto.require = function patchedRequire(this: unknown, id: string): unknown {
  if (id === 'server-only') return {}
  return originalRequire.call(this, id)
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

interface Options {
  siteDir: string
  outDir: string
  schema: string
  storagePrefix?: string
}

function parseArgs(argv: readonly string[]): Options {
  const flag = (name: string): string | undefined => {
    const idx = argv.indexOf(`--${name}`)
    return idx >= 0 ? argv[idx + 1] : undefined
  }

  const siteDir = flag('site-dir')
  const outDir = flag('out-dir')
  const schema = flag('schema')
  const storagePrefix = flag('storage-prefix')

  if (!siteDir || !outDir || !schema) {
    console.error('Usage: npm run rin5:roundtrip -- --site-dir <in> --out-dir <out> --schema <s> [--storage-prefix <p>]')
    process.exit(1)
  }
  if (schema === 'public') {
    console.error('--schema public is refused: this command drops the schema it is given.')
    process.exit(1)
  }
  if (!fs.existsSync(path.join(siteDir, 'index.html'))) {
    console.error(`--site-dir ${siteDir} does not look like a site bundle (no index.html)`)
    process.exit(1)
  }

  return {
    siteDir: path.resolve(siteDir),
    outDir: path.resolve(outDir),
    schema,
    ...(storagePrefix ? { storagePrefix } : {}),
  }
}

/** Every object under a prefix, recursively — Storage lists one level at a time. */
async function listStorageObjects(
  storage: { list: (prefix: string, options: { limit: number }) => Promise<{ data: Array<{ name: string; id: string | null }> | null }> },
  prefix: string,
): Promise<string[]> {
  const { data } = await storage.list(prefix, { limit: 1000 })
  if (!data) return []

  const paths: string[] = []
  for (const entry of data) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name
    // A row with a null id is a synthetic folder, not an object.
    if (entry.id === null) paths.push(...(await listStorageObjects(storage, full)))
    else paths.push(full)
  }
  return paths
}

/**
 * Content hash of the exported bundle: every file's path and its sha256, in
 * sorted order.
 *
 * It fingerprints *this* output, it is not a reproducibility check: the
 * importer mints a fresh `data-layer-id` for every layer on every run, so two
 * round-trips of the same input give different digests (measured — the HTML
 * differs in nothing else). What it is good for is telling one client's bundle
 * from another's, and spotting that a bundle changed after an edit.
 */
function hashBundle(dir: string): { hash: string; files: number } {
  const entries: string[] = []

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else entries.push(`${path.relative(dir, full)}\0${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`)
    }
  }
  walk(dir)
  entries.sort()

  return {
    hash: crypto.createHash('sha256').update(entries.join('\n')).digest('hex'),
    files: entries.length,
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  // Set before anything reads it: `knexfile.ts`, the supabase clients and the
  // importer all resolve the tenant from the environment on first use.
  process.env.RIN5_DB_SCHEMA = options.schema
  if (options.storagePrefix) process.env.RIN5_STORAGE_PREFIX = options.storagePrefix
  process.env.RIN5_SITE_DIR = options.siteDir
  process.env.RIN5_EXPORT_ORIGINAL_ASSETS = '1'

  const { resolveDbSchema, resolveStoragePrefix, dbSchemaForClient } = await import('../lib/tenant')
  const schema = resolveDbSchema()
  const storagePrefix = resolveStoragePrefix()

  console.log(`Round-trip: ${options.siteDir} → schema ${schema} / storage ${storagePrefix}/ → ${options.outDir}`)
  const started = Date.now()

  // ─── 1. Clean ──────────────────────────────────────────────────────────
  const knex = (await import('knex')).default
  const { createClient } = await import('@supabase/supabase-js')

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false },
    db: { schema: dbSchemaForClient() },
  })

  const admin = knex({ client: 'pg', connection: process.env.SUPABASE_CONNECTION_URL })
  // Drop and recreate in one implicit transaction: PostgREST refuses to load
  // its schema cache while a schema listed in PGRST_DB_SCHEMAS is missing, so
  // the schema must never be absent as seen from outside this statement.
  await admin.raw(`DROP SCHEMA IF EXISTS "${schema}" CASCADE; CREATE SCHEMA "${schema}"`)
  await admin.destroy()

  const stale = await listStorageObjects(supabase.storage.from('assets'), storagePrefix)
  if (stale.length > 0) {
    const { error } = await supabase.storage.from('assets').remove(stale)
    if (error) throw new Error(`storage cleanup: ${error.message}`)
  }
  console.log(`✓ Cleaned — schema dropped, ${stale.length} stale object(s) removed`)

  // ─── 2. Migrate ────────────────────────────────────────────────────────
  const { getKnexClient, closeKnexClient } = await import('../lib/knex-client')
  const db = await getKnexClient()
  const [, applied] = await db.migrate.latest()
  console.log(`✓ Migrated — ${(applied as string[]).length} migration(s)`)

  // ─── 3. Import ─────────────────────────────────────────────────────────
  // The importer is a top-level script: importing it is what starts it, and
  // `imported` is the handle to wait on before anything reads what it wrote.
  const { imported } = await import('./rin5-import')
  await imported

  // ─── 4. Publish ────────────────────────────────────────────────────────
  const { NextRequest } = await import('next/server')
  const { POST } = await import('../app/(builder)/ycode/api/publish/route')
  const publishResponse = await POST(
    new NextRequest('http://127.0.0.1/ycode/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishAll: true }),
    }),
  )
  if (publishResponse.status !== 200) {
    const payload = (await publishResponse.json()) as { error?: string }
    throw new Error(`publish failed (${publishResponse.status}): ${payload.error ?? 'unknown error'}`)
  }
  console.log('✓ Published')

  // ─── 5. Export ─────────────────────────────────────────────────────────
  fs.rmSync(options.outDir, { force: true, recursive: true })
  fs.mkdirSync(options.outDir, { recursive: true })

  const { exportSite, getExportConfig } = await import('../lib/apps/static-export')
  const { createLocalWriter } = await import('../lib/apps/static-export/writers/local')
  // A writer override rather than a settings write: `--out-dir` belongs to this
  // invocation, not to the client's persisted export configuration.
  const job = await exportSite(undefined, [
    createLocalWriter({ ...(await getExportConfig()), localPath: options.outDir }),
  ])
  if (job.status === 'failed') throw new Error(`export failed: ${job.error}`)
  console.log(`✓ Exported ${job.pagesExported} page(s)`)

  // ─── 6. Report ─────────────────────────────────────────────────────────
  const assets = await db('assets').where({ is_published: true }).whereNull('deleted_at').count<[{ count: string }]>('id as count')
  const bundle = hashBundle(options.outDir)
  const durationMs = Date.now() - started

  const report = {
    schema,
    storagePrefix,
    siteDir: options.siteDir,
    outDir: options.outDir,
    pages: job.pagesExported,
    assets: Number(assets[0].count),
    files: bundle.files,
    bundleSha256: bundle.hash,
    durationMs,
    finishedAt: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(options.outDir, 'roundtrip.json'), `${JSON.stringify(report, null, 2)}\n`)

  await closeKnexClient()
  console.log(`✓ Round-trip done in ${durationMs}ms — ${report.pages} pages, ${report.assets} assets, sha256 ${bundle.hash.slice(0, 16)}…`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
