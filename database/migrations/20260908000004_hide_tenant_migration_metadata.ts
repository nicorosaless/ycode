import type { Knex } from 'knex';

import { resolveAllowedEmails, resolveDbSchema } from '@/lib/tenant';

export async function up(knex: Knex): Promise<void> {
  const schema = resolveDbSchema();
  if (schema === 'public' && resolveAllowedEmails() === null) return;
  const qualified = knex.raw('??', [schema]).toString();
  for (const table of ['migrations', 'migrations_lock', 'tenant_memberships']) {
    if (await knex.schema.hasTable(table)) {
      await knex.raw(`REVOKE ALL ON TABLE ${qualified}.${knex.raw('??', [table]).toString()} FROM anon, authenticated`);
    }
  }
}

export async function down(): Promise<void> {
  throw new Error('tenant_metadata_grants_are_not_restored_automatically');
}
