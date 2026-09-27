import { useMemo } from 'react'
import { create } from 'zustand'

import { RIN5_CUSTOMER_COPY_ES } from './rin5-customer-copy-es'

/**
 * Spanish for the rin5 customer workspace.
 *
 * Ycode has no i18n and its standard mode stays in English. A rin5 customer
 * (the content-only editor role inside a rin5 container) is a Spanish business
 * owner, so every surface they can reach reads its copy through here.
 *
 * The key is the exact English text of the call site. Outside the customer
 * workspace `copy(key)` returns that text, so the standard editor renders
 * exactly what it rendered before. `{name}` placeholders are filled from
 * `vars` in both languages. When one English word means two things, the key
 * carries a context after `|` ("Phone|viewport"); the English shown is the
 * part before it. Only interface copy goes through here, never the
 * customer's own data (page names, file names, CMS values).
 */

export type CustomerCopyKey = keyof typeof RIN5_CUSTOMER_COPY_ES
export type CustomerCopyVars = Readonly<Record<string, string | number>>
export type CustomerCopy = (key: CustomerCopyKey, vars?: CustomerCopyVars) => string

const PLACEHOLDER = /\{(\w+)\}/g

function fill(template: string, vars: CustomerCopyVars | undefined): string {
  if (!vars) return template
  return template.replace(PLACEHOLDER, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

/** The copy for `key`: Spanish inside the customer workspace, the original English elsewhere. */
export function translateCustomerCopy(key: CustomerCopyKey, spanish: boolean, vars?: CustomerCopyVars): string {
  return fill(spanish ? RIN5_CUSTOMER_COPY_ES[key] : englishOf(key), vars)
}

function englishOf(key: string): string {
  const context = key.indexOf('|')
  return context === -1 ? key : key.slice(0, context)
}

/**
 * For labels built elsewhere that are sometimes interface copy and sometimes
 * the customer's own words (a layer is "Heading" unless someone renamed it).
 * Known copy is translated; anything else is returned untouched.
 */
export function translateKnownCustomerCopy(text: string, spanish: boolean): string {
  return spanish && Object.hasOwn(RIN5_CUSTOMER_COPY_ES, text)
    ? RIN5_CUSTOMER_COPY_ES[text as CustomerCopyKey]
    : text
}

/** The placeholders of a template, sorted, so a translation cannot drop or invent one. */
export function customerCopyPlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]).sort()
}

type Rin5CustomerModeState = { active: boolean }

/**
 * Whether this browser is showing the rin5 customer workspace. Set once by the
 * builder from the role and the rin5 navigation; read by components through
 * `useCustomerCopy` and by stores and toasts through `customerCopy`.
 */
export const useRin5CustomerMode = create<Rin5CustomerModeState>(() => ({ active: false }))

export function setRin5CustomerMode(active: boolean): void {
  if (useRin5CustomerMode.getState().active !== active) useRin5CustomerMode.setState({ active })
}

/**
 * Reactive copy for components: re-renders when the workspace mode is known.
 * The function is stable while the mode does not change, so it can sit in the
 * dependencies of a memo or an effect.
 */
export function useCustomerCopy(): CustomerCopy {
  const active = useRin5CustomerMode((state) => state.active)
  return useMemo<CustomerCopy>(() => (key, vars) => translateCustomerCopy(key, active, vars), [active])
}

/** Copy outside React (toasts from stores and handlers), read at call time. */
export const customerCopy: CustomerCopy = (key, vars) =>
  translateCustomerCopy(key, useRin5CustomerMode.getState().active, vars)
