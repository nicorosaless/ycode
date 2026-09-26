import assert from 'node:assert/strict'
import test from 'node:test'

import type { Layer } from '@/types'

import {
  RIN5_CHECKLIST_SNOOZE_MS,
  detectRin5ContentChanges,
  rin5OnboardingView,
  type Rin5OnboardingFacts,
} from './rin5-onboarding'

const NOW = new Date('2026-10-01T10:00:00Z')

const fresh: Rin5OnboardingFacts = {
  siteId: '123e4567-e89b-42d3-a456-426614174000',
  entitled: true,
  welcomeSeenAt: null,
  tourFinishedAt: null,
  textChangedAt: null,
  imageChangedAt: null,
  checklistDismissedAt: null,
  ownerPublished: false,
  domainConnected: false,
}

function view(overrides: Partial<Rin5OnboardingFacts>) {
  const result = rin5OnboardingView({ ...fresh, ...overrides }, NOW)
  assert.equal(result.enabled, true)
  if (!result.enabled) throw new Error('unreachable')
  return result
}

test('the first visit of a trial shows the welcome and nothing else', () => {
  const result = view({})
  assert.equal(result.welcome, true)
  assert.equal(result.tour, null)
  assert.equal(result.checklistOpen, false)
  assert.equal(result.remaining, 4)
})

test('the welcome is shown once: after it the tour starts with a text', () => {
  const result = view({ welcomeSeenAt: '2026-10-01T09:00:00Z' })
  assert.equal(result.welcome, false)
  assert.equal(result.tour, 'text')
})

test('the tour advances with what the customer actually did', () => {
  const seen = { welcomeSeenAt: '2026-10-01T09:00:00Z' }
  assert.equal(view({ ...seen, textChangedAt: '2026-10-01T09:01:00Z' }).tour, 'image')
  assert.equal(view({ ...seen, textChangedAt: 'x', imageChangedAt: 'y' }).tour, 'publish')
  assert.equal(view({ ...seen, textChangedAt: 'x', imageChangedAt: 'y', ownerPublished: true }).tour, null)
  assert.equal(view({ ...seen, tourFinishedAt: '2026-10-01T09:02:00Z' }).tour, null)
})

test('the checklist opens by itself once the tour is out of the way', () => {
  const result = view({ welcomeSeenAt: 'x', tourFinishedAt: 'y' })
  assert.equal(result.checklistOpen, true)
  assert.deepEqual(result.steps.map((step) => [step.id, step.done]), [
    ['linked', true], ['trial', true], ['text', false], ['image', false], ['published', false], ['domain', false],
  ])
})

test('closing the checklist hides it for a day, then it comes back while something is left', () => {
  const closedJustNow = new Date(NOW.getTime() - 60_000).toISOString()
  const closedYesterday = new Date(NOW.getTime() - RIN5_CHECKLIST_SNOOZE_MS - 1).toISOString()
  assert.equal(view({ welcomeSeenAt: 'x', tourFinishedAt: 'y', checklistDismissedAt: closedJustNow }).checklistOpen, false)
  assert.equal(view({ welcomeSeenAt: 'x', tourFinishedAt: 'y', checklistDismissedAt: closedYesterday }).checklistOpen, true)
})

test('a finished checklist never opens again', () => {
  const result = view({
    welcomeSeenAt: 'x', tourFinishedAt: 'y', textChangedAt: 'a', imageChangedAt: 'b', ownerPublished: true, domainConnected: true,
  })
  assert.equal(result.remaining, 0)
  assert.equal(result.checklistOpen, false)
})

test('a site without a current period has no welcome at all', () => {
  assert.deepEqual(rin5OnboardingView({ ...fresh, entitled: false }, NOW), { enabled: false })
})

function text(id: string, value: string, children: Layer[] = []): Layer {
  return {
    id, name: 'text', classes: '', children,
    variables: { text: { type: 'dynamic_text', data: { content: value } } },
  } as unknown as Layer
}

function image(id: string, assetId: string): Layer {
  return {
    id, name: 'image', classes: '',
    variables: { image: { src: { type: 'asset', data: { asset_id: assetId } }, alt: { type: 'dynamic_text', data: { content: '' } } } },
  } as unknown as Layer
}

test('a rewritten text in an existing layer counts as a text change', () => {
  const before = [text('root', 'Hola', [text('title', 'Clases de equitación')])]
  const after = [text('root', 'Hola', [text('title', 'Clases para todas las edades')])]
  assert.deepEqual(detectRin5ContentChanges(before, after), { text: true, image: false })
})

test('a replaced photo counts as a photo change', () => {
  assert.deepEqual(detectRin5ContentChanges([image('hero', 'a')], [image('hero', 'b')]), { text: false, image: true })
})

test('loading a page, adding or deleting layers is not a content change', () => {
  assert.deepEqual(detectRin5ContentChanges(undefined, [text('a', 'x')]), { text: false, image: false })
  assert.deepEqual(detectRin5ContentChanges([text('a', 'x')], [text('a', 'x'), text('b', 'nuevo')]), { text: false, image: false })
  assert.deepEqual(detectRin5ContentChanges([text('a', 'x'), image('b', 'p')], [text('a', 'x')]), { text: false, image: false })
  const same = [text('a', 'x')]
  assert.deepEqual(detectRin5ContentChanges(same, same), { text: false, image: false })
})
