import { NextRequest, NextResponse } from 'next/server'
import { authorizeRin5InternalRequest, parseRin5ExportRequest } from '@/lib/rin5-internal-auth'
import { restoreDraftSnapshot } from '@/lib/rin5-draft-history'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest) {
  if (!authorizeRin5InternalRequest(request.headers, process.env.RIN5_INTERNAL_API_SECRET)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    const identity = parseRin5ExportRequest(body, process.env.RIN5_SITE_ID)
    if (body.expectedDigest !== undefined && (typeof body.expectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedDigest))) throw new Error('draft_digest_invalid')
    return NextResponse.json(await restoreDraftSnapshot(identity, body.expectedDigest), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'No se pudo restaurar. La versión no tiene borrador recuperable o el editor ha cambiado.' }, { status: 409 })
  }
}
