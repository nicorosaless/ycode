import { NextRequest, NextResponse } from 'next/server'

import { exportSite } from '@/lib/apps/static-export'
import type { OutputFile } from '@/lib/apps/static-export/writers/types'
import { authorizeRin5InternalRequest, parseRin5ExportRequest } from '@/lib/rin5-internal-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_EXPORT_BYTES = 75 * 1024 * 1024

export async function POST(request: NextRequest) {
  if (!authorizeRin5InternalRequest(request.headers, process.env.RIN5_INTERNAL_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { siteId } = parseRin5ExportRequest(await request.json(), process.env.RIN5_SITE_ID)
    let files: readonly OutputFile[] = []
    const job = await exportSite(undefined, [{
      name: 'rin5',
      async flush(outputs) {
        const totalBytes = outputs.reduce(
          (total, file) => total + (typeof file.body === 'string' ? Buffer.byteLength(file.body) : file.body.byteLength),
          0,
        )
        if (totalBytes > MAX_EXPORT_BYTES) throw new Error('rin5_export_too_large')
        files = outputs
        return outputs.length
      },
    }])
    if (job.status !== 'completed') {
      return NextResponse.json({ error: job.error ?? 'Export failed' }, { status: 422 })
    }
    return NextResponse.json({
      files: files.map((file) => ({
        bodyBase64: Buffer.from(file.body).toString('base64'),
        contentType: file.contentType,
        path: file.key,
      })),
      job,
      siteId,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
