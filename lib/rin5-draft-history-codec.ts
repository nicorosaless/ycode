import { createHash } from 'node:crypto'

export interface DraftLayerRow {
  id: string
  page_id: string
  layers: unknown
  content_hash: string | null
  generated_css: string | null
}
export function draftDigest(rows: DraftLayerRow[]): string {
  return createHash('sha256').update(JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)))).digest('hex')
}
export function validateDraftRestore(current: DraftLayerRow[], saved: DraftLayerRow[], expected: string): void {
  if (draftDigest(current) !== expected) throw new Error('draft_conflict')
  const keys = (rows: DraftLayerRow[]) => rows.map(row => `${row.id}:${row.page_id}`).sort().join('|')
  if (!saved.length || keys(current) !== keys(saved)) throw new Error('draft_structure_changed')
}
