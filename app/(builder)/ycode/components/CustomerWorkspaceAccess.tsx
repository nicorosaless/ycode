'use client'

import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'
import { canEditStructure, type UserRole } from '@/lib/roles'

export function StructureEditorOnly({ children, role }: { children: ReactNode; role: UserRole }) {
  return canEditStructure(role) ? children : null
}

type Rin5CustomerLocalizationNavProps = Readonly<{
  active: boolean
  enabled: boolean
  onSelect: () => void
}>

export function Rin5CustomerLocalizationNav({
  active,
  enabled,
  onSelect,
}: Rin5CustomerLocalizationNavProps) {
  if (!enabled) return null

  return (
    <Button
      aria-label="Idiomas"
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      onClick={onSelect}
    >
      <Icon name="globe" />
      <span className="hidden lg:inline">Idiomas</span>
    </Button>
  )
}
