'use client'

import { create } from 'zustand'

import {
  RIN5_ONBOARDING_DISABLED,
  type Rin5OnboardingEvent,
  type Rin5OnboardingView,
} from '@/lib/rin5-onboarding'

/**
 * What the customer sees of the welcome right now. The server decides (it has
 * rin5's facts and the clock); this store only remembers the last answer, the
 * events already sent, and whether the checklist panel is open.
 */
type Rin5OnboardingState = {
  view: Rin5OnboardingView
  loaded: boolean
  checklistOpen: boolean
  sent: ReadonlySet<Rin5OnboardingEvent>
  load: () => Promise<void>
  mark: (event: Rin5OnboardingEvent) => Promise<void>
  openChecklist: () => void
  closeChecklist: () => void
}

const ENDPOINT = '/ycode/api/rin5/onboarding'

function parseView(value: unknown): Rin5OnboardingView {
  if (!value || typeof value !== 'object' || (value as { enabled?: unknown }).enabled !== true) return RIN5_ONBOARDING_DISABLED
  return value as Rin5OnboardingView
}

/** Events that record a fact once; repeating them changes nothing on the server. */
const ONCE: ReadonlySet<Rin5OnboardingEvent> = new Set(['welcome_seen', 'tour_finished', 'text_changed', 'image_changed'])

export const useRin5Onboarding = create<Rin5OnboardingState>((set, get) => ({
  view: RIN5_ONBOARDING_DISABLED,
  loaded: false,
  checklistOpen: false,
  sent: new Set(),

  async load() {
    try {
      const response = await fetch(ENDPOINT, { cache: 'no-store' })
      const view = parseView(await response.json())
      set({ view, loaded: true, checklistOpen: view.enabled && view.checklistOpen })
    } catch {
      set({ view: RIN5_ONBOARDING_DISABLED, loaded: true })
    }
  },

  async mark(event) {
    if (ONCE.has(event) && get().sent.has(event)) return
    set({ sent: new Set([...get().sent, event]) })
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event }),
      })
      const view = parseView(await response.json())
      const checklistOpen = event === 'checklist_dismissed'
        ? false
        : get().checklistOpen || (view.enabled && view.checklistOpen)
      set({ view, checklistOpen })
    } catch {
      // Not being able to record a step must never block editing.
    }
  },

  openChecklist() {
    set({ checklistOpen: true })
  },

  closeChecklist() {
    set({ checklistOpen: false })
    void get().mark('checklist_dismissed')
  },
}))
