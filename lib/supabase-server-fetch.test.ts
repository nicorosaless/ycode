import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createSupabaseServerFetch, parseSupabaseInternalOrigin } from './supabase-server-fetch'

describe('Supabase server transport', () => {
  it('rewrites canonical requests and preserves request data', async () => {
    let received: Request | undefined
    const fetchImpl: typeof fetch = async (input, init) => {
      received = new Request(input, init)
      return new Response(null, { status: 204 })
    }
    const routedFetch = createSupabaseServerFetch(
      'http://localhost:57321',
      'http://kong:8000',
      fetchImpl,
    )
    const request = new Request('http://localhost:57321/rest/v1/pages?select=id', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Inicio' }),
    })

    await routedFetch(request)

    assert.ok(received)
    assert.equal(received.url, 'http://kong:8000/rest/v1/pages?select=id')
    assert.equal(received.method, 'POST')
    assert.equal(received.headers.get('authorization'), 'Bearer test-token')
    assert.equal(received.headers.get('content-type'), 'application/json')
    assert.equal(await received.text(), JSON.stringify({ title: 'Inicio' }))
  })

  it('does not forward requests for another origin', async () => {
    let receivedUrl = ''
    const fetchImpl: typeof fetch = async (input, init) => {
      receivedUrl = new Request(input, init).url
      return new Response(null, { status: 204 })
    }
    const routedFetch = createSupabaseServerFetch(
      'http://localhost:57321',
      'http://kong:8000',
      fetchImpl,
    )

    await routedFetch('https://example.com/rest/v1/pages')

    assert.equal(receivedUrl, 'https://example.com/rest/v1/pages')
  })

  it('uses the original fetch unchanged when the internal URL is unset', () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 204 })

    assert.equal(createSupabaseServerFetch('http://localhost:57321', undefined, fetchImpl), fetchImpl)
  })

  it('accepts only an HTTP(S) origin without credentials, path, query, or fragment', () => {
    assert.equal(parseSupabaseInternalOrigin('http://kong:8000'), 'http://kong:8000')
    assert.equal(parseSupabaseInternalOrigin('https://supabase.internal/'), 'https://supabase.internal')

    for (const value of [
      'ftp://kong:8000',
      'http://user:pass@kong:8000',
      'http://kong:8000/rest',
      'http://kong:8000/?mode=test',
      'http://kong:8000/#fragment',
    ]) {
      assert.throws(() => parseSupabaseInternalOrigin(value), /SUPABASE_INTERNAL_URL must be an HTTP\(S\) origin/)
    }
  })
})
