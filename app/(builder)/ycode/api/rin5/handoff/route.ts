import { NextRequest, NextResponse } from 'next/server'

import { getSupabaseAdmin } from '@/lib/supabase-server'
import { authorizeRin5InternalRequest, parseRin5EditorBaseUrl, parseRin5HandoffRequest } from '@/lib/rin5-internal-auth'
import { isEmailAllowed, resolveAllowedEmails } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  if (!authorizeRin5InternalRequest(request.headers, process.env.RIN5_INTERNAL_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { email, siteId } = parseRin5HandoffRequest(await request.json(), process.env.RIN5_SITE_ID)
    // The handoff is what mints the session, so this is where a foreign email
    // has to be stopped: creating the GoTrue user first would leave a valid
    // account for another client's site behind even on a rejected request.
    if (!isEmailAllowed(email, resolveAllowedEmails())) {
      return NextResponse.json(
        { error: 'rin5_email_not_allowed_for_this_site' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const editorBaseUrl = parseRin5EditorBaseUrl(process.env.RIN5_EDITOR_BASE_URL)
    const admin = await getSupabaseAdmin()
    if (!admin) throw new Error('Supabase admin is not configured')

    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listed.error) throw listed.error
    let user = listed.data.users.find((candidate) => candidate.email?.toLowerCase() === email)
    if (!user) {
      const created = await admin.auth.admin.createUser({
        app_metadata: { role: 'editor' },
        email,
        email_confirm: true,
      })
      if (created.error) throw created.error
      user = created.data.user
    } else if (!['owner', 'admin'].includes(String(user.app_metadata?.role))) {
      const updated = await admin.auth.admin.updateUserById(user.id, {
        app_metadata: { ...user.app_metadata, role: 'editor' },
      })
      if (updated.error) throw updated.error
    }

    const link = await admin.auth.admin.generateLink({
      email,
      options: { redirectTo: `${editorBaseUrl}/ycode` },
      type: 'magiclink',
    })
    if (link.error || !link.data.properties?.hashed_token) throw link.error ?? new Error('Magic link was not generated')

    const actionLink = new URL('/ycode/api/auth/confirm', editorBaseUrl)
    actionLink.searchParams.set('token_hash', link.data.properties.hashed_token)
    actionLink.searchParams.set('type', 'magiclink')

    return NextResponse.json(
      { actionLink: actionLink.toString(), siteId },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
