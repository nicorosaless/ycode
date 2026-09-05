/**
 * Pure helpers for `scripts/rin5-import.ts`.
 *
 * Split out of the importer so the two behaviours with the highest visual
 * impact on the rin5 round-trip diff (G9, P-2609) — `::before`/`::after`
 * `content` synthesis and inline/block collapse — can be unit tested without
 * a DOM+DB fixture. The importer wires these against its own `computeBuckets`
 * closure; nothing here touches CSS cascade resolution or Ycode's schema.
 */

/** A resolved `content` value for a `::before`/`::after` rule. */
export type PseudoContent =
  | { kind: 'text'; text: string }
  | { kind: 'empty' }
  | { kind: 'skip' };

/**
 * Resolve a raw `content` declaration value (already cascade-resolved, still
 * carrying its literal quotes) into text to render, an empty decorative box,
 * or `skip` for constructs this importer doesn't represent (`attr()`,
 * `url()`, multi-value lists, image `content`). `skip` is also returned when
 * `content` is absent entirely — per spec, a pseudo-element with no `content`
 * declaration generates no box.
 */
export function resolvePseudoContent(
  content: string | undefined,
  counters: ReadonlyMap<string, number>,
): PseudoContent {
  if (content === undefined) return { kind: 'skip' };
  const v = content.trim();
  if (v === 'none' || v === 'normal' || v === '""' || v === "''") return { kind: 'empty' };

  const str = v.match(/^["']([\s\S]*)["']$/);
  if (str) return { kind: 'text', text: str[1].replace(/\\(.)/g, '$1') };

  const counter = v.match(/^counter\(\s*([\w-]+)\s*(?:,\s*([\w-]+))?\s*\)$/);
  if (counter) {
    const n = counters.get(counter[1]) ?? 0;
    return { kind: 'text', text: formatCounterValue(n, counter[2] || 'decimal') };
  }

  return { kind: 'skip' };
}

/** Format a counter value. Only the two styles seen in practice are supported. */
export function formatCounterValue(n: number, style: string): string {
  if (style === 'decimal-leading-zero') return String(Math.max(n, 0)).padStart(2, '0');
  return String(n);
}

/** Parse a `counter-reset: <name> [<value>]` declaration. Default value is 0. */
export function parseCounterReset(raw: string): { name: string; value: number } | null {
  const m = raw.trim().match(/^([\w-]+)(?:\s+(-?\d+))?$/);
  if (!m) return null;
  return { name: m[1], value: m[2] !== undefined ? parseInt(m[2], 10) : 0 };
}

/** Parse a `counter-increment: <name> [<amount>]` declaration. Default amount is 1. */
export function parseCounterIncrement(raw: string): { name: string; amount: number } | null {
  const m = raw.trim().match(/^([\w-]+)(?:\s+(-?\d+))?$/);
  if (!m) return null;
  return { name: m[1], amount: m[2] !== undefined ? parseInt(m[2], 10) : 1 };
}

/**
 * CSS properties that give a `content: ""` pseudo-element a visible footprint
 * (a decorative dot, checkmark or divider) even though it carries no text —
 * `.checks li::before`/`.hero__tag::before` in the rin5 reference client are
 * exactly this shape. Anything else on an empty pseudo (e.g. just `transform`
 * or `transition`, used for hover-only decoration) is not worth a layer.
 */
const VISUAL_BOX_PROPS = new Set([
  'background', 'background-color', 'background-image', 'box-shadow', 'mask', '-webkit-mask',
  'border', 'border-width', 'border-color', 'border-style', 'border-radius',
]);

export function pseudoHasVisualBox(props: Iterable<string>): boolean {
  for (const p of props) {
    if (VISUAL_BOX_PROPS.has(p)) return true;
    if (/^border-(top|right|bottom|left)(-\w+)?$/.test(p)) return true;
    if (/^border-(top|bottom)-(left|right)-radius$/.test(p)) return true;
  }
  return false;
}

/** Minimal element shape this module needs — satisfied by both DOM `Element` and linkedom's. */
export interface CollapsibleElement {
  tagName: string;
  children: ArrayLike<CollapsibleElement>;
  getAttribute(name: string): string | null;
}

export interface CollapseContext {
  /** True when the CSS cascade gives `el` a non-`inline` `display`. */
  isBlockified(el: CollapsibleElement): boolean;
  /** The resolved `display` value of `el`, if any rule sets one. */
  displayOf(el: CollapsibleElement): string | undefined;
}

const FLEX_OR_GRID_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid']);

/**
 * True when every descendant of `el` can be flattened into a single rich-text
 * leaf (inline tags only, no classes of their own, not blockified).
 *
 * Unlike a plain "is every descendant `display:inline`?" check, this also
 * treats any *direct* child of a flex/grid container as blockified even when
 * the child has no `display` rule of its own — becoming a flex/grid item
 * forces a child onto its own line regardless of its own `display` value.
 * Without this, `.brand__name{display:flex;flex-direction:column}` (two
 * lines: the autoescuela name and its address) collapsed into one line,
 * because the nested `<span>` never got an explicit `display` of its own.
 */
export function isInlineCollapsible(
  el: CollapsibleElement,
  inlineOkTags: ReadonlySet<string>,
  ctx: CollapseContext,
): boolean {
  const stack: CollapsibleElement[] = [el];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const parentDisplay = ctx.displayOf(current);
    const parentForcesBlock = !!parentDisplay && FLEX_OR_GRID_DISPLAYS.has(parentDisplay);
    for (const child of Array.from(current.children)) {
      const tag = child.tagName.toLowerCase();
      if (!inlineOkTags.has(tag)) return false;
      if (child.getAttribute('class')) return false;
      if (tag !== 'br') {
        if (parentForcesBlock) return false;
        if (ctx.isBlockified(child)) return false;
      }
      stack.push(child);
    }
  }
  return true;
}
