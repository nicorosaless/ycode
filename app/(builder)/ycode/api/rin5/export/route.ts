import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'

import { exportSite } from '@/lib/apps/static-export'
import type { OutputFile } from '@/lib/apps/static-export/writers/types'
import { authorizeRin5InternalRequest, parseRin5ExportRequest } from '@/lib/rin5-internal-auth'
import { getOrCreateExportSnapshot } from '@/lib/rin5-export-snapshot'

import { POST as publishDraft } from '../../publish/route'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_EXPORT_BYTES = 75 * 1024 * 1024
export async function POST(request: NextRequest) {
  if (!authorizeRin5InternalRequest(request.headers, process.env.RIN5_INTERNAL_API_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const identity = parseRin5ExportRequest(await request.json(), process.env.RIN5_SITE_ID)
    const snapshot = await getOrCreateExportSnapshot(identity, async () => {
      const publishResponse = await publishDraft(new NextRequest(`${new URL(request.url).origin}/ycode/api/publish`, {
        body: JSON.stringify({ publishAll: true }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }))
      if (!publishResponse.ok) {
        const failure = await publishResponse.json().catch(() => null) as { error?: unknown } | null
        const detail = typeof failure?.error === 'string' ? failure.error : `http_${publishResponse.status}`
        throw new Error(`rin5_draft_publish_failed:${detail}`)
      }
      let captured: readonly OutputFile[] = []
      const exportedJob = await exportSite(undefined, [{
        name: 'rin5',
        async flush(outputs) {
          const totalBytes = outputs.reduce(
            (total, file) => total + (typeof file.body === 'string' ? Buffer.byteLength(file.body) : file.body.byteLength),
            0,
          )
          if (totalBytes > MAX_EXPORT_BYTES) throw new Error('rin5_export_too_large')
          captured = [...outputs].sort((left, right) => left.key.localeCompare(right.key))
          return outputs.length
        },
      }])
      if (exportedJob.status !== 'completed') throw new Error(exportedJob.error ?? 'rin5_export_failed')
      const encoded = captured.map((file) => {
        const body = Buffer.from(file.body)
        return { bodyBase64: body.toString('base64'), contentType: file.contentType, path: file.key, sha256: createHash('sha256').update(body).digest('hex'), size: body.byteLength }
      })
      return {
        ...identity,
        files: encoded,
        manifest: encoded.map(({ contentType, path, sha256, size }) => ({ contentType, path, sha256, size })),
        job: exportedJob,
      }
    })
    const { job } = snapshot
    if (job.status !== 'completed') {
      return NextResponse.json({ error: 'Export failed' }, { status: 422 })
    }
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
