import { translateCustomerCopy, type CustomerCopyKey } from './rin5-customer-copy'

/**
 * The fields Ycode creates with every collection are stored with their English
 * names (stores/useCollectionsStore.ts), in every mode. The rin5 customer reads
 * them in Spanish; that happens here, when they are drawn, and only while the
 * field still carries its stock name. A field the owner renamed shows as named.
 */
const BUILT_IN_FIELD_NAMES: Readonly<Record<string, CustomerCopyKey>> = {
  id: 'ID',
  status: 'Status',
  name: 'Name',
  slug: 'Slug',
  created_at: 'Created Date',
  updated_at: 'Updated Date',
}

export function customerFieldName(field: Readonly<{ key?: string | null; name: string }>, spanish: boolean): string {
  const stock = field.key ? BUILT_IN_FIELD_NAMES[field.key] : undefined
  return spanish && stock && field.name === stock ? translateCustomerCopy(stock, true) : field.name
}
