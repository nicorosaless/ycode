import type { Knex } from 'knex'

import { resolveDbSchema } from '@/lib/tenant'
import { RIN5_EXPORT_BUCKET } from '@/lib/rin5-export-snapshot-codec'

export async function up(knex: Knex): Promise<void> {
  const schema = resolveDbSchema()
  if (schema === 'public') return
  const siteId = process.env.RIN5_SITE_ID
  if (!siteId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteId)) {
    throw new Error('rin5_site_id_required_for_export_lock')
  }

  await knex.schema.createTable('rin5_export_snapshots', (table) => {
    table.uuid('request_id').primary()
    table.uuid('source_revision_id').notNullable().unique()
    table.uuid('site_id').notNullable()
    table.uuid('actor_user_id').notNullable()
    table.text('object_path').notNullable().unique()
    table.uuid('lock_token')
    table.text('status').notNullable().checkIn(['capturing', 'completed'])
    table.jsonb('manifest')
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
  })
  await knex.raw(`ALTER TABLE ??.rin5_export_snapshots ENABLE ROW LEVEL SECURITY`, [schema])
  await knex.raw(`REVOKE ALL ON TABLE ??.rin5_export_snapshots FROM anon, authenticated`, [schema])

  await knex.raw(
    `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     VALUES (?, ?, false, 110100480, ARRAY['application/json'])
     ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types`,
    [RIN5_EXPORT_BUCKET, RIN5_EXPORT_BUCKET],
  )

  const qualified = knex.raw('??', [schema]).toString()
  const lockName = knex.raw('?', [`rin5-export:${siteId}`]).toString()
  await knex.raw(`
    CREATE OR REPLACE FUNCTION ${qualified}.rin5_wait_for_export_lock()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog
    AS $fn$
    DECLARE export_token text;
    BEGIN
      export_token := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-rin5-export-token';
      IF export_token IS NOT NULL AND EXISTS (
        SELECT 1 FROM ${qualified}.rin5_export_snapshots snapshot
        WHERE snapshot.status = 'capturing' AND snapshot.lock_token::text = export_token
      ) THEN
        RETURN COALESCE(NEW, OLD);
      END IF;
      PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(${lockName}, 0));
      RETURN COALESCE(NEW, OLD);
    END
    $fn$`)
  await knex.raw(`REVOKE ALL ON FUNCTION ${qualified}.rin5_wait_for_export_lock() FROM PUBLIC, anon, authenticated, service_role`)

  const schemaLiteral = knex.raw('?', [schema]).toString()
  await knex.raw(`
    DO $triggers$
    DECLARE table_name text; DECLARE target_schema text := ${schemaLiteral};
    BEGIN
      FOR table_name IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = target_schema AND c.relkind IN ('r', 'p')
          AND c.relname NOT IN ('migrations', 'migrations_lock', 'rin5_export_snapshots')
      LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS rin5_export_write_lock ON %I.%I', target_schema, table_name);
        EXECUTE format(
          'CREATE TRIGGER rin5_export_write_lock BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.rin5_wait_for_export_lock()',
          target_schema, table_name, target_schema
        );
      END LOOP;
    END $triggers$`)
}

export async function down(): Promise<void> {
  throw new Error('rin5_export_snapshot_migration_is_irreversible')
}
