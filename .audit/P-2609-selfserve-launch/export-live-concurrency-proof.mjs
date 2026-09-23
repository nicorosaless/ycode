import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const base = 'http://localhost:3002';
const state = JSON.parse(await readFile('/home/nicolas-rosales/.rin5/secrets/rin5-editor-dev-browser-state.json', 'utf8'));
const cookie = state.cookies.find(({ name }) => name === 'sb-localhost-auth-token');
if (!cookie) throw new Error('owner_cookie_missing');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false }, db: { schema: process.env.RIN5_DB_SCHEMA },
});
const page = await admin.from('pages').select('id').eq('is_published', false).is('deleted_at', null).limit(1).single();
if (page.error) throw page.error;
const layer = await admin.from('page_layers').select('layers').eq('page_id', page.data.id).eq('is_published', false).is('deleted_at', null).single();
if (layer.error) throw layer.error;

const identity = {
  actorUserId: randomUUID(), requestId: randomUUID(), siteId: process.env.RIN5_SITE_ID, sourceRevisionId: randomUUID(),
};
const connectionString = process.env.SUPABASE_CONNECTION_URL.replace('[YOUR-PASSWORD]', encodeURIComponent(process.env.SUPABASE_DB_PASSWORD));
const db = new pg.Client({ connectionString });
await db.connect();
try {
  const exportStartedAt = Date.now();
  const exporting = fetch(`${base}/ycode/api/rin5/export`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RIN5_INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify(identity),
  }).then(async (response) => ({ response, body: await response.text(), endedAt: Date.now() }));

  let observedCapturingAt;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const { rows } = await db.query(
      `select status, lock_token is not null as token_bound from ${process.env.RIN5_DB_SCHEMA}.rin5_export_snapshots where request_id=$1`,
      [identity.requestId],
    );
    if (rows[0]?.status === 'capturing' && rows[0]?.token_bound) {
      observedCapturingAt = Date.now();
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  if (!observedCapturingAt) throw new Error('live_capture_window_not_observed');

  const writeStartedAt = Date.now();
  const writing = fetch(`${base}/ycode/api/layers?page_id=${page.data.id}`, {
    method: 'PUT',
    headers: { cookie: `${cookie.name}=${cookie.value}`, 'content-type': 'application/json' },
    body: JSON.stringify({ layers: layer.data.layers }),
  }).then(async (response) => ({ response, body: await response.text(), endedAt: Date.now() }));

  const [exported, written] = await Promise.all([exporting, writing]);
  if (!exported.response.ok) throw new Error(`export_failed:${exported.response.status}:${exported.body}`);
  if (!written.response.ok) throw new Error(`editor_write_failed:${written.response.status}:${written.body}`);
  if (written.endedAt < exported.endedAt) throw new Error('editor_write_completed_inside_capture');
  const result = {
    observedLiveCaptureBeforeEditorWrite: observedCapturingAt <= writeStartedAt,
    editorWriteCompletedAfterExport: true,
    exportCompleted: true,
    editorWriteCompleted: true,
    captureObservedMs: observedCapturingAt - exportStartedAt,
    exportMs: exported.endedAt - exportStartedAt,
    editorWriteMs: written.endedAt - writeStartedAt,
    requestId: identity.requestId,
    sourceRevisionId: identity.sourceRevisionId,
  };
  await writeFile('.audit/P-2609-selfserve-launch/export-live-concurrency-proof.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  await db.end();
}
