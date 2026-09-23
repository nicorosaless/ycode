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
  const frame = page.locator('iframe').first().contentFrame();
  const paragraph = frame.getByText('Este sitio permite comprobar el dashboard y la publicación sin utilizar los datos de un cliente.', { exact: true });
  await paragraph.click();
  const moved = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/ycode/api/layers' && response.ok(), { timeout: 15_000 });
  await page.keyboard.press('ArrowUp');
  await moved;
  await page.reload({ waitUntil: 'networkidle', timeout: 90_000 });
  const mainTexts = await page.locator('iframe').first().contentFrame().locator('main > *').allTextContents();
  if (!mainTexts[0]?.startsWith('Este sitio permite')) throw new Error(`order_not_persisted:${JSON.stringify(mainTexts)}`);
  await page.locator('iframe').first().contentFrame().getByText('Este sitio permite comprobar el dashboard y la publicación sin utilizar los datos de un cliente.', { exact: true }).click();
  const restored = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === '/ycode/api/layers' && response.ok(), { timeout: 15_000 });
  await page.keyboard.press('ArrowDown');
  await restored;
  await page.reload({ waitUntil: 'networkidle', timeout: 90_000 });
  const restoredTexts = await page.locator('iframe').first().contentFrame().locator('main > *').allTextContents();
  if (!restoredTexts[0]?.startsWith('Tu primera web')) throw new Error(`order_not_restored:${JSON.stringify(restoredTexts)}`);
  console.log(JSON.stringify({ orderPersisted: true, orderRestored: true }));
} finally {
  await context.close();
  await browser.close();
}
