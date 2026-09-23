import type { Knex } from 'knex'

import { resolveDbSchema } from '@/lib/tenant'

export async function up(knex: Knex): Promise<void> {
  const schema = resolveDbSchema()
  if (schema === 'public') return
  const siteId = process.env.RIN5_SITE_ID
  if (!siteId) throw new Error('rin5_site_id_required_for_export_lock')
  // New installs already receive this column from 00005; existing local
  // installs that applied the earlier 00005 shape still need it here.
  if (!await knex.schema.hasColumn('rin5_export_snapshots', 'lock_token')) {
    await knex.schema.alterTable('rin5_export_snapshots', (table) => table.uuid('lock_token'))
  }
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
}

export async function down(): Promise<void> {
  throw new Error('rin5_export_write_lock_migration_is_irreversible')
}
