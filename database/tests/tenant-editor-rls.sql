-- Run after the migration against only the assigned local tenant. Every fixture
-- created here is rolled back.
\if :{?tenant_schema}
\else
  \quit 'tenant_schema is required'
\endif
\if :{?storage_prefix}
\else
  \quit 'storage_prefix is required'
\endif

BEGIN;
SELECT set_config('rin5.rls_schema', :'tenant_schema', true);
SELECT set_config('rin5.storage_prefix', :'storage_prefix', true);
SELECT set_config('rin5.owner_id', gen_random_uuid()::text, true);
SELECT set_config('rin5.other_id', gen_random_uuid()::text, true);
SELECT set_config('rin5.page_id', gen_random_uuid()::text, true);
SELECT set_config('rin5.layer_id', gen_random_uuid()::text, true);

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  (current_setting('rin5.owner_id')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-owner@example.test', 'not-used', now(), '{}', '{}'),
  (current_setting('rin5.other_id')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-other@example.test', 'not-used', now(), '{}', '{}');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_setting('rin5.rls_schema') AND table_name = 'tenant_memberships' AND column_name = 'user_id'
  ) THEN
    EXECUTE format('INSERT INTO %1$I.tenant_memberships (user_id, email) VALUES ($1, $2)', current_setting('rin5.rls_schema'))
      USING current_setting('rin5.owner_id')::uuid, 'rls-owner@example.test';
  ELSE
    EXECUTE format('INSERT INTO %1$I.tenant_memberships (email) VALUES ($1)', current_setting('rin5.rls_schema'))
      USING 'rls-owner@example.test';
  END IF;
  EXECUTE format('INSERT INTO %1$I.pages (id, name, slug, is_published) VALUES ($1, $2, $3, false)', current_setting('rin5.rls_schema')) USING current_setting('rin5.page_id')::uuid, 'RLS private page', 'rls-private';
  EXECUTE format('INSERT INTO %1$I.page_layers (id, page_id, layers, is_published) VALUES ($1, $2, $3::jsonb, false)', current_setting('rin5.rls_schema')) USING current_setting('rin5.layer_id')::uuid, current_setting('rin5.page_id')::uuid, '[]';
END $$;
UPDATE public.rin5_storage_tenants
SET allowed_emails = array_append(allowed_emails, 'rls-owner@example.test')
WHERE bucket_id = 'rin5-assets' AND prefix = current_setting('rin5.storage_prefix');
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
VALUES ('rin5-assets', current_setting('rin5.storage_prefix') || '/owner-proof.txt', current_setting('rin5.owner_id'), '{}');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', current_setting('rin5.owner_id'), true);
DO $$
DECLARE pages integer; DECLARE layers integer; DECLARE objects integer; DECLARE changed integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM %I.pages WHERE id = $1', current_setting('rin5.rls_schema')) INTO pages USING current_setting('rin5.page_id')::uuid;
  EXECUTE format('SELECT count(*) FROM %I.page_layers WHERE id = $1', current_setting('rin5.rls_schema')) INTO layers USING current_setting('rin5.layer_id')::uuid;
  SELECT count(*) INTO objects FROM storage.objects WHERE bucket_id = 'rin5-assets' AND name = current_setting('rin5.storage_prefix') || '/owner-proof.txt';
  IF pages <> 1 OR layers <> 1 OR objects <> 1 THEN RAISE EXCEPTION 'member read failed: pages %, layers %, objects %', pages, layers, objects; END IF;
  EXECUTE format('UPDATE %I.pages SET name = ''owner edit'' WHERE id = $1', current_setting('rin5.rls_schema')) USING current_setting('rin5.page_id')::uuid;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'member cannot edit own draft page'; END IF;
  BEGIN
    EXECUTE format('SELECT count(*) FROM %I.migrations', current_setting('rin5.rls_schema')) INTO pages;
    RAISE EXCEPTION 'authenticated member read migration metadata';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE format('SELECT count(*) FROM %I.tenant_memberships', current_setting('rin5.rls_schema')) INTO pages;
    RAISE EXCEPTION 'authenticated member read tenant membership registry';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claim.sub', current_setting('rin5.other_id'), true);
DO $$
DECLARE pages integer; DECLARE layers integer; DECLARE objects integer; DECLARE changed integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM %I.pages WHERE id = $1', current_setting('rin5.rls_schema')) INTO pages USING current_setting('rin5.page_id')::uuid;
  EXECUTE format('SELECT count(*) FROM %I.page_layers WHERE id = $1', current_setting('rin5.rls_schema')) INTO layers USING current_setting('rin5.layer_id')::uuid;
  SELECT count(*) INTO objects FROM storage.objects WHERE bucket_id = 'rin5-assets' AND name = current_setting('rin5.storage_prefix') || '/owner-proof.txt';
  IF pages <> 0 OR layers <> 0 OR objects <> 0 THEN RAISE EXCEPTION 'non-member read tenant data: pages %, layers %, objects %', pages, layers, objects; END IF;
  EXECUTE format('UPDATE %I.pages SET name = ''cross-tenant write'' WHERE id = $1', current_setting('rin5.rls_schema')) USING current_setting('rin5.page_id')::uuid;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN RAISE EXCEPTION 'non-member updated a draft page'; END IF;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('rin5-assets', current_setting('rin5.storage_prefix') || '/foreign-write.txt', current_setting('rin5.other_id'), '{}');
    RAISE EXCEPTION 'non-member inserted into tenant storage';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$
DECLARE objects integer;
BEGIN
  SELECT count(*) INTO objects FROM storage.objects WHERE bucket_id = 'rin5-assets' AND name = current_setting('rin5.storage_prefix') || '/owner-proof.txt';
  IF objects <> 0 THEN RAISE EXCEPTION 'anonymous user read private tenant storage'; END IF;
  BEGIN
    EXECUTE format('SELECT %I.is_verified_tenant_member()', current_setting('rin5.rls_schema'));
    RAISE EXCEPTION 'anonymous user executed tenant security definer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE pages integer; DECLARE objects integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM %I.pages WHERE id = $1', current_setting('rin5.rls_schema')) INTO pages USING current_setting('rin5.page_id')::uuid;
  SELECT count(*) INTO objects FROM storage.objects WHERE bucket_id = 'rin5-assets' AND name = current_setting('rin5.storage_prefix') || '/owner-proof.txt';
  IF pages <> 1 OR objects <> 1 THEN RAISE EXCEPTION 'service_role cannot operate on tenant data'; END IF;
  EXECUTE format('SELECT count(*) FROM %I.migrations', current_setting('rin5.rls_schema')) INTO pages;
  IF pages = 0 THEN RAISE EXCEPTION 'service_role cannot read migration metadata'; END IF;
END $$;
ROLLBACK;
