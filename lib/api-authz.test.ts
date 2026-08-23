import assert from 'node:assert/strict';
import { test } from 'node:test';

import { requiredPermission, roleHasPermission } from '@/lib/api-authz';
import { extractRoleFromUser, resolveRole } from '@/lib/roles';

const editorAllowed: Array<[string, string]> = [
  ['GET', '/ycode/api/pages'],
  ['PUT', '/ycode/api/layers'],
  ['POST', '/ycode/api/assets/upload'],
  ['PUT', '/ycode/api/collections/posts/items/item-1'],
  ['POST', '/ycode/api/collections/items/batch'],
  ['PUT', '/ycode/api/translations/copy-1'],
];

for (const [method, pathname] of editorAllowed) {
  test(`editor may ${method} ${pathname}`, () => {
    const permission = requiredPermission(pathname, method);
    assert.equal(roleHasPermission('editor', permission), true);
  });
}

const editorDenied: Array<[string, string]> = [
  ['POST', '/ycode/api/publish'],
  ['POST', '/ycode/api/revert'],
  ['POST', '/ycode/api/pages'],
  ['DELETE', '/ycode/api/pages/page-1'],
  ['PUT', '/ycode/api/settings/batch'],
  ['POST', '/ycode/api/api-keys'],
  ['POST', '/ycode/api/webhooks'],
  ['POST', '/ycode/api/project/import'],
  ['POST', '/ycode/api/devtools/reset-db'],
  ['POST', '/ycode/api/ai/chat'],
];

for (const [method, pathname] of editorDenied) {
  test(`editor may not ${method} ${pathname}`, () => {
    const permission = requiredPermission(pathname, method);
    assert.equal(roleHasPermission('editor', permission), false);
    assert.equal(roleHasPermission('owner', permission), true);
  });
}

test('unknown and missing roles fail closed to editor', () => {
  assert.equal(resolveRole(undefined), 'editor');
  assert.equal(resolveRole('super-admin'), 'editor');
  assert.equal(extractRoleFromUser({ app_metadata: { role: 'super-admin' } }), 'editor');
  assert.equal(extractRoleFromUser(null), null);
});
