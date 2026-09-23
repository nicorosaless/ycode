import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssetLoadGuard } from './file-manager-load';

test('a reset supersedes an older in-flight asset load', () => {
  const guard = createAssetLoadGuard();

  const oldRequest = guard.start(false);
  assert.notEqual(oldRequest, null);
  assert.equal(guard.isLoading(), true);

  const latestRequest = guard.start(true);
  assert.notEqual(latestRequest, null);
  assert.equal(guard.isCurrent(oldRequest!), false);
  assert.equal(guard.isCurrent(latestRequest!), true);

  guard.finish(oldRequest!);
  assert.equal(guard.isLoading(), true, 'an obsolete request must not clear the loading guard');

  guard.finish(latestRequest!);
  assert.equal(guard.isLoading(), false);
});

test('pagination cannot overlap the current asset load', () => {
  const guard = createAssetLoadGuard();

  const firstRequest = guard.start(false);
  assert.notEqual(firstRequest, null);
  assert.equal(guard.start(false), null);

  guard.finish(firstRequest!);
  assert.notEqual(guard.start(false), null);
});
