import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { parsePublicHttpUrl, safePublicFetch } from '@/lib/safe-public-fetch';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// DNS resolution + arbitrary outbound fetch need the Node runtime.
export const runtime = 'nodejs';

// Bound outbound fetches so a slow/hostile upstream can't stall a paste or
// exhaust memory. Published Webflow pages and their shared stylesheets are
// comfortably under these limits.
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 3 * 1024 * 1024; // 3MB

/**
 * GET /ycode/api/apps/webflow/stylesheet?site=<published site URL>
 *
 * Server-side proxy that auto-discovers a Webflow site's published stylesheet
 * from its live page. Fetching it from the builder directly would hit CORS;
 * routing through the server avoids that.
 *
 * We discover the URL from the page on every request rather than persisting it:
 * Webflow's shared CSS filename carries a content fingerprint that changes on
 * every republish, so a stored URL would go stale.
 */
export async function GET(request: NextRequest) {
  const site = request.nextUrl.searchParams.get('site');

  if (!site) {
    return noCache({ error: 'Provide a `site` parameter' }, 400);
  }

  try {
    const pageUrl = normalizeSiteUrl(site);
    if (!pageUrl) {
      return noCache({ error: 'Enter a valid published site URL' }, 400);
    }

    // SSRF guard: only fetch hosts that resolve to public IPs.
    const html = await fetchText(pageUrl.toString());
    const stylesheetUrl = findStylesheetUrl(html);
    if (!stylesheetUrl) {
      return noCache(
        {
          error:
            'No Webflow stylesheet found on that page. Make sure the site is published and the URL is correct.',
        },
        404,
      );
    }

    const css = await fetchText(stylesheetUrl);
    return noCache({ data: { css, stylesheetUrl } });
  } catch (error) {
    console.error('Error fetching Webflow stylesheet:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch stylesheet' },
      502,
    );
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize a user-entered site URL (bare domain or full URL) to an https URL,
 * rejecting hosts that could be used for SSRF (loopback / private ranges).
 */
function normalizeSiteUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const parsed = parsePublicHttpUrl(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    parsed.protocol = 'https:';
    if (parsed.port && parsed.port !== '443') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Find the Webflow shared stylesheet link in a published page's HTML.
 *
 * Webflow emits exactly one generated bundle named `*.webflow.shared.*.css`
 * (the global stylesheet that carries `:root` tokens, tag rules and site-wide
 * classes). Prefer that; only fall back to any other website-files.com `.css`
 * when the canonical bundle isn't present.
 */
function findStylesheetUrl(html: string): string | null {
  const matches = html.match(
    /https?:\/\/[^"'\s)]*website-files\.com\/[^"'\s)]+\.css/gi,
  );
  if (!matches || matches.length === 0) return null;
  return matches.find((m) => /\.webflow\.shared\.[^/]*\.css$/i.test(m)) ?? matches[0];
}

/**
 * Fetch text with a timeout and a hard byte cap. Reads the body as a stream so
 * an oversized response is aborted instead of being fully buffered.
 */
async function fetchText(target: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safePublicFetch(target, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Upstream returned ${res.status}`);
    }
    return await readCapped(res, MAX_BYTES);
  } finally {
    clearTimeout(timer);
  }
}

/** Read a response body up to `maxBytes`, aborting if it would exceed the cap. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    if (byteLength(text) > maxBytes) {
      throw new Error('Upstream response too large');
    }
    return text;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error('Upstream response too large');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
