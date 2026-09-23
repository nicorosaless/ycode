import assert from 'node:assert/strict'
import test from 'node:test'

import { parseStoredExportSnapshot } from './rin5-export-snapshot-codec'

const identity = {
  actorUserId: '223e4567-e89b-42d3-a456-426614174000',
  requestId: '323e4567-e89b-42d3-a456-426614174000',
  siteId: '423e4567-e89b-42d3-a456-426614174000',
  sourceRevisionId: '523e4567-e89b-42d3-a456-426614174000',
}

test('stored export snapshots are bound to both request and source revision', () => {
  const stored = JSON.stringify({ ...identity, files: [], manifest: [], job: { status: 'completed' } })
  assert.equal(parseStoredExportSnapshot(stored, identity).requestId, identity.requestId)
  assert.throws(
    () => parseStoredExportSnapshot(stored, { ...identity, requestId: '623e4567-e89b-42d3-a456-426614174000' }),
    /rin5_export_snapshot_identity_mismatch/,
  )
})

test('stored export snapshots reject malformed data', () => {
  assert.throws(() => parseStoredExportSnapshot('{}', identity), /rin5_export_snapshot_invalid/)
  assert.throws(() => parseStoredExportSnapshot('not-json', identity), /rin5_export_snapshot_invalid/)
})
