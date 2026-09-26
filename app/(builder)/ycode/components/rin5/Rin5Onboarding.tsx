'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { Check, ImageIcon, Rocket, Type, X } from 'lucide-react'

import { detectRin5ContentChanges, type Rin5ChecklistStepId, type Rin5TourStep } from '@/lib/rin5-onboarding'
import type { Rin5Navigation } from '@/lib/rin5-navigation'
import { usePagesStore } from '@/stores/usePagesStore'

import styles from './rin5-workspace.module.css'
import { useRin5Onboarding } from './useRin5Onboarding'

/**
 * The welcome of a rin5 customer, inside the editor: a welcome screen over
 * their site, tooltips that move on when the customer actually does the thing,
 * and a first-steps checklist that ticks itself from real state.
 */

const STEP_COPY: Record<Rin5ChecklistStepId, { label: string; hint?: string }> = {
  linked: { label: 'Vincula tu web a tu cuenta' },
  trial: { label: 'Empieza la prueba de 14 días' },
  text: { label: 'Cambia un texto', hint: 'Haz doble clic en cualquier texto de tu web y escribe.' },
  image: { label: 'Cambia una foto', hint: 'Haz doble clic en una foto y elige otra, o sube la tuya.' },
  published: { label: 'Publica tu primer cambio', hint: 'Hasta que publicas, nadie ve tus cambios.' },
  domain: { label: 'Conecta tu dominio', hint: 'Tu web en tu propia dirección, sin cambiar de proveedor.' },
}

const TOUR: Record<Rin5TourStep, { index: number; title: string; body: string; anchor: string }> = {
  text: {
    index: 0,
    title: 'Cambia un texto',
    body: 'Haz doble clic en cualquier texto de tu web y escribe encima. Se guarda solo.',
    anchor: '[data-rin5-tour="canvas"]',
  },
  image: {
    index: 1,
    title: 'Cambia una foto',
    body: 'Haz doble clic en una foto de tu web y elige otra, o sube la tuya.',
    anchor: '[data-rin5-tour="canvas"]',
  },
  publish: {
    index: 2,
    title: 'Publica cuando quieras',
    body: 'Tus cambios están guardados, pero nadie los ve todavía. Pulsa Publicar para ponerlos en tu web.',
    anchor: '[data-rin5-tour="publish"]',
  },
}

/** Loads the state once and keeps watching the drafts for the tour's facts. */
export function Rin5Onboarding() {
  const load = useRin5Onboarding((state) => state.load)
  const loaded = useRin5Onboarding((state) => state.loaded)
  const view = useRin5Onboarding((state) => state.view)

  useEffect(() => {
    // Marks the root so the rin5 palette applies to every portal as well.
    document.documentElement.dataset.rin5Workspace = '1'
    void load()
    return () => { delete document.documentElement.dataset.rin5Workspace }
  }, [load])

  useContentWatcher()

  if (!loaded || !view.enabled) return null
  if (view.welcome) return <Rin5Welcome />
  if (view.tour) return <Rin5TourTip step={view.tour} />
  return null
}

/**
 * A text or a photo changed in a page the customer already had open. Only
 * while that fact is still missing: once rin5 has it, nothing is watched.
 */
function useContentWatcher() {
  const view = useRin5Onboarding((state) => state.view)
  const mark = useRin5Onboarding((state) => state.mark)
  const textDone = view.enabled ? view.steps.find((step) => step.id === 'text')?.done ?? true : true
  const imageDone = view.enabled ? view.steps.find((step) => step.id === 'image')?.done ?? true : true

  useEffect(() => {
    if (textDone && imageDone) return
    return usePagesStore.subscribe((state, previous) => {
      if (state.draftsByPageId === previous.draftsByPageId) return
      for (const [pageId, draft] of Object.entries(state.draftsByPageId)) {
        const before = previous.draftsByPageId[pageId]
        if (!before || before === draft) continue
        const changed = detectRin5ContentChanges(before.layers, draft.layers)
        if (changed.text && !textDone) void mark('text_changed')
        if (changed.image && !imageDone) void mark('image_changed')
      }
    })
  }, [textDone, imageDone, mark])
}

function Rin5Welcome() {
  const mark = useRin5Onboarding((state) => state.mark)
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    await mark('welcome_seen')
  }

  async function explore() {
    setBusy(true)
    await mark('welcome_seen')
    await mark('tour_finished')
  }

  return (
    <div className={styles.scrim}>
      <section className={styles.welcome} role="dialog" aria-modal="true" aria-labelledby="rin5-welcome-title">
        <span className={styles.pill}>Tu prueba de 14 días ha empezado</span>
        <h1 id="rin5-welcome-title" className={styles.welcomeTitle}>Esta es tu web. Ya puedes cambiarla.</h1>
        <p className={styles.welcomeLead}>Todo lo que ves se edita aquí mismo. Te enseñamos lo básico en tres pasos.</p>
        <ol className={styles.welcomeSteps}>
          <li className={styles.welcomeStep}><Type aria-hidden />Cambia un texto</li>
          <li className={styles.welcomeStep}><ImageIcon aria-hidden />Cambia una foto</li>
          <li className={styles.welcomeStep}><Rocket aria-hidden />Publica tus cambios</li>
        </ol>
        <p className={styles.welcomeNote}>Tus cambios se guardan solos. Nadie los ve hasta que publicas.</p>
        <div className={styles.welcomeActions}>
          <button type="button" className={styles.primary} onClick={() => void start()} aria-busy={busy} autoFocus>
            Empezar
          </button>
          <button type="button" className={styles.quiet} onClick={() => void explore()} disabled={busy}>
            Lo haré por mi cuenta
          </button>
        </div>
      </section>
    </div>
  )
}

type Placement = { top: number; left: number; arrowLeft: number; side: 'below' | 'above'; pulse: DOMRect | null }

const TIP_WIDTH = 300

function place(step: Rin5TourStep): Placement | null {
  // While the file manager or any other dialog is open, the tip would cover it.
  if (document.querySelector('[role="dialog"][data-state="open"]')) return null
  const anchor = document.querySelector(TOUR[step].anchor)
  if (!anchor) return null
  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  const viewport = window.innerWidth
  const width = Math.min(TIP_WIDTH, viewport - 16)
  if (step === 'publish') {
    const left = Math.max(8, Math.min(rect.right - width, viewport - width - 8))
    return { top: rect.bottom + 14, left, arrowLeft: Math.min(width - 24, Math.max(12, rect.left + rect.width / 2 - left - 6)), side: 'below', pulse: rect }
  }
  // Canvas steps: the tip sits over the lower part of the page, pointing up
  // into it, so it never covers the text the customer is about to edit.
  const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, viewport - width - 8))
  const top = Math.max(rect.top + 64, rect.bottom - 220)
  return { top, left, arrowLeft: width / 2 - 6, side: 'below', pulse: null }
}

function Rin5TourTip({ step }: { step: Rin5TourStep }) {
  const mark = useRin5Onboarding((state) => state.mark)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useLayoutEffect(() => {
    const update = () => setPlacement(place(step))
    update()
    const timer = window.setInterval(update, 500)
    window.addEventListener('resize', update)
    return () => { window.clearInterval(timer); window.removeEventListener('resize', update) }
  }, [step])

  if (!placement) return null
  const copy = TOUR[step]
  return (
    <>
      {placement.pulse && (
        <div
          className={styles.pulse}
          aria-hidden
          style={{ top: placement.pulse.top - 3, left: placement.pulse.left - 3, width: placement.pulse.width + 6, height: placement.pulse.height + 6 }}
        />
      )}
      <aside
        className={styles.tip}
        data-side={placement.side}
        role="status"
        aria-live="polite"
        style={{ top: placement.top, left: placement.left }}
      >
        <span className={styles.tipArrow} aria-hidden style={{ left: placement.arrowLeft }} />
        <p className={styles.tipStep}>Paso {copy.index + 1} de 3</p>
        <p className={styles.tipTitle}>{copy.title}</p>
        <p className={styles.tipBody}>{copy.body}</p>
        <div className={styles.tipFoot}>
          <span className={styles.tipDots} aria-hidden>
            {[0, 1, 2].map((index) => <span key={index} className={styles.tipDot} data-on={index <= copy.index} />)}
          </span>
          <button type="button" className={styles.tipSkip} onClick={() => void mark('tour_finished')}>
            Saltar el recorrido
          </button>
        </div>
      </aside>
    </>
  )
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 7
  const length = 2 * Math.PI * radius
  return (
    <svg className={styles.ring} viewBox="0 0 18 18" aria-hidden>
      <circle className={styles.ringTrack} cx="9" cy="9" r={radius} fill="none" strokeWidth="2.5" />
      <circle
        className={styles.ringValue}
        cx="9" cy="9" r={radius} fill="none" strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - done / total)}
      />
    </svg>
  )
}

/**
 * The small first-steps button of the header and its panel. It exists while
 * something is left; the panel opens by itself only when the server says so.
 */
export function Rin5ChecklistButton({ navigation }: { navigation: Rin5Navigation }) {
  const view = useRin5Onboarding((state) => state.view)
  const open = useRin5Onboarding((state) => state.checklistOpen)
  const openChecklist = useRin5Onboarding((state) => state.openChecklist)
  const closeChecklist = useRin5Onboarding((state) => state.closeChecklist)

  if (!view.enabled || view.remaining === 0 || view.welcome) return null
  const total = view.steps.length
  const done = total - view.remaining
  const links: Partial<Record<Rin5ChecklistStepId, { href: string; label: string }>> = {
    published: { href: navigation.publishUrl, label: 'Publicar' },
    domain: { href: navigation.domainUrl, label: 'Conectar dominio' },
  }

  return (
    <div className={styles.panelAnchor}>
      <button
        type="button"
        className={styles.progress}
        aria-expanded={open}
        aria-controls="rin5-first-steps"
        onClick={() => (open ? closeChecklist() : openChecklist())}
      >
        <ProgressRing done={done} total={total} />
        <span className={styles.progressLabel}>Primeros pasos</span>
        <span>{done}/{total}</span>
      </button>
      {open && (
        <section id="rin5-first-steps" className={styles.panel} aria-labelledby="rin5-first-steps-title">
          <div className={styles.panelHead}>
            <h2 id="rin5-first-steps-title" className={styles.panelTitle}>Primeros pasos</h2>
            <span className={styles.panelTools}>
              <span className={styles.panelCount}>{done} de {total}</span>
              <button type="button" className={styles.panelClose} onClick={closeChecklist} aria-label="Cerrar primeros pasos">
                <X aria-hidden />
              </button>
            </span>
          </div>
          <div className={styles.bar} aria-hidden><div className={styles.barValue} style={{ width: `${(done / total) * 100}%` }} /></div>
          <ul className={styles.steps}>
            {view.steps.map((step) => {
              const copy = STEP_COPY[step.id]
              const link = !step.done ? links[step.id] : undefined
              return (
                <li key={step.id} className={styles.step} data-done={step.done}>
                  <span className={styles.check} aria-hidden>{step.done && <Check strokeWidth={3} />}</span>
                  <span className={styles.stepBody}>
                    <span className={styles.stepText}>
                      {copy.label}
                      <span className="sr-only">{step.done ? ' (hecho)' : ' (pendiente)'}</span>
                    </span>
                    {!step.done && copy.hint && <span className={styles.stepHint}>{copy.hint}</span>}
                    {link && <a className={styles.stepLink} href={link.href}>{link.label}</a>}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className={styles.panelFoot}>Se marca solo cuando lo haces. Si lo cierras, vuelve mañana mientras quede algo.</p>
        </section>
      )}
    </div>
  )
}
