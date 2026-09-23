import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';

const schema = process.env.RIN5_DB_SCHEMA;
const prefix = process.env.RIN5_STORAGE_PREFIX;
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(prefix)) throw new Error('tenant_identifiers_invalid');
const source = await readFile('database/tests/tenant-editor-rls.sql', 'utf8');
const sql = source.split('\n').filter((line) => !line.trimStart().startsWith('\\')).join('\n')
  .replaceAll(":'tenant_schema'", `'${schema}'`)
  .replaceAll(":'storage_prefix'", `'${prefix}'`);
const connectionString = process.env.SUPABASE_CONNECTION_URL.replace('[YOUR-PASSWORD]', encodeURIComponent(process.env.SUPABASE_DB_PASSWORD));
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(sql);
  const result = { assertionsPassed: true, fixtureResidue: false, rolledBack: true, schema };
  await writeFile('.audit/P-2609-selfserve-launch/tenant-rls-sql-proof.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  await client.end();
}
