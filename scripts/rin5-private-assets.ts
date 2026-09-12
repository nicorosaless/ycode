/**
 * Convert an existing rin5 tenant from public Storage URLs to its authenticated
 * `/a/...` asset proxy. This is deliberately a one-tenant, count-checked
 * migration: operators must provide the expected inventory from the backup.
 */
import { Module } from 'node:module';

type RequireFn = (id: string) => unknown;
const moduleProto = Module.prototype as unknown as { require: RequireFn };
const originalRequire: RequireFn = moduleProto.require;
moduleProto.require = function patchedRequire(this: unknown, id: string): unknown {
  if (id === 'server-only') return {};
  return originalRequire.call(this, id);
};

import knex from 'knex';
import { getAssetProxyUrl } from '../lib/asset-utils';
import { resolveDbSchema } from '../lib/tenant';

const schema = resolveDbSchema();
const expected = Number.parseInt(process.env.RIN5_EXPECTED_ASSET_COUNT ?? '', 10);
if (schema === 'public') throw new Error('rin5_private_assets_requires_tenant_schema');
if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('rin5_expected_asset_count_invalid');
if (!process.env.SUPABASE_CONNECTION_URL) throw new Error('supabase_connection_url_missing');

const db = knex({
  client: 'pg',
  connection: process.env.SUPABASE_CONNECTION_URL,
  searchPath: [schema, 'extensions'],
});

try {
  const assets = await db('assets')
    .select('id', 'filename', 'mime_type', 'storage_path', 'public_url')
    .whereNotNull('storage_path')
    .whereNull('deleted_at');
  if (assets.length !== expected) throw new Error(`rin5_asset_count_mismatch:${assets.length}:${expected}`);

  let changed = 0;
  for (const asset of assets) {
    if (!asset.storage_path.startsWith(`${schema}/`)) throw new Error(`rin5_asset_prefix_invalid:${asset.id}`);
    const publicUrl = getAssetProxyUrl(asset);
    if (!publicUrl) throw new Error(`rin5_asset_proxy_url_missing:${asset.id}`);
    if (asset.public_url !== publicUrl) {
      await db('assets').where({ id: asset.id }).update({ public_url: publicUrl });
      changed += 1;
    }
  }
  process.stdout.write(JSON.stringify({ schema, expected, changed, total: assets.length }) + '\n');
} finally {
  await db.destroy();
}
