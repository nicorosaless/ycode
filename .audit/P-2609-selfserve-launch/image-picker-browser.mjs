import { chromium } from '../../node_modules/playwright/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = 'https://ubuntu-devbox.taild86c42.ts.net:8474';
const state = '/home/nicolas-rosales/.rin5/secrets/rin5-tailnet-browser-state.json';
const outputDir = '.audit/P-2609-selfserve-launch/closeout/image-picker';
const evidence = {
  capturedAt: new Date().toISOString(),
  runtimeImage: '1069a2…',
  opens: [],
};

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/nicolas-rosales/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
});

try {
  for (let index = 1; index <= 3; index += 1) {
    const context = await browser.newContext({
      storageState: state,
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const assetResponses = [];
    const contentMutations = [];
    const readOnlyPosts = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/ycode/api/assets?')) return;
      let body;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      assetResponses.push({
        status: response.status(),
        path: new URL(response.url()).pathname + new URL(response.url()).search,
        count: body?.data?.length ?? null,
        total: body?.total ?? null,
        mimeTypes: [...new Set(body?.data?.map((asset) => asset.mime_type) ?? [])],
      });
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/ycode/api/collections/items/batch' && request.method() === 'POST') {
        readOnlyPosts.push({ method: request.method(), path: url.pathname });
        return;
      }
      if (url.origin === origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        && /\/ycode\/api\/(?:layers|collections|pages|settings|locales|files)/.test(url.pathname)) {
        contentMutations.push({ method: request.method(), path: url.pathname });
      }
    });

    await page.goto(`${origin}/ycode`, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.getByRole('button', { name: 'Contenido', exact: true }).click();
    await page.getByText('Conoce nuestra hípica', { exact: true }).click();
    const originalImageVisible = await page.getByText('foto-04.jpg', { exact: true }).isVisible();
    await page.getByRole('button', { name: 'Change file', exact: true }).click();

    const manager = page.getByText('File Manager', { exact: true });
    await manager.waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByText('12 files', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    const filenames = await page.locator('text=/^foto-(?:0[1-9]|1[0-2])\\.(?:jpg|png)$/').allTextContents();
    const bodyText = await page.locator('body').innerText();
    const filterText = (await page.getByRole('button', { name: 'Images, Icons', exact: true }).innerText()).trim();
    const screenshot = `${outputDir}/open-${index}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await manager.waitFor({ state: 'hidden' });

    evidence.opens.push({
      index,
      freshContext: true,
      collectionPath: new URL(page.url()).pathname,
      originalImageVisible,
      filterText,
      visibleFilenames: [...new Set(filenames)].sort(),
      visibleFileCount: new Set(filenames).size,
      noFilesMessageVisible: bodyText.includes('No files found'),
      assetResponses,
      closedWithoutSelection: await page.getByText('foto-04.jpg', { exact: true }).isVisible(),
      contentMutations,
      readOnlyPosts,
      screenshot,
    });
    await context.close();
  }

  evidence.ok = evidence.opens.length === 3 && evidence.opens.every((open) =>
    open.freshContext
    && open.originalImageVisible
    && open.filterText === 'Images, Icons'
    && open.visibleFileCount === 12
    && !open.noFilesMessageVisible
    && open.assetResponses.some((response) => response.status === 200 && response.count === 12 && response.total === 12)
    && open.closedWithoutSelection
    && open.contentMutations.length === 0
  );
  if (!evidence.ok) process.exitCode = 2;
} catch (error) {
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await writeFile(`${outputDir}/browser-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  await browser.close();
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
