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

// P-2609/G9: `.wrap{width:min(100% - 2.5rem,var(--container))}` is the outer
// container behind almost every section in the rin5 reference client. The
// literal spaces `min()` puts around its own arguments used to split this
// into several broken Tailwind class tokens the same way `clamp()` broke
// font-size (see the fix above it in css.ts) — the class silently never
// applied, the container lost its max-width/centering, and every section
// rendered full width with different text wrapping than the source page.
// Measured as the single largest remaining cause of round-trip pixel diff
// once the pseudo-element and inline-collapse fixes landed.
test('width/height with a min()/max()/clamp() value survive as one escaped arbitrary utility', () => {
  assert.deepEqual(cssToClasses('width: min(100% - 2.5rem, 1220px)'), ['w-[min(100%_-_2.5rem,1220px)]']);
  assert.deepEqual(cssToClasses('height: clamp(200px, 40vw, 480px)'), ['h-[clamp(200px,40vw,480px)]']);
  assert.deepEqual(cssToClasses('width: 100%'), ['w-full']);
});

test('padding/margin shorthand with a function value is kept as a single side, not split on its internal spaces', () => {
  assert.deepEqual(cssToClasses('padding: min(1rem, 4vw)'), ['p-[min(1rem,4vw)]']);
});

test('color/border-color with an rgba() value has no unescaped spaces left', () => {
  const [cls] = cssToClasses('background-color: rgba(35, 71, 55, .15)');
  assert.equal(cls, 'bg-[rgba(35,71,55,.15)]');
  assert.doesNotMatch(cls, /\s/);
});
