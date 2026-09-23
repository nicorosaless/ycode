import test from 'node:test'
import assert from 'node:assert/strict'

import { moveCustomerSection } from './rin5-customer-reorder'
import type { Layer } from '@/types'

const layer = (
  id: string,
  name: string,
  children: Layer[] = [],
  settings?: Layer['settings'],
): Layer => ({ id, name, classes: '', children, ...(settings ? { settings } : {}) })

const section = (id: string, children: Layer[] = []): Layer => layer(id, 'section', children)

test('customer section movement only swaps existing direct canvas sections', () => {
  const main = layer('main', 'div', [section('hero'), section('services'), section('contact')], { tag: 'main' })
  const layers = [layer('body', 'body', [layer('header', 'header'), main, layer('footer', 'footer')])]
  const moved = moveCustomerSection(layers, 'services', 'up')
  assert.equal(moved.moved, true)
  assert.deepEqual(moved.layers[0]?.children?.[1]?.children?.map(layer => layer.id), ['services', 'hero', 'contact'])
  assert.deepEqual(layers[0]?.children?.[1]?.children?.map(layer => layer.id), ['hero', 'services', 'contact'])
})

test('customer section movement rejects nested layers and canvas boundaries', () => {
  const nested = section('hero', [section('heading')])
  const header = layer('header', 'header')
  const footer = layer('footer', 'footer')
  const layers = [layer('body', 'body', [header, nested, section('contact'), footer])]
  assert.equal(moveCustomerSection(layers, 'heading', 'down').moved, false)
  assert.equal(moveCustomerSection(layers, 'hero', 'up').moved, false)
  assert.equal(moveCustomerSection(layers, 'contact', 'down').moved, false)
  assert.deepEqual(layers[0]?.children?.map(layer => layer.id), ['header', 'hero', 'contact', 'footer'])
})

test('customer section movement ignores a nested main outside the body main slot', () => {
  const nestedMain = layer('nested-main', 'div', [section('one'), section('two')], { tag: 'main' })
  const wrapper = layer('wrapper', 'div', [nestedMain])
  const layers = [layer('body', 'body', [wrapper])]
  const result = moveCustomerSection(layers, 'two', 'up')
  assert.equal(result.moved, false)
  assert.deepEqual(result.layers, layers)
})
