import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createSlidingWindowRateLimiter,
  findPublicFormConfig,
  isValidFormId,
  sanitizeFormPayload,
} from '@/lib/form-submission-security';
import type { Layer } from '@/types';

const formLayer: Layer = {
  id: 'layer-1',
  name: 'form',
  classes: '',
  settings: {
    id: 'contact-form',
    form: { email_notification: { enabled: true, to: 'owner@example.com', subject: 'Lead' } },
  },
};

test('form id and payload validation reject malformed public input', () => {
  assert.equal(isValidFormId('contact-form'), true);
  assert.equal(isValidFormId('../settings'), false);
  assert.deepEqual(sanitizeFormPayload({ name: 'Ada', interests: ['web', 'seo'] }), {
    name: 'Ada', interests: ['web', 'seo'],
  });
  assert.equal(sanitizeFormPayload({ nested: { admin: true } }), null);
});

test('notification recipient and subject come from the stored form layer', () => {
  assert.deepEqual(findPublicFormConfig([{ layers: [{ ...formLayer, children: [formLayer] }] }], 'contact-form'), {
    notification: { enabled: true, to: 'owner@example.com', subject: 'Lead' },
  });
  assert.equal(findPublicFormConfig([{ layers: [formLayer] }], 'attacker-form'), null);
});

test('sliding-window limiter denies excess requests and recovers', () => {
  const allow = createSlidingWindowRateLimiter(2, 1_000);
  assert.equal(allow('ip', 0), true);
  assert.equal(allow('ip', 1), true);
  assert.equal(allow('ip', 2), false);
  assert.equal(allow('ip', 1_001), true);
});
