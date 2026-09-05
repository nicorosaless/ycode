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

/**
 * Chromium user-agent default declarations, per tag, for the properties that
 * move pixels.
 *
 * Why this exists: the importer resolves the *author* stylesheet only, and the
 * document Ycode exports is reset by Tailwind's preflight. A hand-written site
 * that ships no `*{margin:0}` reset of its own — the rin5 reference client is
 * one — therefore loses every margin, indent and type-scale step it was
 * silently inheriting from the browser. Measured on `clients/7`: `<figure>`
 * alone (UA `margin: 1em 40px`) made the home hero 80px wider and 100px taller
 * in the export than in the source, which was the largest single desktop
 * region diff left after round 2 (16.5%) — and, before this, was misattributed
 * to Ycode's image pipeline.
 *
 * Seeded into the cascade below every author rule, so anything the stylesheet
 * declares still wins. Values are kept in the UA's own relative units (`em`,
 * `smaller`), not resolved pixels, so they scale off the element's own font
 * size exactly as the browser does.
 *
 * Longhands only, deliberately: the importer's winner map is keyed by property
 * name, so seeding `margin` would sit *alongside* an author `margin-left`
 * instead of losing to it, and both classes would reach the output.
 *
 * Verified against Chromium's computed styles (`getComputedStyle` on a bare
 * document), not copied from the HTML spec's suggested stylesheet.
 *
 * Known gap: the UA also zeroes the margins of a *nested* `ul`/`ol`
 * (`ul ul {margin: 0}`). That's contextual, not per-tag, so a nested list gets
 * a spurious `1em` block margin here. No nested lists exist in the reference
 * client; a list-in-list is on the "avoid" side of the import contract.
 */
const UA_DEFAULTS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  p: [['margin-top', '1em'], ['margin-bottom', '1em']],
  h1: [['margin-top', '.67em'], ['margin-bottom', '.67em'], ['font-size', '2em'], ['font-weight', '700']],
  h2: [['margin-top', '.83em'], ['margin-bottom', '.83em'], ['font-size', '1.5em'], ['font-weight', '700']],
  h3: [['margin-top', '1em'], ['margin-bottom', '1em'], ['font-size', '1.17em'], ['font-weight', '700']],
  h4: [['margin-top', '1.33em'], ['margin-bottom', '1.33em'], ['font-weight', '700']],
  h5: [['margin-top', '1.67em'], ['margin-bottom', '1.67em'], ['font-size', '.83em'], ['font-weight', '700']],
  h6: [['margin-top', '2.33em'], ['margin-bottom', '2.33em'], ['font-size', '.67em'], ['font-weight', '700']],
  ul: [['margin-top', '1em'], ['margin-bottom', '1em'], ['padding-left', '40px'], ['list-style-type', 'disc']],
  ol: [['margin-top', '1em'], ['margin-bottom', '1em'], ['padding-left', '40px'], ['list-style-type', 'decimal']],
  dl: [['margin-top', '1em'], ['margin-bottom', '1em']],
  dd: [['margin-left', '40px']],
  figure: [['margin-top', '1em'], ['margin-right', '40px'], ['margin-bottom', '1em'], ['margin-left', '40px']],
  blockquote: [['margin-top', '1em'], ['margin-right', '40px'], ['margin-bottom', '1em'], ['margin-left', '40px']],
  pre: [['margin-top', '1em'], ['margin-bottom', '1em'], ['font-family', 'monospace']],
  hr: [['margin-top', '.5em'], ['margin-bottom', '.5em'], ['margin-left', 'auto'], ['margin-right', 'auto']],
  address: [['font-style', 'italic']],
  strong: [['font-weight', '700']],
  b: [['font-weight', '700']],
  th: [['font-weight', '700'], ['text-align', 'center']],
  small: [['font-size', 'smaller']],
  // Form controls are the one place the UA deliberately *blocks* inheritance:
  // `button{font: 400 13.3333px Arial; line-height: normal; text-align: center}`
  // and friends. Tailwind preflight replaces that with `font: inherit`, so a
  // control that the stylesheet only half-styles silently picks up the body's
  // typography in the export. Only the typography is seeded, not the chrome
  // (border, background, padding, cursor): a generator that ships an unstyled
  // native button is outside the subset anyway, and seeding an OS-grey 2px
  // outset border would be a worse failure than the one it fixes.
  button: [
    ['font-family', 'Arial'], ['font-size', '13.3333px'], ['font-weight', '400'],
    ['font-style', 'normal'], ['line-height', 'normal'], ['text-align', 'center'],
  ],
  input: [
    ['font-family', 'Arial'], ['font-size', '13.3333px'], ['font-weight', '400'],
    ['font-style', 'normal'], ['line-height', 'normal'], ['text-align', 'start'],
  ],
  select: [
    ['font-family', 'Arial'], ['font-size', '13.3333px'], ['font-weight', '400'],
    ['font-style', 'normal'], ['line-height', 'normal'],
  ],
  textarea: [
    ['font-family', 'monospace'], ['font-size', '13.3333px'], ['font-weight', '400'],
    ['font-style', 'normal'], ['line-height', 'normal'], ['text-align', 'start'],
  ],
  code: [['font-family', 'monospace']],
  kbd: [['font-family', 'monospace']],
  samp: [['font-family', 'monospace']],
};

/** UA default declarations for `tag`, or an empty list if it has none worth keeping. */
export function uaDefaultDecls(tag: string): Array<[string, string]> {
  const decls = UA_DEFAULTS[tag.toLowerCase()];
  return decls ? decls.map(([prop, value]) => [prop, value]) : [];
}

/**
 * Every property name that, declared by the author, would set `prop` as part
 * of a shorthand — `padding-left` → `padding`, `list-style-type` →
 * `list-style` (and the nonexistent-but-harmless `list`).
 *
 * The importer resolves the cascade into a map keyed by property name, so a
 * UA-seeded longhand and an author shorthand never meet: they occupy different
 * keys, both survive, and both become Tailwind classes. Tailwind then sorts the
 * longhand last and it wins — the opposite of the cascade. Rather than expand
 * every shorthand (which would need a value parser per property family), the
 * seed simply withdraws when the author has declared anything above it.
 */
export function shorthandsFor(prop: string): string[] {
  const parts = prop.split('-');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('-'));
  return out;
}

/**
 * Split a CSS value into its top-level parts, ignoring whitespace nested in a
 * function: `clamp(3.5rem, 5vw, 4.5rem) 0 6rem` is three parts, and
 * `min(100% - 2.5rem, 1220px)` is one.
 */
function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (current) { parts.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Expand a `margin`/`padding` shorthand into its four longhands, or `null` for
 * anything else.
 *
 * The importer resolves the cascade into a map keyed by property name, so a
 * shorthand and a longhand for the same side never compete: `p{margin:0 0 1em}`
 * and `p:last-child{margin-bottom:0}` land on different keys, both survive, and
 * both emit an `mb-…` class — after which which one wins is down to the order
 * Tailwind happens to generate them in, not to specificity. Expanding at parse
 * time puts every box declaration on the same key so the cascade decides.
 *
 * The split is paren-aware, unlike `parseSpacingShorthand` in
 * `lib/import/css.ts`: that one bails to a single `p-[whole value]` class as
 * soon as it sees a `(`, which is harmless there (Tailwind copies the value
 * through verbatim) but would produce `padding-top: clamp(…) 0 6rem` here.
 */
export function expandBoxShorthand(prop: string, value: string): Array<[string, string]> | null {
  if (prop !== 'margin' && prop !== 'padding') return null;

  // `!important` rides along on the value string; it belongs on every longhand,
  // not as a fifth side.
  const important = /\s*!important\s*$/i.test(value);
  const parts = splitTopLevel(value.replace(/\s*!important\s*$/i, ''));
  if (parts.length === 0 || parts.length > 4) return null;

  const [top, right = top, bottom = top, left = right] = parts;
  const suffix = important ? ' !important' : '';
  return [
    [`${prop}-top`, top + suffix],
    [`${prop}-right`, right + suffix],
    [`${prop}-bottom`, bottom + suffix],
    [`${prop}-left`, left + suffix],
  ];
}
