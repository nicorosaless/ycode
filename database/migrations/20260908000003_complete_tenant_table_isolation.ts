import type { Knex } from 'knex';

import { resolveAllowedEmails, resolveDbSchema } from '@/lib/tenant';

/** Applies the verified-member policy to every table owned by this tenant. */
export async function up(knex: Knex): Promise<void> {
  const schema = resolveDbSchema();
  const allowedEmails = resolveAllowedEmails();
  if (schema === 'public' && allowedEmails === null) return;
  if (!allowedEmails?.length) throw new Error('rin5_allowed_emails_required_for_tenant_rls');

  const qualified = knex.raw('??', [schema]).toString();
  const schemaLiteral = knex.raw('?', [schema]).toString();
  await knex.raw(`REVOKE ALL ON FUNCTION ${qualified}.is_verified_tenant_member() FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION ${qualified}.is_verified_tenant_member() TO authenticated, service_role`);
  await knex.raw(`
    DO $rls$
    DECLARE table_name text; DECLARE policy_name text; DECLARE target_schema text := ${schemaLiteral};
    BEGIN
      FOR table_name IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = target_schema AND c.relkind IN ('r', 'p') AND c.relname NOT IN ('tenant_memberships', 'migrations', 'migrations_lock')
      LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', target_schema, table_name);
        FOR policy_name IN SELECT policyname FROM pg_policies WHERE schemaname = target_schema AND tablename = table_name LOOP
          EXECUTE format('DROP POLICY %I ON %I.%I', policy_name, target_schema, table_name);
        END LOOP;
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR SELECT TO authenticated USING (%I.is_verified_tenant_member())', 'rin5 verified member read', target_schema, table_name, target_schema);
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR INSERT TO authenticated WITH CHECK (%I.is_verified_tenant_member())', 'rin5 verified member insert', target_schema, table_name, target_schema);
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR UPDATE TO authenticated USING (%I.is_verified_tenant_member()) WITH CHECK (%I.is_verified_tenant_member())', 'rin5 verified member update', target_schema, table_name, target_schema, target_schema);
        EXECUTE format('CREATE POLICY %I ON %I.%I FOR DELETE TO authenticated USING (%I.is_verified_tenant_member())', 'rin5 verified member delete', target_schema, table_name, target_schema);
      END LOOP;
    END $rls$;
  `);
}

export async function down(): Promise<void> {
  throw new Error('tenant_table_isolation_is_irreversible_restore_from_a_reviewed_backup');
}
