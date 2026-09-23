import type { Knex } from 'knex'

import { resolveDbSchema } from '@/lib/tenant'

export async function up(knex: Knex): Promise<void> {
  if (resolveDbSchema() === 'public') return
  const value = {
    enabled: true,
    frameOptions: 'SAMEORIGIN',
    contentTypeOptions: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: 'camera=(), microphone=()',
    contentSecurityPolicy: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; connect-src 'self' https: wss:; frame-src 'self' https:",
    strictTransportSecurity: '',
  }
  await knex('settings').insert({ key: 'security_headers', value: JSON.stringify(value) }).onConflict('key').ignore()
}

export async function down(): Promise<void> {
  throw new Error('tenant_security_headers_migration_is_irreversible')
}
