import type { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getKnexClient } from '@/lib/knex-client'
import { getSupabaseAdmin } from '@/lib/supabase-server'
import { parseStoredExportSnapshot, RIN5_EXPORT_BUCKET, type Rin5ExportIdentity, type StoredExportSnapshot } from '@/lib/rin5-export-snapshot-codec'
import { DRAFT_COLUMNS } from '@/lib/rin5-draft-history'
import { runWithRin5ExportToken } from '@/lib/rin5-export-context'

export { parseStoredExportSnapshot }
export type { Rin5ExportIdentity, StoredExportSnapshot }

async function downloadSnapshot(objectPath: string, identity: Rin5ExportIdentity): Promise<StoredExportSnapshot | null> {
  const supabase = await getSupabaseAdmin()
  if (!supabase) throw new Error('rin5_export_storage_unavailable')
  const { data, error } = await supabase.storage.from(RIN5_EXPORT_BUCKET).download(objectPath)
  if (error) return null
  return parseStoredExportSnapshot(await data.text(), identity)
}

async function withDatabaseExportLock<T>(siteId: string, operation: (db: Knex) => Promise<T>): Promise<T> {
  const db = await getKnexClient()
  const connection = await db.client.acquireConnection()
  const lockName = `rin5-export:${siteId}`
  try {
    await connection.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockName])
    return await operation(db)
  } finally {
    try {
      await connection.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName])
    } finally {
      await db.client.releaseConnection(connection)
    }
  }
}

/**
 * Bind a caller-owned revision UUID to one immutable export artifact.
 *
 * The database advisory lock is also observed by tenant-table write triggers,
 * so an authenticated edit cannot interleave with publish/export. The completed
 * artifact lives in a service-role-only bucket and survives process restarts.
 */
export async function getOrCreateExportSnapshot<T extends StoredExportSnapshot>(
  identity: Rin5ExportIdentity,
  capture: () => Promise<T>,
): Promise<T> {
  return withDatabaseExportLock(identity.siteId, async (db) => {
    const objectPath = `${identity.siteId}/${identity.sourceRevisionId}.json`
    await db('rin5_export_snapshots')
      .insert({
        actor_user_id: identity.actorUserId,
        object_path: objectPath,
        request_id: identity.requestId,
        site_id: identity.siteId,
        source_revision_id: identity.sourceRevisionId,
        status: 'capturing',
      })
      .onConflict('request_id')
      .ignore()

    const conflicts = await db('rin5_export_snapshots')
      .select('actor_user_id', 'object_path', 'request_id', 'site_id', 'source_revision_id', 'status')
      .where('request_id', identity.requestId)
      .orWhere('source_revision_id', identity.sourceRevisionId)
    if (conflicts.length !== 1) throw new Error('rin5_export_snapshot_identity_conflict')
    const row = conflicts[0]
    if (row.actor_user_id !== identity.actorUserId || row.request_id !== identity.requestId
      || row.site_id !== identity.siteId || row.source_revision_id !== identity.sourceRevisionId
      || row.object_path !== objectPath) {
      throw new Error('rin5_export_snapshot_identity_conflict')
    }

    const existing = await downloadSnapshot(objectPath, identity)
    if (existing) {
      if (row.status !== 'completed') {
        await db('rin5_export_snapshots').where('request_id', identity.requestId).update({ status: 'completed', updated_at: db.fn.now() })
      }
      return existing as T
    }
    if (row.status === 'completed') throw new Error('rin5_export_snapshot_artifact_missing')

    const exportToken = randomUUID()
    await db('rin5_export_snapshots').where('request_id', identity.requestId).update({ lock_token: exportToken, updated_at: db.fn.now() })
    let snapshot: T
    try {
      snapshot = await runWithRin5ExportToken(exportToken, capture)
    } catch (error) {
      await db('rin5_export_snapshots').where('request_id', identity.requestId).update({ lock_token: null, updated_at: db.fn.now() })
      throw error
    }
    const draftLayers = await db('page_layers').select(DRAFT_COLUMNS).where({ is_published: false }).whereNull('deleted_at').orderBy('id')
    await db('rin5_export_snapshots').where('request_id', identity.requestId).update({ draft_layers: JSON.stringify(draftLayers) })
    const encoded = JSON.stringify(snapshot)
    const supabase = await getSupabaseAdmin()
    if (!supabase) throw new Error('rin5_export_storage_unavailable')
    const { error } = await supabase.storage.from(RIN5_EXPORT_BUCKET).upload(objectPath, encoded, {
      contentType: 'application/json',
      upsert: false,
    })
    if (error) {
      const raced = await downloadSnapshot(objectPath, identity)
      if (!raced) throw new Error(`rin5_export_snapshot_store_failed:${error.message}`)
      await db('rin5_export_snapshots').where('request_id', identity.requestId).update({ lock_token: null, status: 'completed', updated_at: db.fn.now() })
      return raced as T
    }
    await db('rin5_export_snapshots').where('request_id', identity.requestId).update({
      manifest: JSON.stringify(snapshot.manifest),
      lock_token: null,
      status: 'completed',
      updated_at: db.fn.now(),
    })
    return snapshot
  })
}
