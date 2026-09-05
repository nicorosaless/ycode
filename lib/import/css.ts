/**
 * Shared CSS → Tailwind class mapper.
 *
 * This is the single source of truth for turning a raw CSS declaration block
 * (an inline `style` attribute, or a Webflow `styleLess` string) into Tailwind
 * utility classes. It generalises the original `styleToClasses` from
 * `html-layer-converter.ts` and adds:
 *   - a punch-list of frequent Webflow-isms (grid gaps, per-side borders,
 *     transition-*, transform, mix-blend), and
 *   - a Tailwind arbitrary-property fallback (`[prop:value]`) so that nothing
 *     is silently dropped.
 *
 * `html-layer-converter.styleToClasses` delegates here so the existing HTML
 * import benefits from the wider coverage too.
 */

export interface CssToClassesOptions {
  /**
   * Emit a Tailwind arbitrary-property class (`[prop:value]`) for declarations
   * that have no dedicated mapping. Defaults to `true`.
   */
  arbitraryFallback?: boolean;
}

function parseSpacingShorthand(val: string, prefix: string, sides: [string, string, string, string]): string[] {
  // A CSS function (`min()`/`max()`/`clamp()`/`calc()`) can contain literal
  // spaces around its own arguments — splitting on whitespace would slice it
  // into several bogus "shorthand" parts. Treat the whole value as a single
  // side in that case; multi-side shorthand with a function inside one side
  // (`padding: min(1rem,2vw) 0`) is rare enough to be out of scope (documented
  // in docs/rin5-import-subset.md).
  const parts = (val.includes('(') ? [val] : val.split(/\s+/)).map(arb);
  if (parts.length === 1) return [`${prefix}-[${parts[0]}]`];
  if (parts.length === 2) return [
    `${sides[0]}-[${parts[0]}]`, `${sides[1]}-[${parts[1]}]`,
    `${sides[2]}-[${parts[0]}]`, `${sides[3]}-[${parts[1]}]`,
  ];
  if (parts.length === 3) return [
    `${sides[0]}-[${parts[0]}]`, `${sides[1]}-[${parts[1]}]`,
    `${sides[2]}-[${parts[2]}]`, `${sides[3]}-[${parts[1]}]`,
  ];
  return [
    `${sides[0]}-[${parts[0]}]`, `${sides[1]}-[${parts[1]}]`,
    `${sides[2]}-[${parts[2]}]`, `${sides[3]}-[${parts[3]}]`,
  ];
}

const DISPLAY_MAP: Record<string, string> = {
  flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid',
  'inline-grid': 'inline-grid', block: 'block', 'inline-block': 'inline-block',
  inline: 'inline', none: 'hidden',
};
const FLEX_DIR_MAP: Record<string, string> = {
  row: 'flex-row', 'row-reverse': 'flex-row-reverse',
  column: 'flex-col', 'column-reverse': 'flex-col-reverse',
};
const FLEX_WRAP_MAP: Record<string, string> = {
  wrap: 'flex-wrap', 'wrap-reverse': 'flex-wrap-reverse', nowrap: 'flex-nowrap',
};
const JUSTIFY_MAP: Record<string, string> = {
  'flex-start': 'justify-start', start: 'justify-start',
  'flex-end': 'justify-end', end: 'justify-end',
  center: 'justify-center', 'space-between': 'justify-between',
  'space-around': 'justify-around', 'space-evenly': 'justify-evenly',
  stretch: 'justify-stretch',
};
const ALIGN_ITEMS_MAP: Record<string, string> = {
  'flex-start': 'items-start', start: 'items-start',
  'flex-end': 'items-end', end: 'items-end',
  center: 'items-center', baseline: 'items-baseline', stretch: 'items-stretch',
};
const ALIGN_SELF_MAP: Record<string, string> = {
  auto: 'self-auto', 'flex-start': 'self-start', start: 'self-start',
  'flex-end': 'self-end', end: 'self-end',
  center: 'self-center', stretch: 'self-stretch', baseline: 'self-baseline',
};
const ALIGN_CONTENT_MAP: Record<string, string> = {
  'flex-start': 'content-start', start: 'content-start',
  'flex-end': 'content-end', end: 'content-end',
  center: 'content-center', 'space-between': 'content-between',
  'space-around': 'content-around', 'space-evenly': 'content-evenly',
  stretch: 'content-stretch',
};
const TEXT_ALIGN_MAP: Record<string, string> = {
  left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify',
};
const TEXT_DECO_MAP: Record<string, string> = {
  underline: 'underline', 'line-through': 'line-through', none: 'no-underline',
};
const TEXT_TRANSFORM_MAP: Record<string, string> = {
  uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize', none: 'normal-case',
};
const WHITESPACE_MAP: Record<string, string> = {
  nowrap: 'whitespace-nowrap', pre: 'whitespace-pre',
  'pre-wrap': 'whitespace-pre-wrap', 'pre-line': 'whitespace-pre-line',
  normal: 'whitespace-normal',
};
const POSITION_MAP: Record<string, string> = {
  relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky', static: 'static',
};
const OVERFLOW_MAP: Record<string, string> = {
  hidden: 'overflow-hidden', auto: 'overflow-auto', scroll: 'overflow-scroll', visible: 'overflow-visible',
};
const CURSOR_MAP: Record<string, string> = {
  pointer: 'cursor-pointer', default: 'cursor-default', move: 'cursor-move',
  text: 'cursor-text', wait: 'cursor-wait', help: 'cursor-help',
  'not-allowed': 'cursor-not-allowed', grab: 'cursor-grab', grabbing: 'cursor-grabbing',
};
const OBJECT_FIT_MAP: Record<string, string> = {
  contain: 'object-contain', cover: 'object-cover', fill: 'object-fill',
  none: 'object-none', 'scale-down': 'object-scale-down',
};
const OBJECT_POSITION_MAP: Record<string, string> = {
  top: 'object-top', bottom: 'object-bottom', left: 'object-left', right: 'object-right',
  center: 'object-center', 'left top': 'object-left-top', 'top left': 'object-left-top',
  'right top': 'object-right-top', 'top right': 'object-right-top',
  'left bottom': 'object-left-bottom', 'bottom left': 'object-left-bottom',
  'right bottom': 'object-right-bottom', 'bottom right': 'object-right-bottom',
};
const BORDER_STYLE_VALUES = new Set(['solid', 'dashed', 'dotted', 'double', 'none']);
const SIDE_ABBR: Record<string, string> = { top: 't', right: 'r', bottom: 'b', left: 'l' };

export function sanitizeCssValue(val: string): string {
  let v = val.replace(/\s*!important\s*$/i, '').trim();
  v = v.replace(/,\s+/g, ',');
  return v;
}

/** Underscore-escape a value for use inside a Tailwind arbitrary bracket. */
function arb(val: string): string {
  return val.replace(/\s+/g, '_');
}

/**
 * A font family name that CSS accepts unquoted: one `<custom-ident>`, i.e. an
 * optional single leading hyphen, then a letter, then letters/digits/hyphens.
 *
 * Anything else — a space, a digit-starting token, a non-ASCII character, `--`
 * — has to be a quoted `<string>` or the browser throws the whole declaration
 * away. Generic keywords (`sans-serif`, `system-ui`, `ui-monospace`) and the
 * `-apple-system` system-font keyword all match, and must stay unquoted:
 * quoting them turns a keyword into the name of a font nobody has installed.
 */
const UNQUOTED_FONT_FAMILY_RE = /^-?[A-Za-z][A-Za-z0-9-]*$/;

/** Split a comma-separated list at top level, ignoring commas inside `()`. */
function splitTopLevelCommas(val: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of val) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Serialise a `font-family` list for a Tailwind `font-[…]` arbitrary value.
 *
 * The rin5 generator writes `--f-body: "Source Sans 3", system-ui, sans-serif`
 * and `scripts/rin5-import.ts` strips every quote before it gets here, because
 * a raw `"` can't ride inside a `class="…"` attribute. That left
 * `font-family: Source Sans 3,system-ui,sans-serif`, where `3` is not a valid
 * identifier: Chromium discards the *entire* declaration and the whole body
 * falls back to the system font. Measured on `out-v7`: 6,3% weighted
 * round-trip diff, against 0,23% for the same site with a digit-free family
 * name (P-2609/G9).
 *
 * So families are re-quoted here, with single quotes — Tailwind un-escapes
 * `_` back to a space inside the string, and `'` survives a double-quoted HTML
 * class attribute where `"` would not.
 */
function fontFamilyArb(val: string): string {
  return splitTopLevelCommas(val)
    .map((raw) => {
      const family = raw.trim().replace(/^["']|["']$/g, '').trim();
      if (!family) return '';
      // A `var()`/`local()` leftover is not a name — pass it through untouched.
      if (family.includes('(')) return arb(family);
      if (UNQUOTED_FONT_FAMILY_RE.test(family)) return family;
      return `'${arb(family.replace(/(['\\])/g, '\\$1'))}'`;
    })
    .filter(Boolean)
    .join(',');
}

/** Map a single `prop: value` declaration to zero or more Tailwind classes. */
function mapDeclaration(prop: string, val: string): string[] {
  const out: string[] = [];

  // Gradient text: `background-clip: text` only reveals the gradient if the
  // text fill is transparent. Emit the full Tailwind recipe so it's visible —
  // a bare `background-clip: text` leaves the gradient hidden behind the text.
  if ((prop === 'background-clip' || prop === '-webkit-background-clip') && val === 'text') {
    return ['bg-clip-text', 'text-transparent'];
  }

  const mapped =
    prop === 'display' ? DISPLAY_MAP[val] :
      prop === 'flex-direction' ? FLEX_DIR_MAP[val] :
        prop === 'flex-wrap' ? FLEX_WRAP_MAP[val] :
          prop === 'justify-content' ? JUSTIFY_MAP[val] :
            prop === 'align-items' ? ALIGN_ITEMS_MAP[val] :
              prop === 'align-self' ? ALIGN_SELF_MAP[val] :
                prop === 'align-content' ? ALIGN_CONTENT_MAP[val] :
                  prop === 'text-align' ? TEXT_ALIGN_MAP[val] :
                    prop === 'text-decoration' || prop === 'text-decoration-line' ? TEXT_DECO_MAP[val] :
                      prop === 'text-transform' ? TEXT_TRANSFORM_MAP[val] :
                        prop === 'white-space' ? WHITESPACE_MAP[val] :
                          prop === 'position' ? POSITION_MAP[val] :
                            prop === 'overflow' ? OVERFLOW_MAP[val] :
                              prop === 'cursor' ? CURSOR_MAP[val] :
                                prop === 'object-fit' ? OBJECT_FIT_MAP[val] :
                                  prop === 'object-position' ? OBJECT_POSITION_MAP[val] :
                                    prop === 'font-style' && val === 'italic' ? 'italic' :
                                      prop === 'font-style' && val === 'normal' ? 'not-italic' :
                                        prop === 'pointer-events' && val === 'none' ? 'pointer-events-none' :
                                          prop === 'pointer-events' && val === 'auto' ? 'pointer-events-auto' :
                                            prop === 'word-break' && val === 'break-all' ? 'break-all' :
                                              prop === 'overflow-wrap' && val === 'break-word' ? 'break-words' :
                                                null;

  if (mapped) { out.push(mapped); return out; }

  // Per-side border width and colour (border-top-width → border-t-[…]). Both
  // land on the same utility: Tailwind reads a length as a width and a colour
  // as a colour. Per-side style has no arbitrary utility, so it is dropped —
  // `border-solid` is Tailwind's default and the only style these sheets use.
  const sideBorder = prop.match(/^border-(top|right|bottom|left)-(width|color)$/);
  if (sideBorder) { out.push(`border-${SIDE_ABBR[sideBorder[1]]}-[${arb(val)}]`); return out; }
  if (/^border-(top|right|bottom|left)-style$/.test(prop)) return out;

  switch (prop) {
    case 'gap': out.push(`gap-[${arb(val)}]`); break;
    case 'row-gap': case 'grid-row-gap': out.push(`gap-y-[${arb(val)}]`); break;
    case 'column-gap': case 'grid-column-gap': out.push(`gap-x-[${arb(val)}]`); break;
    case 'grid-gap': out.push(`gap-[${arb(val)}]`); break;
    case 'grid-template-columns': out.push(`grid-cols-[${arb(val)}]`); break;
    case 'grid-template-rows': out.push(`grid-rows-[${arb(val)}]`); break;
    case 'padding':
      out.push(...parseSpacingShorthand(val, 'p', ['pt', 'pr', 'pb', 'pl']));
      break;
    case 'padding-top': out.push(`pt-[${arb(val)}]`); break;
    case 'padding-right': out.push(`pr-[${arb(val)}]`); break;
    case 'padding-bottom': out.push(`pb-[${arb(val)}]`); break;
    case 'padding-left': out.push(`pl-[${arb(val)}]`); break;
    case 'margin':
      out.push(...parseSpacingShorthand(val, 'm', ['mt', 'mr', 'mb', 'ml']));
      break;
    case 'margin-top': out.push(`mt-[${arb(val)}]`); break;
    case 'margin-right': out.push(`mr-[${arb(val)}]`); break;
    case 'margin-bottom': out.push(`mb-[${arb(val)}]`); break;
    case 'margin-left': out.push(`ml-[${arb(val)}]`); break;
    // `width: min(100% - 2.5rem, 1220px)` (the ubiquitous "wrap" container
    // pattern behind almost every section in the rin5 reference client) has
    // the exact same unescaped-space problem `font-size: clamp(…)` had: the
    // literal spaces around `-`/`,` split `w-[min(100% - 2.5rem,1220px)]`
    // into several broken class tokens, so the class silently never applied
    // — the container lost its max-width and centering, every section
    // rendered full-bleed, and text reflowed onto different line breaks
    // throughout the whole site. Measured as the single largest remaining
    // contributor to the round-trip diff after the pseudo-element and
    // inline-collapse fixes (P-2609/G9).
    case 'width':
      out.push(val === '100%' ? 'w-full' : `w-[${arb(val)}]`);
      break;
    case 'height':
      out.push(val === '100%' ? 'h-full' : val === 'auto' ? 'h-auto' : `h-[${arb(val)}]`);
      break;
    case 'min-width': out.push(`min-w-[${arb(val)}]`); break;
    case 'min-height': out.push(`min-h-[${arb(val)}]`); break;
    case 'max-width': out.push(`max-w-[${arb(val)}]`); break;
    case 'max-height': out.push(`max-h-[${arb(val)}]`); break;
    // `clamp(2.6rem, 5vw + 1rem, 4.75rem)`-style responsive font sizes are
    // common in modern hand-written CSS and contain literal spaces around
    // the `+`/`-` in the calc-like middle argument. Unlike box-shadow/
    // background-image/transform above, this case used to emit `val` raw —
    // the unescaped space split the Tailwind arbitrary value into multiple
    // broken class tokens, so `clamp()` headings silently lost their
    // font-size rule (dominant cause of the P-2609 rin5-import round-trip
    // pixel diff on any page with a fluid-type heading).
    case 'font-size': out.push(`text-[${arb(val)}]`); break;
    case 'font-weight': out.push(`font-[${val}]`); break;
    case 'font-family': out.push(`font-[${fontFamilyArb(val)}]`); break;
    case 'color': out.push(`text-[${arb(val)}]`); break;
    case 'line-height': out.push(`leading-[${arb(val)}]`); break;
    case 'letter-spacing': out.push(`tracking-[${arb(val)}]`); break;
    case 'background-color': out.push(`bg-[${arb(val)}]`); break;
    case 'border-radius': out.push(`rounded-[${arb(val)}]`); break;
    case 'border-top-left-radius': out.push(`rounded-tl-[${arb(val)}]`); break;
    case 'border-top-right-radius': out.push(`rounded-tr-[${arb(val)}]`); break;
    case 'border-bottom-right-radius': out.push(`rounded-br-[${arb(val)}]`); break;
    case 'border-bottom-left-radius': out.push(`rounded-bl-[${arb(val)}]`); break;
    case 'border-width': out.push(`border-[${arb(val)}]`); break;
    case 'border-color': out.push(`border-[${arb(val)}]`); break;
    case 'border-style':
      if (BORDER_STYLE_VALUES.has(val)) out.push(`border-${val}`);
      break;
    case 'border': {
      const m = val.match(/^(\S+)\s+(solid|dashed|dotted|double|none)\s+(.+)$/);
      if (m) { out.push(`border-[${arb(m[1])}]`, `border-${m[2]}`, `border-[${arb(m[3])}]`); }
      else if (val === 'none') out.push('border-none');
      break;
    }
    case 'opacity': out.push(`opacity-[${arb(val)}]`); break;
    case 'top': out.push(`top-[${arb(val)}]`); break;
    case 'right': out.push(`right-[${arb(val)}]`); break;
    case 'bottom': out.push(`bottom-[${arb(val)}]`); break;
    case 'left': out.push(`left-[${arb(val)}]`); break;
    case 'z-index': out.push(`z-[${arb(val)}]`); break;
    case 'overflow-x':
      if (['hidden', 'auto', 'scroll', 'visible'].includes(val)) out.push(`overflow-x-${val}`);
      break;
    case 'overflow-y':
      if (['hidden', 'auto', 'scroll', 'visible'].includes(val)) out.push(`overflow-y-${val}`);
      break;
    case 'aspect-ratio':
      out.push(val === 'auto' ? 'aspect-auto' : `aspect-[${val.replace(/\s*\/\s*/g, '/')}]`);
      break;
    case 'box-shadow': out.push(`shadow-[${arb(val)}]`); break;
    case 'background-image': out.push(`bg-[${arb(val)}]`); break;
    case 'flex-grow': out.push(val === '0' ? 'grow-0' : 'grow'); break;
    case 'flex-shrink': out.push(val === '0' ? 'shrink-0' : 'shrink'); break;
    case 'flex-basis': out.push(val === 'auto' ? 'basis-auto' : `basis-[${arb(val)}]`); break;
    case 'order': out.push(`order-[${arb(val)}]`); break;
    // ── Punch-list: frequent Webflow-isms ──
    case 'transition-duration': out.push(`duration-[${arb(val)}]`); break;
    case 'transition-delay': out.push(`delay-[${arb(val)}]`); break;
    case 'transition-timing-function': out.push(`ease-[${arb(val)}]`); break;
    case 'transform': out.push(`[transform:${arb(val)}]`); break;
    case 'mix-blend-mode': out.push(`mix-blend-${val}`); break;
  }

  return out;
}

/**
 * A CSS property name we are willing to render via the arbitrary fallback.
 *
 * Custom properties (`--token: value`) are deliberately excluded: Webflow's
 * exported stylesheet dumps its *entire* design-token set as `--var` declarations
 * onto class rules (e.g. `.heading-h1` carries 100+ `--font-size--h1: 4rem` style
 * lines). Those are token *definitions*, not utilities — every `var(--token)`
 * reference is already resolved to a concrete value up front — so emitting them
 * as `[--token:value]` classes only floods the layer with meaningless styling.
 */
function isRenderableProp(prop: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(prop);
}

/**
 * Convert a CSS declaration block into Tailwind classes.
 */
export function cssToClasses(style: string, options?: CssToClassesOptions): string[] {
  const arbitraryFallback = options?.arbitraryFallback ?? true;
  const classes: string[] = [];
  const decls = style.split(';').map(d => d.trim()).filter(Boolean);

  for (const decl of decls) {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) continue;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    const val = sanitizeCssValue(decl.slice(colonIdx + 1));
    if (!val) continue;

    // Gradient-text technique (`background-clip: text` + `-webkit-text-fill-color:
    // transparent`) can't be reproduced faithfully — we drop the `-webkit-*`
    // halves, and a lone `background-clip: text` would clip the background to the
    // glyphs while the text keeps a solid colour, which tends to blank the text.
    // Skip it so the element keeps its resolved colour and stays visible.
    if ((prop === 'background-clip' || prop === '-webkit-background-clip') && val === 'text') {
      continue;
    }

    const declClasses = mapDeclaration(prop, val);

    if (declClasses.length === 0 && arbitraryFallback && isRenderableProp(prop)) {
      declClasses.push(`[${prop}:${arb(val)}]`);
    }

    classes.push(...declClasses);
  }

  return classes;
}
