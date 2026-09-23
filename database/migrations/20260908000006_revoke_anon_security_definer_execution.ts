import type { Knex } from 'knex'

import { resolveDbSchema } from '@/lib/tenant'

export async function up(knex: Knex): Promise<void> {
  const schema = resolveDbSchema()
  if (schema === 'public') return
  const qualified = knex.raw('??', [schema]).toString()
  await knex.raw(`REVOKE ALL ON FUNCTION ${qualified}.is_verified_tenant_member() FROM PUBLIC, anon`)
  await knex.raw('REVOKE ALL ON FUNCTION public.rin5_storage_member_for_object(text, text) FROM PUBLIC, anon')
  await knex.raw(`GRANT EXECUTE ON FUNCTION ${qualified}.is_verified_tenant_member() TO authenticated, service_role`)
  await knex.raw('GRANT EXECUTE ON FUNCTION public.rin5_storage_member_for_object(text, text) TO authenticated, service_role')
}

export async function down(): Promise<void> {
  throw new Error('rin5_security_definer_acl_migration_is_irreversible')
}
