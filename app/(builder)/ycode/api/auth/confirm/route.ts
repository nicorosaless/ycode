import type { EmailOtpType } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

import { createRouteClient } from '@/lib/supabase-route-client'
import { parseRin5EditorBaseUrl } from '@/lib/rin5-internal-auth'

export async function GET(request: NextRequest) {
  let editorBaseUrl: string
  try {
    editorBaseUrl = parseRin5EditorBaseUrl(process.env.RIN5_EDITOR_BASE_URL)
  } catch {
    return NextResponse.json({ error: 'Editor handoff is not configured' }, { status: 503 })
  }
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type')
  if (!tokenHash || type !== 'magiclink') return NextResponse.redirect(new URL('/ycode?auth=invalid', editorBaseUrl))

  const supabase = await createRouteClient()
  if (!supabase) return NextResponse.redirect(new URL('/ycode?auth=unavailable', editorBaseUrl))
  const verified = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
  if (verified.error) return NextResponse.redirect(new URL('/ycode?auth=invalid', editorBaseUrl))
  return NextResponse.redirect(new URL('/ycode', editorBaseUrl))
}
