import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveRin5Navigation } from './rin5-navigation'

const siteId = '123e4567-e89b-42d3-a456-426614174000'

test('builds the Basic customer navigation from runtime-only rin5 configuration', () => {
  assert.deepEqual(
    resolveRin5Navigation({
      RIN5_APP_URL: 'https://app.rin5.test/',
      RIN5_SITE_ID: siteId,
    }),
    {
      dashboardUrl: 'https://app.rin5.test/dashboard',
      analyticsUrl: 'https://app.rin5.test/dashboard/analytics',
      settingsUrl: 'https://app.rin5.test/dashboard/settings',
      siteUrl: `https://app.rin5.test/dashboard/sites/${siteId}`,
      publishUrl: `https://app.rin5.test/dashboard/sites/${siteId}/publish`,
      helpUrl: 'https://app.rin5.test/ayuda',
    },
  )
})

test('does not expose navigation for incomplete or unsafe configuration', () => {
  assert.equal(resolveRin5Navigation({ RIN5_APP_URL: 'https://app.rin5.test' }), null)
  assert.equal(resolveRin5Navigation({ RIN5_APP_URL: 'javascript:alert(1)', RIN5_SITE_ID: siteId }), null)
  assert.equal(resolveRin5Navigation({ RIN5_APP_URL: 'https://user:password@app.rin5.test', RIN5_SITE_ID: siteId }), null)
  assert.equal(resolveRin5Navigation({ RIN5_APP_URL: 'https://app.rin5.test', RIN5_SITE_ID: 'site-short-id' }), null)
})

test('allows plain HTTP only for local development hosts', () => {
  assert.equal(resolveRin5Navigation({ RIN5_APP_URL: 'http://app.rin5.test', RIN5_SITE_ID: siteId }), null)
  assert.equal(
    resolveRin5Navigation({ RIN5_APP_URL: 'http://localhost:3100', RIN5_SITE_ID: siteId })?.helpUrl,
    'http://localhost:3100/ayuda',
  )
})
