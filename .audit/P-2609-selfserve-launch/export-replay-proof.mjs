import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'http://localhost:3002';
const identity = { actorUserId: randomUUID(), requestId: randomUUID(), siteId: process.env.RIN5_SITE_ID, sourceRevisionId: randomUUID() };
const exportWith = async (value) => {
  const response = await fetch(`${base}/ycode/api/rin5/export`, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.RIN5_INTERNAL_API_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`export_failed:${response.status}:${await response.text()}`);
  return response.json();
};
const digest = (bundle) => createHash('sha256').update(JSON.stringify(bundle.files)).digest('hex');
const first = await exportWith(identity);

const handoff = await fetch(`${base}/ycode/api/rin5/handoff`, {
  method: 'POST', headers: { authorization: `Bearer ${process.env.RIN5_INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
  body: JSON.stringify({ siteId: process.env.RIN5_SITE_ID, email: process.env.RIN5_ALLOWED_EMAILS }),
});
if (!handoff.ok) throw new Error(`handoff_failed:${handoff.status}`);
const { actionLink } = await handoff.json();
const browser = await chromium.launch({ headless: true, executablePath: '/home/nicolas-rosales/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const context = await browser.newContext();
const page = await context.newPage();
const original = 'Tu primera web de prueba';
const changed = `Snapshot posterior ${Date.now()}`;
let canvas;
let currentText;
try {
  await page.goto(actionLink, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForFunction(() => location.pathname.includes('/ycode/layers/'), undefined, { timeout: 90_000 });
  canvas = page.locator('iframe').first().contentFrame();
  const heading = canvas.locator('h1').first();
  await heading.waitFor({ timeout: 60_000 });
  currentText = (await heading.textContent())?.trim();
  if (!currentText) throw new Error('fixture_heading_missing');
  await heading.dblclick();
  const save = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/ycode/api/layers' && response.ok(), { timeout: 30_000 });
  await canvas.locator('[contenteditable=true]').first().fill(changed);
  await canvas.locator('[contenteditable=true]').first().press('Escape');
  await save;

  const replay = await exportWith(identity);
  const laterIdentity = { ...identity, requestId: randomUUID(), sourceRevisionId: randomUUID() };
  const later = await exportWith(laterIdentity);
  if (digest(first) !== digest(replay)) throw new Error('replay_bytes_changed');
  if (!later.files.some((file) => file.contentType.includes('text/html') && Buffer.from(file.bodyBase64, 'base64').includes(changed))) {
    throw new Error('new_revision_did_not_capture_edit');
  }

  const result = {
    firstDigest: digest(first), replayDigest: digest(replay), replayExact: true,
    laterRevisionCapturedEdit: true, requestId: identity.requestId, sourceRevisionId: identity.sourceRevisionId,
  };
  await writeFile('.audit/P-2609-selfserve-launch/export-replay-proof.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  if (canvas) {
    const edited = canvas.getByText(changed, { exact: true });
    if (await edited.count()) {
      await edited.dblclick();
      const restore = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/ycode/api/layers' && response.ok(), { timeout: 30_000 });
      await canvas.locator('[contenteditable=true]').first().fill(original);
      await canvas.locator('[contenteditable=true]').first().press('Escape');
      await restore;
    }
  }
  await context.close();
  await browser.close();
}
