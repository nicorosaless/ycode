/**
 * Static export — output-key computation.
 *
 * S3-friendly path layout:
 *   - homepage / folder index → `<dir>/index.html`
 *   - any other page          → `<dir>/<slug>/index.html` (clean URLs)
 *   - error pages             → `<code>.html` at root
 */

import { getTranslatableKey, getTranslationValue } from '@/lib/locale-runtime'
import { buildLocalizedDynamicPageUrl, buildSlugPath } from '@/lib/page-utils'

import type { Locale, Page, PageFolder, Translation } from '@/types'

export function computeOutputKey(page: Page, folders: PageFolder[]): string {
  if (page.error_page !== null && page.error_page !== undefined) {
    return `${page.error_page}.html`
  }

  const slugPath = buildSlugPath(page, folders, 'page')
  const trimmed = slugPath.replace(/^\/+/, '').replace(/\/+$/, '')

  if (!trimmed) return 'index.html'
  return `${trimmed}/index.html`
}

export function buildStaticCmsItemPath({
  page,
  folders,
  itemId,
  defaultSlug,
  locale,
  translations,
}: Readonly<{
  page: Page
  folders: PageFolder[]
  itemId: string
  defaultSlug: string
  locale: Locale | null
  translations: Record<string, Translation>
}>): string {
  const slugTranslation = locale
    ? translations[getTranslatableKey({
      source_type: 'cms',
      source_id: itemId,
      content_key: 'field:key:slug',
    })]
    : undefined
  const slug = getTranslationValue(slugTranslation) ?? defaultSlug

  return buildLocalizedDynamicPageUrl(page, folders, slug, locale, translations)
    .replace(/^\/+|\/+$/g, '')
}
