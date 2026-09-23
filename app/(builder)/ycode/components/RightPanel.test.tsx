import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'

import RightPanel from './RightPanel'

test('content-only customers see editing guidance without agent or tier promotion', () => {
  const markup = renderToStaticMarkup(<RightPanel contentOnly onLayerUpdate={() => undefined} />)

  assert.match(markup, /Selecciona un texto o una imagen/)
  assert.doesNotMatch(markup, /Human|Agent|Agente IA|tier|futuro/i)
})

test('content-only guidance does not take canvas width on a phone', () => {
  const markup = renderToStaticMarkup(<RightPanel contentOnly onLayerUpdate={() => undefined} />)

  assert.match(markup, /hidden md:flex/)
})
