const INTERNAL_URL_ERROR = 'SUPABASE_INTERNAL_URL must be an HTTP(S) origin without credentials, path, query, or fragment'

export function parseSupabaseInternalOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(INTERNAL_URL_ERROR)
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error(INTERNAL_URL_ERROR)
  }

  return url.origin
}

function rewriteRequestOrigin(input: RequestInfo | URL, canonicalOrigin: string, internalOrigin: string): RequestInfo | URL {
  const inputUrl = new URL(input instanceof Request ? input.url : input.toString())
  if (inputUrl.origin !== canonicalOrigin) return input

  const internalUrl = new URL(internalOrigin)
  internalUrl.pathname = inputUrl.pathname
  internalUrl.search = inputUrl.search
  internalUrl.hash = inputUrl.hash

  return input instanceof Request
    ? new Request(internalUrl, input)
    : internalUrl
}

export function createSupabaseServerFetch(
  canonicalProjectUrl: string,
  internalUrl = process.env.SUPABASE_INTERNAL_URL,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  if (!internalUrl) return fetchImpl

  const canonicalOrigin = new URL(canonicalProjectUrl).origin
  const internalOrigin = parseSupabaseInternalOrigin(internalUrl)

  return (input, init) => fetchImpl(
    rewriteRequestOrigin(input, canonicalOrigin, internalOrigin),
    init,
  )
}
