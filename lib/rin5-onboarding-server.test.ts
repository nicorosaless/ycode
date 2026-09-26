import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchRin5OnboardingFacts,
  markRin5Onboarding,
  resolveRin5OnboardingTarget,
} from './rin5-onboarding-server'

const siteId = '123e4567-e89b-42d3-a456-426614174000'
const secret = 's'.repeat(40)
const env = { RIN5_APP_URL: 'https://rin5.app', RIN5_SITE_ID: siteId, RIN5_INTERNAL_API_SECRET: secret }

const facts = {
  siteId, entitled: true, welcomeSeenAt: null, tourFinishedAt: null, textChangedAt: null,
  imageChangedAt: null, checklistDismissedAt: null, ownerPublished: false, domainConnected: false,
}

function recorder(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetcher = (async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, fetcher }
}

test('the welcome is off without a complete, safe rin5 configuration', () => {
  assert.equal(resolveRin5OnboardingTarget({}), null)
  assert.equal(resolveRin5OnboardingTarget({ ...env, RIN5_INTERNAL_API_SECRET: 'short' }), null)
  assert.equal(resolveRin5OnboardingTarget({ ...env, RIN5_SITE_ID: 'not-a-uuid' }), null)
  assert.equal(resolveRin5OnboardingTarget({ ...env, RIN5_APP_URL: 'http://rin5.app' }), null)
  assert.equal(resolveRin5OnboardingTarget({ ...env, RIN5_APP_URL: 'https://u:p@rin5.app' }), null)
  assert.equal(resolveRin5OnboardingTarget({ ...env, RIN5_APP_URL: 'http://localhost:3360' })?.endpoint.toString(), 'http://localhost:3360/api/editor/onboarding')
})

test('reads the facts of this container site with the internal secret', async () => {
  const target = resolveRin5OnboardingTarget(env)
  assert.ok(target)
  const { calls, fetcher } = recorder(facts)
  assert.deepEqual(await fetchRin5OnboardingFacts(target, fetcher), facts)
  assert.equal(calls[0].url, `https://rin5.app/api/editor/onboarding?site_id=${siteId}`)
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), `Bearer ${secret}`)
})

test('marks an event for this site only', async () => {
  const target = resolveRin5OnboardingTarget(env)
  assert.ok(target)
  const { calls, fetcher } = recorder({ ...facts, welcomeSeenAt: '2026-10-01T10:00:00Z' })
  await markRin5Onboarding(target, 'welcome_seen', fetcher)
  assert.equal(calls[0].init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { siteId, event: 'welcome_seen' })
})

test('rejects an answer about another site or an error status', async () => {
  const target = resolveRin5OnboardingTarget(env)
  assert.ok(target)
  await assert.rejects(fetchRin5OnboardingFacts(target, recorder({ ...facts, siteId: '223e4567-e89b-42d3-a456-426614174000' }).fetcher), /site_mismatch/)
  await assert.rejects(fetchRin5OnboardingFacts(target, recorder({ error: 'unauthorized' }, 401).fetcher), /http_401/)
  await assert.rejects(fetchRin5OnboardingFacts(target, recorder({ siteId }).fetcher))
})
