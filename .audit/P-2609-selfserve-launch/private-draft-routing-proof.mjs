import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const base = 'http://localhost:3002';
const state = JSON.parse(await readFile('/home/nicolas-rosales/.rin5/secrets/rin5-editor-dev-browser-state.json', 'utf8'));
const ownerCookie = state.cookies.find(({ name }) => name === 'sb-localhost-auth-token');
if (!ownerCookie) throw new Error('owner_cookie_missing');
const pagePaths = ['/', '/nosotros', '/dynamic'];
const statuses = async (headers) => Object.fromEntries(await Promise.all(pagePaths.map(async (path) => [path, (await fetch(`${base}${path}`, { headers })).status])));
const before = await statuses();
const owner = await statuses({ cookie: `${ownerCookie.name}=${ownerCookie.value}` });
const [form, collection, config] = await Promise.all([
  fetch(`${base}/ycode/api/form-submissions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  fetch(`${base}/ycode/api/collections/${randomUUID()}/items/filter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
  fetch(`${base}/ycode/api/supabase/config`),
]);
const exported = await fetch(`${base}/ycode/api/rin5/export`, {
  method: 'POST', headers: { authorization: `Bearer ${process.env.RIN5_INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
  body: JSON.stringify({ actorUserId: randomUUID(), requestId: randomUUID(), siteId: process.env.RIN5_SITE_ID, sourceRevisionId: randomUUID() }),
});
if (!exported.ok) throw new Error(`export_failed:${exported.status}`);
const after = await statuses();
if (Object.values(before).some((status) => status !== 401) || Object.values(after).some((status) => status !== 401)) throw new Error('anonymous_draft_page_leak');
if (Object.values(owner).some((status) => status !== 200)) throw new Error('owner_draft_page_unavailable');
if (form.status !== 401 || collection.status !== 401 || config.status !== 200) throw new Error('tenant_api_boundary_failed');
const result = { afterExportAnonymous: after, beforeExportAnonymous: before, owner, tenantApis: { collection: collection.status, configBootstrap: config.status, form: form.status } };
await writeFile('.audit/P-2609-selfserve-launch/private-draft-routing-proof.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(result));
