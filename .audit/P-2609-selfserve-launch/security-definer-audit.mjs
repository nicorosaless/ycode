import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.SUPABASE_CONNECTION_URL.replace('[YOUR-PASSWORD]', encodeURIComponent(process.env.SUPABASE_DB_PASSWORD));
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const { rows } = await client.query(`
    SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
      p.proconfig AS config, pg_get_userbyid(p.proowner) AS owner,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute,
      pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND (n.nspname = $1 OR (n.nspname = 'public' AND p.proname LIKE 'rin5_%'))
    ORDER BY n.nspname, p.proname`, [process.env.RIN5_DB_SCHEMA]);
  const expectedAuthenticated = new Set([
    `${process.env.RIN5_DB_SCHEMA}.is_verified_tenant_member()`,
    'public.rin5_storage_member_for_object(object_bucket text, object_name text)',
  ]);
  const functions = rows.map((row) => {
    const signature = `${row.schema}.${row.name}(${row.arguments})`;
    const fixedSearchPath = row.config?.some((entry) => entry.startsWith('search_path=')) ?? false;
    if (row.anon_execute) throw new Error(`security_definer_executable_by_anon:${signature}`);
    if (!fixedSearchPath) throw new Error(`security_definer_without_fixed_search_path:${signature}`);
    if (row.authenticated_execute !== expectedAuthenticated.has(signature)) throw new Error(`security_definer_authenticated_acl_unexpected:${signature}`);
    if (!row.service_execute && row.name !== 'rin5_wait_for_export_lock') throw new Error(`security_definer_service_acl_missing:${signature}`);
    return {
      arguments: row.arguments, authenticatedExecute: row.authenticated_execute,
      definitionSha256: createHash('sha256').update(row.definition).digest('hex'),
      fixedSearchPath, name: row.name, owner: row.owner, schema: row.schema,
      anonExecute: row.anon_execute, serviceExecute: row.service_execute,
    };
  });
  const result = { schema: process.env.RIN5_DB_SCHEMA, securityDefinerFunctions: functions };
  await writeFile('.audit/P-2609-selfserve-launch/security-definer-audit.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  await client.end();
}
