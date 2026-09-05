import { Knex } from 'knex';

import { resolveDbSchema } from '@/lib/tenant';

/**
 * Migration: grant Supabase roles access to this tenant's schema
 *
 * Every migration in this fork is plain SQL/knex run as the `postgres`
 * superuser, which is enough to create tables but does **not** give
 * `anon`/`authenticated`/`service_role` any privileges on them. On a
 * Supabase-managed project this step is invisible because the platform
 * grants it once when the project (and its `public` schema) is provisioned.
 * A self-hosted instance bootstrapped straight from `npm run migrate:latest`
 * never gets that platform-level grant, so every authenticated request hits
 * `permission denied for table pages` (and the same for every other table)
 * even though `lib/supabase-server.ts` authenticates with the service-role
 * key — GRANT, not RLS, is what's missing.
 *
 * Idempotent: GRANT/ALTER DEFAULT PRIVILEGES are safe to re-run and apply to
 * every table/sequence/function that exists today, plus any created later.
 *
 * Multi-tenant (P-2609): the schema is `RIN5_DB_SCHEMA`, not a literal
 * `public`. Without the grant PostgREST answers `permission denied` for the
 * tenant's tables even after `PGRST_DB_SCHEMAS` exposes the schema.
 */
export async function up(knex: Knex): Promise<void> {
  const schema = resolveDbSchema();

  await knex.schema.raw(`GRANT USAGE ON SCHEMA ${schema} TO anon, authenticated, service_role`);
  await knex.schema.raw(`GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO anon, authenticated, service_role`);
  await knex.schema.raw(`GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schema} TO anon, authenticated, service_role`);
  await knex.schema.raw(`GRANT ALL ON ALL FUNCTIONS IN SCHEMA ${schema} TO anon, authenticated, service_role`);

  await knex.schema.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON TABLES TO anon, authenticated, service_role`,
  );
  await knex.schema.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON SEQUENCES TO anon, authenticated, service_role`,
  );
  await knex.schema.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role`,
  );
}

export async function down(knex: Knex): Promise<void> {
  const schema = resolveDbSchema();

  await knex.schema.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON TABLES FROM anon, authenticated, service_role`,
  );
  await knex.schema.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role`,
  );
  await knex.schema.raw(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role`,
  );

  await knex.schema.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM anon, authenticated, service_role`);
  await knex.schema.raw(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM anon, authenticated, service_role`);
  await knex.schema.raw(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM anon, authenticated, service_role`);
  await knex.schema.raw(`REVOKE USAGE ON SCHEMA ${schema} FROM anon, authenticated, service_role`);
}
