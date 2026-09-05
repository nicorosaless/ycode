/**
 * Standalone publish CLI
 *
 * Runs the exact same publish the editor's "Publish" button runs — folders,
 * pages + layers, collections, components, layer styles, assets, fonts,
 * locales and the CSS bundle — without a browser session or a running
 * Next.js server. This is what makes `import → publish → export` a
 * repeatable, scriptable cycle (G9, P-2609): the static export only ever
 * sees `is_published = true` rows, so an import alone exports nothing.
 *
 * It calls `app/(builder)/ycode/api/publish/route.ts`'s `POST` handler
 * directly with a synthetic `NextRequest` rather than reimplementing the
 * publish order. Reimplementing it would drift from the UI the first time
 * someone adds a step to the route. The cache-invalidation tail of the
 * handler (`next/cache`) cannot run here — there is no Next.js server in this
 * process to invalidate — so it logs
 * `❌ [Cache] Invalidation error: Invariant: static generation store missing`
 * and carries on. That line is expected, not a failure: the handler wraps the
 * whole invalidation step in try/catch, and a static export reads the database
 * directly. Trust the `✓ Published` line, not the absence of that error.
 *
 * Usage:
 *   npm run rin5:publish
 *   npm run rin5:publish -- --pages <id>,<id>   # partial publish
 */

// `lib/credentials.ts` calls `import 'server-only'` which throws outside
// Next.js. Same require-shim `scripts/rin5-import.ts` and `scripts/export.ts`
// install, and it must run BEFORE anything that transitively reaches it.
import { Module } from 'node:module'

type RequireFn = (id: string) => unknown
const moduleProto = Module.prototype as unknown as { require: RequireFn }
const originalRequire: RequireFn = moduleProto.require
moduleProto.require = function patchedRequire(this: unknown, id: string): unknown {
  if (id === 'server-only') return {}
  return originalRequire.call(this, id)
}

interface PublishBody {
  publishAll?: boolean
  pageIds?: string[]
}

function parseArgs(argv: string[]): PublishBody {
  const pagesIdx = argv.indexOf('--pages')
  if (pagesIdx >= 0) {
    const ids = (argv[pagesIdx + 1] || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (ids.length === 0) {
      console.error('--pages needs a comma-separated list of page ids')
      process.exit(1)
    }
    return { pageIds: ids }
  }
  return { publishAll: true }
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_URL && !process.env.SUPABASE_CONNECTION_URL) {
    console.error(
      'Missing Supabase credentials. Run with `npm run rin5:publish` (which loads .env) ' +
        'or export SUPABASE_URL / SUPABASE_SECRET_KEY in your shell.',
    )
    process.exit(1)
  }

  const body = parseArgs(process.argv.slice(2))

  // Dynamic imports so the require shim is in place before the route pulls in
  // `lib/credentials.ts` through the supabase server client.
  const { NextRequest } = await import('next/server')
  const { POST } = await import('../app/(builder)/ycode/api/publish/route')

  console.log(body.publishAll ? 'Publishing everything…' : `Publishing ${body.pageIds!.length} page(s)…`)
  const start = Date.now()

  const request = new NextRequest('http://127.0.0.1/ycode/api/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const response = await POST(request)
  const payload = (await response.json()) as {
    data?: { changes?: Record<string, number | boolean> }
    error?: string
  }

  if (response.status !== 200) {
    console.error(`✗ Publish failed (${response.status}): ${payload.error ?? 'unknown error'}`)
    process.exit(1)
  }

  const changes = payload.data?.changes ?? {}
  const summary = Object.entries(changes)
    .filter(([, value]) => value !== 0 && value !== false)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ')

  console.log(`✓ Published in ${Date.now() - start}ms${summary ? ` — ${summary}` : ' — no changes'}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
