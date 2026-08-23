import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { authorizeRin5InternalRequest, parseRin5ExportRequest } from './rin5-internal-auth'

describe('rin5 internal API boundary', () => {
  it('accepts only the configured bearer secret', () => {
    const headers = new Headers({ authorization: 'Bearer a-secure-shared-secret-1234567890' })
    assert.equal(authorizeRin5InternalRequest(headers, 'a-secure-shared-secret-1234567890'), true)
    assert.equal(authorizeRin5InternalRequest(headers, 'another-secure-secret-1234567890'), false)
    assert.equal(authorizeRin5InternalRequest(new Headers(), 'a-secure-shared-secret-1234567890'), false)
  })

  it('binds an export request to the instance site', () => {
    const siteId = '123e4567-e89b-42d3-a456-426614174000'
    assert.deepEqual(parseRin5ExportRequest({ siteId }, siteId), { siteId })
    assert.throws(
      () => parseRin5ExportRequest({ siteId: '223e4567-e89b-42d3-a456-426614174000' }, siteId),
      /rin5_site_mismatch/,
    )
    assert.throws(() => parseRin5ExportRequest({}, siteId), /rin5_export_request_invalid/)
  })
})
