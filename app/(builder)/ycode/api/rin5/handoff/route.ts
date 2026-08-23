import { NextRequest, NextResponse } from 'next/server'

import { getSupabaseAdmin } from '@/lib/supabase-server'
import { authorizeRin5InternalRequest, parseRin5HandoffRequest } from '@/lib/rin5-internal-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  if (!authorizeRin5InternalRequest(request.headers, process.env.RIN5_INTERNAL_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { email, siteId } = parseRin5HandoffRequest(await request.json(), process.env.RIN5_SITE_ID)
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

    const origin = new URL(request.url).origin
    const link = await admin.auth.admin.generateLink({
      email,
      options: { redirectTo: `${origin}/ycode` },
      type: 'magiclink',
    })
    if (link.error || !link.data.properties?.action_link) throw link.error ?? new Error('Magic link was not generated')

    return NextResponse.json(
      { actionLink: link.data.properties.action_link, siteId },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
