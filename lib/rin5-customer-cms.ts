import type { CollectionFieldType, Layer, PageSettings } from '@/types';
import type { UserRole } from './roles';

type CmsCollection = Readonly<{ id: string; name: string }>;
type CmsField = Readonly<{ id: string; key?: string | null; name: string; type: CollectionFieldType }>;

const BODY_FIELD_NAMES = new Set(['body', 'content', 'description', 'contenido', 'descripción']);
const IMAGE_FIELD_NAMES = new Set(['image', 'cover', 'cover image', 'photo', 'imagen', 'foto']);

function fieldName(field: CmsField): string {
  return (field.key || field.name).trim().toLowerCase();
}

function fieldData(field: CmsField) {
  return {
    field_id: field.id,
    field_type: field.type,
    relationships: [] as string[],
    source: 'page' as const,
  };
}

function boundText(field: CmsField) {
  return {
    type: 'dynamic_rich_text' as const,
    data: {
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{
            type: 'dynamicVariable',
            attrs: { variable: { type: 'field', data: fieldData(field) }, label: field.name },
          }],
        }],
      },
    },
  };
}

function inlineField(field: CmsField): string {
  return `<ycode-inline-variable>${JSON.stringify({ type: 'field', data: fieldData(field) })}</ycode-inline-variable>`;
}

export function canDirectlyPublishCms(role: UserRole, tenantMode: boolean): boolean {
  return role !== 'editor' || !tenantMode;
}

export function customerCollectionUpdate(input: Record<string, unknown>) {
  return Object.fromEntries(['name', 'sorting', 'order'].flatMap((key) => key in input ? [[key, input[key]]] : []));
}

export function customerFieldUpdate(input: Record<string, unknown>) {
  return Object.fromEntries(
    ['name', 'default', 'order', 'reference_collection_id', 'hidden', 'data']
      .flatMap((key) => key in input ? [[key, input[key]]] : []),
  );
}

export function customerItemUpdate(input: Record<string, unknown>) {
  return Object.fromEntries(['manual_order', 'is_publishable'].flatMap((key) => key in input ? [[key, input[key]]] : []));
}

export function buildCustomerCmsPageBlueprint(collection: CmsCollection, fields: readonly CmsField[]): {
  page: {
    name: string;
    slug: string;
    is_published: false;
    is_publishable: true;
    page_folder_id: null;
    order: number;
    depth: 0;
    is_index: false;
    is_dynamic: true;
    error_page: null;
    settings: PageSettings;
  };
  layers: Layer[];
} {
  const name = fields.find((field) => field.key === 'name');
  const slug = fields.find((field) => field.key === 'slug');
  if (!name || !slug) throw new Error('rin5_customer_cms_required_fields_missing');

  const body = fields.find((field) => BODY_FIELD_NAMES.has(fieldName(field)) && ['text', 'rich_text'].includes(field.type));
  const image = fields.find((field) => IMAGE_FIELD_NAMES.has(fieldName(field)) && field.type === 'image');
  if (!body || !image) throw new Error('rin5_customer_cms_display_fields_missing');
  const content: Layer[] = [];

  content.push({
    id: 'rin5-cms-image',
    name: 'image',
    settings: { tag: 'img' },
    classes: ['w-[100%]', 'max-h-[560px]', 'object-cover', 'rounded-[16px]'],
    attributes: { loading: 'eager' },
    design: { sizing: { isActive: true, width: '100%', maxHeight: '560px', objectFit: 'cover' }, borders: { isActive: true, borderRadius: '16px' } },
    variables: {
      image: {
        src: { type: 'field', data: fieldData(image) },
        alt: { type: 'dynamic_text', data: { content: inlineField(name) } },
      },
    },
  });

  content.push({
    id: 'rin5-cms-title',
    name: 'heading',
    settings: { tag: 'h1' },
    classes: ['text-[48px]', 'font-[700]', 'leading-[1.1]', 'tracking-[-0.01em]'],
    restrictions: { editText: true },
    design: { typography: { isActive: true, fontSize: '48px', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.01' } },
    variables: { text: boundText(name) },
  });

  content.push({
    id: 'rin5-cms-body-copy',
    name: body.type === 'rich_text' ? 'richText' : 'text',
    settings: body.type === 'rich_text' ? undefined : { tag: 'p' },
    classes: ['text-[18px]', 'leading-[1.7]'],
    restrictions: { editText: true },
    design: { typography: { isActive: true, fontSize: '18px', lineHeight: '1.7' } },
    variables: { text: boundText(body) },
  });

  return {
    page: {
      name: `${collection.name} item`,
      slug: '*',
      is_published: false,
      is_publishable: true,
      page_folder_id: null,
      order: 0,
      depth: 0,
      is_index: false,
      is_dynamic: true,
      error_page: null,
      settings: {
        cms: { collection_id: collection.id, slug_field_id: slug.id },
        seo: { title: inlineField(name), description: inlineField(body), image: { type: 'field', data: fieldData(image) }, noindex: false },
      },
    },
    layers: [{
      id: 'body',
      name: 'body',
      classes: [],
      children: [{
        id: 'rin5-cms-section',
        name: 'section',
        classes: ['flex', 'flex-col', 'w-[100%]', 'pt-[80px]', 'pb-[80px]', 'items-center'],
        design: { layout: { isActive: true, display: 'Flex', flexDirection: 'column', alignItems: 'center' }, sizing: { isActive: true, width: '100%' }, spacing: { isActive: true, paddingTop: '80px', paddingBottom: '80px' } },
        children: [{
          id: 'rin5-cms-container',
          name: 'div',
          classes: ['flex', 'flex-col', 'gap-[28px]', 'max-w-[960px]', 'w-[100%]', 'pl-[32px]', 'pr-[32px]'],
          design: { layout: { isActive: true, display: 'Flex', flexDirection: 'column', gap: '28px' }, sizing: { isActive: true, width: '100%', maxWidth: '960px' }, spacing: { isActive: true, paddingLeft: '32px', paddingRight: '32px' } },
          children: content,
        }],
      }],
    }],
  };
}
