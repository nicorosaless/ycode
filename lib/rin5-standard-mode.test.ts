import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { translateCustomerCopy } from './rin5-customer-copy'
import { customerFieldName } from './rin5-customer-fields'
import { fileManagerLayout } from './rin5-file-manager-layout'
import { uploadFailureNotice } from './rin5-upload-notice'

// Standard Ycode (no rin5 client space) must behave and read exactly as it
// did before the client space existed. One test per leak found in review.

test('built-in collection fields are stored with their English names', () => {
  const store = readFileSync('stores/useCollectionsStore.ts', 'utf8')
  assert.doesNotMatch(store, /customerCopy|rin5-customer/)
  for (const name of ['ID', 'Status', 'Name', 'Slug', 'Created Date', 'Updated Date']) {
    assert.match(store, new RegExp(`name: '${name}',`))
  }
})

test('built-in field names are translated only when drawn in the client space', () => {
  assert.equal(customerFieldName({ key: 'name', name: 'Name' }, false), 'Name')
  assert.equal(customerFieldName({ key: 'name', name: 'Name' }, true), 'Nombre')
  assert.equal(customerFieldName({ key: 'created_at', name: 'Created Date' }, true), 'Creado')
  assert.equal(customerFieldName({ key: 'name', name: 'Nombre del caballo' }, true), 'Nombre del caballo')
  assert.equal(customerFieldName({ key: null, name: 'Name' }, true), 'Name')
})

test('standard Ycode shows no upload-failure notice, for any file type', () => {
  assert.equal(uploadFailureNotice(['clase.mp4'], false), null)
  assert.equal(uploadFailureNotice(['foto.heic', 'plano.pdf'], false), null)
  assert.equal(uploadFailureNotice([], true), null)
  assert.match(uploadFailureNotice(['foto.heic'], true)?.title ?? '', /foto\.heic/)
})

test('standard Ycode keeps its original English copy where the review found leaks', () => {
  const vars = { field: 'Photo', collection: 'Horses', count: 2 }
  assert.equal(translateCustomerCopy('Field "{field}" in "{collection}"', false, vars), 'Field "Photo" in "Horses"')
  assert.equal(translateCustomerCopy('Field "{field}" in the "{collection}" collection', false, vars), 'Field "Photo" in the "Horses" collection')
  assert.equal(translateCustomerCopy('{count} assets', false, vars), '2 assets')
  assert.equal(translateCustomerCopy('Move {count} assets', false, vars), 'Move 2 assets')
  assert.equal(
    translateCustomerCopy('Create site-wide values you can reuse anywhere via content.', false),
    'Create site-wide values you can reuse anywhere via content.',
  )
})

test('standard Ycode keeps the file manager layout at every width, iPad included', () => {
  assert.deepEqual(fileManagerLayout(false), {
    sidebar: 'w-64 border-r h-full overflow-y-auto px-4',
    typeFilter: 'w-35 justify-between gap-1 font-normal',
    separator: 'h-7! shrink-0 mx-0.5',
    svgButton: undefined,
    gridHeader: 'flex items-center justify-between gap-2 min-h-14 shrink-0',
  })
  assert.match(fileManagerLayout(true).sidebar, /\bhidden\b.*\bmd:block\b/)
})
