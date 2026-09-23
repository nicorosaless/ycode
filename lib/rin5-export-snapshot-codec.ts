export const RIN5_EXPORT_BUCKET = 'rin5-internal-exports'

export interface Rin5ExportIdentity {
  actorUserId: string
  requestId: string
  siteId: string
  sourceRevisionId: string
}

export interface StoredExportSnapshot extends Rin5ExportIdentity {
  files: readonly unknown[]
  manifest: readonly unknown[]
  job: { status: string }
}

export function parseStoredExportSnapshot(raw: string, identity: Rin5ExportIdentity): StoredExportSnapshot {
  try {
    const value = JSON.parse(raw) as Partial<StoredExportSnapshot>
    if (!Array.isArray(value.files) || !Array.isArray(value.manifest) || !value.job || typeof value.job.status !== 'string') {
      throw new Error('invalid')
    }
    for (const field of ['actorUserId', 'requestId', 'siteId', 'sourceRevisionId'] as const) {
      if (value[field] !== identity[field]) throw new Error('identity')
    }
    return value as StoredExportSnapshot
  } catch (error) {
    if (error instanceof Error && error.message === 'identity') throw new Error('rin5_export_snapshot_identity_mismatch')
    throw new Error('rin5_export_snapshot_invalid')
  }
}
