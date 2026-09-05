/**
 * Pure helpers for `scripts/rin5-import.ts`.
 *
 * Split out of the importer so the two behaviours with the highest visual
 * impact on the rin5 round-trip diff (G9, P-2609) — `::before`/`::after`
 * `content` synthesis and inline/block collapse — can be unit tested without
 * a DOM+DB fixture. The importer wires these against its own `computeBuckets`
 * closure; nothing here touches CSS cascade resolution or Ycode's schema.
 */

/**
 * The Tailwind variant prefix a rule's `@media` context maps to. `''` is the
 * base sheet, outside any at-rule.
 */
export type CssBucket = '' | 'max-lg:' | 'max-md:';

/** The order buckets have to be emitted in: base first, widest query last. */
export const BUCKET_ORDER: readonly CssBucket[] = ['', 'max-lg:', 'max-md:'];

/**
 * Map an `@media` parameter string to the Tailwind `max-*` variant that
 * approximates it, or `null` for a query this importer doesn't represent
 * (`min-width`, `print`, feature queries).
 *
 * Approximate on purpose: Tailwind's `max-md:` cuts at 767px, so a source
 * `@media (max-width: 760px)` lands on it and the two don't break at the same
 * pixel. Documented in `docs/rin5-import-subset.md`.
 */
export function bucketForMedia(params: string): CssBucket | null {
  const m = params.match(/max-width:\s*(\d+)px/);
  if (!m) return null;
  const px = parseInt(m[1], 10);
  if (px <= 767) return 'max-md:';
  if (px <= 1200) return 'max-lg:';
  return null;
}

/** The declaration that won for one property inside one bucket. */
export interface CascadeWinner {
  value: string;
  spec: number;
  order: number;
}

/** A parsed rule, already matched against its subject element. */
export interface BucketedRule {
  bucket: CssBucket;
  spec: number;
  order: number;
  decls: ReadonlyArray<readonly [string, string]>;
}

/**
 * Which buckets' rules are live at the width each bucket describes. A
 * `max-lg:` viewport still sees every base rule; a `max-md:` one sees the base
 * sheet *and* the `max-lg:` query, because 767px is also below 1200px.
 */
const RULES_LIVE_AT: Readonly<Record<CssBucket, readonly CssBucket[]>> = {
  '': [''],
  'max-lg:': ['', 'max-lg:'],
  'max-md:': ['', 'max-lg:', 'max-md:'],
};

/**
 * Resolve a list of matching rules into one winner map per media bucket.
 *
 * Each bucket is the cascade *as a browser would resolve it at that width* —
 * every rule live there competing by specificity and declaration order — minus
 * whatever the next wider bucket already says. What comes back is therefore a
 * delta: base carries the full winner map, `max-lg:` only the properties that
 * change below 1200px, `max-md:` only those that change again below 767px.
 * That is exactly the shape Tailwind variants need, and it keeps a `max-md:`
 * declaration from overwriting the base one, which is why pseudo-element rules
 * were pulled into this in the first place (`.nav a.active::after` lost its
 * `display:block` to a `display:none` declared later inside a media query).
 *
 * The delta is what round 6 fixed. A media query adds **no specificity**: with
 * `.split{grid-template-columns:1fr 1fr}`, `.split.narrow{…1.05fr .95fr}` and
 * `@media(max-width:900px){.split{…1fr}}`, a browser at 390px still paints two
 * columns, because `.split.narrow` is the more specific selector. Cascading
 * each bucket in isolation left the media rule unopposed in its own bucket, so
 * the importer emitted `max-lg:grid-cols-[1fr]` and the export collapsed to one
 * column where the original does not.
 */
export function resolveBuckets(rules: Iterable<BucketedRule>): Map<CssBucket, Map<string, CascadeWinner>> {
  const byBucket = new Map<CssBucket, BucketedRule[]>();
  for (const rule of rules) {
    const list = byBucket.get(rule.bucket);
    if (list) list.push(rule);
    else byBucket.set(rule.bucket, [rule]);
  }

  const out = new Map<CssBucket, Map<string, CascadeWinner>>();
  let wider: Map<string, CascadeWinner> | null = null;
  for (const bucket of BUCKET_ORDER) {
    const effective = new Map<string, CascadeWinner>();
    for (const live of RULES_LIVE_AT[bucket]) {
      for (const rule of byBucket.get(live) ?? []) {
        for (const [prop, value] of rule.decls) {
          const prev = effective.get(prop);
          if (prev && (prev.spec > rule.spec || (prev.spec === rule.spec && prev.order > rule.order))) continue;
          effective.set(prop, { value, spec: rule.spec, order: rule.order });
        }
      }
    }

    const emitted = new Map<string, CascadeWinner>();
    for (const [prop, winner] of effective) {
      if (wider?.get(prop)?.value === winner.value) continue;
      emitted.set(prop, winner);
    }
    if (emitted.size > 0) out.set(bucket, emitted);
    wider = effective;
  }
  return out;
}

/**
 * Constructs the importer has no representation for. `::` covers every
 * pseudo-element other than `::before`/`::after` (those are pulled out of the
 * selector before this runs), and `@` catches at-rule text that leaks into a
 * selector when a stylesheet is malformed.
 */
const UNSUPPORTED_SELECTOR_RE = /::|:focus-visible|:active|@/;

/**
 * A class, id, attribute or tag anywhere in the selector — i.e. something that
 * ties the rule to a part of the document instead of to everything in it.
 */
const SELECTOR_ANCHOR_RE = /[.#[]|(^|[\s>+~])[a-zA-Z][\w-]*/;

/**
 * True when the cascade should take this selector into account.
 *
 * The universal selector used to disqualify a rule outright, which threw away
 * `.stack > * + * { margin-top: 1rem }` — the "lobotomised owl", the most
 * common way hand-written CSS spaces a stack of siblings. Measured on the
 * 188658f6 generation: every `.panel.stack` card lost the separation between
 * its tag, its `h3` and its `p`, and the `section.section-tint` regions were
 * the worst of the whole round-trip (up to 13,3%).
 *
 * `*` is fine for the matcher — `Element.matches()` resolves it like a browser.
 * A lone `*` is in too, since round 6: `* { margin: 0 }` is half a reset and
 * dropping it left the UA seeds the importer plants per tag standing, so every
 * `<h2>`, `<p>` and `<ul>` of the export carried a margin the original does not
 * have and the whole page drifted downwards (13,4% weighted on the Natural
 * Equus generation). At specificity 0 it sits exactly where CSS puts it: above
 * the UA origin, below every author rule. The importer drops its `box-sizing`
 * on the way in — Tailwind's preflight already applies border-box, so emitting
 * it on every layer would be noise with no pixel behind it.
 *
 * What stays out is a *combined* universal with nothing to anchor it (`* + *`).
 */
export function isSupportedSelector(sel: string): boolean {
  const s = sel.trim();
  if (!s) return false;
  if (UNSUPPORTED_SELECTOR_RE.test(s)) return false;
  if (s === '*') return true;
  return SELECTOR_ANCHOR_RE.test(s);
}

/** Every class name a selector tests for, in source order and with repeats. */
export function selectorClassNames(sel: string): string[] {
  return [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
}

/**
 * The properties a JS-toggled state class is allowed to resolve.
 *
 * Deliberately short. See `relaxStateClasses` for why the list cannot simply be
 * "all of them".
 */
export const STATE_CLASS_PROPS: ReadonlySet<string> = new Set(['opacity', 'transform', 'visibility']);

/**
 * Rewrite a selector as if the given classes were present on the element, or
 * `null` when nothing changes or when a compound is nothing but state classes.
 *
 * This is how the importer represents reveal-on-scroll, the one JS-driven
 * pattern every generated sheet uses:
 *
 * ```css
 * .reveal    { opacity: 0; transform: translateY(22px); transition: … }
 * .reveal.in { opacity: 1; transform: none }
 * ```
 *
 * `in` is never written in the HTML — an IntersectionObserver adds it when the
 * block scrolls into view. The importer reads a static document, so it only
 * ever saw `.reveal` and baked `opacity-[0]` into the layer. The class never
 * arrives in the export (Ycode rebuilds the tree, and the observer's selectors
 * no longer match), so the block stays invisible for good: nine sections of the
 * Hipiclub generation exported as an empty cream band, 2,63% weighted.
 *
 * A class that appears in the stylesheet but on no element of any page is by
 * definition set from script. Which of its states is "the" state is not
 * knowable, so the relaxed rule is doubly fenced: it may only carry
 * `STATE_CLASS_PROPS`, and it is only consulted for an element that
 * `isHiddenByCascade` says is invisible without it. Both fences are needed.
 * The property list on its own let `.nav-links.open{transform:none}` through
 * and every internal page of the Can Nicolau export shipped with its mobile
 * menu hanging open — the drawer is parked off-screen with a `translateY`, not
 * hidden, so nothing was gained by guessing. Fully transparent is the one case
 * where guessing cannot be worse: there is no other state to be wrong about.
 */
export function relaxStateClasses(sel: string, present: ReadonlySet<string>): string | null {
  let removed = false;
  const compounds = sel.trim().split(/(\s*[>+~]\s*|\s+)/);
  const out: string[] = [];
  for (const compound of compounds) {
    if (!compound || /^\s*[>+~]?\s*$/.test(compound)) { out.push(compound); continue; }
    const stripped = compound.replace(/\.([\w-]+)/g, (match, name: string) => {
      if (present.has(name)) return match;
      removed = true;
      return '';
    });
    if (stripped === '') return null;
    out.push(stripped);
  }
  return removed ? out.join('') : null;
}

/**
 * True when the base cascade leaves the element with nothing on screen at all.
 *
 * The gate on `relaxStateClasses`: only an element that is invisible without
 * its JS state class gets to borrow it. A drawer parked off-screen with a
 * `transform` is not invisible — it is somewhere, and the page loads with it
 * there.
 */
export function isHiddenByCascade(base: ReadonlyMap<string, CascadeWinner> | undefined): boolean {
  const opacity = base?.get('opacity')?.value.trim();
  const visibility = base?.get('visibility')?.value.trim();
  return opacity === '0' || visibility === 'hidden';
}

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

/** `border: <width> <style> <color>`, the only form worth splitting apart. */
const BORDER_TRIPLE_RE = /^(\S+)\s+(solid|dashed|dotted|double|groove|ridge|inset|outset)\s+(.+)$/;

/**
 * The two physical sides each logical shorthand writes, in LTR. Every sheet the
 * rin5 generator produces is LTR; a RTL site would need the pair swapped for
 * `-inline`.
 */
const LOGICAL_SIDES: Readonly<Record<string, readonly [string, string]>> = {
  'margin-inline': ['margin-left', 'margin-right'],
  'margin-block': ['margin-top', 'margin-bottom'],
  'padding-inline': ['padding-left', 'padding-right'],
  'padding-block': ['padding-top', 'padding-bottom'],
};

/**
 * Expand a `margin`/`padding`/`border` shorthand — physical or logical — into
 * its longhands, or `null` for anything else.
 *
 * The importer resolves the cascade into a map keyed by property name, so a
 * shorthand and a longhand for the same side never compete: `p{margin:0 0 1em}`
 * and `p:last-child{margin-bottom:0}` land on different keys, both survive, and
 * both emit an `mb-…` class — after which which one wins is down to the order
 * Tailwind happens to generate them in, not to specificity. Expanding at parse
 * time puts every box declaration on the same key so the cascade decides.
 *
 * `border` is the same defect one property family over, and it costs a whole
 * component: `.btn{border:1.5px solid transparent}` plus
 * `.btn--ghost{border-color:var(--line)}` emitted `border-[transparent]` *and*
 * `border-[rgba(32,38,26,0.14)]` into the same `class`, and the ghost buttons of
 * the Natural Equus generation lost their outline. Only the three-part form is
 * split: `border: none` or `border: 0` says nothing about colour, and
 * `cssToClasses` already maps those whole.
 *
 * The logical pairs (`margin-inline`, `padding-block`…) are here for the same
 * reason and it took `*{margin:0}` entering the cascade to expose it:
 * `.wrap{margin-inline:auto}` and the reset's `margin-left:0` sat on different
 * keys, both emitted a class, Tailwind sorted the longhand last and every page
 * of the site stopped being centred.
 *
 * The split is paren-aware, unlike `parseSpacingShorthand` in
 * `lib/import/css.ts`: that one bails to a single `p-[whole value]` class as
 * soon as it sees a `(`, which is harmless there (Tailwind copies the value
 * through verbatim) but would produce `padding-top: clamp(…) 0 6rem` here.
 */
export function expandBoxShorthand(prop: string, value: string): Array<[string, string]> | null {
  const logical = LOGICAL_SIDES[prop];
  if (logical) {
    const important = /\s*!important\s*$/i.test(value);
    const parts = splitTopLevel(value.replace(/\s*!important\s*$/i, ''));
    if (parts.length === 0 || parts.length > 2) return null;
    const suffix = important ? ' !important' : '';
    const [start, end = start] = parts;
    return [[logical[0], start + suffix], [logical[1], end + suffix]];
  }
  if (prop === 'border' || /^border-(top|right|bottom|left)$/.test(prop)) {
    const important = /\s*!important\s*$/i.test(value);
    const m = value.replace(/\s*!important\s*$/i, '').trim().match(BORDER_TRIPLE_RE);
    if (!m) return null;
    const suffix = important ? ' !important' : '';
    return [
      [`${prop}-width`, m[1] + suffix],
      [`${prop}-style`, m[2] + suffix],
      [`${prop}-color`, m[3].trim() + suffix],
    ];
  }
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

/**
 * Parse a `style` attribute into cascade-ready declarations.
 *
 * The importer used to hand the attribute straight to `cssToClasses` and append
 * the result after everything else. That reads like it should win, but the
 * classes all land in one flat `class` attribute where order means nothing —
 * the winner is whichever utility Tailwind generated last. An inline style
 * outranks every selector in real CSS, so it belongs in the same winner map as
 * the rest, just at the top.
 *
 * `margin`/`padding` come back expanded for the same reason they do in
 * `expandBoxShorthand`.
 */
export function parseInlineStyle(style: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    if (!prop || !value) continue;
    const expanded = expandBoxShorthand(prop, value);
    if (expanded) out.push(...expanded);
    else out.push([prop, value]);
  }
  return out;
}
