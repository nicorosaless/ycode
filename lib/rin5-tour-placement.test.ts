import assert from 'node:assert/strict'
import test from 'node:test'

import { placeTourTip, type TourRect } from './rin5-tour-placement'

// Measured on the editor at 1440×900: header 56 px, canvas and its toolbar on
// the left, the customer's hint column (w-64) on the right.
const canvas: TourRect = { top: 56, left: 0, width: 1184, height: 844 }
const column: TourRect = { top: 56, left: 1184, width: 256, height: 844 }
const publish: TourRect = { top: 8, left: 1271, width: 115, height: 40 }

function overlaps(a: TourRect, b: TourRect) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
}

test('on desktop the canvas steps sit in the hint column and never over the web', () => {
  for (const step of ['text', 'image'] as const) {
    const placement = placeTourTip({ step, anchor: canvas, column })
    assert.equal(placement.mode, 'float')
    if (placement.mode !== 'float') return
    assert.equal(placement.side, 'left')
    const tip = { top: placement.top, left: placement.left, width: placement.width, height: 200 }
    assert.equal(overlaps(tip, canvas), false)
    assert.ok(placement.left >= column.left && placement.left + placement.width <= column.left + column.width)
  }
})

test('on desktop the publish step hangs under Publicar, inside the column', () => {
  const placement = placeTourTip({ step: 'publish', anchor: publish, column })
  assert.equal(placement.mode, 'float')
  if (placement.mode !== 'float') return
  assert.equal(placement.side, 'below')
  assert.ok(placement.top > publish.top + publish.height)
  const tip = { top: placement.top, left: placement.left, width: placement.width, height: 200 }
  assert.equal(overlaps(tip, canvas), false)
  assert.equal(overlaps(tip, publish), false)
  const arrowX = placement.left + placement.arrow + 6
  assert.ok(Math.abs(arrowX - (publish.left + publish.width / 2)) <= 1, 'the arrow points at the button')
})

test('without the column (a 390 px phone) every step docks to the bottom', () => {
  const phoneCanvas: TourRect = { top: 56, left: 0, width: 390, height: 788 }
  for (const step of ['text', 'image', 'publish'] as const) {
    assert.deepEqual(placeTourTip({ step, anchor: phoneCanvas, column: null }), { mode: 'dock' })
  }
})

test('a column too narrow for a readable tip docks as well', () => {
  assert.deepEqual(
    placeTourTip({ step: 'text', anchor: canvas, column: { ...column, width: 150 } }),
    { mode: 'dock' },
  )
})
