import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const statePath = '/home/nicolas-rosales/.rin5/secrets/rin5-editor-dev-browser-state.json';
const state = JSON.parse(await readFile(statePath, 'utf8'));
const cookie = state.cookies.find(({ name }) => name === 'sb-localhost-auth-token');
if (!cookie?.value.startsWith('base64-')) throw new Error('owner_session_cookie_missing');
const ownerSession = JSON.parse(Buffer.from(cookie.value.slice(7), 'base64url').toString('utf8'));
if (typeof ownerSession.access_token !== 'string') throw new Error('owner_access_token_missing');

const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'RIN5_DB_SCHEMA', 'RIN5_STORAGE_PREFIX'];
for (const key of required) if (!process.env[key]) throw new Error(`missing_${key.toLowerCase()}`);

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const anonymous = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const refreshedOwner = await anonymous.auth.refreshSession({ refresh_token: ownerSession.refresh_token });
if (refreshedOwner.error || !refreshedOwner.data.session) throw refreshedOwner.error ?? new Error('owner_session_refresh_failed');
const ownerAccessToken = refreshedOwner.data.session.access_token;
const otherEmail = `rin5-rls-${randomUUID()}@example.test`;
const otherPassword = `${randomBytes(24).toString('base64url')}Aa1!`;
const objectPath = `${process.env.RIN5_STORAGE_PREFIX}/http-proof-${randomUUID()}.txt`;
let otherUserId;

const restPages = async (token) => {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/pages?select=id`, {
    headers: {
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
      'accept-profile': process.env.RIN5_DB_SCHEMA,
    },
  });
  const body = await response.json();
  return { status: response.status, rows: Array.isArray(body) ? body.length : null, error: Array.isArray(body) ? null : body.message };
};
const restMetadata = async (table, token, apikey = process.env.SUPABASE_PUBLISHABLE_KEY) => {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey, authorization: `Bearer ${token}`, 'accept-profile': process.env.RIN5_DB_SCHEMA },
  });
  return response.status;
};

try {
  const created = await admin.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('foreign_user_create_failed');
  otherUserId = created.data.user.id;
  const signedIn = await anonymous.auth.signInWithPassword({ email: otherEmail, password: otherPassword });
  if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error('foreign_user_signin_failed');
  const otherToken = signedIn.data.session.access_token;
  const otherCookie = `base64-${Buffer.from(JSON.stringify(signedIn.data.session)).toString('base64url')}`;

  const upload = await admin.storage.from('rin5-assets').upload(objectPath, Buffer.from('rin5 private proof'), { contentType: 'text/plain' });
  if (upload.error) throw upload.error;
  const publicUrl = admin.storage.from('rin5-assets').getPublicUrl(objectPath).data.publicUrl;
  const publicRead = await fetch(publicUrl);
  const ownerStorage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { authorization: `Bearer ${ownerAccessToken}` } },
  });
  const otherStorage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { authorization: `Bearer ${otherToken}` } },
  });
  const assets = await admin.schema(process.env.RIN5_DB_SCHEMA).from('assets').select('public_url').eq('is_published', false).is('deleted_at', null).limit(1).single();
  if (assets.error || !assets.data?.public_url?.startsWith('/a/')) throw assets.error ?? new Error('asset_proxy_fixture_missing');
  const assetUrl = new URL(assets.data.public_url, 'http://localhost:3002');
  const [ownerPages, otherPages, ownerObject, otherObject, anonymousProxy, ownerProxy, otherProxy, ownerMigrations, serviceMigrations, ownerMemberships] = await Promise.all([
    restPages(ownerAccessToken),
    restPages(otherToken),
    ownerStorage.storage.from('rin5-assets').download(objectPath),
    otherStorage.storage.from('rin5-assets').download(objectPath),
    fetch(assetUrl),
    fetch(assetUrl, { headers: { cookie: `${cookie.name}=${cookie.value}` } }),
    fetch(assetUrl, { headers: { cookie: `${cookie.name}=${otherCookie}` } }),
    restMetadata('migrations', ownerAccessToken),
    restMetadata('migrations', process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SECRET_KEY),
    restMetadata('tenant_memberships', ownerAccessToken),
  ]);
  const result = {
    schema: process.env.RIN5_DB_SCHEMA,
    prefix: process.env.RIN5_STORAGE_PREFIX,
    ownerPages,
    otherPages,
    storage: {
      publicStatus: publicRead.status,
      ownerAllowed: !ownerObject.error && ownerObject.data.size > 0,
      otherDenied: Boolean(otherObject.error),
      assetProxy: {
        anonymousCacheControl: anonymousProxy.headers.get('cache-control'), anonymousStatus: anonymousProxy.status,
        foreignStatus: otherProxy.status, ownerCacheControl: ownerProxy.headers.get('cache-control'), ownerStatus: ownerProxy.status,
      },
    },
    metadata: { authenticatedMembershipsStatus: ownerMemberships, authenticatedMigrationsStatus: ownerMigrations, serviceMigrationsStatus: serviceMigrations },
  };
  if (ownerPages.status !== 200 || ownerPages.rows === 0) throw new Error(`owner_rest_failed:${JSON.stringify(result)}`);
  if (otherPages.status !== 200 || otherPages.rows !== 0) throw new Error(`foreign_rest_failed:${JSON.stringify(result)}`);
  if (publicRead.ok || !result.storage.ownerAllowed || !result.storage.otherDenied) throw new Error(`storage_isolation_failed:${JSON.stringify(result)}`);
  if (anonymousProxy.status !== 401 || ownerProxy.status !== 200 || otherProxy.status !== 403) throw new Error(`asset_proxy_isolation_failed:${JSON.stringify(result)}`);
  if (anonymousProxy.headers.get('cache-control') !== 'private, no-store' || !ownerProxy.headers.get('cache-control')?.startsWith('private')) throw new Error(`asset_proxy_cache_failed:${JSON.stringify(result)}`);
  if (ownerMigrations < 400 || ownerMemberships < 400 || serviceMigrations !== 200) throw new Error(`metadata_acl_failed:${JSON.stringify(result)}`);
  await writeFile('.audit/P-2609-selfserve-launch/tenant-http-proof.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  await admin.storage.from('rin5-assets').remove([objectPath]);
  if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
}
