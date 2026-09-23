import { NextRequest, NextResponse } from 'next/server';

import { getCollectionById } from '@/lib/repositories/collectionRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { createPage, deletePage, getAllPages } from '@/lib/repositories/pageRepository';
import { upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { buildCustomerCmsPageBlueprint } from '@/lib/rin5-customer-cms';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { collectionId?: unknown };
    if (typeof body.collectionId !== 'string' || !UUID.test(body.collectionId)) {
      return NextResponse.json({ error: 'invalid_collection_id' }, { status: 400 });
    }

    const [collection, fields, pages] = await Promise.all([
      getCollectionById(body.collectionId, false),
      getFieldsByCollectionId(body.collectionId, false),
      getAllPages({ is_published: false }),
    ]);
    if (!collection) return NextResponse.json({ error: 'collection_not_found' }, { status: 404 });

    const existing = pages.find((page) => page.is_dynamic && page.settings?.cms?.collection_id === collection.id);
    if (existing) {
      return NextResponse.json({ data: { page: existing, pathPattern: '/{slug}' } });
    }
    if (pages.some((page) => page.page_folder_id === null && page.is_dynamic && page.slug === '*')) {
      return NextResponse.json({ error: 'rin5_customer_cms_page_slot_used' }, { status: 409 });
    }

    const blueprint = buildCustomerCmsPageBlueprint(collection, fields);
    blueprint.page.order = pages.reduce(
      (maximum, page) => page.page_folder_id === null ? Math.max(maximum, page.order ?? 0) : maximum,
      -1,
    ) + 1;
    const page = await createPage(blueprint.page);
    try {
      await upsertDraftLayers(page.id, blueprint.layers, undefined, null);
    } catch (error) {
      await deletePage(page.id).catch(() => undefined);
      throw error;
    }

    return NextResponse.json(
      { data: { page, pathPattern: '/{slug}' } },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'rin5_customer_cms_page_failed';
    const status = message === 'rin5_customer_cms_required_fields_missing'
      || message === 'rin5_customer_cms_display_fields_missing' ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
