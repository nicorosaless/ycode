import type { Layer } from '@/types'

export type SectionMoveDirection = 'up' | 'down'

export function moveCustomerSection(
  layers: Layer[],
  selectedLayerId: string,
  direction: SectionMoveDirection,
): { layers: Layer[]; moved: boolean } {
  const isSection = (layer: Layer) => layer.name === 'section' || layer.settings?.tag === 'section'
  const bodyIndex = layers.findIndex(layer => layer.id === 'body' || layer.name === 'body')
  const body = bodyIndex >= 0 ? layers[bodyIndex] : null
  if (!body?.children) return { layers, moved: false }

  const mainIndex = body.children.findIndex(layer => layer.settings?.tag === 'main')
  const container = mainIndex >= 0 ? body.children[mainIndex] : body
  if (!container.children) return { layers, moved: false }
  const sectionIndexes = container.children.flatMap((child, index) => isSection(child) ? [index] : [])
  const sectionPosition = sectionIndexes.findIndex(index => container.children?.[index]?.id === selectedLayerId)
  const targetPosition = sectionPosition + (direction === 'up' ? -1 : 1)
  if (sectionPosition < 0 || targetPosition < 0 || targetPosition >= sectionIndexes.length) return { layers, moved: false }

  const children = [...container.children]
  const from = sectionIndexes[sectionPosition]
  const to = sectionIndexes[targetPosition]
  ;[children[from], children[to]] = [children[to], children[from]]
  const nextBody = mainIndex >= 0
    ? { ...body, children: body.children.map((child, index) => index === mainIndex ? { ...container, children } : child) }
    : { ...body, children }
  const next = [...layers]
  next[bodyIndex] = nextBody
  return { layers: next, moved: true }
}
