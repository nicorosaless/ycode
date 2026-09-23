import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const identity = { actorUserId: randomUUID(), requestId: randomUUID(), sourceRevisionId: randomUUID() };
const response = await fetch('http://localhost:3002/ycode/api/rin5/export', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.RIN5_INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
  body: JSON.stringify({ ...identity, siteId: process.env.RIN5_SITE_ID }),
});
if (!response.ok) throw new Error(`export_failed:${response.status}`);
const body = await response.json();
if (body.actorUserId !== identity.actorUserId || body.requestId !== identity.requestId || body.sourceRevisionId !== identity.sourceRevisionId) throw new Error('identity_mismatch');
const manifest = body.files.map((file) => {
  const bytes = Buffer.from(file.bodyBase64, 'base64');
  return { contentType: file.contentType, path: file.path, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength };
});
if (JSON.stringify(manifest) !== JSON.stringify(body.manifest)) throw new Error('manifest_mismatch');
if (manifest.some((entry, index) => index > 0 && manifest[index - 1].path.localeCompare(entry.path) > 0)) throw new Error('manifest_not_sorted');
const evidence = { files: manifest.length, identityReflected: true, manifestVerified: true, paths: manifest.map(({ path }) => path) };
await writeFile('.audit/P-2609-selfserve-launch/export-contract-proof.json', `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(evidence));
