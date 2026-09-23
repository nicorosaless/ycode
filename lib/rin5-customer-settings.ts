import { z } from 'zod'

export const RIN5_CUSTOMER_SETTING_KEYS = [
  'site_name',
  'site_description',
  'timezone',
  'favicon_asset_id',
  'web_clip_asset_id',
] as const

const optionalAssetId = z.string().uuid().nullable()
const timezone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}, 'Invalid IANA timezone')

const rin5CustomerSettingsSchema = z.object({
  site_name: z.string().trim().min(1).max(255).optional(),
  site_description: z.string().trim().max(500).optional(),
  timezone: timezone.optional(),
  favicon_asset_id: optionalAssetId.optional(),
  web_clip_asset_id: optionalAssetId.optional(),
}).strict().refine((settings) => Object.keys(settings).length > 0, 'At least one setting is required')

export type Rin5CustomerSettings = z.infer<typeof rin5CustomerSettingsSchema>

export function parseRin5CustomerSettings(value: unknown): Rin5CustomerSettings {
  return rin5CustomerSettingsSchema.parse(value)
}
