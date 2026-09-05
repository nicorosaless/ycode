/**
 * Multi-tenant boundary — one Ycode container per rin5 client, one shared
 * Supabase stack.
 *
 * A full Supabase stack per client (Postgres + GoTrue + PostgREST + Storage)
 * does not fit in the 2 GB box, so every client shares one stack and the
 * isolation is drawn inside it:
 *
 * - `RIN5_DB_SCHEMA` — the Postgres schema this container owns. Knex migrates
 *   and queries there (`searchPath`), supabase-js is built with `db.schema`,
 *   and PostgREST has to expose it (`PGRST_DB_SCHEMAS`).
 * - `RIN5_STORAGE_PREFIX` — object prefix inside the shared `assets` bucket.
 *   Defaults to the schema so the two cannot drift apart.
 * - `RIN5_ALLOWED_EMAILS` — GoTrue is global to the stack, so a user belonging
 *   to another client authenticates perfectly well. This list is the only thing
 *   that stops them reaching this container's site.
 *
 * Defaults reproduce the single-tenant install exactly: schema `public`, no
 * storage prefix, no email restriction.
 *
 * Deliberately free of `server-only`: `knexfile.ts` and the standalone
 * `scripts/rin5-*.ts` load this from a plain Node process.
 */

export type TenantEnv = Record<string, string | undefined>

export const DEFAULT_DB_SCHEMA = 'public'

/** A bare Postgres identifier — no quoting, no dots, nothing to escape. */
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/

/** A single storage folder name: no slash, no dot, nothing that walks up. */
const STORAGE_PREFIX_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

/**
 * The Postgres schema this container owns.
 * Throws rather than falling back: a typo silently landing on `public` would
 * put one client's pages in another's schema.
 */
export function resolveDbSchema(env: TenantEnv = process.env): string {
  const raw = (env.RIN5_DB_SCHEMA ?? '').trim().toLowerCase()
  if (!raw) return DEFAULT_DB_SCHEMA
  if (!SCHEMA_RE.test(raw)) throw new Error('rin5_db_schema_invalid')
  return raw
}

/**
 * Object prefix inside the shared `assets` bucket. Empty string means "no
 * prefix", which is what a single-tenant install on `public` gets.
 */
export function resolveStoragePrefix(env: TenantEnv = process.env): string {
  const raw = (env.RIN5_STORAGE_PREFIX ?? '').trim().toLowerCase()
  if (raw) {
    if (!STORAGE_PREFIX_RE.test(raw)) throw new Error('rin5_storage_prefix_invalid')
    return raw
  }
  const schema = resolveDbSchema(env)
  return schema === DEFAULT_DB_SCHEMA ? '' : schema
}

/**
 * Scope a storage object path to this tenant. Idempotent-safe only for fresh
 * paths — call it once, where the path is generated, never on a path read back
 * from the `assets` table (those are already scoped).
 */
export function tenantStoragePath(path: string, env: TenantEnv = process.env): string {
  const prefix = resolveStoragePrefix(env)
  const clean = path.replace(/^\/+/, '')
  return prefix ? `${prefix}/${clean}` : clean
}

/**
 * Emails allowed to use this container, or `null` when unrestricted.
 * An explicitly empty list is not "unrestricted": it locks everybody out,
 * which is the safe reading of `RIN5_ALLOWED_EMAILS=""`.
 */
export function resolveAllowedEmails(env: TenantEnv = process.env): string[] | null {
  const raw = env.RIN5_ALLOWED_EMAILS
  if (raw === undefined) return null
  return raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function isEmailAllowed(email: string | null | undefined, allowed: readonly string[] | null): boolean {
  if (allowed === null) return true
  if (!email) return false
  return allowed.includes(email.trim().toLowerCase())
}

/**
 * The tenant schema in the shape supabase-js's generics expect.
 *
 * `SupabaseClient` is parameterised by its schema name, and this codebase
 * types every client as the default `'public'`. A schema read at runtime is a
 * plain `string`, which widens that generic and breaks every call site. The
 * tables are identical in every tenant schema — that is the whole point of the
 * model — so the literal is asserted back here, in one place, instead of
 * threading a type parameter through the entire repository.
 */
export function dbSchemaForClient(env: TenantEnv = process.env): 'public' {
  return resolveDbSchema(env) as 'public'
}
