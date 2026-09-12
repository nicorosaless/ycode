/**
 * Static export — original-bytes asset mode (rin5 round-trip, G9/P-2609).
 *
 * By default Ycode serves every bitmap through its own image proxy: the
 * rendered `<img>` carries `src="/a/<hash>/<slug>.jpg?width=1920&quality=85"`
 * plus a seven-candidate `srcset` and a `sizes` attribute. That is the right
 * default for a hosted site, but it makes an exported bundle impossible to
 * compare byte-for-byte against the HTML that was imported: the paths differ,
 * the query string differs, and which candidate the browser fetches depends on
 * its DPR.
 *
 * With `RIN5_EXPORT_ORIGINAL_ASSETS=1` the export instead writes every asset
 * that `scripts/rin5-import.ts` uploaded back out under `assets/<filename>` —
 * the same path and the same bytes it came in with — and rewrites the HTML to
 * point at it with no query string, no `srcset` and no `sizes`. The result is
 * diffable against the input bundle.
 *
 * Only rin5-imported assets are touched. Anything uploaded through the editor
 * keeps the proxy URL and the responsive pipeline.
 */

import { getAssetProxyUrl } from '@/lib/asset-utils'

/** Minimal asset row shape this module needs. */
export interface AssetRow {
  id: string
  filename: string
  mime_type: string
  storage_path: string | null
  public_url: string | null
}

export interface OriginalAsset {
  filename: string
  mimeType: string
  storagePath: string
  /** Output path in the exported bundle — mirrors the input bundle's `assets/` folder. */
  outputKey: string
}

/**
 * `assets.source` written by `scripts/rin5-import.ts` for everything it
 * uploads. Kept as a literal on both sides rather than shared through a module,
 * because the importer is a standalone script and this is a database value, not
 * an API.
 */
export const RIN5_IMPORT_ASSET_SOURCE = 'rin5-import'

/** Whether the caller asked for original bytes. Opt-in; anything falsy is off. */
export function isOriginalAssetsMode(env: Record<string, string | undefined>): boolean {
  const raw = env.RIN5_EXPORT_ORIGINAL_ASSETS
  return raw === '1' || raw === 'true'
}

/**
 * Index rin5-imported assets by the proxy path Ycode renders for them, so a
 * plain string rewrite over the finished HTML can find them.
 */
export function buildOriginalAssetMap(assets: readonly AssetRow[]): Map<string, OriginalAsset> {
  const map = new Map<string, OriginalAsset>()
  for (const asset of assets) {
    if (!asset.storage_path || !asset.public_url) continue
    const proxyPath = getAssetProxyUrl(asset)
    if (!proxyPath) continue
    map.set(proxyPath, {
      filename: asset.filename,
      mimeType: asset.mime_type,
      storagePath: asset.storage_path,
      outputKey: `assets/${asset.filename}`,
    })
  }
  return map
}

/**
 * Proxy reference as it appears in rendered HTML: the path, plus whatever
 * query string the image pipeline appended. `&amp;` shows up because the
 * document is already HTML-escaped by the time we see it.
 */
const PROXY_REF_RE = /\/a\/[A-Za-z0-9]{22}\/[^"'\s)<>?&]+(?:\?(?:[^"'\s)<>]|&amp;)*)?/g

/** `<img …>` tags whose `src` we have already pointed at `/assets/…`. */
const REWRITTEN_IMG_RE = /<img\b[^>]*\bsrc="\/assets\/[^"]*"[^>]*>/g
const SRCSET_OR_SIZES_RE = /\s(?:srcset|sizes)="[^"]*"/g

/**
 * Point every mapped proxy reference at `/assets/<filename>` and strip the
 * responsive attributes from the `<img>` tags that now carry one.
 *
 * Paths stay absolute here; `engine.ts` relativizes them per output depth in
 * the same pass it already runs for `/a/…`.
 */
export function rewriteToOriginalAssets(html: string, assets: Map<string, OriginalAsset>): string {
  if (assets.size === 0) return html

  const withOriginalSrcs = html.replace(PROXY_REF_RE, (match) => {
    const pathOnly = match.split('?')[0]
    const asset = assets.get(pathOnly)
    return asset ? `/${asset.outputKey}` : match
  })

  // `srcset`/`sizes` must go, not just be rewritten: leaving seven candidates
  // that all resolve to the same file still lets the browser pick by DPR, and
  // `sizes` would keep driving the layout width off Ycode's guess rather than
  // the source stylesheet's.
  return withOriginalSrcs.replace(REWRITTEN_IMG_RE, (tag) => tag.replace(SRCSET_OR_SIZES_RE, ''))
}
