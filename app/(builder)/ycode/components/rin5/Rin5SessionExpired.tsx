'use client'

import { useEffect } from 'react'
import { LogIn } from 'lucide-react'

import type { Rin5Navigation } from '@/lib/rin5-navigation'

import styles from './rin5-workspace.module.css'

/**
 * What a rin5 customer sees when the editor has no session: the link from rin5
 * expired or they opened the editor address directly. They never had a
 * password here, so instead of Ycode's login they go back through rin5, which
 * signs them in again. `onPasswordLogin` keeps Ycode's own form one click away
 * for whoever does have a password on this container.
 */
export function Rin5SessionExpired({
  navigation,
  onPasswordLogin,
}: Readonly<{ navigation: Rin5Navigation; onPasswordLogin: () => void }>) {
  useEffect(() => {
    document.documentElement.dataset.rin5Workspace = '1'
    return () => { delete document.documentElement.dataset.rin5Workspace }
  }, [])

  return (
    <div className={styles.scrim}>
      <section
        className={styles.welcome}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rin5-session-title"
      >
        <h1 id="rin5-session-title" className={styles.welcomeTitle}>Vuelve a entrar desde rin5</h1>
        <p className={styles.welcomeLead}>
          Tu sesión en el editor ha caducado. Entra de nuevo desde tu cuenta de rin5 y tu web se abrirá aquí mismo.
        </p>
        <div className={styles.welcomeActions}>
          <a className={styles.primary} href={navigation.dashboardUrl}>
            <LogIn aria-hidden />
            Entrar de nuevo
          </a>
          <button
            type="button" className={styles.quiet}
            onClick={onPasswordLogin}
          >
            Tengo contraseña
          </button>
        </div>
      </section>
    </div>
  )
}
