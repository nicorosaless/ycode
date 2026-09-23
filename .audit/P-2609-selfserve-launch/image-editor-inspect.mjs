import { chromium } from 'playwright';

const base = 'http://localhost:3002';
const handoff = await fetch(`${base}/ycode/api/rin5/handoff`, {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.RIN5_INTERNAL_API_SECRET}`, 'content-type': 'application/json' },
  body: JSON.stringify({ siteId: process.env.RIN5_SITE_ID, email: process.env.RIN5_ALLOWED_EMAILS }),
});
if (!handoff.ok) throw new Error(`handoff_failed:${handoff.status}`);
const browser = await chromium.launch({ headless: true, executablePath: '/home/nicolas-rosales/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
try {
  await page.goto((await handoff.json()).actionLink, { waitUntil: 'networkidle', timeout: 90_000 });
  const pagesResponse = await context.request.get(`${base}/ycode/api/pages`);
  const pages = (await pagesResponse.json()).data;
  const second = pages.find(({ slug }) => slug === 'nosotros');
  if (!second) throw new Error('second_page_missing');
  await page.goto(`${base}/ycode/layers/${second.id}`, { waitUntil: 'networkidle', timeout: 90_000 });
  const frame = page.locator('iframe').first().contentFrame();
  const image = frame.getByAltText('Ilustración geométrica de prueba');
  await image.waitFor({ timeout: 60_000 });
  const originalImage = await image.evaluate((element) => ({ src: element.getAttribute('src'), parent: element.parentElement?.getAttribute('data-layer-id') }));
  await image.dblclick();
  const uploaded = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/ycode/api/files/upload' && response.ok(), { timeout: 60_000 });
  await page.locator('input[type=file]').setInputFiles('.audit/P-2609-selfserve-launch/editor-replacement.svg');
  await uploaded;
  await page.waitForTimeout(1000);
  const replacementSaved = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/ycode/api/layers' && response.ok(), { timeout: 30_000 });
  const replacementCard = page.getByText('editor-replacement', { exact: true }).last().locator('..').locator(':scope > div').first();
  await replacementCard.click();
  await replacementSaved;
  await page.reload({ waitUntil: 'networkidle', timeout: 90_000 });
  const persistedFrame = page.locator('iframe').first().contentFrame();
  const replacementImage = persistedFrame.getByAltText('Ilustración geométrica de prueba');
  await replacementImage.waitFor({ timeout: 60_000 });
  const replacementSrc = await replacementImage.getAttribute('src');

  await replacementImage.dblclick();
  const restored = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/ycode/api/layers' && response.ok(), { timeout: 30_000 });
  const originalCard = page.getByText('editor-proof.svg', { exact: true }).locator('..').locator(':scope > div').first();
  await originalCard.click();
  await restored;
  await page.reload({ waitUntil: 'networkidle', timeout: 90_000 });
  const restoredImage = page.locator('iframe').first().contentFrame().getByAltText('Ilustración geométrica de prueba');
  await restoredImage.waitFor({ timeout: 60_000 });
  const restoredSrc = await restoredImage.getAttribute('src');

  const assetsResponse = await context.request.get(`${base}/ycode/api/assets?limit=100`);
  const assetsBody = await assetsResponse.json();
  const assets = assetsBody.data?.assets ?? assetsBody.data ?? [];
  for (const asset of assets.filter(({ filename }) => filename === 'editor-replacement')) {
    await context.request.delete(`${base}/ycode/api/assets/${asset.id}`);
  }
  if (!replacementSrc?.startsWith('data:image/svg+xml') || !restoredSrc?.includes('/a/')) throw new Error('image_edit_or_restore_failed');
  await page.waitForTimeout(750);
  console.log(JSON.stringify({
    image: originalImage,
    replacementPersisted: true,
    restoredToPrivateProxy: restoredSrc,
    buttons: (await page.getByRole('button').allTextContents()).filter(Boolean).slice(0, 80),
    labels: (await page.locator('label').allTextContents()).filter(Boolean).slice(0, 80),
    inputs: await page.locator('input').evaluateAll((elements) => elements.map((element) => ({ type: element.type, value: element.value, placeholder: element.placeholder })).slice(0, 80)),
    text: (await page.locator('body').innerText()).slice(-3000),
  }));
} finally {
  await context.close();
  await browser.close();
}
