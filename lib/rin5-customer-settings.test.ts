import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRin5CustomerSettings } from './rin5-customer-settings'

test('accepts only the safe persistent customer settings', () => {
  assert.deepEqual(parseRin5CustomerSettings({
    site_name: ' Autoescuela Sol ',
    site_description: 'Clases de conducción en Barcelona',
    timezone: 'Europe/Madrid',
    favicon_asset_id: null,
  }), {
    site_name: 'Autoescuela Sol',
    site_description: 'Clases de conducción en Barcelona',
    timezone: 'Europe/Madrid',
    favicon_asset_id: null,
  })
})

test('rejects unsafe and unknown settings', () => {
  assert.throws(() => parseRin5CustomerSettings({ custom_code_head: '<script />' }))
  assert.throws(() => parseRin5CustomerSettings({ site_name: '' }))
  assert.throws(() => parseRin5CustomerSettings({ timezone: 'Barcelona' }))
})
