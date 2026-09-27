/**
 * Where the guided tour's tooltip goes, so that it never covers what the
 * customer is working on.
 *
 * - With the right-hand column on screen (from 768 px), the tip lives inside
 *   it: that column only holds a hint for the customer, and the canvas stays
 *   whole. Canvas steps point left, at the web; the publish step sits under
 *   the Publicar button, which is above that same column.
 * - Without it (phones), the tip docks to the bottom of the screen and the
 *   canvas gives up that height, so the tip sits next to the web and not on
 *   top of its lower part.
 */

export type TourStep = 'text' | 'image' | 'publish'

export type TourRect = Readonly<{ top: number; left: number; width: number; height: number }>

export type TourPlacement =
  | Readonly<{ mode: 'float'; side: 'left' | 'below'; top: number; left: number; width: number; arrow: number }>
  | Readonly<{ mode: 'dock' }>

export const TOUR_TIP_WIDTH = 300
/** Below this the column cannot hold a readable tip. */
const MIN_COLUMN = 200
const GAP = 12
const ARROW = 12

export function placeTourTip(input: Readonly<{
  step: TourStep
  /** The canvas for text and image, the Publicar button for publish. */
  anchor: TourRect
  /** The right-hand column, or null when it is not on screen. */
  column: TourRect | null
}>): TourPlacement {
  const { step, anchor, column } = input
  if (!column || column.width < MIN_COLUMN) return { mode: 'dock' }

  const width = Math.min(TOUR_TIP_WIDTH, column.width - GAP * 2)
  const left = column.left + (column.width - width) / 2

  if (step === 'publish') {
    const centre = anchor.left + anchor.width / 2
    const arrow = Math.min(width - ARROW * 2, Math.max(ARROW, centre - left - ARROW / 2))
    return { mode: 'float', side: 'below', top: anchor.top + anchor.height + 14, left, width, arrow }
  }

  // Level with the top of the canvas, pointing left at the web.
  return { mode: 'float', side: 'left', top: Math.max(column.top, anchor.top) + 16, left, width, arrow: 22 }
}
