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
} from '@/lib/import/rin5-html';

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
