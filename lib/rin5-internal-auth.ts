import { timingSafeEqual } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const RIN5_HANDOFF_DESTINATIONS = {
  canvas: '/ycode',
  cms: '/ycode/collections',
  general: '/ycode/site-settings',
  localization: '/ycode/localization',
} as const

export type Rin5HandoffDestination = keyof typeof RIN5_HANDOFF_DESTINATIONS

export function parseRin5HandoffDestination(value: unknown): {
  destination: Rin5HandoffDestination
  path: (typeof RIN5_HANDOFF_DESTINATIONS)[Rin5HandoffDestination]
} {
  const destination = value === undefined || value === null || value === '' ? 'canvas' : value
  if (typeof destination !== 'string' || !(destination in RIN5_HANDOFF_DESTINATIONS)) {
    throw new Error('rin5_handoff_destination_invalid')
  }
  const key = destination as Rin5HandoffDestination
  return { destination: key, path: RIN5_HANDOFF_DESTINATIONS[key] }
}

// `embed=1` means the editor is framed inside the rin5 Canvas, which already
// draws its own navigation. Only the literal '1' or an absent flag is valid:
// anything else is a caller bug, not a softer way of saying "no".
export function parseRin5HandoffEmbed(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (value === '1') return true
  throw new Error('rin5_handoff_embed_invalid')
}

// The confirm step turns the flag into a cookie scoped to /ycode, so the
// server layout knows on every later navigation that the editor is framed. A
// direct (non-embedded) sign-in clears it, which keeps a stale embed from an
// earlier session from hiding the header of a full-window editor.
export function rin5EmbedCookie(embed: boolean, editorBaseUrl: string) {
  return {
    name: 'rin5_embed',
    value: embed ? '1' : '',
    options: {
      httpOnly: false,
      maxAge: embed ? 60 * 60 * 24 * 30 : 0,
      path: '/ycode',
      sameSite: 'lax' as const,
      secure: editorBaseUrl.startsWith('https:'),
    },
  }
}

export function authorizeRin5InternalRequest(headers: Headers, configuredSecret: string | undefined): boolean {
  if (!configuredSecret || configuredSecret.length < 32) return false
  const header = headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(configuredSecret, 'utf8')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function parseSiteId(value: unknown, configuredSiteId: string | undefined): { record: Record<string, unknown>; siteId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('rin5_export_request_invalid')
  const record = value as Record<string, unknown>
  const siteId = record.siteId
  if (typeof siteId !== 'string' || !UUID.test(siteId)) throw new Error('rin5_export_request_invalid')
  if (!configuredSiteId || !UUID.test(configuredSiteId)) throw new Error('rin5_instance_site_not_configured')
  if (siteId !== configuredSiteId) throw new Error('rin5_site_mismatch')
  return { record, siteId }
}

export function parseRin5ExportRequest(value: unknown, configuredSiteId: string | undefined): {
  actorUserId: string; requestId: string; siteId: string; sourceRevisionId: string
} {
  const { record, siteId } = parseSiteId(value, configuredSiteId)
  const actorUserId = record.actorUserId
  const requestId = record.requestId
  const sourceRevisionId = record.sourceRevisionId
  if (typeof actorUserId !== 'string' || !UUID.test(actorUserId)
    || typeof requestId !== 'string' || !UUID.test(requestId)
    || typeof sourceRevisionId !== 'string' || !UUID.test(sourceRevisionId)) {
    throw new Error('rin5_export_request_invalid')
  }
  return { actorUserId, requestId, siteId, sourceRevisionId }
}

export function parseRin5HandoffRequest(value: unknown, configuredSiteId: string | undefined): {
  destination: Rin5HandoffDestination
  email: string
  embed: boolean
  siteId: string
} {
  const { record, siteId } = parseSiteId(value, configuredSiteId)
  const emailValue = record.email
  if (typeof emailValue !== 'string') throw new Error('rin5_handoff_request_invalid')
  const email = emailValue.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('rin5_handoff_request_invalid')
  }
  const { destination } = parseRin5HandoffDestination(record.destination)
  const embed = parseRin5HandoffEmbed(record.embed)
  return { destination, email, embed, siteId }
}

export function parseRin5EditorBaseUrl(value: string | undefined): string {
  try {
    if (!value) throw new Error('missing')
    const url = new URL(value)
    const localHttpHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.localhost$/.test(url.hostname)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHttpHost))) {
      throw new Error('unsafe')
    }
    return url.origin
  } catch {
    throw new Error('rin5_editor_base_url_invalid')
  }
}
