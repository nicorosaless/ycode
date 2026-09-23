import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveBundlePath } from './bundle-files'

test('bundle paths stay beneath their import root', () => {
  assert.equal(resolveBundlePath('/tmp/site', 'assets/photo.png'), '/tmp/site/assets/photo.png')
  assert.throws(() => resolveBundlePath('/tmp/site', '../secret'), /rin5_bundle_path_escape/)
  assert.throws(() => resolveBundlePath('/tmp/site', '/etc/passwd'), /rin5_bundle_path_escape/)
})
