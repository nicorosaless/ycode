import assert from 'node:assert/strict'
import test from 'node:test'
import { draftDigest, validateDraftRestore } from './rin5-draft-history-codec'
const rows = [{ id: 'a', page_id: 'p', layers: [{ text: 'antes' }], content_hash: 'h', generated_css: null }]
test('restore detects an edit since confirmation', () => {
  assert.throws(() => validateDraftRestore(rows, rows, 'stale'), /draft_conflict/)
  assert.doesNotThrow(() => validateDraftRestore(rows, rows, draftDigest(rows)))
})
test('restore refuses a changed set of pages instead of partial recovery', () => {
  assert.throws(() => validateDraftRestore(rows, [{ ...rows[0], page_id: 'other' }], draftDigest(rows)), /structure_changed/)
})
