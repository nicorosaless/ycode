import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStaticCmsItemPath } from './paths'
import type { Locale, Page, Translation } from '@/types'

const page: Page = {
  id: 'page-id',
  slug: '*',
  name: 'Article',
  page_folder_id: null,
  order: 0,
  depth: 0,
  is_index: false,
  is_dynamic: true,
  error_page: null,
  settings: { cms: { collection_id: 'collection-id', slug_field_id: 'slug-field-id' } },
  is_published: true,
  is_publishable: true,
  created_at: '2026-09-09T00:00:00.000Z',
  updated_at: '2026-09-09T00:00:00.000Z',
  deleted_at: null,
}

const locale: Locale = {
  id: 'locale-id',
  code: 'ca',
  label: 'Català',
  is_default: false,
  is_published: true,
  created_at: '2026-09-09T00:00:00.000Z',
  updated_at: '2026-09-09T00:00:00.000Z',
  deleted_at: null,
}

function slugTranslation(overrides: Partial<Translation> = {}): Translation {
  return {
    id: 'translation-id',
    locale_id: locale.id,
    source_type: 'cms',
    source_id: 'item-id',
    content_key: 'field:key:slug',
    content_type: 'text',
    content_value: 'primer-article',
    is_completed: true,
    is_published: true,
    created_at: '2026-09-09T00:00:00.000Z',
    updated_at: '2026-09-09T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  }
}

test('published static export creates a localized CMS item route from its translated slug', () => {
  const translation = slugTranslation()
  const path = buildStaticCmsItemPath({
    page,
    folders: [],
    itemId: 'item-id',
    defaultSlug: 'first-article',
    locale,
    translations: { 'cms:item-id:field:key:slug': translation },
  })

  assert.equal(path, 'ca/primer-article')
})

test('published static export falls back to the original CMS slug until a translation is complete', () => {
  const translation = slugTranslation({ is_completed: false })
  const path = buildStaticCmsItemPath({
    page,
    folders: [],
    itemId: 'item-id',
    defaultSlug: 'first-article',
    locale,
    translations: { 'cms:item-id:field:key:slug': translation },
  })

  assert.equal(path, 'ca/first-article')
})

test('published static export keeps the default CMS item route unprefixed', () => {
  const path = buildStaticCmsItemPath({
    page,
    folders: [],
    itemId: 'item-id',
    defaultSlug: 'first-article',
    locale: null,
    translations: {},
  })

  assert.equal(path, 'first-article')
})
