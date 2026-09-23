import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCreateLocale, parseUpdateLocale } from './locale-input'

test('locale inputs accept the localization workspace fields', () => {
  assert.deepEqual(parseCreateLocale({ code: 'es-ES', label: ' Español ', is_default: false }), {
    code: 'es-ES', label: 'Español', is_default: false,
  })
  assert.deepEqual(parseUpdateLocale({ label: 'Català' }), { label: 'Català' })
})

test('locale inputs reject unknown fields and malformed locale codes', () => {
  assert.throws(() => parseCreateLocale({ code: '../es', label: 'Español' }))
  assert.throws(() => parseUpdateLocale({ label: 'Español', deleted_at: null }))
})
