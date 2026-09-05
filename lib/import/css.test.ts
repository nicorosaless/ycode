import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssToClasses } from '@/lib/import/css';

// rin5 round-trip (P-2609/G9): the hero photo in clients/7/site is a
// `position:relative` figure with `aspect-ratio` + an `img{object-fit:cover}`
// child — losing any of the three collapses the image box to its intrinsic
// size and shifts everything below it. These already map today; the tests
// lock that in so a future refactor of mapDeclaration can't silently drop them.

test('object-fit maps to the matching object-* utility', () => {
  assert.deepEqual(cssToClasses('object-fit: cover'), ['object-cover']);
  assert.deepEqual(cssToClasses('object-fit: contain'), ['object-contain']);
});

test('object-position maps compound keywords to their object-* utility', () => {
  assert.deepEqual(cssToClasses('object-position: center'), ['object-center']);
  assert.deepEqual(cssToClasses('object-position: top left'), ['object-left-top']);
  assert.deepEqual(cssToClasses('object-position: bottom right'), ['object-right-bottom']);
});

test('aspect-ratio maps to an arbitrary aspect-[…] utility, slashes preserved', () => {
  assert.deepEqual(cssToClasses('aspect-ratio: 4/5'), ['aspect-[4/5]']);
  assert.deepEqual(cssToClasses('aspect-ratio: 16 / 10'), ['aspect-[16/10]']);
  assert.deepEqual(cssToClasses('aspect-ratio: auto'), ['aspect-auto']);
});

test('percentage padding-top (the intrinsic-ratio box hack) survives as an arbitrary pt-[…] utility', () => {
  assert.deepEqual(cssToClasses('padding-top: 56.25%'), ['pt-[56.25%]']);
});

test('a full hero figure declaration block keeps all three together', () => {
  const classes = cssToClasses('position: relative; aspect-ratio: 4/5; overflow: hidden');
  assert.ok(classes.includes('relative'));
  assert.ok(classes.includes('aspect-[4/5]'));
  assert.ok(classes.includes('overflow-hidden'));
});
