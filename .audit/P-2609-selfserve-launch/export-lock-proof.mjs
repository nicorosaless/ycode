import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const state = JSON.parse(await readFile('/home/nicolas-rosales/.rin5/secrets/rin5-editor-dev-browser-state.json', 'utf8'));
const cookie = state.cookies.find(({ name }) => name === 'sb-localhost-auth-token');
const stored = JSON.parse(Buffer.from(cookie.value.slice(7), 'base64url').toString('utf8'));
const auth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const refreshed = await auth.auth.refreshSession({ refresh_token: stored.refresh_token });
if (refreshed.error || !refreshed.data.session) throw refreshed.error ?? new Error('owner_refresh_failed');
const token = refreshed.data.session.access_token;
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false }, db: { schema: process.env.RIN5_DB_SCHEMA } });
const page = await admin.from('pages').select('id').eq('is_published', false).is('deleted_at', null).limit(1).single();
if (page.error) throw page.error;
const layer = await admin.from('page_layers').select('layers').eq('page_id', page.data.id).eq('is_published', false).is('deleted_at', null).single();
if (layer.error) throw layer.error;

const connectionString = process.env.SUPABASE_CONNECTION_URL.replace('[YOUR-PASSWORD]', encodeURIComponent(process.env.SUPABASE_DB_PASSWORD));
const db = new pg.Client({ connectionString });
await db.connect();
const lockName = `rin5-export:${process.env.RIN5_SITE_ID}`;
let released = false;
try {
  await db.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockName]);
  const startedAt = Date.now();
  const update = fetch(`http://localhost:3002/ycode/api/layers?page_id=${page.data.id}`, {
    method: 'PUT',
    headers: {
      cookie: `${cookie.name}=${cookie.value}`, 'content-type': 'application/json',
    },
    body: JSON.stringify({ layers: layer.data.layers }),
  });
  let settled = false;
  update.finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (settled) throw new Error('authenticated_write_did_not_wait_for_export_lock');
  await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]);
  released = true;
  const response = await update;
  if (!response.ok) throw new Error(`authenticated_write_failed:${response.status}`);
  const result = { blockedAdminBackedEditorApiWhileSnapshotLockHeld: true, completedAfterRelease: true, minimumObservedWaitMs: Date.now() - startedAt };
  await writeFile('.audit/P-2609-selfserve-launch/export-lock-proof.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  if (!released) await db.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]);
  await db.end();
}
