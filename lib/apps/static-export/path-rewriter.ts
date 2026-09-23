/** Asset and route path rewrites for standalone static HTML. */

const ABSOLUTE_ASSET_RE = /(?<=["'\s,=(])\/(?=a\/[A-Za-z0-9]{22}\/|assets\/|ycode\/layouts\/assets\/|swiper-minimal\.css)/g
const ESCAPED_ABSOLUTE_ASSET_RE = /\\\/(?=a\\\/[A-Za-z0-9]{22}\\\/|assets\\\/|ycode\\\/layouts\\\/assets\\\/|swiper-minimal\\\.css)/g
const INTERNAL_LINK_RE = /href="\/([^"]*?)"/g

function canonicalPagePath(path: string): string {
  const normalized = `/${path}`.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  return normalized || '/'
}

/** Preserve the active locale for imported URL links that match a known page. */
export function localizeKnownPageLinks(
  html: string,
  routes: ReadonlyMap<string, string>,
): string {
  if (routes.size === 0) return html
  const localizedPaths = new Set([...routes.values()].map(canonicalPagePath))

  return html.replace(INTERNAL_LINK_RE, (match, path: string) => {
    const suffixIndex = path.search(/[?#]/)
    const pathname = suffixIndex >= 0 ? path.slice(0, suffixIndex) : path
    const suffix = suffixIndex >= 0 ? path.slice(suffixIndex) : ''
    const canonical = canonicalPagePath(pathname)
    if (localizedPaths.has(canonical)) return match
    const localized = routes.get(canonical)
    return localized ? `href="${canonicalPagePath(localized)}${suffix}"` : match
  })
}

/** Escape path punctuation as it appears inside a Tailwind arbitrary-value selector. */
export function escapeCssSelectorPath(path: string): string {
  return path.replace(/[./]/g, '\\$&')
}

/** Convert absolute asset and route paths to paths relative to the output document. */
export function relativizePaths(html: string, outputKey: string): string {
  const depth = outputKey.split('/').length - 1
  const prefix = depth === 0 ? './' : '../'.repeat(depth)

  let result = html
    .replace(ABSOLUTE_ASSET_RE, prefix)
    .replace(ESCAPED_ABSOLUTE_ASSET_RE, escapeCssSelectorPath(prefix))

  result = result.replace(INTERNAL_LINK_RE, (_match, path: string) => {
    if (/^a\/[A-Za-z0-9]{22}\//.test(path)) return `href="${prefix}${path}"`
    if (path.startsWith('ycode/layouts/assets/')) return `href="${prefix}${path}"`
    if (path.startsWith('assets/')) return `href="${prefix}${path}"`

    const suffixIndex = path.search(/[?#]/)
    const pathPart = suffixIndex >= 0 ? path.slice(0, suffixIndex) : path
    const suffix = suffixIndex >= 0 ? path.slice(suffixIndex) : ''
    const trimmed = pathPart.replace(/^\/+/, '').replace(/\/+$/, '')

    if (!trimmed) return `href="${prefix}index.html${suffix}"`
    return `href="${prefix}${trimmed}/index.html${suffix}"`
  })

  return result
}
