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

// `.wrap{max-width:1180px;margin-inline:auto;padding-inline:var(--gutter)}` es
// el contenedor de todas estas hojas. Con `*{margin:0}` en la cascada, el
// `margin-inline` del autor y los `margin-left/right` del reset caían en claves
// distintas: sobrevivían los dos, Tailwind ordenaba el longhand al final y el
// sitio entero se pegaba al margen izquierdo.

test('expandBoxShorthand: the logical inline/block shorthands expand to two sides', () => {
  assert.deepEqual(expandBoxShorthand('margin-inline', 'auto'), [
    ['margin-left', 'auto'],
    ['margin-right', 'auto'],
  ]);
  assert.deepEqual(expandBoxShorthand('padding-block', 'clamp(56px, 9vw, 110px)'), [
    ['padding-top', 'clamp(56px, 9vw, 110px)'],
    ['padding-bottom', 'clamp(56px, 9vw, 110px)'],
  ]);
  assert.deepEqual(expandBoxShorthand('margin-block', '0 1.5rem'), [
    ['margin-top', '0'],
    ['margin-bottom', '1.5rem'],
  ]);
});

test('expandBoxShorthand: leaves anything that is not a box shorthand alone', () => {
  assert.equal(expandBoxShorthand('margin-top', '1em'), null);
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

// ── El atajo `border` compite con `border-color` (P-2609/G9, ronda 6) ──
//
// `.btn{border:1.5px solid transparent}` y `.btn--ghost{border-color:var(--line)}`
// caían en claves distintas del mapa de ganadores, así que sobrevivían las dos
// y el export sacaba `border-[transparent]` y `border-[rgba(32,38,26,0.14)]` en
// el mismo `class`. Tailwind decide entonces por orden de generación y el
// botón fantasma de Natural Equus se quedaba sin borde: una píldora invisible.

test('expandBoxShorthand splits a border shorthand into width, style and colour', () => {
  assert.deepEqual(expandBoxShorthand('border', '1.5px solid transparent'), [
    ['border-width', '1.5px'],
    ['border-style', 'solid'],
    ['border-color', 'transparent'],
  ]);
  assert.deepEqual(expandBoxShorthand('border-top', '1px solid rgba(32, 38, 26, 0.14)'), [
    ['border-top-width', '1px'],
    ['border-top-style', 'solid'],
    ['border-top-color', 'rgba(32, 38, 26, 0.14)'],
  ]);
});

test('expandBoxShorthand leaves a border it cannot split confidently alone', () => {
  // `border: none` no dice anchura ni color; `cssToClasses` ya lo traduce entero.
  assert.equal(expandBoxShorthand('border', 'none'), null);
  assert.equal(expandBoxShorthand('border', '0'), null);
  assert.equal(expandBoxShorthand('border-radius', '999px'), null);
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

// ── La media query no añade especificidad (P-2609/G9, ronda 6) ──
//
// `.split{grid-template-columns:1fr 1fr}` + `.split.narrow{…1.05fr .95fr}` y,
// dentro de `@media(max-width:900px)`, `.split{grid-template-columns:1fr}`.
// En un navegador, a 390px gana `.split.narrow`: la media query no suma
// especificidad. El importador cascadeaba cada bucket por separado, así que la
// regla de la media query era la única candidata de su bucket y salía como
// `max-lg:grid-cols-[1fr]`, que sí ganaba. Medido en la generación de Can
// Nicolau: el `.split` de nueve páginas colapsaba a una columna en el export y
// no en el original (13,8% de diff en móvil).

test('a media-query rule does not beat a more specific base rule at that width', () => {
  const buckets = resolveBuckets([
    { bucket: '', spec: 10, order: 1, decls: [['grid-template-columns', '1fr 1fr']] },
    { bucket: '', spec: 20, order: 2, decls: [['grid-template-columns', '1.05fr .95fr']] },
    { bucket: 'max-lg:', spec: 10, order: 3, decls: [['grid-template-columns', '1fr']] },
  ]);
  assert.equal(buckets.get('')?.get('grid-template-columns')?.value, '1.05fr .95fr');
  assert.equal(buckets.get('max-lg:')?.get('grid-template-columns'), undefined);
});

test('a media-query rule still wins over a base rule of the same specificity', () => {
  const buckets = resolveBuckets([
    { bucket: '', spec: 10, order: 1, decls: [['grid-template-columns', '1fr 1fr']] },
    { bucket: 'max-lg:', spec: 10, order: 2, decls: [['grid-template-columns', '1fr']] },
  ]);
  assert.equal(buckets.get('')?.get('grid-template-columns')?.value, '1fr 1fr');
  assert.equal(buckets.get('max-lg:')?.get('grid-template-columns')?.value, '1fr');
});

test('the narrowest bucket inherits the wider one and only emits what changes', () => {
  const buckets = resolveBuckets([
    { bucket: '', spec: 10, order: 1, decls: [['padding', '40px'], ['color', 'red']] },
    { bucket: 'max-lg:', spec: 10, order: 2, decls: [['padding', '20px']] },
    { bucket: 'max-md:', spec: 10, order: 3, decls: [['color', 'blue']] },
  ]);
  // `padding` cambia una sola vez: `max-md:` hereda los 20px de `max-lg:`.
  assert.equal(buckets.get('max-lg:')?.get('padding')?.value, '20px');
  assert.equal(buckets.get('max-md:')?.has('padding'), false);
  assert.equal(buckets.get('max-md:')?.get('color')?.value, 'blue');
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
// El `*` a secas también entra, desde la ronda 6: `*{margin:0}` es medio reset
// de Meyer y Natural Equus lo usa. Descartarlo dejaba en pie las semillas del
// navegador que el importador siembra por tag, así que cada `<h2>`, `<p>` y
// `<ul>` del export llevaba un margen que el original no tiene y todo el sitio
// se desplazaba hacia abajo (13,4% de diff ponderado). Lo que sigue fuera es un
// universal *combinado* sin anclar (`* + *`).

test('isSupportedSelector acepta el búho anclado en una clase', () => {
  assert.equal(isSupportedSelector('.stack > * + *'), true);
  assert.equal(isSupportedSelector('.prose * + *'), true);
  assert.equal(isSupportedSelector('.panel .tag'), true);
  assert.equal(isSupportedSelector('[data-x]'), true);
});

test('isSupportedSelector acepta el reset universal a secas', () => {
  assert.equal(isSupportedSelector('*'), true);
});

test('isSupportedSelector descarta un universal combinado sin anclar y lo que ya estaba fuera del subset', () => {
  assert.equal(isSupportedSelector('* + *'), false);
  assert.equal(isSupportedSelector('* > *'), false);
  assert.equal(isSupportedSelector(''), false);
  assert.equal(isSupportedSelector('a:focus-visible'), false);
  assert.equal(isSupportedSelector('a:active'), false);
  assert.equal(isSupportedSelector('p::selection'), false);
});

test('el reset universal gana a la semilla del navegador y pierde contra cualquier regla de autor', () => {
  const buckets = resolveBuckets([
    // Semilla UA de <p>, especificidad -1 como la siembra el importador.
    { bucket: '', spec: -1, order: -1, decls: [['margin-top', '1em'], ['margin-bottom', '1em']] },
    { bucket: '', spec: 0, order: 1, decls: [['margin-top', '0'], ['margin-bottom', '0']] },
    { bucket: '', spec: 1, order: 2, decls: [['margin-top', '1rem']] },
  ]);
  assert.equal(buckets.get('')?.get('margin-top')?.value, '1rem');
  assert.equal(buckets.get('')?.get('margin-bottom')?.value, '0');
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
