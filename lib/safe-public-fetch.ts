import { lookup } from 'node:dns/promises'

const MAX_REDIRECTS = 4

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === '::' || normalized === '::1') return true
  if (/^(?:fc|fd|fe8|fe9|fea|feb)/.test(normalized)) return true
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1]
  const v4 = mapped ?? normalized
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v4)
  if (!match) return false
  const octets = match.slice(1).map(Number)
  if (octets.some((value) => value > 255)) return true
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

export function parsePublicHttpUrl(value: string | URL): URL {
  const url = value instanceof URL ? new URL(value) : new URL(value)
  const hostname = url.hostname.toLowerCase()
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port))
    || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')
    || isPrivateIp(hostname)) {
    throw new Error('public_fetch_target_invalid')
  }
  return url
}

async function assertPublicResolution(url: URL): Promise<void> {
  const addresses = await lookup(url.hostname, { all: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('public_fetch_target_invalid')
  }
}

/** Validate every DNS name and every redirect before making the next request. */
export async function safePublicFetch(value: string | URL, init: RequestInit = {}): Promise<Response> {
  let current = parsePublicHttpUrl(value)
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicResolution(current)
    const response = await fetch(current, { ...init, redirect: 'manual' })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location || redirects === MAX_REDIRECTS) throw new Error('public_fetch_redirect_invalid')
    current = parsePublicHttpUrl(new URL(location, current))
  }
  throw new Error('public_fetch_redirect_invalid')
}
