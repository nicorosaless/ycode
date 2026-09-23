import type { Knex } from 'knex';

import { resolveAllowedEmails, resolveDbSchema, resolveStoragePrefix } from '@/lib/tenant';

const RIN5_STORAGE_BUCKET = 'rin5-assets';

/** Repairs environments where the tenant-table RLS migration ran before its storage half was safe. */
export async function up(knex: Knex): Promise<void> {
  const schema = resolveDbSchema();
  const allowedEmails = resolveAllowedEmails();
  const prefix = resolveStoragePrefix();

  if (schema === 'public' && allowedEmails === null) return;
  if (!allowedEmails?.length) throw new Error('rin5_allowed_emails_required_for_tenant_rls');
  if (!prefix) throw new Error('rin5_storage_prefix_required_for_tenant_rls');

  const qualified = knex.raw('??', [schema]).toString();
  await knex.raw(`REVOKE ALL ON FUNCTION ${qualified}.is_verified_tenant_member() FROM PUBLIC, anon`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION ${qualified}.is_verified_tenant_member() TO authenticated, service_role`);

  const schemaLiteral = knex.raw('?', [schema]).toString();
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

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS public.rin5_storage_tenants (
      prefix text PRIMARY KEY CHECK (prefix ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
      bucket_id text NOT NULL,
      allowed_emails text[] NOT NULL CHECK (cardinality(allowed_emails) > 0),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await knex.raw(`ALTER TABLE public.rin5_storage_tenants ADD COLUMN IF NOT EXISTS bucket_id text`);
  await knex.raw(`UPDATE public.rin5_storage_tenants SET bucket_id = ? WHERE bucket_id IS NULL`, [RIN5_STORAGE_BUCKET]);
  await knex.raw(`ALTER TABLE public.rin5_storage_tenants ALTER COLUMN bucket_id SET NOT NULL`);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS rin5_storage_tenants_prefix_unique ON public.rin5_storage_tenants (prefix)`);
  await knex.raw('ALTER TABLE public.rin5_storage_tenants ENABLE ROW LEVEL SECURITY');
  await knex.raw(
    `INSERT INTO public.rin5_storage_tenants (bucket_id, prefix, allowed_emails) VALUES (?, ?, ?::text[])
     ON CONFLICT (prefix) DO UPDATE SET bucket_id = EXCLUDED.bucket_id, allowed_emails = EXCLUDED.allowed_emails`,
    [RIN5_STORAGE_BUCKET, prefix, allowedEmails],
  );
  await knex.raw(
    `INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     VALUES (?, ?, false, 52428800, NULL)
     ON CONFLICT (id) DO UPDATE SET public = false`,
    [RIN5_STORAGE_BUCKET, RIN5_STORAGE_BUCKET],
  );

  await knex.raw(`DROP FUNCTION IF EXISTS public.rin5_storage_member_for_path(text)`);
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.rin5_storage_member_for_object(object_bucket text, object_name text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = pg_catalog, auth, public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.rin5_storage_tenants tenant
        JOIN auth.users user_record ON lower(user_record.email) = ANY (tenant.allowed_emails)
        WHERE tenant.bucket_id = object_bucket
          AND tenant.prefix = split_part(object_name, '/', 1)
          AND user_record.id = auth.uid()
          AND user_record.email_confirmed_at IS NOT NULL
      )
    $$`);
  await knex.raw('REVOKE ALL ON FUNCTION public.rin5_storage_member_for_object(text, text) FROM PUBLIC, anon');
  await knex.raw('GRANT EXECUTE ON FUNCTION public.rin5_storage_member_for_object(text, text) TO authenticated, service_role');

  for (const operation of ['read', 'insert', 'update', 'delete']) {
    await knex.raw(`DROP POLICY IF EXISTS ${knex.raw('??', [`rin5 private assets ${operation}`]).toString()} ON storage.objects`);
  }
  const member = 'public.rin5_storage_member_for_object(bucket_id, name)';
  await knex.raw(`CREATE POLICY "rin5 private assets read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = '${RIN5_STORAGE_BUCKET}' AND ${member})`);
  await knex.raw(`CREATE POLICY "rin5 private assets insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = '${RIN5_STORAGE_BUCKET}' AND ${member})`);
  await knex.raw(`CREATE POLICY "rin5 private assets update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = '${RIN5_STORAGE_BUCKET}' AND ${member}) WITH CHECK (bucket_id = '${RIN5_STORAGE_BUCKET}' AND ${member})`);
  await knex.raw(`CREATE POLICY "rin5 private assets delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = '${RIN5_STORAGE_BUCKET}' AND ${member})`);
}

export async function down(): Promise<void> {
  throw new Error('tenant_storage_isolation_is_irreversible_restore_from_a_reviewed_backup');
}
