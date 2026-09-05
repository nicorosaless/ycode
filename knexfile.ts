import type { Knex } from 'knex';
import path from 'path';
import { credentials } from './lib/credentials.ts';
import { parseSupabaseConfig } from './lib/supabase-config-parser.ts';
import { resolveDbSchema } from './lib/tenant.ts';
import type { SupabaseConfig } from './types/index.ts';

/**
 * Knex Configuration for Ycode Supabase Migrations
 *
 * This configuration is used to run migrations programmatically
 * against the user's Supabase PostgreSQL database.
 *
 * Multi-tenant (P-2609): every query and every migration runs inside
 * `RIN5_DB_SCHEMA` — `searchPath` puts it first for the schema builder, and
 * `migrations.schemaName` keeps this tenant's `migrations` table with its own
 * tables instead of in `public`, where two clients would overwrite each
 * other's batch history. The schema is created on connect because knex has no
 * hook that runs before the migrator reads that table.
 */

/**
 * Load Supabase credentials from centralized storage
 * Uses environment variables on Vercel, file-based storage locally
 */
async function getSupabaseConnectionParams() {
  const config = await credentials.get<SupabaseConfig>('supabase_config');

  if (!config?.connectionUrl || !config?.dbPassword) {
    throw new Error('Supabase not configured. Please run setup first.');
  }

  const connectionParams = parseSupabaseConfig(config);
  const isSelfHosted = !!config.supabaseUrl;

  return {
    host: connectionParams.dbHost,
    port: connectionParams.dbPort,
    database: connectionParams.dbName,
    user: connectionParams.dbUser,
    password: connectionParams.dbPassword,
    ssl: isSelfHosted ? false : { rejectUnauthorized: false },
  };
}

/**
 * Create the tenant schema on the first query of every pooled connection.
 * `CREATE SCHEMA IF NOT EXISTS` is idempotent and costs one round trip per
 * connection, which is the price of not needing a provisioning step before
 * `migrate:latest` can run against a brand-new client.
 */
const ensureSchema = (schema: string) =>
  (connection: { query: (sql: string, cb: (err: Error | null) => void) => void }, done: (err?: Error | null) => void) => {
    if (schema === 'public') return done();
    connection.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`, (err) => done(err));
  };

const createConfig = (): Knex.Config => {
  const isVercel = process.env.VERCEL === '1';
  const schema = resolveDbSchema();

  return {
    client: 'pg',
    connection: async () => {
      const connectionParams = await getSupabaseConnectionParams();

      return connectionParams;
    },
    // `extensions` is where Supabase installs pgcrypto: a migration calling
    // `digest()` fails with `function digest(...) does not exist` if the only
    // entry is the tenant schema. `public` is deliberately NOT on the path —
    // a table missing from the tenant schema must fail loudly, not silently
    // resolve to another tenant's leftovers in `public`.
    searchPath: [schema, 'extensions'],
    migrations: {
      directory: path.join(process.cwd(), 'database/migrations'),
      extension: 'ts',
      tableName: 'migrations',
      schemaName: schema,
    },
    pool: isVercel ? {
      afterCreate: ensureSchema(schema),
      min: 0,
      max: 1,
      acquireTimeoutMillis: 10000,
      createTimeoutMillis: 10000,
      idleTimeoutMillis: 1000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200,
    } : {
      afterCreate: ensureSchema(schema),
      min: 0,
      max: 3,
      idleTimeoutMillis: 30000,
    },
  };
};

const config: { [key: string]: Knex.Config } = {
  development: createConfig(),
  production: createConfig(),
};

export default config;
