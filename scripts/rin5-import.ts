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

const SITE_DIR = path.resolve(process.env.RIN5_SITE_DIR || '/home/nicolas-rosales/src/rin5/clients/3-freeform-bench/site');
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

interface CssRule {
  sel: string;
  hover: boolean;
  bucket: '' | 'max-lg:' | 'max-md:';
  spec: number;
  order: number;
  decls: Array<[string, string]>;
}

function specificity(sel: string): number {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  const types = (sel.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 1_000_000 + classes * 1_000 + types;
}

function bucketForMedia(params: string): '' | 'max-lg:' | 'max-md:' | null {
  const m = params.match(/max-width:\s*(\d+)px/);
  if (!m) return null;
  const px = parseInt(m[1], 10);
  if (px <= 767) return 'max-md:';
  if (px <= 1200) return 'max-lg:';
  return null;
}

async function main() {
  const { parseHTML } = await import('linkedom');
  const postcss = (await import('postcss')).default;
  const { cssToClasses } = await import('../lib/import/css');
  const { generatePageMetadataHash, generatePageLayersHash } = await import('../lib/hash-utils');
  const { generateId } = await import('../lib/utils');
  const knexMod = await import('knex');
  const sharp = (await import('sharp')).default;
  const { createClient } = await import('@supabase/supabase-js');

  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SECRET = process.env.SUPABASE_SECRET_KEY!;
  const PUBLIC_BASE = (process.env.ASSET_PUBLIC_BASE || SUPABASE_URL).replace(/\/$/, '');
  const db = knexMod.default({ client: 'pg', connection: process.env.SUPABASE_CONNECTION_URL });
  const supabase = createClient(SUPABASE_URL, SECRET, { auth: { persistSession: false } });

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
    const storagePath = `website/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
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

  const rules: CssRule[] = [];
  let order = 0;
  root.walkRules((r) => {
    const parent = r.parent as { type?: string; name?: string; params?: string };
    let bucket: '' | 'max-lg:' | 'max-md:' = '';
    if (parent?.type === 'atrule') {
      if (parent.name !== 'media') return;
      if (/prefers-reduced-motion/.test(parent.params || '')) return;
      const b = bucketForMedia(parent.params || '');
      if (b === null) return;
      bucket = b;
    }
    const decls: Array<[string, string]> = [];
    r.walkDecls((d) => {
      if (d.prop.startsWith('--')) return;
      if (DROP_PROPS.has(d.prop)) return;
      decls.push([d.prop, d.value + (d.important ? ' !important' : '')]);
    });
    if (decls.length === 0) return;

    for (const rawSel of r.selector.split(',')) {
      const sel = rawSel.trim();
      if (!sel || sel === ':root') continue;
      if (/::|:focus-visible|:active|@|\*/.test(sel)) continue;
      const hover = sel.includes(':hover');
      if (hover) {
        // Only subject-level hover (`.btn:hover`), not ancestor hover (`.card:hover img`)
        const lastToken = sel.split(/[\s>+~]+/).filter(Boolean).pop() || '';
        if (!lastToken.includes(':hover')) continue;
      }
      rules.push({ sel, hover, bucket, spec: specificity(sel), order: order++, decls });
    }
  });
  console.log(`Parsed ${rules.length} CSS rule entries`);

  // ───────────────────────── 3. Element → classes ─────────────────────────
  type El = Element & { matches: (s: string) => boolean };
  const matchesSafe = (el: El, sel: string): boolean => {
    try { return el.matches(sel); } catch { return false; }
  };

  interface Winner { value: string; spec: number; order: number }

  const computeBuckets = (el: El): Record<string, Map<string, Winner>> => {
    const buckets: Record<string, Map<string, Winner>> = {};
    for (const r of rules) {
      const subject = r.hover ? r.sel.replace(/:hover/g, '') : r.sel;
      if (!matchesSafe(el, subject)) continue;
      const key = (r.hover ? 'hover:' : '') + r.bucket;
      const map = (buckets[key] ??= new Map());
      for (const [prop, rawVal] of r.decls) {
        const prev = map.get(prop);
        if (prev && (prev.spec > r.spec || (prev.spec === r.spec && prev.order > r.order))) continue;
        map.set(prop, { value: rawVal, spec: r.spec, order: r.order });
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
    const styleAttr = el.getAttribute('style');
    if (styleAttr) out.push(...cssToClasses(rewriteUrls(resolveVars(styleAttr))));
    return [...new Set(out)].join(' ');
  };

  // True when an inline descendant is promoted to block/element styling by CSS
  const isBlockified = (el: El): boolean => {
    const buckets = computeBuckets(el);
    const disp = buckets['']?.get('display')?.value;
    return !!disp && disp !== 'inline';
  };

  // ───────────────────────── 4. HTML → layers ─────────────────────────
  const rewriteHref = (href: string): string => {
    if (/^(https?:|tel:|mailto:|#|wa\.me)/.test(href)) return href;
    const m = href.match(/^\/?([\w-]+)\.html(#.*)?$/);
    if (m) return m[1] === 'index' ? `/${m[2] ?? ''}` : `/${m[1]}${m[2] ?? ''}`;
    return href;
  };

  const isTextLeaf = (el: El): boolean => {
    for (const child of el.querySelectorAll('*')) {
      const tag = child.tagName.toLowerCase();
      if (!INLINE_OK.has(tag)) return false;
      if (child.getAttribute('class')) return false;
      if (tag !== 'br' && isBlockified(child as El)) return false;
    }
    return true;
  };

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

    // Text leaves
    const isHeading = HEADINGS.has(tag);
    const textish = isHeading || tag === 'p' || tag === 'span' || tag === 'strong' || tag === 'small'
      || tag === 'td' || tag === 'th' || tag === 'figcaption' || tag === 'h4';
    if (textish && isTextLeaf(el) && (el.textContent || '').trim()) {
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
        // Inline unclassed wrappers inside mixed content: recurse contents
        const child = elementToLayer(node as El);
        if (child) children.push(child);
        void childTag;
      }
    }
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

  const fontsHead = [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Caveat:wght@600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">',
  ].join('\n');

  let orderIdx = 0;
  const importedPages: Array<{ id: string; slug: string; name: string }> = [];
  for (const file of htmlFiles.sort()) {
    const html = fs.readFileSync(path.join(SITE_DIR, file), 'utf8');
    const { document } = parseHTML(html);
    const base = file.replace(/\.html$/, '');
    const isIndex = base === 'index';
    const slug = isIndex ? '' : base;
    const title = document.querySelector('title')?.textContent?.trim() || base;
    const name = isIndex ? 'Inicio' : (title.split(/[—|]/)[0].trim() || base);
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
      custom_code: { head: fontsHead, body: '' },
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
  }

  // ───────────────────────── 6. Fonts ─────────────────────────
  const fonts = [
    { name: 'inter', family: 'Inter', category: 'sans-serif', weights: [400, 500, 600, 700], variants: ['regular', '500', '600', '700'] },
    { name: 'bricolage-grotesque', family: 'Bricolage Grotesque', category: 'sans-serif', weights: [700, 800], variants: ['700', '800'] },
    { name: 'caveat', family: 'Caveat', category: 'handwriting', weights: [600], variants: ['600'] },
  ];
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
