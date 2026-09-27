import assert from 'node:assert/strict'
import test from 'node:test'

import {
  customerCopy,
  customerCopyPlaceholders,
  setRin5CustomerMode,
  translateCustomerCopy,
  translateKnownCustomerCopy,
} from './rin5-customer-copy'
import { RIN5_CUSTOMER_COPY_ES } from './rin5-customer-copy-es'

test('the standard Ycode editor keeps its English copy unchanged', () => {
  assert.equal(translateCustomerCopy('Desktop', false), 'Desktop')
  assert.equal(translateCustomerCopy('Zoom to 100%', false), 'Zoom to 100%')
})

test('the rin5 customer workspace reads Spanish', () => {
  assert.equal(translateCustomerCopy('Desktop', true), 'Ordenador')
  assert.equal(translateCustomerCopy('Phone|viewport', true), 'Móvil')
})

test('a context after | tells two meanings apart and never reaches the English', () => {
  assert.equal(translateCustomerCopy('Phone|viewport', false), 'Phone')
  assert.equal(translateCustomerCopy('Phone', true), 'Teléfono')
})

test('placeholders are filled in both languages', () => {
  assert.equal(translateCustomerCopy('{count} files', false, { count: 3 }), '3 files')
  assert.equal(translateCustomerCopy('{count} files', true, { count: 3 }), '3 archivos')
})

test('labels that may be the customer\'s own words are only translated when they are known copy', () => {
  assert.equal(translateKnownCustomerCopy('Heading', true), 'Título')
  assert.equal(translateKnownCustomerCopy('Clases de equitación', true), 'Clases de equitación')
  assert.equal(translateKnownCustomerCopy('Heading', false), 'Heading')
})

test('every translation keeps exactly the placeholders of its English key', () => {
  for (const [english, spanish] of Object.entries(RIN5_CUSTOMER_COPY_ES)) {
    assert.deepEqual(customerCopyPlaceholders(spanish), customerCopyPlaceholders(english), english)
    assert.ok(spanish.trim().length > 0, `${english} has no Spanish`)
  }
})

test('copy outside React follows the workspace mode at call time', () => {
  setRin5CustomerMode(false)
  assert.equal(customerCopy('Zoom in'), 'Zoom in')
  setRin5CustomerMode(true)
  assert.equal(customerCopy('Zoom in'), 'Acercar')
  setRin5CustomerMode(false)
})
