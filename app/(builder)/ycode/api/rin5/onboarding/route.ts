import { NextRequest, NextResponse } from 'next/server'

import {
  RIN5_ONBOARDING_DISABLED,
  rin5OnboardingEventSchema,
  rin5OnboardingView,
  type Rin5OnboardingView,
} from '@/lib/rin5-onboarding'
import {
  fetchRin5OnboardingFacts,
  markRin5Onboarding,
  resolveRin5OnboardingTarget,
} from '@/lib/rin5-onboarding-server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The customer's browser asks here; this server asks rin5 with the container's
 * internal secret, which never reaches the browser. `proxy.ts` has already
 * checked the editor session and the rin5 customer role before this runs.
 *
 * Any failure turns the welcome off instead of breaking the editor: showing it
 * twice is worse than not showing it.
 */

function reply(view: Rin5OnboardingView, status = 200) {
  return NextResponse.json(view, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET() {
  const target = resolveRin5OnboardingTarget(process.env)
  if (!target) return reply(RIN5_ONBOARDING_DISABLED)
  try {
    return reply(rin5OnboardingView(await fetchRin5OnboardingFacts(target), new Date()))
  } catch (error) {
    console.error('[rin5 onboarding] read failed', error instanceof Error ? error.message : error)
    return reply(RIN5_ONBOARDING_DISABLED)
  }
}

export async function POST(request: NextRequest) {
  let event: unknown
  try {
    event = ((await request.json()) as { event?: unknown } | null)?.event
  } catch {
    return NextResponse.json({ error: 'Invalid onboarding event' }, { status: 400 })
  }
  const parsed = rin5OnboardingEventSchema.safeParse(event)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid onboarding event' }, { status: 400 })
  const target = resolveRin5OnboardingTarget(process.env)
  if (!target) return reply(RIN5_ONBOARDING_DISABLED)
  try {
    return reply(rin5OnboardingView(await markRin5Onboarding(target, parsed.data), new Date()))
  } catch (error) {
    console.error('[rin5 onboarding] mark failed', error instanceof Error ? error.message : error)
    return reply(RIN5_ONBOARDING_DISABLED, 502)
  }
}
