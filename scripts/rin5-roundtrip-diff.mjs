#!/usr/bin/env node
/**
 * rin5 round-trip diff, per section (G9, P-2609).
 *
 * A full-page screenshot diff (used in round 1) conflates every cause of
 * pixel drift into one number: a single missing `::before` shifts everything
 * below it, and the diff at the bottom of a long page is dominated by that
 * accumulated offset, not by whatever actually changed there. This measures
 * each top-level `<header>`/`<section>`/`<footer>` in isolation instead, so a
 * regression in one section can't hide inside — or fake — the average.
 *
 * Usage:
 *   node scripts/rin5-roundtrip-diff.mjs \
 *     --src /path/to/rin5/clients/7/site \
 *     --out /path/to/ycode-roundtrip/7-v2/bundle \
 *     --diff /path/to/ycode-roundtrip/7-v2/diff-sections \
 *     [--pages index,contacto,permisos,permiso-a,permiso-b] \
 *     [--viewports 1440,390]
 *
 * `--src` is a flat rin5 bundle (`{slug}.html` + `assets/`, `index.html` for
 * the home page). `--out` is a Ycode static export (`{slug}/index.html`,
 * `index.html` for the home page). Both are served locally over plain HTTP;
 * nothing is uploaded anywhere.
 */

import { chromium } from 'playwright';
import pixelmatchModule from 'pixelmatch';
import { PNG } from 'pngjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pixelmatch = pixelmatchModule.default ?? pixelmatchModule;

const REGION_SELECTOR = [
  'body > header', 'body > footer', 'body > section',
  'body > main > header', 'body > main > footer', 'body > main > section',
].join(', ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const out = { pages: null, viewports: [1440, 390] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') out.src = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--diff') out.diff = argv[++i];
    else if (a === '--pages') out.pages = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--viewports') out.viewports = argv[++i].split(',').map((s) => parseInt(s.trim(), 10));
  }
  if (!out.src || !out.out || !out.diff) {
    console.error('Usage: rin5-roundtrip-diff.mjs --src <dir> --out <dir> --diff <dir> [--pages a,b] [--viewports 1440,390]');
    process.exit(1);
  }
  return out;
}

/** Minimal static file server — no framework, no external listener beyond this process. */
function serveDir(rootDir) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let rel = urlPath === '/' ? '/index.html' : urlPath;
    let filePath = path.join(rootDir, rel);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found: ' + rel);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function serverPort(server) {
  return server.address().port;
}

/**
 * The pages of a bundle, in either shape it can arrive in.
 *
 * `--src` used to be a flat rin5 bundle and nothing else. Since the importer
 * accepts its own exports (P-2609), a useful measurement is export against
 * export — same shape on both sides — so the layout is detected instead of
 * assumed: `{slug}.html` at the root, or `{slug}/index.html` one folder deep.
 * Error pages are skipped in both.
 */
function listBundlePages(srcDir, only) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  const skip = new Set(['401.html', '404.html', '500.html']);
  const slugs = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue;
      if (fs.existsSync(path.join(srcDir, entry.name, 'index.html'))) slugs.push(entry.name);
      continue;
    }
    if (!entry.name.endsWith('.html') || skip.has(entry.name)) continue;
    const base = entry.name.replace(/\.html$/, '');
    slugs.push(base === 'index' ? '' : base);
  }
  const picked = only ? slugs.filter((s) => only.includes(s === '' ? 'index' : s)) : slugs;
  return picked.sort();
}

/** Whether this bundle keeps `{slug}` in a folder (a Ycode export) or as `{slug}.html` (a rin5 bundle). */
function isNestedBundle(dir) {
  return !fs.existsSync(path.join(dir, 'styles.css'));
}

function urlForSrc(port, slug, nested) {
  if (slug === '') return `http://127.0.0.1:${port}/`;
  return `http://127.0.0.1:${port}/${nested ? `${slug}/` : `${slug}.html`}`;
}
function urlForOut(port, slug) {
  return `http://127.0.0.1:${port}/${slug === '' ? '' : `${slug}/`}`;
}

/** Pad two same-format PNGs to a shared canvas size (transparent-black fill) so pixelmatch can compare them. */
function padToCommonSize(a, b) {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pad = (img) => {
    if (img.width === width && img.height === height) return img;
    const out = new PNG({ width, height });
    PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
    return out;
  };
  return [pad(a), pad(b), width, height];
}

async function screenshotRegions(page, url, viewportWidth) {
  await page.setViewportSize({ width: viewportWidth, height: 1000 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});

  // Walk the whole page before capturing, half a viewport at a time.
  // A `fullPage` screenshot of a page that reveals on scroll is otherwise a
  // reference nobody ever sees: `.reveal{opacity:0}` plus an
  // IntersectionObserver means only what has actually been inside the 1000px
  // viewport is visible, so on the Hipiclub bundle 17 of 19 revealed blocks
  // were captured blank while a real visitor sees every one of them. The dwell
  // is not decoration — jumping a full viewport per frame let the observer
  // coalesce the moves and still left 17 blocks hidden.
  await page.evaluate(async () => {
    const step = Math.max(1, Math.round(window.innerHeight / 2));
    for (let y = 0; y < document.body.scrollHeight + step; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
    // Long enough for the slowest reveal transition in these sheets (0.7s).
    await new Promise((resolve) => setTimeout(resolve, 900));
  });

  // Page-relative boxes (getBoundingClientRect + scroll offset), not
  // `elementHandle.screenshot()` after `scrollIntoViewIfNeeded()`: with a
  // `position:sticky` header (both bundles have one), repeatedly scrolling
  // the *same* page/tab through several regions left the sticky header
  // re-appearing inside a later region's clip on some runs — a genuine
  // Playwright element-screenshot quirk, not a fidelity difference. A single
  // `fullPage` capture clipped per region sidesteps scrolling entirely.
  const boxes = await page.evaluate(({ sel }) => [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height,
      tag: el.tagName.toLowerCase(), className: el.getAttribute('class') || '',
    };
  }), { sel: REGION_SELECTOR });

  const regions = [];
  for (const box of boxes) {
    const { tag, className, ...clip } = box;
    const meta = { tag, className };
    let buffer = null;
    try {
      if (clip.width <= 0 || clip.height <= 0) throw new Error(`degenerate box ${JSON.stringify(clip)}`);
      buffer = await page.screenshot({ fullPage: true, clip });
    } catch (err) {
      meta.error = String(err.message || err);
    }
    regions.push({ ...meta, buffer });
  }
  return regions;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.diff, { recursive: true });

  const srcServer = await serveDir(args.src);
  const outServer = await serveDir(args.out);
  const srcPort = serverPort(srcServer);
  const outPort = serverPort(outServer);

  const pages = listBundlePages(args.src, args.pages);
  const srcNested = isNestedBundle(args.src);
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const rows = [];
  for (const slug of pages) {
    const label = slug === '' ? 'index' : slug;
    for (const vw of args.viewports) {
      const viewportLabel = vw >= 1200 ? 'desktop' : 'mobile';
      const srcRegions = await screenshotRegions(page, urlForSrc(srcPort, slug, srcNested), vw);
      const outRegions = await screenshotRegions(page, urlForOut(outPort, slug), vw);
      const regionCount = Math.max(srcRegions.length, outRegions.length);

      for (let i = 0; i < regionCount; i++) {
        const s = srcRegions[i];
        const o = outRegions[i];
        const base = `${label}-${viewportLabel}-r${i}`;
        if (!s || !o || !s.buffer || !o.buffer) {
          rows.push({
            page: label, viewport: viewportLabel, region: i,
            tag: (s || o)?.tag ?? null, className: (s || o)?.className ?? null,
            diffPixels: null, totalPixels: null, diffPct: null,
            note: !s ? 'missing in src' : !o ? 'missing in out' : 'screenshot failed',
          });
          continue;
        }
        const srcPng = PNG.sync.read(s.buffer);
        const outPng = PNG.sync.read(o.buffer);
        const [a, b, width, height] = padToCommonSize(srcPng, outPng);
        const diffPng = new PNG({ width, height });
        const diffPixels = pixelmatch(a.data, b.data, diffPng.data, width, height, { threshold: 0.1 });
        const totalPixels = width * height;
        fs.writeFileSync(path.join(args.diff, `${base}-src.png`), PNG.sync.write(a));
        fs.writeFileSync(path.join(args.diff, `${base}-out.png`), PNG.sync.write(b));
        fs.writeFileSync(path.join(args.diff, `${base}-diff.png`), PNG.sync.write(diffPng));
        rows.push({
          page: label, viewport: viewportLabel, region: i,
          tag: s.tag, className: s.className,
          diffPixels, totalPixels, diffPct: (100 * diffPixels) / totalPixels,
        });
      }
    }
  }

  await browser.close();
  srcServer.close();
  outServer.close();

  // Weighted total = sum(diffPixels) / sum(totalPixels), by page+viewport and overall —
  // weighting by area so a tiny badge and a full-width hero don't count equally.
  const summarize = (filterFn) => {
    const scoped = rows.filter((r) => r.totalPixels !== null && filterFn(r));
    const diffSum = scoped.reduce((acc, r) => acc + r.diffPixels, 0);
    const totalSum = scoped.reduce((acc, r) => acc + r.totalPixels, 0);
    return totalSum > 0 ? (100 * diffSum) / totalSum : null;
  };

  const byPageViewport = [];
  for (const slug of pages) {
    const label = slug === '' ? 'index' : slug;
    for (const vw of args.viewports) {
      const viewportLabel = vw >= 1200 ? 'desktop' : 'mobile';
      byPageViewport.push({
        page: label, viewport: viewportLabel,
        weightedDiffPct: summarize((r) => r.page === label && r.viewport === viewportLabel),
      });
    }
  }

  const result = {
    schema: '1.0',
    src: args.src, out: args.out,
    pages, viewports: args.viewports,
    rows, byPageViewport,
    overallWeightedDiffPct: summarize(() => true),
  };
  fs.writeFileSync(path.join(args.diff, 'sections.json'), JSON.stringify(result, null, 2));

  const lines = [];
  lines.push('| page | viewport | region | tag.class | diff % |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    const label = r.className ? `${r.tag}.${r.className.split(/\s+/)[0]}` : r.tag ?? '?';
    const pct = r.diffPct === null ? (r.note ?? 'n/a') : `${r.diffPct.toFixed(2)}%`;
    lines.push(`| ${r.page} | ${r.viewport} | ${r.region} | ${label} | ${pct} |`);
  }
  lines.push('');
  lines.push('| page | viewport | weighted diff % |');
  lines.push('|---|---|---|');
  for (const pv of byPageViewport) {
    lines.push(`| ${pv.page} | ${pv.viewport} | ${pv.weightedDiffPct?.toFixed(2) ?? 'n/a'}% |`);
  }
  lines.push('');
  lines.push(`**Overall weighted diff: ${result.overallWeightedDiffPct?.toFixed(2) ?? 'n/a'}%**`);
  const table = lines.join('\n');
  fs.writeFileSync(path.join(args.diff, 'sections.md'), table);
  console.log(table);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
