/**
 * rin5 → Ycode importer (spike)
 *
 * Imports the static benchmark site (clients/3-freeform-bench/site) into this
 * Ycode instance: pages + page_layers (draft), assets (Storage + table), fonts.
 *
 * Conversion strategy: per-element CSS cascade resolution → Tailwind arbitrary
 * utilities on `layer.classes` (the same target format Ycode's Webflow importer
 * produces via lib/import/css.ts, which we reuse as the single mapper).
 *
 * Usage:
 *   ASSET_PUBLIC_BASE=https://host:8453 npx tsx --env-file=.env scripts/rin5-import.ts
 */

import { Module } from 'node:module';

type RequireFn = (id: string) => unknown;
const moduleProto = Module.prototype as unknown as { require: RequireFn };
const originalRequire: RequireFn = moduleProto.require;
moduleProto.require = function patchedRequire(this: unknown, id: string): unknown {
  if (id === 'server-only') return {};
  return originalRequire.call(this, id);
};

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// Type-only: erased at compile time, so it doesn't trip the `server-only`
// require-patch that the rest of this script installs before loading anything.
import type { BucketedRule, CascadeWinner, CssBucket } from '../lib/import/rin5-html';

if (!process.env.RIN5_SITE_DIR) throw new Error('RIN5_SITE_DIR is required');
const SITE_DIR = path.resolve(process.env.RIN5_SITE_DIR);
const ASSET_DIR = path.join(SITE_DIR, 'assets');

const MIME: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// Tags whose children can be flattened into one rich-text layer
const INLINE_OK = new Set(['br', 'strong', 'b', 'em', 'i', 'small', 'a', 'span', 'u', 's', 'sub', 'sup']);
const MARK_TAGS: Record<string, string> = {
  strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline',
  s: 'strike', del: 'strike', sub: 'subscript', sup: 'superscript',
};
const SEMANTIC_TAGS: Record<string, string> = {
  header: 'header', footer: 'footer', main: 'main', aside: 'aside', article: 'article',
  nav: 'nav', ul: 'ul', ol: 'ol', li: 'li', dl: 'dl', dt: 'dt', dd: 'dd',
  blockquote: 'blockquote', figure: 'figure', figcaption: 'figcaption', address: 'address',
  table: 'table', thead: 'thead', tbody: 'tbody', tr: 'tr', td: 'td', th: 'th',
};
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const DROP_PROPS = new Set([
  'box-sizing', 'scroll-behavior', 'counter-reset', 'counter-increment', 'content',
  '-webkit-font-smoothing', 'text-decoration-thickness', 'text-underline-offset',
]);

/**
 * Cascade weight of a user-agent default. Below every author declaration
 * (`specificity()` never returns a negative), which is exactly where the UA
 * origin sits — and recognisable afterwards, so a seed can be withdrawn when
 * an author shorthand covers it.
 */
const UA_SPECIFICITY = -1;

/**
 * Cascade weight of a `style` attribute: above every selector, since
 * `specificity()` tops out at the id count times a million and no real
 * selector carries thousands of ids.
 */
const INLINE_SPECIFICITY = Number.MAX_SAFE_INTEGER;

interface CssRule extends BucketedRule {
  sel: string;
  hover: boolean;
  decls: Array<[string, string]>;
}

interface PseudoRule extends BucketedRule {
  /** Subject selector with the trailing `::before`/`::after` stripped. */
  sel: string;
  pseudo: 'before' | 'after';
  decls: Array<[string, string]>;
}

function specificity(sel: string): number {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  const types = (sel.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 1_000_000 + classes * 1_000 + types;
}

async function main() {
  const { parseHTML } = await import('linkedom');
  const postcss = (await import('postcss')).default;
  const { cssToClasses } = await import('../lib/import/css');
  const {
    resolvePseudoContent, parseCounterReset, parseCounterIncrement, pseudoHasVisualBox, isInlineCollapsible,
    uaDefaultDecls, shorthandsFor, expandBoxShorthand, parseInlineStyle,
    bucketForMedia, resolveBuckets, BUCKET_ORDER, isSupportedSelector,
    selectorClassNames, relaxStateClasses, STATE_CLASS_PROPS,
  } = await import('../lib/import/rin5-html');
  const { generatePageMetadataHash, generatePageLayersHash } = await import('../lib/hash-utils');
  const { generateId } = await import('../lib/utils');
  const knexMod = await import('knex');
  const sharp = (await import('sharp')).default;
  const { createClient } = await import('@supabase/supabase-js');
  const { generateCSSForPage, generateAndSaveDraftCSS } = await import('../lib/server/cssGenerator');
  const { dbSchemaForClient, resolveDbSchema, tenantStoragePath } = await import('../lib/tenant');

  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SECRET = process.env.SUPABASE_SECRET_KEY!;
  const PUBLIC_BASE = (process.env.ASSET_PUBLIC_BASE || SUPABASE_URL).replace(/\/$/, '');
  // This script writes straight to the tenant's schema and to its own folder
  // inside the shared `assets` bucket — see lib/tenant.ts.
  const db = knexMod.default({
    client: 'pg',
    connection: process.env.SUPABASE_CONNECTION_URL,
    searchPath: [resolveDbSchema(), 'extensions'],
  });
  const supabase = createClient(SUPABASE_URL, SECRET, {
    auth: { persistSession: false },
    db: { schema: dbSchemaForClient() },
  });

  // ───────────────────────── 1. Upload assets ─────────────────────────
  const assetMap = new Map<string, { id: string; public_url: string }>();
  const files = fs.readdirSync(ASSET_DIR).filter((f) => MIME[path.extname(f).toLowerCase()]);
  console.log(`Uploading ${files.length} assets…`);

  // Reuse previously imported assets (idempotent re-runs)
  const existing = await db('assets')
    .where({ source: 'rin5-import', is_published: false })
    .whereNull('deleted_at');
  for (const row of existing) assetMap.set(row.filename, { id: row.id, public_url: row.public_url });

  for (const file of files) {
    if (assetMap.has(file)) continue;
    const buf = fs.readFileSync(path.join(ASSET_DIR, file));
    const mime = MIME[path.extname(file).toLowerCase()];
    let width: number | null = null;
    let height: number | null = null;
    try {
      const meta = await sharp(buf).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch { /* ignore */ }

    const ext = path.extname(file).slice(1);
    const storagePath = tenantStoragePath(`website/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`);
    const { error } = await supabase.storage.from('assets').upload(storagePath, buf, { contentType: mime });
    if (error) throw new Error(`upload ${file}: ${error.message}`);

    const public_url = `${PUBLIC_BASE}/storage/v1/object/public/assets/${storagePath}`;
    const [row] = await db('assets')
      .insert({
        source: 'rin5-import',
        filename: file,
        storage_path: storagePath,
        public_url,
        file_size: buf.length,
        mime_type: mime,
        width,
        height,
        is_published: false,
      })
      .returning('*');
    assetMap.set(file, { id: row.id, public_url });
    console.log(`  ✓ ${file}`);
  }

  const assetByRef = (src: string) => {
    const name = path.basename(src.split('?')[0]);
    return assetMap.get(name);
  };

  // ───────────────────────── 2. Parse CSS ─────────────────────────
  const cssText = fs.readFileSync(path.join(SITE_DIR, 'styles.css'), 'utf8');
  const root = postcss.parse(cssText);

  const vars = new Map<string, string>();
  root.walkRules((r) => {
    if (r.selector.trim() === ':root') {
      r.walkDecls((d) => { if (d.prop.startsWith('--')) vars.set(d.prop, d.value); });
    }
  });
  const resolveVars = (value: string): string => {
    let v = value;
    for (let i = 0; i < 5 && v.includes('var('); i++) {
      v = v.replace(/var\((--[\w-]+)\s*(?:,\s*([^()]+))?\)/g, (_m, name, fb) => vars.get(name) ?? fb ?? '');
    }
    return v;
  };
  const rewriteUrls = (value: string): string =>
    value.replace(/url\(\s*['"]?(\/?assets\/[^'")]+)['"]?\s*\)/g, (m, p) => {
      const a = assetByRef(p);
      return a ? `url(${a.public_url})` : m;
    });

  // `content` is meaningless as a Tailwind class on a real element (DROP_PROPS
  // still drops it there) but is exactly what a `::before`/`::after` rule needs
  // to synthesize — kept for pseudoRules only, see PSEUDO_DROP_PROPS below.
  const PSEUDO_DROP_PROPS = new Set([...DROP_PROPS].filter((p) => p !== 'content'));
  const PSEUDO_SUFFIX_RE = /(::?(before|after))$/;

  const rules: CssRule[] = [];
  const pseudoRules: PseudoRule[] = [];
  const counterResets: Array<{ sel: string; name: string; value: number }> = [];
  const counterIncrements: Array<{ sel: string; name: string; amount: number }> = [];
  let order = 0;
  root.walkRules((r) => {
    const parent = r.parent as { type?: string; name?: string; params?: string };
    let bucket: CssBucket = '';
    if (parent?.type === 'atrule') {
      if (parent.name !== 'media') return;
      if (/prefers-reduced-motion/.test(parent.params || '')) return;
      const b = bucketForMedia(parent.params || '');
      if (b === null) return;
      bucket = b;
    }
    const decls: Array<[string, string]> = [];
    const pseudoDecls: Array<[string, string]> = [];
    r.walkDecls((d) => {
      if (d.prop.startsWith('--')) return;
      if (!PSEUDO_DROP_PROPS.has(d.prop)) pseudoDecls.push([d.prop, d.value + (d.important ? ' !important' : '')]);
      if (d.prop === 'counter-reset' || d.prop === 'counter-increment') return;
      if (DROP_PROPS.has(d.prop)) return;
      const value = d.value + (d.important ? ' !important' : '');
      // Expand `margin`/`padding` into longhands so the cascade can actually
      // resolve them: the winner map below is keyed by property name, so a
      // shorthand and a longhand for the same side otherwise sit on different
      // keys, both survive, and both emit a class — after which the winner is
      // whichever order Tailwind generated them in, not the more specific rule.
      const expanded = expandBoxShorthand(d.prop, value);
      if (expanded) decls.push(...expanded);
      else decls.push([d.prop, value]);
    });

    for (const rawSel of r.selector.split(',')) {
      const sel = rawSel.trim();
      if (!sel || sel === ':root') continue;

      const pseudoMatch = sel.match(PSEUDO_SUFFIX_RE);
      if (pseudoMatch) {
        const subject = sel.slice(0, sel.length - pseudoMatch[0].length);
        // Same support test as regular selectors, applied to the subject part.
        if (!isSupportedSelector(subject)) continue;
        if (pseudoDecls.length === 0) continue;
        pseudoRules.push({
          sel: subject,
          pseudo: pseudoMatch[2] as 'before' | 'after',
          bucket,
          spec: specificity(subject),
          order: order++,
          decls: pseudoDecls,
        });
        continue;
      }

      if (!isSupportedSelector(sel)) continue;
      const hover = sel.includes(':hover');
      if (hover) {
        // Only subject-level hover (`.btn:hover`), not ancestor hover (`.card:hover img`)
        const lastToken = sel.split(/[\s>+~]+/).filter(Boolean).pop() || '';
        if (!lastToken.includes(':hover')) continue;
      }
      // `counter-reset`/`counter-increment` never produce a Tailwind class (they're
      // dropped from `decls` above) but still tell us which elements start/advance
      // a `counter()` used by a descendant's `::before` — captured separately so
      // `.step::before{content:counter(step,decimal-leading-zero)}` renders "01..04"
      // instead of being silently skipped along with the rest of `::before`.
      r.walkDecls((d) => {
        if (d.prop === 'counter-reset') {
          const parsed = parseCounterReset(d.value);
          if (parsed) counterResets.push({ sel, ...parsed });
        } else if (d.prop === 'counter-increment') {
          const parsed = parseCounterIncrement(d.value);
          if (parsed) counterIncrements.push({ sel, ...parsed });
        }
      });
      // A lone `*` is a reset, and a reset is worth honouring: `*{margin:0}`
      // cancels the UA seeds this importer plants per tag. `box-sizing` is the
      // one declaration to leave behind — Tailwind's preflight already sets
      // border-box on everything, so repeating it on every layer of the site is
      // noise with no pixel behind it.
      const selDecls = sel === '*' ? decls.filter(([prop]) => prop !== 'box-sizing') : decls;
      if (selDecls.length === 0) continue;
      rules.push({ sel, hover, bucket, spec: specificity(sel), order: order++, decls: selDecls });
    }
  });
  console.log(`Parsed ${rules.length} CSS rule entries`);

  // Reveal-on-scroll. A class the stylesheet tests for but that no element of
  // any page carries is set from script — `.reveal.in` is the pattern every
  // generated sheet uses. Those rules are replayed with the phantom classes
  // taken out of the selector so they reach their subject, keeping the original
  // specificity (`.reveal.in` still outranks `.reveal`) and carrying only the
  // properties that can make something visible. Without this the export bakes
  // `opacity-[0]` and the block never comes back: the observer's selectors do
  // not survive Ycode rebuilding the tree.
  const classesInUse = new Set<string>();
  for (const file of fs.readdirSync(SITE_DIR).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
    for (const m of html.matchAll(/\sclass\s*=\s*"([^"]*)"/g)) {
      for (const name of m[1].split(/\s+/)) if (name) classesInUse.add(name);
    }
  }
  const stateRules: CssRule[] = [];
  for (const r of rules) {
    if (!selectorClassNames(r.sel).some((name) => !classesInUse.has(name))) continue;
    const relaxed = relaxStateClasses(r.sel, classesInUse);
    if (!relaxed) continue;
    const decls = r.decls.filter(([prop]) => STATE_CLASS_PROPS.has(prop));
    if (decls.length === 0) continue;
    stateRules.push({ ...r, sel: relaxed, decls });
  }
  rules.push(...stateRules);
  if (stateRules.length > 0) console.log(`Resolved ${stateRules.length} JS state-class rule(s) to their visible state`);

  // ───────────────────────── 3. Element → classes ─────────────────────────
  type El = Element & { matches: (s: string) => boolean };
  const matchesSafe = (el: El, sel: string): boolean => {
    try { return el.matches(sel); } catch { return false; }
  };

  type Winner = CascadeWinner;

  const computeBuckets = (el: El): Record<string, Map<string, Winner>> => {
    // Everything that isn't a `:hover` rule goes through `resolveBuckets`, which
    // resolves each media bucket as the browser would at that width — base rules
    // included — and hands back only what changes from the wider bucket. Hover
    // keeps its own per-bucket cascade: a `hover:` utility only ever paints on
    // top of the resting state, so it has nothing to inherit.
    const plain: BucketedRule[] = [];
    const buckets: Record<string, Map<string, Winner>> = {};

    // Seed the base bucket with the browser's own defaults for this tag before
    // any author rule. Ycode's output is reset by Tailwind preflight, so a
    // source stylesheet that ships no reset of its own (the rin5 reference
    // client is one) would otherwise silently lose every UA margin, indent and
    // type-scale step — `<figure>`'s `margin: 1em 40px` alone accounted for the
    // largest desktop region diff left after round 2. `spec`/`order` of -1 puts
    // them below every author declaration, exactly where the UA origin sits.
    const uaDecls = uaDefaultDecls(el.tagName);
    if (uaDecls.length > 0) {
      plain.push({ bucket: '', spec: UA_SPECIFICITY, order: UA_SPECIFICITY, decls: uaDecls });
    }
    for (const r of rules) {
      const subject = r.hover ? r.sel.replace(/:hover/g, '') : r.sel;
      if (!matchesSafe(el, subject)) continue;
      if (!r.hover) { plain.push(r); continue; }
      const map = (buckets['hover:' + r.bucket] ??= new Map());
      for (const [prop, rawVal] of r.decls) {
        const prev = map.get(prop);
        if (prev && (prev.spec > r.spec || (prev.spec === r.spec && prev.order > r.order))) continue;
        map.set(prop, { value: rawVal, spec: r.spec, order: r.order });
      }
    }
    // A `style` attribute outranks every selector. It used to be appended to the
    // class list after the cascade instead of taking part in it — which reads
    // like it should win, but the classes all end up in one flat attribute
    // where order means nothing and Tailwind's generation order picks the
    // winner. Measured: `<h3 style="font-size:1.75rem">` rendered at the 21.6px
    // of `h3{font-size:clamp(…)}` instead of 28px.
    const styleAttr = el.getAttribute('style');
    if (styleAttr) {
      const decls = parseInlineStyle(styleAttr).filter(([prop]) => !DROP_PROPS.has(prop));
      if (decls.length > 0) {
        plain.push({ bucket: '', spec: INLINE_SPECIFICITY, order: INLINE_SPECIFICITY, decls });
      }
    }
    for (const [bucket, map] of resolveBuckets(plain)) buckets[bucket] = map;
    // Withdraw any UA seed the author has already covered with a shorthand.
    // Specificity can't do this on its own: `padding-left` (seed) and
    // `padding` (author) are different keys in this map, so both survive and
    // both become classes — and Tailwind sorts the longhand last, inverting
    // the cascade. Measured: `.site-footer ul{list-style:none;padding:0;
    // margin:0}` vs the UA's `ul{padding-left:40px}` indented the whole footer
    // nav by 40px.
    for (const map of Object.values(buckets)) {
      for (const [prop, winner] of map) {
        if (winner.spec !== UA_SPECIFICITY) continue;
        if (shorthandsFor(prop).some((s) => (map.get(s)?.spec ?? UA_SPECIFICITY) !== UA_SPECIFICITY)) {
          map.delete(prop);
        }
      }
    }
    return buckets;
  };

  // Quotes cannot survive into class attributes (broken HTML) — Tailwind
  // arbitrary values work unquoted with underscores for spaces.
  const cleanValue = (v: string): string => rewriteUrls(resolveVars(v)).replace(/["']/g, '');

  const bucketToClasses = (map: Map<string, Winner>): string[] => {
    const declStr = [...map.entries()]
      .map(([p, w]) => `${p}: ${cleanValue(w.value)}`)
      .join('; ');
    return cssToClasses(declStr);
  };

  const computeClasses = (el: El): string => {
    const buckets = computeBuckets(el);
    const out: string[] = [];
    // Order: base, then max-lg, then max-md, then hover variants
    for (const key of ['', 'max-lg:', 'max-md:', 'hover:', 'hover:max-lg:', 'hover:max-md:']) {
      const map = buckets[key];
      if (!map) continue;
      const prefix = key.startsWith('hover:') ? 'hover:' : key;
      out.push(...bucketToClasses(map).map((c) => (prefix ? prefix + c : c)));
    }
    return [...new Set(out)].join(' ');
  };

  // True when an inline descendant is promoted to block/element styling by CSS
  const isBlockified = (el: El): boolean => {
    const buckets = computeBuckets(el);
    const disp = buckets['']?.get('display')?.value;
    return !!disp && disp !== 'inline';
  };
  const displayOf = (el: El): string | undefined => computeBuckets(el)['']?.get('display')?.value;
  const collapseCtx = { isBlockified: (el: El) => isBlockified(el), displayOf: (el: El) => displayOf(el) };

  // ───────────────────────── 4. HTML → layers ─────────────────────────
  const rewriteHref = (href: string): string => {
    if (/^(https?:|tel:|mailto:|#|wa\.me)/.test(href)) return href;
    const m = href.match(/^\/?([\w-]+)\.html(#.*)?$/);
    if (m) return m[1] === 'index' ? `/${m[2] ?? ''}` : `/${m[1]}${m[2] ?? ''}`;
    return href;
  };

  // See lib/import/rin5-html.ts: also blockifies a bare inline child that has
  // no `display` rule of its own but sits directly inside a flex/grid parent.
  const isTextLeaf = (el: El): boolean => isInlineCollapsible(el, INLINE_OK, collapseCtx);

  type Mark = { type: string; attrs?: Record<string, unknown> };
  const collectInline = (node: Node, marks: Mark[]): Array<Record<string, unknown>> => {
    const out: Array<Record<string, unknown>> = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const text = child.textContent || '';
        if (text) out.push({ type: 'text', text, ...(marks.length ? { marks: [...marks] } : {}) });
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as El;
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') { out.push({ type: 'hardBreak' }); continue; }
      if (tag === 'a') {
        const link: Mark = {
          type: 'richTextLink',
          attrs: {
            type: 'url',
            url: { type: 'dynamic_text', data: { content: rewriteHref(el.getAttribute('href') || '') } },
          },
        };
        out.push(...collectInline(el, [...marks, link]));
        continue;
      }
      const markType = MARK_TAGS[tag];
      out.push(...collectInline(el, markType ? [...marks, { type: markType }] : marks));
    }
    return out;
  };

  const richText = (el: El) => ({
    type: 'dynamic_rich_text',
    data: { content: { type: 'doc', content: [{ type: 'paragraph', content: collectInline(el, []) }] } },
  });
  const richTextFromString = (text: string) => ({
    type: 'dynamic_rich_text',
    data: { content: { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] } },
  });

  type Layer = Record<string, any>;

  // CSS counters (`.steps{counter-reset:step}` / `.step{counter-increment:step}`)
  // are a single flat namespace here — good enough for the one-level, non-nested
  // shape seen in practice (numbered step lists). Cleared per page in the page
  // loop below; mutated in document order as elementToLayerInner visits each
  // element, mirroring how the browser evaluates counters top-down.
  const counters = new Map<string, number>();
  const applyCounterMutations = (el: El): void => {
    for (const r of counterResets) if (matchesSafe(el, r.sel)) counters.set(r.name, r.value);
    for (const r of counterIncrements) if (matchesSafe(el, r.sel)) counters.set(r.name, (counters.get(r.name) ?? 0) + r.amount);
  };

  // One winner map per media bucket, exactly like `computeBuckets` does for real
  // elements. Collapsing all of them into a single cascade is what made
  // `.nav a.active::after{display:block}` lose to the `display:none` that
  // `@media (max-width:760px)` declares later in the sheet: the pseudo-element
  // came out `hidden` at every width and the active-link underline disappeared
  // on desktop as well (P-2609/G9).
  const pseudoBucketsFor = (el: El, pseudo: 'before' | 'after'): Map<CssBucket, Map<string, Winner>> | undefined => {
    const matched = pseudoRules.filter((r) => r.pseudo === pseudo && matchesSafe(el, r.sel));
    if (matched.length === 0) return undefined;
    return resolveBuckets(matched);
  };

  // Synthesizes a child layer for a `::before`/`::after` rule: a text leaf for
  // literal/`counter()` content, an empty decorative layer for `content:""`
  // that still carries a background/border, or nothing at all (out-of-subset
  // constructs like `attr()`/`url()`, or purely decorative-but-invisible rules
  // used only for hover transitions). Must run after `applyCounterMutations(el)`
  // for this element so `counter()` reads this element's own increment.
  const synthesizePseudoLayer = (el: El, pseudo: 'before' | 'after'): Layer | null => {
    const buckets = pseudoBucketsFor(el, pseudo);
    if (!buckets) return null;
    // `content` and the visual-box test look across every bucket: whether the
    // pseudo-element exists at all is one decision for the whole layer, even
    // when only a media query declares it. Only the styling is per-bucket.
    const contentWinner = BUCKET_ORDER.map((b) => buckets.get(b)?.get('content')).find(Boolean);
    const resolved = resolvePseudoContent(contentWinner?.value, counters);
    if (resolved.kind === 'skip') return null;
    const allProps = BUCKET_ORDER.flatMap((b) => [...(buckets.get(b)?.keys() ?? [])]);
    if (resolved.kind === 'empty' && !pseudoHasVisualBox(allProps.filter((p) => p !== 'content'))) return null;

    const classes = [...new Set(BUCKET_ORDER.flatMap((bucket) => {
      const map = buckets.get(bucket);
      if (!map) return [];
      const stylingMap = new Map(map);
      stylingMap.delete('content');
      return bucketToClasses(stylingMap).map((c) => bucket + c);
    }))].join(' ');
    if (resolved.kind === 'empty') return { id: generateId('lyr'), name: 'div', classes };
    return {
      id: generateId('lyr'),
      name: 'span',
      classes,
      restrictions: { editText: true },
      variables: { text: richTextFromString(resolved.text) },
    };
  };

  // Counters are already mutated for `el` by the time this runs (see the call
  // to `applyCounterMutations` at the top of `elementToLayerInner`), so this
  // reuses the exact same skip/empty/text decision `synthesizePseudoLayer`
  // makes — an element whose only pseudo rule is invisible (no text, no box)
  // still collapses to a text leaf as before.
  const hasPseudoLayer = (el: El): boolean =>
    synthesizePseudoLayer(el, 'before') !== null || synthesizePseudoLayer(el, 'after') !== null;

  const sanitizeSvg = (el: El): void => {
    el.querySelectorAll('script').forEach((s) => s.remove());
    const walk = (node: Element) => {
      for (const attr of Array.from(node.attributes)) {
        if (attr.name.toLowerCase().startsWith('on')) node.removeAttribute(attr.name);
      }
      for (const c of Array.from(node.children)) walk(c);
    };
    walk(el);
  };

  const elementToLayer = (el: El): Layer | null => {
    const layer = elementToLayerInner(el);
    if (layer && !layer.customName) {
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0];
      if (cls) layer.customName = cls;
    }
    return layer;
  };

  const elementToLayerInner = (el: El): Layer | null => {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'br', 'title'].includes(tag)) return null;

    applyCounterMutations(el);
    const classes = computeClasses(el);

    if (tag === 'svg') {
      sanitizeSvg(el);
      el.removeAttribute('class');
      return {
        id: generateId('lyr'),
        name: 'icon',
        classes,
        variables: { icon: { src: { type: 'static_text', data: { content: el.outerHTML } } } },
      };
    }

    if (tag === 'img') {
      const src = el.getAttribute('src') || '';
      const asset = assetByRef(src);
      const layer: Layer = {
        id: generateId('lyr'),
        name: 'image',
        classes,
        variables: {
          image: {
            src: asset
              ? { type: 'asset', data: { asset_id: asset.id } }
              : { type: 'dynamic_text', data: { content: src } },
            alt: { type: 'dynamic_text', data: { content: el.getAttribute('alt') || '' } },
          },
        },
      };
      const w = el.getAttribute('width');
      const h = el.getAttribute('height');
      if (w || h) layer.attributes = { ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) };
      return layer;
    }

    if (tag === 'hr') return { id: generateId('lyr'), name: 'hr', classes };

    // `<details>`/`<summary>`: Ycode has no native disclosure widget, but it does
    // have exactly the primitive this needs — a `click` interaction with a
    // `display` tween, which the static export ships as a ~40-line runtime
    // (`INTERACTIONS_BOOT_SCRIPT` in lib/apps/static-export/document.ts). Map the
    // `<summary>` to the trigger and every sibling to a target that starts
    // hidden, and the export reproduces the closed-by-default accordion the
    // source renders — including the `+` marker, because `.faq summary::after`
    // matches a closed `<details>` while `.faq details[open] summary::after`
    // does not, and the importer resolves the cascade against the real DOM.
    //
    // Two things the model can't carry (see docs/rin5-import-subset.md): the
    // marker doesn't flip to `–` on open (`[open]` state styling has no
    // equivalent), and a viewport resize re-applies the on-load hidden state,
    // closing an open panel.
    if (tag === 'details') {
      const summaryEl = Array.from(el.children).find(
        (c) => (c as El).tagName.toLowerCase() === 'summary',
      ) as El | undefined;
      const panelEls = Array.from(el.children).filter((c) => c !== summaryEl) as El[];

      if (summaryEl && panelEls.length > 0) {
        const summaryLayer = elementToLayer(summaryEl);
        const panelLayers = panelEls.map((c) => elementToLayer(c)).filter((l): l is Layer => !!l);

        if (summaryLayer && panelLayers.length > 0) {
          summaryLayer.interactions = [{
            id: generateId('int'),
            trigger: 'click',
            // No breakpoint restriction: a disclosure is a disclosure at every
            // width. `yoyo` is what makes the second click close it again.
            timeline: { breakpoints: [], repeat: 0, yoyo: true },
            tweens: panelLayers.map((panel) => ({
              id: generateId('twn'),
              layer_id: panel.id,
              position: 0,
              duration: 0,
              ease: 'none',
              from: { display: 'hidden' },
              to: { display: 'visible' },
              // `on-load` is what paints the closed state before first paint;
              // without it every answer renders open and only hides on click.
              apply_styles: { display: 'on-load' },
            })),
          }] as Layer['interactions'];

          return {
            id: generateId('lyr'),
            name: 'div',
            classes,
            children: [summaryLayer, ...panelLayers],
          };
        }
      }
    }

    // Text leaves
    const isHeading = HEADINGS.has(tag);
    // `dd` (contact/address blocks routinely use `<dd>street<br>zip city</dd>`)
    // must go through the rich-text path: the generic Containers branch below
    // drops a bare `<br>` child entirely (it's in the top-of-function
    // script/style/br/… ignore-list) and turns the two text nodes around it
    // into separate, unbroken inline spans — "Rambla de Sant Joan, 89" and
    // "08917 Badalona" run together as "8908917 Badalona" with no line break
    // and no separating space. `collectInline` (used by the rich-text path)
    // already turns `<br>` into a proper `hardBreak` node.
    const textish = isHeading || tag === 'p' || tag === 'span' || tag === 'strong' || tag === 'small'
      || tag === 'td' || tag === 'th' || tag === 'figcaption' || tag === 'h4' || tag === 'dd';
    // A pseudo-element rule (numbered step, bullet, "+"/"–" toggle icon…) wins
    // over rich-text collapse: it needs its own child layer, so the element
    // must stay a container even when its text content alone would collapse.
    if (textish && isTextLeaf(el) && !hasPseudoLayer(el) && (el.textContent || '').trim()) {
      const layer: Layer = {
        id: generateId('lyr'),
        name: isHeading ? 'heading' : (tag === 'span' || tag === 'strong' ? 'span' : 'text'),
        classes,
        restrictions: { editText: true },
        variables: { text: richText(el) },
      };
      if (isHeading) layer.settings = { tag };
      else if (SEMANTIC_TAGS[tag]) layer.settings = { tag: SEMANTIC_TAGS[tag] };
      return layer;
    }

    // Containers
    const name = tag === 'section' ? 'section' : tag === 'button' ? 'button' : 'div';
    const layer: Layer = { id: generateId('lyr'), name, classes };
    if (isHeading) layer.name = 'heading';
    if (isHeading) layer.settings = { tag };
    else if (SEMANTIC_TAGS[tag]) layer.settings = { tag: SEMANTIC_TAGS[tag] };

    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) {
        const link: Record<string, unknown> = {
          type: 'url',
          url: { type: 'dynamic_text', data: { content: rewriteHref(href) } },
        };
        const target = el.getAttribute('target');
        if (target) link.target = target;
        layer.variables = { ...layer.variables, link };
      }
    }
    const customId = el.getAttribute('id');
    if (customId) layer.attributes = { ...layer.attributes, id: customId };
    // Carry over data-*/aria-* attributes verbatim: the source site's mobile
    // menu (site.js) drives itself purely off `[data-nav]`/`[data-nav-toggle]`
    // + `data-open`/`aria-expanded`, so without these the re-imported script
    // has nothing to attach to. Boolean/no-value attributes (`data-nav`) come
    // back from linkedom as an empty string, which is fine for `[attr]`
    // selectors and `getAttribute('data-nav')` presence checks.
    for (const attr of Array.from((el as unknown as Element).attributes)) {
      if (attr.name.startsWith('aria-') || attr.name.startsWith('data-')) {
        layer.attributes = { ...layer.attributes, [attr.name]: attr.value };
      }
    }

    const children: Layer[] = [];
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        // Collapse whitespace but keep boundary spaces so inline spans don't glue
        const text = (node.textContent || '').replace(/\s+/g, ' ');
        if (text.trim()) {
          children.push({
            id: generateId('lyr'),
            name: 'span',
            classes: '',
            restrictions: { editText: true },
            variables: { text: richTextFromString(text) },
          });
        }
      } else if (node.nodeType === 1) {
        const childTag = (node as El).tagName.toLowerCase();
        if (childTag === 'br') {
          // `collectInline` turns `<br>` into a proper hardBreak, but only on
          // the rich-text path — and an element drops off that path as soon as
          // one descendant is blockified. `.locate__panel dd small{display:
          // block}` does exactly that to `<dd>Rambla…89<br>08917 Badalona…
          // <small>…</small></dd>`, so the `<br>` was discarded and the two
          // halves of the address ran together on one line.
          //
          // A zero-height block between the two inline runs splits them into
          // two anonymous block boxes, which is the same line break at the same
          // line-height. `basis-[100%]` covers the (meaningless but harmless)
          // case of a `<br>` inside a wrapping flex row.
          children.push({
            id: generateId('lyr'),
            name: 'div',
            classes: 'block w-full h-[0px] basis-[100%]',
            customName: 'br',
          });
          continue;
        }
        // Inline unclassed wrappers inside mixed content: recurse contents
        const child = elementToLayer(node as El);
        if (child) children.push(child);
      }
    }
    // `::before` goes first, `::after` last — same visual position the
    // pseudo-element occupies relative to the element's real content.
    const beforeLayer = synthesizePseudoLayer(el, 'before');
    if (beforeLayer) children.unshift(beforeLayer);
    const afterLayer = synthesizePseudoLayer(el, 'after');
    if (afterLayer) children.push(afterLayer);

    layer.children = children;
    return layer;
  };

  // ───────────────────────── 5. Build + insert pages ─────────────────────────
  const htmlFiles = fs.readdirSync(SITE_DIR).filter((f) => f.endsWith('.html'));
  console.log(`Importing ${htmlFiles.length} pages…`);

  // Soft-delete previously existing regular pages (draft AND published) so
  // slugs are free. Error pages are kept.
  const now = new Date().toISOString();
  const oldPages = await db('pages').whereNull('error_page').whereNull('deleted_at');
  if (oldPages.length > 0) {
    const ids = oldPages.map((p) => p.id);
    await db('pages').whereIn('id', ids).update({ deleted_at: now });
    await db('page_layers').whereIn('page_id', ids).update({ deleted_at: now });
    console.log(`  soft-deleted ${oldPages.length} pre-existing pages`);
  }

  // ───────────────────────── 4b. Fonts detection ─────────────────────────
  // Read the site's own Google Fonts <link> tags instead of a hardcoded
  // Inter/Bricolage/Caveat list — that list was never the family the source
  // site actually used (--font-sans/--font-serif vary per client), so the
  // <head> never loaded the fonts the CSS asked for and the browser silently
  // fell back to its default sans/serif, which is a large source of pixel
  // diff on any text-heavy page.
  const anyHtmlFile = fs.readdirSync(SITE_DIR).find((f) => f.endsWith('.html'));
  const headSampleHtml = anyHtmlFile ? fs.readFileSync(path.join(SITE_DIR, anyHtmlFile), 'utf8') : '';
  const fontLinkTags = [...headSampleHtml.matchAll(
    /<link\b[^>]*href="[^"]*fonts\.g(?:oogleapis|static)\.com[^"]*"[^>]*>/g,
  )].map((m) => m[0]);
  const FALLBACK_FONTS_HEAD = [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Caveat:wght@600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">',
  ].join('\n');
  const fontsHead = fontLinkTags.length > 0 ? fontLinkTags.join('\n') : FALLBACK_FONTS_HEAD;

  const css2LinkHref = fontLinkTags.map((tag) => tag.match(/href="([^"]+)"/)?.[1]).find((h) => h?.includes('css2?'));

  /** Parse a Google Fonts css2 URL (`family=Name:ital,wght@0,400;0,700&family=…`) into per-family weight/variant lists. */
  function parseGoogleFontsCss2Url(href: string): Array<{ family: string; weights: number[]; variants: string[] }> {
    const query = (href.split('?')[1] || '').replace(/&amp;/g, '&');
    const params = new URLSearchParams(query);
    return params.getAll('family').map((spec) => {
      const [rawFamily, axesSpec] = spec.split(':');
      const family = rawFamily.replace(/\+/g, ' ');
      if (!axesSpec) return { family, weights: [400], variants: ['regular'] };
      const [axesNamesPart, valuesPart] = axesSpec.split('@');
      const axisNames = (axesNamesPart || '').split(',').filter(Boolean);
      const weights = new Set<number>();
      const variants = new Set<string>();
      for (const tuple of (valuesPart || '').split(';').filter(Boolean)) {
        const vals = tuple.split(',');
        const rec: Record<string, string> = {};
        axisNames.forEach((axis, i) => { rec[axis] = vals[i]; });
        const wght = rec.wght ? parseInt(rec.wght, 10) : 400;
        const ital = rec.ital === '1';
        weights.add(wght);
        variants.add(ital ? `${wght}italic` : (wght === 400 ? 'regular' : String(wght)));
      }
      return { family, weights: [...weights].sort((a, b) => a - b), variants: [...variants] };
    });
  }

  // `--font-sans`/`--font-serif`/`--font-mono` custom properties tell us which
  // detected family plays which role, so the `fonts` table category matches
  // (purely metadata — the arbitrary `font-[…]` utilities already embed the
  // full literal stack — but rin5-import should still leave the fonts table
  // in the shape a human editing in Ycode would expect).
  const categoryByFamilyLower = new Map<string, string>();
  for (const [varName, varValue] of vars) {
    if (!varName.startsWith('--font-')) continue;
    const category = varName.includes('serif') ? 'serif' : varName.includes('mono') ? 'monospace' : 'sans-serif';
    const m = varValue.match(/^"?([^",]+)"?/);
    if (m) categoryByFamilyLower.set(m[1].trim().toLowerCase(), category);
  }

  const detectedFonts = css2LinkHref
    ? parseGoogleFontsCss2Url(css2LinkHref).map((f) => ({
      name: f.family.toLowerCase().replace(/\s+/g, '-'),
      family: f.family,
      category: categoryByFamilyLower.get(f.family.toLowerCase()) || 'sans-serif',
      weights: f.weights,
      variants: f.variants,
    }))
    : null;

  // Mobile-menu behavior (`[data-nav-toggle]` / `[data-nav]` / `data-open`)
  // lives in a tiny site-wide script, not a Ycode component. Ycode's static
  // export has no generic "attach this script to every page" mechanism
  // outside of `settings.custom_code`, which is per-page — so the script is
  // duplicated into every page's `custom_code.body` verbatim (same content
  // the source site itself served) rather than mapped onto Ycode's own nav
  // component, which does not model this toggle behavior. Element attributes
  // it depends on (`data-nav`, `data-nav-toggle`) are carried over by the
  // generic data-*/aria-* passthrough in `elementToLayerInner` above.
  const siteJsPath = path.join(SITE_DIR, 'site.js');
  const siteJsBody = fs.existsSync(siteJsPath)
    ? `<script>${fs.readFileSync(siteJsPath, 'utf8')}</script>`
    : '';

  let orderIdx = 0;
  const importedPages: Array<{ id: string; slug: string; name: string }> = [];
  for (const file of htmlFiles.sort()) {
    counters.clear();
    const html = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
    const { document } = parseHTML(html);
    const base = file.replace(/\.html$/, '');
    const isIndex = base === 'index';
    const slug = isIndex ? '' : base;
    const title = document.querySelector('title')?.textContent?.trim() || base;
    const name = isIndex ? 'Inicio' : (title.split(/[—|·]/)[0].trim() || base);
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
    const noindex = /noindex/.test(document.querySelector('meta[name="robots"]')?.getAttribute('content') || '');

    const body = document.body as unknown as El;
    const bodyClasses = computeClasses(body);
    const children: Layer[] = [];
    for (const node of Array.from(document.body.childNodes)) {
      if (node.nodeType !== 1) continue;
      const layer = elementToLayer(node as El);
      if (layer) children.push(layer);
    }
    const layers = [{ id: 'body', name: 'body', classes: bodyClasses, children }];

    const settings = {
      seo: { title, description, image: null, noindex },
      custom_code: { head: fontsHead, body: siteJsBody },
    };
    const metaHash = generatePageMetadataHash({
      name, slug, settings, is_index: isIndex, is_dynamic: false, error_page: null,
    });
    const [page] = await db('pages')
      .insert({
        name,
        slug,
        order: orderIdx++,
        depth: 0,
        is_index: isIndex,
        is_published: false,
        settings: JSON.stringify(settings),
        content_hash: metaHash,
      })
      .returning('*');

    const layersHash = generatePageLayersHash({ layers, generated_css: null });
    await db('page_layers').insert({
      page_id: page.id,
      layers: JSON.stringify(layers),
      is_published: false,
      content_hash: layersHash,
    });
    importedPages.push({ id: page.id, slug, name });
    console.log(`  ✓ ${file} → /${slug} (${name})`);

    // Compile this page's Tailwind classes into page_layers.generated_css.
    // Not strictly what feeds the export bundle (see draft_css note below),
    // but it keeps per-page content_hash / builder-canvas CSS consistent with
    // how the app itself generates CSS after any layer edit.
    await generateCSSForPage(page.id);
  }

  // The static-export pipeline (lib/apps/static-export/engine.ts) injects the
  // `published_css` *setting*, not any single page's `generated_css` — and
  // `published_css` is just a copy of the `draft_css` setting made at publish
  // time (lib/services/settingsService.ts). `draft_css` itself is a full
  // recompile across every draft page + component (generateAndSaveDraftCSS),
  // not an aggregate of the per-page columns above. Without this call
  // `draft_css` stays whatever it was before this import (typically empty),
  // publish would copy nothing into `published_css`, and the export would
  // ship zero Tailwind rules — which was the dominant cause of the measured
  // 26-74% pixel diff.
  await generateAndSaveDraftCSS();

  // ───────────────────────── 6. Fonts ─────────────────────────
  const fonts = detectedFonts ?? [
    { name: 'inter', family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700], variants: ['regular', '500', '600', '700'] },
    { name: 'bricolage-grotesque', family: 'Bricolage Grotesque', category: 'sans-serif', weights: [700, 800], variants: ['700', '800'] },
    { name: 'caveat', family: 'Caveat', category: 'handwriting', weights: [600], variants: ['600'] },
  ];
  // Drop stale font rows from a previous run whose detected family list
  // doesn't match this one (e.g. re-importing a different client site).
  const keepFontNames = fonts.map((f) => f.name);
  const staleFonts = await db('fonts').where({ is_published: false }).whereNull('deleted_at').whereNotIn('name', keepFontNames);
  if (staleFonts.length > 0) {
    await db('fonts').whereIn('id', staleFonts.map((f) => f.id)).update({ deleted_at: now });
    console.log(`  soft-deleted ${staleFonts.length} stale font row(s)`);
  }
  for (const f of fonts) {
    const exists = await db('fonts').where({ name: f.name, is_published: false }).whereNull('deleted_at').first();
    if (exists) continue;
    await db('fonts').insert({
      name: f.name,
      family: f.family,
      type: 'google',
      category: f.category,
      weights: JSON.stringify(f.weights),
      variants: JSON.stringify(f.variants),
      is_published: false,
    });
    console.log(`  ✓ font ${f.family}`);
  }

  console.log('\nDone. Imported pages:');
  for (const p of importedPages) console.log(`  ${p.name}: /${p.slug} (${p.id})`);
  await db.destroy();
}

/**
 * Exposed so `scripts/rin5-roundtrip.ts` can await the import instead of
 * racing it: importing this module is what starts the work, and without a
 * handle to wait on, publish and export would run against a half-written site.
 */
export const imported = main();

imported.catch((err) => {
  console.error(err);
  process.exit(1);
});
