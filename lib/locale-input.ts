import { z } from 'zod'

const localeFields = {
  code: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
  label: z.string().trim().min(1).max(255),
  is_default: z.boolean(),
}

const createLocaleSchema = z.object({
  code: localeFields.code,
  label: localeFields.label,
  is_default: localeFields.is_default.optional(),
}).strict()

const updateLocaleSchema = z.object({
  code: localeFields.code.optional(),
  label: localeFields.label.optional(),
  is_default: localeFields.is_default.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one update is required')

export function parseCreateLocale(value: unknown) {
  return createLocaleSchema.parse(value)
}

export function parseUpdateLocale(value: unknown) {
  return updateLocaleSchema.parse(value)
}
