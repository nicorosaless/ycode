import {
  rin5OnboardingFactsSchema,
  type Rin5OnboardingEvent,
  type Rin5OnboardingFacts,
} from '@/lib/rin5-onboarding'

type Environment = Readonly<Record<string, string | undefined>>
type Fetcher = typeof fetch

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

type Rin5OnboardingTarget = { endpoint: URL; secret: string; siteId: string }

/**
 * Where this container asks rin5 about the welcome. Same trust rules as the
 * navigation: HTTPS, or plain HTTP only on a local host. Without a complete
 * configuration the welcome is simply off; the editor keeps working.
 */
export function resolveRin5OnboardingTarget(environment: Environment): Rin5OnboardingTarget | null {
  const siteId = environment.RIN5_SITE_ID?.trim()
  const secret = environment.RIN5_INTERNAL_API_SECRET
  if (!siteId || !UUID.test(siteId) || !secret || secret.length < 32) return null
  try {
    const app = new URL(environment.RIN5_APP_URL ?? '')
    const safe = app.protocol === 'https:' || (app.protocol === 'http:' && LOCAL_HOSTS.has(app.hostname))
    if (!safe || app.username || app.password) return null
    return { endpoint: new URL('/api/editor/onboarding', app.origin), secret, siteId }
  } catch {
    return null
  }
}

async function readFacts(response: Response, siteId: string): Promise<Rin5OnboardingFacts> {
  if (!response.ok) throw new Error(`rin5_onboarding_http_${response.status}`)
  const facts = rin5OnboardingFactsSchema.parse(await response.json())
  if (facts.siteId !== siteId) throw new Error('rin5_onboarding_site_mismatch')
  return facts
}

export async function fetchRin5OnboardingFacts(target: Rin5OnboardingTarget, fetcher: Fetcher = fetch): Promise<Rin5OnboardingFacts> {
  const url = new URL(target.endpoint)
  url.searchParams.set('site_id', target.siteId)
  const response = await fetcher(url, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${target.secret}` },
    signal: AbortSignal.timeout(5_000),
  })
  return readFacts(response, target.siteId)
}

export async function markRin5Onboarding(
  target: Rin5OnboardingTarget,
  event: Rin5OnboardingEvent,
  fetcher: Fetcher = fetch,
): Promise<Rin5OnboardingFacts> {
  const response = await fetcher(target.endpoint, {
    body: JSON.stringify({ siteId: target.siteId, event }),
    cache: 'no-store',
    headers: { authorization: `Bearer ${target.secret}`, 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(5_000),
  })
  return readFacts(response, target.siteId)
}
