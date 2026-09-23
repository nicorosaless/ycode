import assert from 'node:assert/strict'
import test from 'node:test'

import { isPrivateIp, parsePublicHttpUrl } from './safe-public-fetch'

test('rejects private, loopback and credentialed fetch targets', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '::1', 'fc00::1']) {
    assert.equal(isPrivateIp(ip), true, ip)
  }
  assert.throws(() => parsePublicHttpUrl('http://localhost/x'), /public_fetch_target_invalid/)
  assert.throws(() => parsePublicHttpUrl('https://user:pass@example.com/x'), /public_fetch_target_invalid/)
  assert.equal(parsePublicHttpUrl('https://example.com/x').hostname, 'example.com')
})
