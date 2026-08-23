import { timingSafeEqual } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function authorizeRin5InternalRequest(headers: Headers, configuredSecret: string | undefined): boolean {
  if (!configuredSecret || configuredSecret.length < 32) return false
  const header = headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(configuredSecret, 'utf8')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export function parseRin5ExportRequest(value: unknown, configuredSiteId: string | undefined): { siteId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('rin5_export_request_invalid')
  const siteId = (value as Record<string, unknown>).siteId
  if (typeof siteId !== 'string' || !UUID.test(siteId)) throw new Error('rin5_export_request_invalid')
  if (!configuredSiteId || !UUID.test(configuredSiteId)) throw new Error('rin5_instance_site_not_configured')
  if (siteId !== configuredSiteId) throw new Error('rin5_site_mismatch')
  return { siteId }
}

export function parseRin5HandoffRequest(value: unknown, configuredSiteId: string | undefined): { email: string; siteId: string } {
  const { siteId } = parseRin5ExportRequest(value, configuredSiteId)
  const emailValue = (value as Record<string, unknown>).email
  if (typeof emailValue !== 'string') throw new Error('rin5_handoff_request_invalid')
  const email = emailValue.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('rin5_handoff_request_invalid')
  }
  return { email, siteId }
}

export function parseRin5EditorBaseUrl(value: string | undefined): string {
  try {
    if (!value) throw new Error('missing')
    const url = new URL(value)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
      throw new Error('unsafe')
    }
    return url.origin
  } catch {
    throw new Error('rin5_editor_base_url_invalid')
  }
}
