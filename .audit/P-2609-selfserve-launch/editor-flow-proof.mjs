import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'http://localhost:3002';
const handoff = await fetch(`${base}/ycode/api/rin5/handoff`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.RIN5_INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
  body: JSON.stringify({ siteId: process.env.RIN5_SITE_ID, email: process.env.RIN5_ALLOWED_EMAILS }),
});
if (!handoff.ok) throw new Error(`handoff_failed:${handoff.status}`);
const handoffBody = await handoff.json();
const browser = await chromium.launch({ headless: true, executablePath: '/home/nicolas-rosales/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
let context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let page = await context.newPage();
const sessionPath = '/home/nicolas-rosales/.rin5/secrets/rin5-editor-flow-proof-state.json';
const originalText = 'Tu primera web de prueba';
const changedText = `Edición persistida ${Date.now()}`;
try {
  await page.goto(handoffBody.actionLink, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForURL(/\/ycode\/layers\//, { timeout: 90_000 });
  const canvas = page.locator('iframe').first().contentFrame();
  let heading = canvas.getByText(originalText, { exact: true });
  await heading.waitFor({ timeout: 60_000 });
  await heading.dblclick();
  await page.waitForTimeout(500);
  const editable = canvas.locator('[contenteditable=true]').first();
  const saved = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === 'PUT' && new URL(response.url()).pathname === '/ycode/api/layers' && response.ok();
  }, { timeout: 30_000 });
  await editable.fill(changedText);
  await editable.press('Escape');
  await saved;
  await canvas.getByText(changedText, { exact: true }).waitFor({ timeout: 30_000 });
  await context.storageState({ path: sessionPath });
  await context.close();

  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: sessionPath });
  page = await context.newPage();
  await page.goto(`${base}/ycode`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.waitForURL(/\/ycode\/layers\//, { timeout: 90_000 });
  const reloadedCanvas = page.locator('iframe').first().contentFrame();
  const persistedHeading = reloadedCanvas.getByText(changedText, { exact: true });
  await persistedHeading.waitFor({ timeout: 60_000 });

  const exported = await fetch(`${base}/ycode/api/rin5/export`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RIN5_INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ actorUserId: randomUUID(), requestId: randomUUID(), siteId: process.env.RIN5_SITE_ID, sourceRevisionId: randomUUID() }),
  });
  if (!exported.ok) throw new Error(`export_failed:${exported.status}:${await exported.text()}`);
  const bundle = await exported.json();
  const files = bundle.files.map((file) => ({ ...file, body: Buffer.from(file.bodyBase64, 'base64') }));
  const htmlFiles = files.filter((file) => file.contentType.includes('text/html'));
  const image = files.find((file) => file.path === 'assets/editor-proof.svg');
  const sourceImage = await readFile('.audit/P-2609-selfserve-launch/input/assets/editor-proof.svg');
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  if (htmlFiles.length < 2 || !htmlFiles.some((file) => file.body.includes(changedText))) throw new Error('multipage_text_export_failed');
  if (!image || digest(image.body) !== digest(sourceImage)) throw new Error('private_image_export_failed');

  await persistedHeading.dblclick();
  const restoreEditable = reloadedCanvas.locator('[contenteditable=true]').first();
  const restoredSave = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === 'PUT' && new URL(response.url()).pathname === '/ycode/api/layers' && response.ok();
  }, { timeout: 30_000 });
  await restoreEditable.fill(originalText);
  await restoreEditable.press('Escape');
  await restoredSave;
  await page.reload({ waitUntil: 'networkidle', timeout: 90_000 });
  const restored = page.locator('iframe').first().contentFrame().getByText(originalText, { exact: true });
  await restored.waitFor({ timeout: 60_000 });

  const result = {
    finalPath: new URL(page.url()).pathname,
    textPersistedAcrossContext: true,
    textRestored: await restored.count() === 1,
    exportedHtmlPages: htmlFiles.map((file) => file.path).sort(),
    exportedImagePath: image.path,
    exportedImageSha256: digest(image.body),
  };
  await writeFile('.audit/P-2609-selfserve-launch/editor-flow-inspect.json', `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(result));
} finally {
  await context.close();
  await browser.close();
  await rm(sessionPath, { force: true });
}
