'use client'

import { useRef, useState } from 'react'
import {
  BarChart3,
  ChevronDown,
  Database,
  Eye,
  EyeOff,
  Languages,
  LifeBuoy,
  LogOut,
  PenLine,
  Rocket,
  Settings,
  User,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Rin5Navigation } from '@/lib/rin5-navigation'

import { Rin5ChecklistButton } from './Rin5Onboarding'
import styles from './rin5-workspace.module.css'

/**
 * The top bar of a rin5 customer's editor: this bar is the navigation of the
 * whole product. Canvas, Contenido and Idiomas switch inside the editor;
 * Estadísticas, Ajustes, Publicar, Ayuda and the account are pages of rin5.
 */

export type Rin5WorkspaceTab = 'canvas' | 'cms' | 'localization'
export type Rin5SaveState = 'saving' | 'unsaved' | 'saved' | 'idle'

type Rin5WorkspaceHeaderProps = {
  navigation: Rin5Navigation
  active: Rin5WorkspaceTab | null
  onSelect: (tab: Rin5WorkspaceTab) => void
  saveState: Rin5SaveState
  previewing: boolean
  previewDisabled: boolean
  onTogglePreview: () => void
  /** Flushes the draft before leaving for rin5's publish flow. */
  beforePublish: () => Promise<void>
  userEmail: string | null
  onSignOut: () => Promise<void>
}

const TABS: ReadonlyArray<{ id: Rin5WorkspaceTab; label: string; Icon: typeof PenLine }> = [
  { id: 'canvas', label: 'Canvas', Icon: PenLine },
  { id: 'cms', label: 'Contenido', Icon: Database },
  { id: 'localization', label: 'Idiomas', Icon: Languages },
]

const SAVE_COPY: Record<Rin5SaveState, string> = {
  saving: 'Guardando…',
  unsaved: 'Cambios sin guardar',
  saved: 'Guardado',
  idle: 'Guardado',
}

export function Rin5WorkspaceHeader({
  navigation,
  active,
  onSelect,
  saveState,
  previewing,
  previewDisabled,
  onTogglePreview,
  beforePublish,
  userEmail,
  onSignOut,
}: Rin5WorkspaceHeaderProps) {
  const [publishing, setPublishing] = useState(false)
  const logoutForm = useRef<HTMLFormElement>(null)
  const current = TABS.find((tab) => tab.id === active) ?? TABS[0]

  async function publish(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    setPublishing(true)
    try {
      await beforePublish()
    } finally {
      window.location.assign(navigation.publishUrl)
    }
  }

  async function signOut() {
    // The editor session first, then rin5's: leaving one open would bring the
    // customer straight back in on the next visit.
    try { await onSignOut() } finally { logoutForm.current?.submit() }
  }

  return (
    <header className={styles.header}>
      <span className={styles.brand} aria-label="rin5">rin5</span>

      <span className={styles.wide}>
        <span className={styles.divider} aria-hidden />
        <nav className={styles.tabs} aria-label="Tu web">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={styles.tab}
              aria-current={active === id ? 'page' : undefined}
              onClick={() => onSelect(id)}
            >
              <Icon aria-hidden />
              {label}
            </button>
          ))}
          <a className={styles.tab} href={navigation.analyticsUrl}>
            <BarChart3 aria-hidden />
            Estadísticas
          </a>
        </nav>
      </span>

      <span className={styles.narrow}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={styles.tab} aria-current="page" aria-label={`Sección: ${current.label}. Cambiar de sección`}>
              <current.Icon aria-hidden />
              {current.label}
              <ChevronDown aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={styles.menu}>
            {TABS.map(({ id, label, Icon }) => (
              <DropdownMenuItem key={id} className={styles.menuItem} data-active={active === id} onSelect={() => onSelect(id)}>
                <Icon aria-hidden />{label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild className={styles.menuItem}>
              <a href={navigation.analyticsUrl}><BarChart3 aria-hidden />Estadísticas</a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={styles.menuItem} disabled={previewDisabled} onSelect={onTogglePreview}>
              {previewing ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {previewing ? 'Salir de la vista previa' : 'Vista previa'}
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={styles.menuItem}>
              <a href={navigation.settingsUrl}><Settings aria-hidden />Ajustes</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>

      <span className={styles.spacer} />

      <div className={styles.actions}>
        <Rin5ChecklistButton navigation={navigation} />
        <span className={styles.wide}>
          <span className={styles.saveState} data-state={saveState} role="status" aria-live="polite">{SAVE_COPY[saveState]}</span>
          <button
            type="button"
            className={`${styles.quiet} ${styles.iconButton}`}
            onClick={onTogglePreview}
            disabled={previewDisabled}
            aria-pressed={previewing}
            aria-label={previewing ? 'Salir de la vista previa' : 'Vista previa'}
            title={previewing ? 'Salir de la vista previa' : 'Vista previa'}
          >
            {previewing ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </button>
          <a className={styles.quiet} href={navigation.settingsUrl}>
            <Settings aria-hidden />
            <span className={styles.quietLabel}>Ajustes</span>
          </a>
        </span>
        <a
          className={styles.primary}
          href={navigation.publishUrl}
          onClick={(event) => void publish(event)}
          aria-busy={publishing}
          data-rin5-tour="publish"
        >
          <Rocket aria-hidden />
          Publicar
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={styles.avatar} aria-label="Tu cuenta">
              {(userEmail ?? '?').slice(0, 1)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={styles.menu}>
            <div className={styles.menuHeader}>
              <p className={styles.menuLabel}>Tu cuenta</p>
              {userEmail && <p className={styles.menuEmail}>{userEmail}</p>}
            </div>
            <DropdownMenuItem asChild className={styles.menuItem}>
              <a href={navigation.accountUrl}><User aria-hidden />Perfil y suscripción</a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className={styles.menuItem}>
              <a href={navigation.helpUrl}><LifeBuoy aria-hidden />Ayuda</a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={styles.menuItem} onSelect={() => void signOut()}>
              <LogOut aria-hidden />Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <form ref={logoutForm} method="post" action={navigation.logoutUrl} hidden />
      </div>
    </header>
  )
}
