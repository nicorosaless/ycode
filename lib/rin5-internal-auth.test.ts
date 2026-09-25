import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  authorizeRin5InternalRequest,
  parseRin5EditorBaseUrl,
  parseRin5ExportRequest,
  parseRin5HandoffDestination,
  parseRin5HandoffEmbed,
  parseRin5HandoffRequest,
  rin5EmbedCookie,
} from './rin5-internal-auth'

describe('rin5 internal API boundary', () => {
  it('accepts only the configured bearer secret', () => {
    const headers = new Headers({ authorization: 'Bearer a-secure-shared-secret-1234567890' })
    assert.equal(authorizeRin5InternalRequest(headers, 'a-secure-shared-secret-1234567890'), true)
    assert.equal(authorizeRin5InternalRequest(headers, 'another-secure-secret-1234567890'), false)
    assert.equal(authorizeRin5InternalRequest(new Headers(), 'a-secure-shared-secret-1234567890'), false)
  })

  it('binds an export request to the instance site', () => {
    const siteId = '123e4567-e89b-42d3-a456-426614174000'
    const actorUserId = '223e4567-e89b-42d3-a456-426614174000'
    const requestId = '323e4567-e89b-42d3-a456-426614174000'
    const sourceRevisionId = '423e4567-e89b-42d3-a456-426614174000'
    assert.deepEqual(parseRin5ExportRequest({ actorUserId, requestId, siteId, sourceRevisionId }, siteId), {
      actorUserId, requestId, siteId, sourceRevisionId,
    })
    assert.throws(
      () => parseRin5ExportRequest({ actorUserId, requestId, siteId: '523e4567-e89b-42d3-a456-426614174000', sourceRevisionId }, siteId),
      /rin5_site_mismatch/,
    )
    assert.throws(() => parseRin5ExportRequest({}, siteId), /rin5_export_request_invalid/)
  })

  it('accepts a normalized handoff email only for the instance site', () => {
    const siteId = '123e4567-e89b-42d3-a456-426614174000'
    assert.deepEqual(parseRin5HandoffRequest({ siteId, email: ' Client@Example.com ', destination: 'cms' }, siteId), {
      destination: 'cms',
      email: 'client@example.com',
      embed: false,
      siteId,
    })
    assert.equal(parseRin5HandoffRequest({ siteId, email: 'client@example.com' }, siteId).destination, 'canvas')
    assert.throws(() => parseRin5HandoffRequest({ siteId, email: 'invalid' }, siteId), /rin5_handoff_request_invalid/)
    assert.throws(
      () => parseRin5HandoffRequest({ siteId, email: 'client@example.com', destination: 'https://evil.example' }, siteId),
      /rin5_handoff_destination_invalid/,
    )
  })

  it('maps handoff destinations to exact editor routes', () => {
    assert.equal(parseRin5HandoffDestination('canvas').path, '/ycode')
    assert.equal(parseRin5HandoffDestination('cms').path, '/ycode/collections')
    assert.equal(parseRin5HandoffDestination('localization').path, '/ycode/localization')
    assert.equal(parseRin5HandoffDestination('general').path, '/ycode/site-settings')
    assert.throws(() => parseRin5HandoffDestination('/ycode/settings/general'), /rin5_handoff_destination_invalid/)
  })

  it('carries embed=1 through the handoff and rejects any other value', () => {
    const siteId = '123e4567-e89b-42d3-a456-426614174000'
    assert.equal(parseRin5HandoffRequest({ siteId, email: 'client@example.com', embed: '1' }, siteId).embed, true)
    assert.equal(parseRin5HandoffRequest({ siteId, email: 'client@example.com' }, siteId).embed, false)
    for (const embed of ['0', 'true', '', 1, true]) {
      assert.throws(
        () => parseRin5HandoffRequest({ siteId, email: 'client@example.com', embed }, siteId),
        /rin5_handoff_embed_invalid/,
      )
    }
  })

  it('reads the embed flag of the confirm link the same way', () => {
    assert.equal(parseRin5HandoffEmbed(null), false)
    assert.equal(parseRin5HandoffEmbed(undefined), false)
    assert.equal(parseRin5HandoffEmbed('1'), true)
    assert.throws(() => parseRin5HandoffEmbed('yes'), /rin5_handoff_embed_invalid/)
  })

  it('sets the embed cookie for an embedded session and clears it otherwise', () => {
    const embedded = rin5EmbedCookie(true, 'https://demo.edit.example.test')
    assert.equal(embedded.name, 'rin5_embed')
    assert.equal(embedded.value, '1')
    assert.equal(embedded.options.path, '/ycode')
    assert.equal(embedded.options.secure, true)
    assert.ok(embedded.options.maxAge > 0)

    const direct = rin5EmbedCookie(false, 'http://127.0.0.1:3002')
    assert.equal(direct.value, '')
    assert.equal(direct.options.maxAge, 0)
    assert.equal(direct.options.secure, false)
  })

  it('requires a safe editor origin for magic-link redirects', () => {
    assert.equal(parseRin5EditorBaseUrl('https://edit.example.test'), 'https://edit.example.test')
    assert.equal(parseRin5EditorBaseUrl('http://127.0.0.1:3002'), 'http://127.0.0.1:3002')
    assert.equal(parseRin5EditorBaseUrl('http://rin5-demo-recovery.localhost:3007'), 'http://rin5-demo-recovery.localhost:3007')
    assert.throws(() => parseRin5EditorBaseUrl('https://edit.example.test/path'), /rin5_editor_base_url_invalid/)
    assert.throws(() => parseRin5EditorBaseUrl('http://edit.example.test'), /rin5_editor_base_url_invalid/)
    assert.throws(() => parseRin5EditorBaseUrl('http://nested.rin5-demo-recovery.localhost:3007'), /rin5_editor_base_url_invalid/)
    assert.throws(() => parseRin5EditorBaseUrl('http://rin5-demo-recovery.localhost.evil.test:3007'), /rin5_editor_base_url_invalid/)
    assert.throws(() => parseRin5EditorBaseUrl('http://user:password@rin5-demo-recovery.localhost:3007'), /rin5_editor_base_url_invalid/)
  })
})
