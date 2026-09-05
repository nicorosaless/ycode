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
