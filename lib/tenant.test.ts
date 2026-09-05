import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  isEmailAllowed,
  resolveAllowedEmails,
  resolveDbSchema,
  resolveStoragePrefix,
  tenantStoragePath,
} from './tenant'

describe('tenant boundary — database schema', () => {
  it('defaults to public when RIN5_DB_SCHEMA is unset', () => {
    assert.equal(resolveDbSchema({}), 'public')
    assert.equal(resolveDbSchema({ RIN5_DB_SCHEMA: '  ' }), 'public')
  })

  it('takes the configured schema', () => {
    assert.equal(resolveDbSchema({ RIN5_DB_SCHEMA: 'cliente_a' }), 'cliente_a')
    assert.equal(resolveDbSchema({ RIN5_DB_SCHEMA: ' Cliente_A ' }), 'cliente_a')
  })

  it('rejects anything that is not a plain identifier', () => {
    for (const bad of ['cliente-a', 'public; drop schema public', '1cliente', 'a'.repeat(64), 'cliente a']) {
      assert.throws(() => resolveDbSchema({ RIN5_DB_SCHEMA: bad }), /rin5_db_schema_invalid/, bad)
    }
  })
})

describe('tenant boundary — storage prefix', () => {
  it('has no prefix on the default single-tenant install', () => {
    assert.equal(resolveStoragePrefix({}), '')
    assert.equal(tenantStoragePath('website/1-abc.jpg', {}), 'website/1-abc.jpg')
  })

  it('follows the schema when no explicit prefix is set', () => {
    const env = { RIN5_DB_SCHEMA: 'cliente_a' }
    assert.equal(resolveStoragePrefix(env), 'cliente_a')
    assert.equal(tenantStoragePath('website/1-abc.jpg', env), 'cliente_a/website/1-abc.jpg')
  })

  it('lets the prefix be set independently of the schema', () => {
    const env = { RIN5_DB_SCHEMA: 'cliente_a', RIN5_STORAGE_PREFIX: 'autoescuela-7' }
    assert.equal(resolveStoragePrefix(env), 'autoescuela-7')
    assert.equal(tenantStoragePath('/website/x.jpg', env), 'autoescuela-7/website/x.jpg')
  })

  it('rejects a prefix that could escape its own folder', () => {
    for (const bad of ['../otro', 'a/b', 'cliente a', '.hidden']) {
      assert.throws(() => resolveStoragePrefix({ RIN5_STORAGE_PREFIX: bad }), /rin5_storage_prefix_invalid/, bad)
    }
  })
})

describe('tenant boundary — allowed emails', () => {
  it('allows everyone when the list is unset (single-tenant install)', () => {
    assert.equal(resolveAllowedEmails({}), null)
    assert.equal(isEmailAllowed('anyone@example.com', null), true)
  })

  it('parses a comma or whitespace separated list, normalized', () => {
    assert.deepEqual(
      resolveAllowedEmails({ RIN5_ALLOWED_EMAILS: ' Ana@Example.com, bob@example.com\ncarol@example.com ' }),
      ['ana@example.com', 'bob@example.com', 'carol@example.com'],
    )
  })

  it('admits only the listed emails', () => {
    const allowed = resolveAllowedEmails({ RIN5_ALLOWED_EMAILS: 'ana@example.com' })
    assert.equal(isEmailAllowed(' ANA@example.com ', allowed), true)
    assert.equal(isEmailAllowed('bob@example.com', allowed), false)
    assert.equal(isEmailAllowed(undefined, allowed), false)
    assert.equal(isEmailAllowed(null, allowed), false)
  })

  it('locks the container out when the list is set but empty', () => {
    const allowed = resolveAllowedEmails({ RIN5_ALLOWED_EMAILS: '  ,  ' })
    assert.deepEqual(allowed, [])
    assert.equal(isEmailAllowed('ana@example.com', allowed), false)
  })
})
