export type Rin5Navigation = Readonly<{
  dashboardUrl: string
  analyticsUrl: string
  settingsUrl: string
  siteUrl: string
  publishUrl: string
  helpUrl: string
}>

type Rin5NavigationEnvironment = Readonly<Record<string, string | undefined>>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function safeAppOrigin(value: string | undefined): string | null {
  if (!value) return null

  try {
    const url = new URL(value)
    const safeProtocol = url.protocol === 'https:'
      || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))
    if (!safeProtocol || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

/** Return the only rin5 runtime values that browser components may receive. */
export function resolveRin5Navigation(environment: Rin5NavigationEnvironment): Rin5Navigation | null {
  const appOrigin = safeAppOrigin(environment.RIN5_APP_URL)
  const siteId = environment.RIN5_SITE_ID?.trim()
  if (!appOrigin || !siteId || !UUID.test(siteId)) return null

  const sitePath = `/dashboard/sites/${siteId}`
  return {
    dashboardUrl: `${appOrigin}/dashboard`,
    analyticsUrl: `${appOrigin}/dashboard/analytics`,
    settingsUrl: `${appOrigin}/dashboard/settings`,
    siteUrl: `${appOrigin}${sitePath}`,
    publishUrl: `${appOrigin}${sitePath}/publish`,
    helpUrl: `${appOrigin}/ayuda`,
  }
}
