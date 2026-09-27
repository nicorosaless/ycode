import assert from 'node:assert/strict'
import test from 'node:test'

import { customerLocaleLabel } from './rin5-customer-locale'

test('a stock language name reads in Spanish for the rin5 customer', () => {
  assert.equal(customerLocaleLabel({ code: 'en', label: 'English' }, true), 'Inglés')
  assert.equal(customerLocaleLabel({ code: 'ca', label: 'Catalan' }, true), 'Catalán')
})

test('a name the site owner typed stays as written', () => {
  assert.equal(customerLocaleLabel({ code: 'en', label: 'English (UK)' }, true), 'English (UK)')
})

test('the standard editor keeps the stored name', () => {
  assert.equal(customerLocaleLabel({ code: 'en', label: 'English' }, false), 'English')
})
