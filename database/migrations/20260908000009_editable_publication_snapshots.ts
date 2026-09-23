import type { Knex } from 'knex'
import { resolveDbSchema } from '@/lib/tenant'
export async function up(knex: Knex): Promise<void> {
  if (resolveDbSchema() === 'public') return
  await knex.schema.alterTable('rin5_export_snapshots', table => table.jsonb('draft_layers'))
  await knex.schema.createTable('rin5_draft_restores', table => {
    table.uuid('request_id').primary()
    table.uuid('actor_user_id').notNullable()
    table.uuid('source_revision_id').notNullable()
    table.string('expected_digest', 64).notNullable()
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())
  })
  await knex.raw('ALTER TABLE rin5_draft_restores ENABLE ROW LEVEL SECURITY')
  await knex.raw('REVOKE ALL ON rin5_draft_restores FROM PUBLIC, anon, authenticated')
  await knex.raw('GRANT SELECT, INSERT ON rin5_draft_restores TO service_role')
}
export async function down(): Promise<void> { throw new Error('editable_snapshots_irreversible') }
