import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOriginalAssetMap,
  rewriteToOriginalAssets,
  isOriginalAssetsMode,
} from '@/lib/apps/static-export/original-assets';
import { fetchAssetByProxyUrl } from '@/lib/apps/static-export/asset-bundler';
import { uuidToBase62 } from '@/lib/convertion-utils';

const ASSETS = [
  {
    id: '5f2c1a44-0000-4000-8000-000000000001',
    filename: 'hero-keys.jpg',
    mime_type: 'image/jpeg',
    storage_path: 'website/1-abc.jpg',
    public_url: 'http://sb/storage/v1/object/public/assets/website/1-abc.jpg',
  },
  {
    id: '5f2c1a44-0000-4000-8000-000000000002',
    filename: 'moto-a1.jpg',
    mime_type: 'image/jpeg',
    storage_path: 'website/2-def.jpg',
    public_url: 'http://sb/storage/v1/object/public/assets/website/2-def.jpg',
  },
];

test('buildOriginalAssetMap: keys on the proxy path Ycode renders, values are the input path', () => {
  const map = buildOriginalAssetMap(ASSETS);
  const entries = [...map.entries()];
  assert.equal(entries.length, 2);
  for (const [proxyPath, asset] of entries) {
    assert.match(proxyPath, /^\/a\/[A-Za-z0-9]{22}\/[^?]+$/);
    assert.equal(asset.outputKey, `assets/${asset.filename}`);
  }
  assert.deepEqual(
    entries.map(([, a]) => a.filename).sort(),
    ['hero-keys.jpg', 'moto-a1.jpg'],
  );
});

test('fetchAssetByProxyUrl: descarga desde Storage con la credencial del servidor, no desde public_url', async () => {
  const id = '5f2c1a44-0000-4000-8000-000000000001';
  const downloads: string[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({
                data: {
                  id,
                  filename: 'hero-keys.jpg',
                  mime_type: 'image/jpeg',
                  public_url: '/a/legacy',
                  storage_path: 'cliente_a/website/hero.jpg',
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        download: async (storagePath: string) => {
          downloads.push(storagePath);
          return { data: new Blob(['private asset']), error: null };
        },
      }),
    },
  };

  const file = await fetchAssetByProxyUrl(client, `/a/${uuidToBase62(id)}/hero-keys.jpg`);
  assert.equal(Buffer.isBuffer(file?.body), true);
  assert.equal(file?.body.toString(), 'private asset');
  assert.deepEqual(downloads, ['cliente_a/website/hero.jpg']);
});

test('buildOriginalAssetMap: skips assets with no storage_path (inline SVG icons)', () => {
  const map = buildOriginalAssetMap([
    { ...ASSETS[0], storage_path: null, public_url: null },
  ]);
  assert.equal(map.size, 0);
});

test('rewriteToOriginalAssets: src keeps the original filename and loses the query string', () => {
  const map = buildOriginalAssetMap(ASSETS);
  const [proxyPath] = [...map.keys()];
  const html = `<img src="${proxyPath}?width=1920&amp;quality=85" alt="x" />`;
  const out = rewriteToOriginalAssets(html, map);
  assert.match(out, /src="\/assets\/(hero-keys|moto-a1)\.jpg"/);
  assert.equal(out.includes('width=1920'), false);
  assert.equal(out.includes('/a/'), false);
});

test('rewriteToOriginalAssets: srcset and sizes are dropped, so the browser cannot pick a variant', () => {
  const map = buildOriginalAssetMap(ASSETS);
  const [proxyPath] = [...map.keys()];
  const html =
    `<img class="w-full" src="${proxyPath}?width=1920&amp;quality=85" ` +
    `srcset="${proxyPath}?width=320&amp;quality=85 320w, ${proxyPath}?width=640&amp;quality=85 640w" ` +
    `sizes="(max-width: 768px) 100vw, 1200px" alt="x" width="1200" height="800" />`;
  const out = rewriteToOriginalAssets(html, map);
  assert.equal(out.includes('srcset'), false);
  assert.equal(out.includes('sizes='), false);
  assert.match(out, /class="w-full"/);
  assert.match(out, /alt="x"/);
  assert.match(out, /width="1200"/);
});

test('rewriteToOriginalAssets: rewrites CSS url() references too, not just <img>', () => {
  const map = buildOriginalAssetMap(ASSETS);
  const [proxyPath, asset] = [...map.entries()][0];
  const html = `<div style="background-image:url(${proxyPath}?width=828&quality=85)"></div>`;
  const out = rewriteToOriginalAssets(html, map);
  assert.match(out, new RegExp(`url\\(/assets/${asset.filename.replace('.', '\\.')}\\)`));
});

test('rewriteToOriginalAssets: an unmapped proxy URL is left exactly as it was', () => {
  const map = buildOriginalAssetMap(ASSETS);
  const html = '<img src="/a/AAAAAAAAAAAAAAAAAAAAAA/other.jpg?width=640&amp;quality=85" srcset="x 1w" />';
  assert.equal(rewriteToOriginalAssets(html, map), html);
});

test('isOriginalAssetsMode: opt-in, off by default', () => {
  assert.equal(isOriginalAssetsMode({}), false);
  assert.equal(isOriginalAssetsMode({ RIN5_EXPORT_ORIGINAL_ASSETS: '0' }), false);
  assert.equal(isOriginalAssetsMode({ RIN5_EXPORT_ORIGINAL_ASSETS: '' }), false);
  assert.equal(isOriginalAssetsMode({ RIN5_EXPORT_ORIGINAL_ASSETS: '1' }), true);
  assert.equal(isOriginalAssetsMode({ RIN5_EXPORT_ORIGINAL_ASSETS: 'true' }), true);
});
