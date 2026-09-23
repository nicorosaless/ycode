import { getKnexClient } from '@/lib/knex-client'
import { draftDigest, validateDraftRestore, type DraftLayerRow } from './rin5-draft-history-codec'
import type { Rin5ExportIdentity } from './rin5-export-snapshot-codec'
export const DRAFT_COLUMNS = ['id', 'page_id', 'layers', 'content_hash', 'generated_css']

export async function restoreDraftSnapshot(identity: Rin5ExportIdentity, expectedDigest?: string) {
  const db = await getKnexClient()
  return db.transaction(async trx => {
    await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`rin5-export:${identity.siteId}`])
    const saved = await trx('rin5_export_snapshots').where({ source_revision_id: identity.sourceRevisionId, site_id: identity.siteId, actor_user_id: identity.actorUserId, status: 'completed' }).first('draft_layers')
    if (!Array.isArray(saved?.draft_layers)) throw new Error('draft_snapshot_unavailable')
    const current: DraftLayerRow[] = await trx('page_layers').select(DRAFT_COLUMNS).where({ is_published: false }).whereNull('deleted_at').orderBy('id')
    if (!expectedDigest) return { status: 'available', digest: draftDigest(current) }
    const replay = await trx('rin5_draft_restores').where({ request_id: identity.requestId }).first()
    if (replay) {
      if (replay.actor_user_id !== identity.actorUserId || replay.source_revision_id !== identity.sourceRevisionId || replay.expected_digest !== expectedDigest) throw new Error('draft_restore_identity_conflict')
      return { status: 'restored' }
    }
    validateDraftRestore(current, saved.draft_layers, expectedDigest)
    for (const row of saved.draft_layers as DraftLayerRow[]) {
      await trx('page_layers').where({ id: row.id, page_id: row.page_id, is_published: false }).update({ layers: JSON.stringify(row.layers), content_hash: row.content_hash, generated_css: row.generated_css, updated_at: trx.fn.now() })
    }
    await trx('rin5_draft_restores').insert({ request_id: identity.requestId, actor_user_id: identity.actorUserId, source_revision_id: identity.sourceRevisionId, expected_digest: expectedDigest })
    return { status: 'restored' }
  })
}
