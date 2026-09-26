import { z } from 'zod'

import type { Layer } from '@/types'

/**
 * rin5 welcome inside the customer editor: pure decisions over the facts rin5
 * returns for this container's site. Shared by the server route (which decides
 * with the server clock) and the client (which detects content changes).
 *
 * rin5 stores facts only (welcome seen, a text changed, a photo changed, the
 * checklist closed, the owner published, a domain is live). What is shown, and
 * when the checklist comes back, is decided here.
 */

export const RIN5_ONBOARDING_EVENTS = [
  'welcome_seen',
  'tour_finished',
  'text_changed',
  'image_changed',
  'checklist_dismissed',
  'checklist_restored',
] as const
export type Rin5OnboardingEvent = (typeof RIN5_ONBOARDING_EVENTS)[number]

export const rin5OnboardingEventSchema = z.enum(RIN5_ONBOARDING_EVENTS)

const timestamp = z.string().min(1).nullable()

export const rin5OnboardingFactsSchema = z.object({
  siteId: z.string(),
  entitled: z.boolean(),
  welcomeSeenAt: timestamp,
  tourFinishedAt: timestamp,
  textChangedAt: timestamp,
  imageChangedAt: timestamp,
  checklistDismissedAt: timestamp,
  ownerPublished: z.boolean(),
  domainConnected: z.boolean(),
})
export type Rin5OnboardingFacts = z.infer<typeof rin5OnboardingFactsSchema>

export type Rin5ChecklistStepId = 'linked' | 'trial' | 'text' | 'image' | 'published' | 'domain'
export type Rin5TourStep = 'text' | 'image' | 'publish'

export type Rin5OnboardingView =
  | { enabled: false }
  | {
    enabled: true
    /** Show the welcome screen now. Only once, on the first visit of the trial. */
    welcome: boolean
    /** Current guided step, or null when the tour is over or not started. */
    tour: Rin5TourStep | null
    steps: ReadonlyArray<{ id: Rin5ChecklistStepId; done: boolean }>
    remaining: number
    /** The checklist opens by itself: something is left and it was not closed in the last day. */
    checklistOpen: boolean
  }

/** Closing the checklist puts it away for a day. If something is left, it comes back. */
export const RIN5_CHECKLIST_SNOOZE_MS = 24 * 60 * 60 * 1000

export const RIN5_ONBOARDING_DISABLED: Rin5OnboardingView = { enabled: false }

export function rin5OnboardingView(facts: Rin5OnboardingFacts, now: Date): Rin5OnboardingView {
  // A lapsed or removed site has no editor worth teaching.
  if (!facts.entitled) return RIN5_ONBOARDING_DISABLED

  const steps = [
    { id: 'linked', done: true },
    { id: 'trial', done: true },
    { id: 'text', done: facts.textChangedAt !== null },
    { id: 'image', done: facts.imageChangedAt !== null },
    { id: 'published', done: facts.ownerPublished },
    { id: 'domain', done: facts.domainConnected },
  ] as const
  const remaining = steps.filter((step) => !step.done).length

  const welcome = facts.welcomeSeenAt === null
  let tour: Rin5TourStep | null = null
  if (!welcome && facts.tourFinishedAt === null) {
    if (facts.textChangedAt === null) tour = 'text'
    else if (facts.imageChangedAt === null) tour = 'image'
    else if (!facts.ownerPublished) tour = 'publish'
  }

  const dismissedAt = facts.checklistDismissedAt ? Date.parse(facts.checklistDismissedAt) : Number.NaN
  const snoozed = Number.isFinite(dismissedAt) && now.getTime() - dismissedAt < RIN5_CHECKLIST_SNOOZE_MS
  // The welcome and the tooltips go first; two things pointing at once is noise.
  const checklistOpen = remaining > 0 && !welcome && tour === null && !snoozed

  return { enabled: true, welcome, tour, steps, remaining, checklistOpen }
}

type Signatures = Map<string, { text: string; image: string }>

function signatures(layers: readonly Layer[] | undefined): Signatures {
  const map: Signatures = new Map()
  const visit = (list: readonly Layer[] | undefined) => {
    for (const layer of list ?? []) {
      const overrides = layer.componentOverrides
      map.set(layer.id, {
        text: JSON.stringify([layer.variables?.text ?? null, overrides?.text ?? null, overrides?.rich_text ?? null]),
        image: JSON.stringify([
          layer.variables?.image?.src ?? null,
          layer.variables?.backgroundImage?.src ?? null,
          overrides?.image ?? null,
        ]),
      })
      visit(layer.children)
    }
  }
  visit(layers)
  return map
}

/**
 * Did the customer change a text or a photo between two drafts of the same
 * page? Only layers present in both count: loading a page, adding or deleting
 * a layer is not "changing a text".
 */
export function detectRin5ContentChanges(
  previous: readonly Layer[] | undefined,
  next: readonly Layer[] | undefined,
): { text: boolean; image: boolean } {
  if (!previous || !next || previous === next) return { text: false, image: false }
  const before = signatures(previous)
  const after = signatures(next)
  let text = false
  let image = false
  for (const [id, now] of after) {
    const then = before.get(id)
    if (!then) continue
    if (then.text !== now.text) text = true
    if (then.image !== now.image) image = true
    if (text && image) break
  }
  return { text, image }
}
