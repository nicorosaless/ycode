import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSlidingWindowRateLimiter,
  configuredPublicForm,
  isValidFormId,
  sanitizeFormPayload,
} from '@/lib/form-submission-security';

test('form id and payload validation reject malformed public input', () => {
  assert.equal(isValidFormId('contact-form'), true);
  assert.equal(isValidFormId('../settings'), false);
  assert.deepEqual(sanitizeFormPayload({ name: 'Ada', interests: ['web', 'seo'] }), {
    name: 'Ada', interests: ['web', 'seo'],
  });
  assert.equal(sanitizeFormPayload({ nested: { admin: true } }), null);
});

test('notification recipient and subject come only from server configuration', () => {
  const source = { RIN5_FORM_CONFIG_JSON: JSON.stringify({ 'contact-form': { to: 'owner@example.com', subject: 'Lead' }, passive: null }) };
  assert.deepEqual(configuredPublicForm('contact-form', source), {
    notification: { enabled: true, to: 'owner@example.com', subject: 'Lead' },
  });
  assert.deepEqual(configuredPublicForm('passive', source), { notification: null });
  assert.equal(configuredPublicForm('attacker-form', source), null);
  assert.equal(configuredPublicForm('contact-form', { RIN5_FORM_CONFIG_JSON: '{"contact-form":{"to":"bad"}}' }), null);
});

test('sliding-window limiter denies excess requests and recovers', () => {
  const allow = createSlidingWindowRateLimiter(2, 1_000);
  assert.equal(allow('ip', 0), true);
  assert.equal(allow('ip', 1), true);
  assert.equal(allow('ip', 2), false);
  assert.equal(allow('ip', 1_001), true);
});
