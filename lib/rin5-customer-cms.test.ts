import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCustomerCmsPageBlueprint,
  canDirectlyPublishCms,
  customerCollectionUpdate,
  customerFieldUpdate,
  customerItemUpdate,
} from './rin5-customer-cms';

const fields = [
  { id: 'name-id', key: 'name', name: 'Name', type: 'text' },
  { id: 'slug-id', key: 'slug', name: 'Slug', type: 'text' },
  { id: 'body-id', key: null, name: 'Body', type: 'rich_text' },
  { id: 'image-id', key: null, name: 'Image', type: 'image' },
] as const;

test('customer CMS blueprint creates a publishable dynamic page with visible field bindings', () => {
  const blueprint = buildCustomerCmsPageBlueprint({ id: 'collection-id', name: 'News' }, fields);

  assert.equal(blueprint.page.slug, '*');
  assert.equal(blueprint.page.is_dynamic, true);
  assert.equal(blueprint.page.is_publishable, true);
  assert.deepEqual(blueprint.page.settings.cms, {
    collection_id: 'collection-id',
    slug_field_id: 'slug-id',
  });

  const serialized = JSON.stringify(blueprint.layers);
  for (const fieldId of ['name-id', 'body-id', 'image-id']) {
    assert.match(serialized, new RegExp(fieldId));
  }
  assert.match(serialized, /"source":"page"/);
});

test('customer CMS blueprint requires canonical name and slug fields', () => {
  assert.throws(
    () => buildCustomerCmsPageBlueprint({ id: 'collection-id', name: 'News' }, fields.slice(2)),
    /rin5_customer_cms_required_fields_missing/,
  );
});

test('customer CMS blueprint requires bounded body and image fields', () => {
  assert.throws(
    () => buildCustomerCmsPageBlueprint(
      { id: 'collection-id', name: 'News' },
      [...fields.slice(0, 2), { id: 'secret-id', key: null, name: 'Internal note', type: 'text' as const }],
    ),
    /rin5_customer_cms_display_fields_missing/,
  );
});

test('tenant editors stage CMS changes for rin5 instead of publishing directly', () => {
  assert.equal(canDirectlyPublishCms('editor', true), false);
  assert.equal(canDirectlyPublishCms('editor', false), true);
  assert.equal(canDirectlyPublishCms('designer', true), true);
});

test('customer CMS mutations discard publication and protected identity fields', () => {
  assert.deepEqual(customerCollectionUpdate({ name: 'News', is_published: true, deleted_at: 'now' }), { name: 'News' });
  assert.deepEqual(customerFieldUpdate({ name: 'Body', key: 'slug', type: 'status', is_published: true }), { name: 'Body' });
  assert.deepEqual(customerItemUpdate({ manual_order: 2, is_publishable: false, is_published: true, deleted_at: 'now' }), {
    manual_order: 2,
    is_publishable: false,
  });
});
