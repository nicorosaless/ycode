import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import {
  resolvePseudoContent,
  formatCounterValue,
  parseCounterReset,
  parseCounterIncrement,
  pseudoHasVisualBox,
  isInlineCollapsible,
  uaDefaultDecls,
  shorthandsFor,
  expandBoxShorthand,
  parseInlineStyle,
  bucketForMedia,
  resolveBuckets,
  BUCKET_ORDER,
  isSupportedSelector,
} from '@/lib/import/rin5-html';
import { cssToClasses } from '@/lib/import/css';

test('resolvePseudoContent: literal string content, quotes and escapes stripped', () => {
  assert.deepEqual(resolvePseudoContent('"→"', new Map()), { kind: 'text', text: '→' });
  assert.deepEqual(resolvePseudoContent('"–"', new Map()), { kind: 'text', text: '–' });
  assert.deepEqual(resolvePseudoContent(String.raw`"can\'t"`, new Map()), { kind: 'text', text: "can't" });
});

test('resolvePseudoContent: none/empty-string content is decorative, not text', () => {
  assert.deepEqual(resolvePseudoContent('""', new Map()), { kind: 'empty' });
  assert.deepEqual(resolvePseudoContent('none', new Map()), { kind: 'empty' });
});

test('resolvePseudoContent: absent content declaration generates no box (per spec)', () => {
  assert.deepEqual(resolvePseudoContent(undefined, new Map()), { kind: 'skip' });
});

test('resolvePseudoContent: unsupported constructs (attr/url) are skipped, not guessed at', () => {
  assert.deepEqual(resolvePseudoContent('attr(data-label)', new Map()), { kind: 'skip' });
  assert.deepEqual(resolvePseudoContent('url(icon.svg)', new Map()), { kind: 'skip' });
});

test('resolvePseudoContent: counter() resolves against the running counter map', () => {
  const counters = new Map([['step', 3]]);
  assert.deepEqual(resolvePseudoContent('counter(step)', counters), { kind: 'text', text: '3' });
  assert.deepEqual(
    resolvePseudoContent('counter(step, decimal-leading-zero)', counters),
    { kind: 'text', text: '03' },
  );
});

test('formatCounterValue: decimal-leading-zero pads to two digits, decimal does not', () => {
  assert.equal(formatCounterValue(3, 'decimal-leading-zero'), '03');
  assert.equal(formatCounterValue(11, 'decimal-leading-zero'), '11');
  assert.equal(formatCounterValue(3, 'decimal'), '3');
});

test('parseCounterReset/parseCounterIncrement: default value/amount when omitted', () => {
  assert.deepEqual(parseCounterReset('step'), { name: 'step', value: 0 });
  assert.deepEqual(parseCounterReset('step 5'), { name: 'step', value: 5 });
  assert.deepEqual(parseCounterIncrement('step'), { name: 'step', amount: 1 });
  assert.deepEqual(parseCounterIncrement('step 2'), { name: 'step', amount: 2 });
});

test('pseudoHasVisualBox: background/border props earn a decorative layer, layout-only props do not', () => {
  assert.equal(pseudoHasVisualBox(['background', 'width', 'height']), true);
  assert.equal(pseudoHasVisualBox(['border-top-left-radius']), true);
  assert.equal(pseudoHasVisualBox(['width', 'height', 'flex']), false);
  assert.equal(pseudoHasVisualBox(['transform', 'transition']), false);
});

const INLINE_OK = new Set(['br', 'strong', 'b', 'em', 'i', 'small', 'a', 'span', 'u', 's', 'sub', 'sup']);

test('isInlineCollapsible: a flex-column parent blockifies its children even without their own display rule', () => {
  // Mirrors clients/7/site: `.brand__name{display:flex;flex-direction:column}`
  // wraps a bare `<span>` (no class, no own display rule) holding the second line.
  const { document } = parseHTML(
    '<span class="brand__name">Autoescuela Lloreda<span>Badalona · Rambla de Sant Joan</span></span>',
  );
  const el = document.querySelector('.brand__name')!;
  const ctx = {
    isBlockified: () => false,
    displayOf: (node: Element) => (node === el ? 'flex' : undefined),
  };
  assert.equal(isInlineCollapsible(el, INLINE_OK, ctx), false);
});

test('isInlineCollapsible: plain inline text with no block-forcing ancestor still collapses', () => {
  const { document } = parseHTML('<span class="eyebrow">Coche</span>');
  const el = document.querySelector('.eyebrow')!;
  const ctx = { isBlockified: () => false, displayOf: () => undefined };
  assert.equal(isInlineCollapsible(el, INLINE_OK, ctx), true);
});

test('isInlineCollapsible: a classed child still breaks collapse regardless of display', () => {
  const { document } = parseHTML('<span class="brand__name">Name<span class="sub">Address</span></span>');
  const el = document.querySelector('.brand__name')!;
  const ctx = { isBlockified: () => false, displayOf: () => undefined };
  assert.equal(isInlineCollapsible(el, INLINE_OK, ctx), false);
});

test('uaDefaultDecls: <figure> keeps the UA 1em/40px margin box', () => {
  // The single largest desktop diff left in round 2 (hero, 16.5%): the source
  // stylesheet has no `*{margin:0}` reset, so the figure was 80px narrower and
  // 34px shorter than the div Ycode renders under Tailwind preflight.
  assert.deepEqual(uaDefaultDecls('figure'), [
    ['margin-top', '1em'],
    ['margin-right', '40px'],
    ['margin-bottom', '1em'],
    ['margin-left', '40px'],
  ]);
  assert.deepEqual(uaDefaultDecls('FIGURE'), uaDefaultDecls('figure'));
});

test('uaDefaultDecls: headings carry both the margin and the type scale', () => {
  assert.deepEqual(uaDefaultDecls('h1'), [
    ['margin-top', '.67em'],
    ['margin-bottom', '.67em'],
    ['font-size', '2em'],
    ['font-weight', '700'],
  ]);
  assert.deepEqual(uaDefaultDecls('h4'), [
    ['margin-top', '1.33em'],
    ['margin-bottom', '1.33em'],
    ['font-weight', '700'],
  ]);
});

test('uaDefaultDecls: list and definition-list indentation', () => {
  assert.deepEqual(uaDefaultDecls('ul'), [
    ['margin-top', '1em'],
    ['margin-bottom', '1em'],
    ['padding-left', '40px'],
    ['list-style-type', 'disc'],
  ]);
  assert.deepEqual(uaDefaultDecls('dd'), [['margin-left', '40px']]);
  assert.deepEqual(uaDefaultDecls('dl'), [['margin-top', '1em'], ['margin-bottom', '1em']]);
});

test('uaDefaultDecls: only longhands, so an author longhand can win per side', () => {
  for (const tag of ['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'dl', 'dd', 'figure', 'blockquote', 'hr']) {
    for (const [prop] of uaDefaultDecls(tag)) {
      assert.notEqual(prop, 'margin', `${tag} must not seed the \`margin\` shorthand`);
      assert.notEqual(prop, 'padding', `${tag} must not seed the \`padding\` shorthand`);
      assert.notEqual(prop, 'border', `${tag} must not seed the \`border\` shorthand`);
    }
  }
});

test('uaDefaultDecls: tags with no layout-relevant UA style seed nothing', () => {
  assert.deepEqual(uaDefaultDecls('div'), []);
  assert.deepEqual(uaDefaultDecls('span'), []);
  assert.deepEqual(uaDefaultDecls('section'), []);
  assert.deepEqual(uaDefaultDecls('a'), []);
});

test('shorthandsFor: a UA longhand names every shorthand that would override it', () => {
  // `.site-footer ul{list-style:none;padding:0;margin:0}` in the reference
  // client competes with the UA's `padding-left`/`margin-top`. Different map
  // keys, so neither wins by specificity and both classes reach the output —
  // where Tailwind sorts `pl-[40px]` after `p-[0]` and the footer nav got a
  // 40px indent it never had. The seed has to stand down instead.
  assert.deepEqual(shorthandsFor('padding-left'), ['padding']);
  assert.deepEqual(shorthandsFor('margin-top'), ['margin']);
  assert.deepEqual(shorthandsFor('list-style-type'), ['list', 'list-style']);
  assert.deepEqual(shorthandsFor('font-size'), ['font']);
  assert.deepEqual(shorthandsFor('font-weight'), ['font']);
});

test('shorthandsFor: a single-word property has no shorthand above it', () => {
  assert.deepEqual(shorthandsFor('color'), []);
  assert.deepEqual(shorthandsFor('display'), []);
});

test('uaDefaultDecls: form controls do not inherit typography, so the seed restores the break', () => {
  // Measured on the mobile header of clients/7 (9.76% on every page): `.btn`
  // sets family/size/weight but not line-height, so the source button keeps the
  // UA's `normal` (~18.2px) while Tailwind preflight's `button{font:inherit}`
  // gave the export body's 1.6 (21.76px). 3px taller button → 3px taller
  // header → every element inside shifted 2px down.
  const button = new Map(uaDefaultDecls('button'));
  assert.equal(button.get('line-height'), 'normal');
  assert.equal(button.get('font-family'), 'Arial');
  assert.equal(button.get('font-size'), '13.3333px');
  assert.equal(button.get('text-align'), 'center');

  for (const tag of ['input', 'select', 'textarea']) {
    assert.equal(new Map(uaDefaultDecls(tag)).get('line-height'), 'normal', tag);
  }
});

test('expandBoxShorthand: 1/2/3/4-value forms expand to the four sides', () => {
  assert.deepEqual(expandBoxShorthand('margin', '0'), [
    ['margin-top', '0'], ['margin-right', '0'], ['margin-bottom', '0'], ['margin-left', '0'],
  ]);
  assert.deepEqual(expandBoxShorthand('margin', '0 auto'), [
    ['margin-top', '0'], ['margin-right', 'auto'], ['margin-bottom', '0'], ['margin-left', 'auto'],
  ]);
  // `p{margin:0 0 1em}` + `p:last-child{margin-bottom:0}` in the reference
  // client: different map keys, so specificity never got to decide and both
  // `mb-[1em]` and `mb-[0]` reached the class list. Every section's trailing
  // paragraph kept a 1em margin it should not have had — 17px of drift at the
  // top of a section, which the per-section clip turns into a 20–28% diff.
  assert.deepEqual(expandBoxShorthand('margin', '0 0 1em'), [
    ['margin-top', '0'], ['margin-right', '0'], ['margin-bottom', '1em'], ['margin-left', '0'],
  ]);
  assert.deepEqual(expandBoxShorthand('padding', '1px 2px 3px 4px'), [
    ['padding-top', '1px'], ['padding-right', '2px'], ['padding-bottom', '3px'], ['padding-left', '4px'],
  ]);
});

test('expandBoxShorthand: the split is paren-aware, so a function is one side and not three', () => {
  assert.deepEqual(expandBoxShorthand('padding', 'clamp(2rem, 4vw, 3rem)'), [
    ['padding-top', 'clamp(2rem, 4vw, 3rem)'], ['padding-right', 'clamp(2rem, 4vw, 3rem)'],
    ['padding-bottom', 'clamp(2rem, 4vw, 3rem)'], ['padding-left', 'clamp(2rem, 4vw, 3rem)'],
  ]);
  // `.site-footer{padding: clamp(3.5rem,5vw,4.5rem) 0 6rem}` — a function in
  // one side of a three-value shorthand. Splitting on whitespace would give
  // `padding-top: clamp(…) 0 6rem`, which is not a value at all.
  assert.deepEqual(expandBoxShorthand('padding', 'clamp(3.5rem,5vw,4.5rem) 0 6rem'), [
    ['padding-top', 'clamp(3.5rem,5vw,4.5rem)'], ['padding-right', '0'],
    ['padding-bottom', '6rem'], ['padding-left', '0'],
  ]);
  // `.wrap{width:min(100% - 2.5rem,1220px)}`-style spaces inside the parens
  // must not create parts either.
  assert.deepEqual(expandBoxShorthand('margin', 'min(100% - 2.5rem, 1220px) auto'), [
    ['margin-top', 'min(100% - 2.5rem, 1220px)'], ['margin-right', 'auto'],
    ['margin-bottom', 'min(100% - 2.5rem, 1220px)'], ['margin-left', 'auto'],
  ]);
});

test('expandBoxShorthand: !important lands on every longhand, not as a fifth side', () => {
  assert.deepEqual(expandBoxShorthand('margin', '0 auto !important'), [
    ['margin-top', '0 !important'], ['margin-right', 'auto !important'],
    ['margin-bottom', '0 !important'], ['margin-left', 'auto !important'],
  ]);
});

test('expandBoxShorthand: leaves anything that is not a box shorthand alone', () => {
  assert.equal(expandBoxShorthand('margin-top', '1em'), null);
  assert.equal(expandBoxShorthand('border', '1px solid red'), null);
  assert.equal(expandBoxShorthand('gap', '1rem 2rem'), null);
});

test('parseInlineStyle: declarations, with margin/padding already expanded', () => {
  // `<h3 style="font-family:var(--font-serif);font-size:1.75rem">` in
  // permiso-a.html. The importer used to append inline styles as extra classes
  // after the cascade instead of putting them *in* it, so `text-[1.75rem]` and
  // the `h3{font-size:clamp(…)}` class both reached the output and Tailwind's
  // generation order picked the loser: 21.6px instead of 28px.
  assert.deepEqual(parseInlineStyle('font-family:var(--font-serif);font-size:1.75rem'), [
    ['font-family', 'var(--font-serif)'],
    ['font-size', '1.75rem'],
  ]);
  assert.deepEqual(parseInlineStyle('margin:0 auto'), [
    ['margin-top', '0'], ['margin-right', 'auto'], ['margin-bottom', '0'], ['margin-left', 'auto'],
  ]);
});

test('parseInlineStyle: empty, trailing-semicolon and valueless input', () => {
  assert.deepEqual(parseInlineStyle(''), []);
  assert.deepEqual(parseInlineStyle('  '), []);
  assert.deepEqual(parseInlineStyle('color:red;'), [['color', 'red']]);
  assert.deepEqual(parseInlineStyle('color'), []);
  assert.deepEqual(parseInlineStyle('color:'), []);
});

// ── Media-query buckets, for pseudo-element rules too (P-2609/G9) ──
//
// `.nav a.active::after` is declared `display:block` in the base sheet and
// `display:none` inside `@media (max-width:760px)`. The importer collapsed
// every `::before`/`::after` rule into one cascade regardless of the at-rule
// it came from, so the media rule — later in the file — simply won and the
// active-link underline disappeared on desktop as well.

test('bucketForMedia maps a max-width query to the Tailwind max-* variant it approximates', () => {
  assert.equal(bucketForMedia('(max-width: 760px)'), 'max-md:');
  assert.equal(bucketForMedia('(max-width: 767px)'), 'max-md:');
  assert.equal(bucketForMedia('(max-width: 960px)'), 'max-lg:');
  assert.equal(bucketForMedia('(min-width: 768px)'), null);
  assert.equal(bucketForMedia('print'), null);
});

test('resolveBuckets keeps a media-query declaration out of the base bucket', () => {
  const buckets = resolveBuckets([
    { bucket: '', spec: 2001, order: 1, decls: [['content', '""'], ['display', 'block'], ['height', '3px']] },
    { bucket: 'max-md:', spec: 2001, order: 2, decls: [['display', 'none']] },
  ]);
  assert.equal(buckets.get('')?.get('display')?.value, 'block');
  assert.equal(buckets.get('max-md:')?.get('display')?.value, 'none');
  assert.equal(buckets.get('max-md:')?.has('height'), false);
});

test('resolveBuckets resolves specificity and order inside each bucket independently', () => {
  const buckets = resolveBuckets([
    { bucket: '', spec: 1000, order: 1, decls: [['color', 'red']] },
    { bucket: '', spec: 2000, order: 2, decls: [['color', 'green']] },
    { bucket: '', spec: 1000, order: 3, decls: [['color', 'blue']] },
  ]);
  assert.equal(buckets.get('')?.get('color')?.value, 'green');
});

test('the .nav a.active::after case ends up as an unprefixed block plus a max-md:hidden', () => {
  const buckets = resolveBuckets([
    { bucket: '', spec: 2001, order: 1, decls: [['display', 'block'], ['height', '3px']] },
    { bucket: 'max-md:', spec: 2001, order: 2, decls: [['display', 'none']] },
  ]);
  const classes: string[] = [];
  for (const bucket of BUCKET_ORDER) {
    const map = buckets.get(bucket);
    if (!map) continue;
    const decls = [...map].map(([p, w]) => `${p}: ${w.value}`).join('; ');
    classes.push(...cssToClasses(decls).map((c) => bucket + c));
  }
  assert.deepEqual(classes, ['block', 'h-[3px]', 'max-md:hidden']);
});

// ── El selector "búho" (P-2609/G9) ──
//
// `.stack > * + { margin-top: 1rem }` — el patrón de espaciado vertical más
// común en CSS escrito a mano — se descartaba entero porque el filtro de
// selectores rechazaba cualquier cosa que contuviera `*`. En la generación
// 188658f6 eso dejaba las tarjetas `.panel.stack` sin separación entre la
// etiqueta, el `h3` y el `p`, y las regiones `section.section-tint` eran las
// peores del round-trip (hasta 13,3%).
//
// Lo que sí hay que seguir descartando es un `*` sin anclar: `*{box-sizing:
// border-box}` está en todas estas hojas y emitirlo como clase en cada capa
// es ruido puro (el preflight de Tailwind ya lo aplica).

test('isSupportedSelector acepta el búho anclado en una clase', () => {
  assert.equal(isSupportedSelector('.stack > * + *'), true);
  assert.equal(isSupportedSelector('.prose * + *'), true);
  assert.equal(isSupportedSelector('.panel .tag'), true);
  assert.equal(isSupportedSelector('[data-x]'), true);
});

test('isSupportedSelector descarta un universal sin anclar y lo que ya estaba fuera del subset', () => {
  assert.equal(isSupportedSelector('*'), false);
  assert.equal(isSupportedSelector('* + *'), false);
  assert.equal(isSupportedSelector('* > *'), false);
  assert.equal(isSupportedSelector(''), false);
  assert.equal(isSupportedSelector('a:focus-visible'), false);
  assert.equal(isSupportedSelector('a:active'), false);
  assert.equal(isSupportedSelector('p::selection'), false);
});

test('el búho casa contra la tarjeta exacta de la generación 188658f6', () => {
  const { document } = parseHTML(
    '<div class="panel stack">' +
    '<span class="tag">Excursiones</span>' +
    '<h3>Salidas en grupo o personalizadas</h3>' +
    '<p>Para empresas o eventos.</p>' +
    '</div>',
  );
  const matched = [...document.querySelectorAll('*')]
    .filter((el) => el.matches('.stack > * + *'))
    .map((el) => el.tagName.toLowerCase());
  // La etiqueta es el primer hijo y no lleva `margin-top`; el h3 y el p sí.
  assert.deepEqual(matched, ['h3', 'p']);
});
