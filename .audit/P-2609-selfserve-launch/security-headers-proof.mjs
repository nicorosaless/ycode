import { writeFile } from 'node:fs/promises';

const response = await fetch('http://localhost:3002/');
const required = ['content-security-policy', 'permissions-policy', 'referrer-policy', 'x-content-type-options', 'x-frame-options'];
const headers = Object.fromEntries(required.map((name) => [name, response.headers.get(name)]));
if (!response.ok || Object.values(headers).some((value) => !value)) throw new Error(`security_headers_missing:${JSON.stringify(headers)}`);
const result = { headers, status: response.status };
await writeFile('.audit/P-2609-selfserve-launch/security-headers-proof.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(result));
