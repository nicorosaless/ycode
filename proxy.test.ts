import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('the proxy Supabase client uses the server-only internal transport', () => {
  const source = readFileSync('proxy.ts', 'utf8')

  assert.match(source, /global:\s*\{\s*fetch:\s*createSupabaseServerFetch\(config\.url\)\s*\}/)
})
