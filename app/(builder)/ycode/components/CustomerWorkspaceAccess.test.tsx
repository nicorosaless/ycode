import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  Rin5CustomerLocalizationNav,
  StructureEditorOnly,
} from './CustomerWorkspaceAccess'

test('content-only customers do not see controls that mutate project structure', () => {
  const markup = renderToStaticMarkup(
    <StructureEditorOnly role="editor"><span>Import</span></StructureEditorOnly>,
  )

  assert.equal(markup, '')
})

test('designers keep controls that mutate project structure', () => {
  const markup = renderToStaticMarkup(
    <StructureEditorOnly role="designer"><span>Import</span></StructureEditorOnly>,
  )

  assert.match(markup, /Import/)
})

test('the rin5 customer workspace exposes Idiomas in its primary navigation', () => {
  const markup = renderToStaticMarkup(
    <Rin5CustomerLocalizationNav
      active={false}
      enabled
      onSelect={() => undefined}
    />,
  )

  assert.match(markup, /Idiomas/)
})

test('headers outside the rin5 customer workspace do not gain the localization link', () => {
  const markup = renderToStaticMarkup(
    <Rin5CustomerLocalizationNav
      active={false}
      enabled={false}
      onSelect={() => undefined}
    />,
  )

  assert.equal(markup, '')
})
