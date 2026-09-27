import { LOCALES } from '@/lib/localisation-utils'

const LOCALE_LABELS = new Map(LOCALES.map((locale) => [locale.code, locale.label]))

/**
 * The name of a site language as the rin5 customer reads it: "Inglés", not
 * "English". Only the stock English name is replaced; a name the site owner
 * typed themselves stays as they wrote it.
 */
export function customerLocaleLabel(locale: Readonly<{ code: string; label: string }>, spanish: boolean): string {
  if (!spanish || LOCALE_LABELS.get(locale.code) !== locale.label) return locale.label
  try {
    const name = new Intl.DisplayNames(['es'], { type: 'language' }).of(locale.code)
    return name ? name.charAt(0).toLocaleUpperCase('es') + name.slice(1) : locale.label
  } catch {
    return locale.label
  }
}
