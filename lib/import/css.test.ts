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

// P-2609/G9: the rin5 generator writes `--f-body: "Source Sans 3", system-ui,
// sans-serif`, and the importer resolves the custom property and strips every
// quote before handing the declaration over (quotes can't ride inside a class
// attribute unescaped). `3` is not a valid CSS identifier, so Chromium threw
// the whole `font-family: Source Sans 3,system-ui,sans-serif` declaration away
// and the entire body fell back to the system font — 6,3% weighted round-trip
// diff, against 0,23% for the same site with a digit-free family name.
// Any family that isn't a single valid CSS identifier is re-quoted here.
test('a font family that is not a valid CSS identifier is emitted quoted', () => {
  assert.deepEqual(
    cssToClasses('font-family: "Source Sans 3", system-ui, sans-serif'),
    ["font-['Source_Sans_3',system-ui,sans-serif]"],
  );
  // Same value after the importer's quote-stripping pass — the case actually measured.
  assert.deepEqual(
    cssToClasses('font-family: Source Sans 3,system-ui,sans-serif'),
    ["font-['Source_Sans_3',system-ui,sans-serif]"],
  );
  assert.deepEqual(
    cssToClasses('font-family: IBM Plex Sans, sans-serif'),
    ["font-['IBM_Plex_Sans',sans-serif]"],
  );
  assert.deepEqual(
    cssToClasses('font-family: Noto Sans JP, sans-serif'),
    ["font-['Noto_Sans_JP',sans-serif]"],
  );
});

test('a single-identifier family and the generic keywords stay unquoted', () => {
  assert.deepEqual(
    cssToClasses('font-family: "Archivo", system-ui, sans-serif'),
    ['font-[Archivo,system-ui,sans-serif]'],
  );
  // `-apple-system` is a valid identifier (single leading hyphen + letter) and
  // only resolves to the system font unquoted, so it must not be re-quoted.
  assert.deepEqual(
    cssToClasses('font-family: -apple-system, ui-sans-serif, monospace'),
    ['font-[-apple-system,ui-sans-serif,monospace]'],
  );
});

test('a family with non-ASCII or a leading digit is quoted too', () => {
  assert.deepEqual(cssToClasses('font-family: Ñandú Sans, serif'), ["font-['Ñandú_Sans',serif]"]);
  assert.deepEqual(cssToClasses('font-family: 3Suisses, serif'), ["font-['3Suisses',serif]"]);
});

test('a quote inside a family name is escaped so the arbitrary value stays parseable', () => {
  assert.deepEqual(cssToClasses("font-family: Nico's Sans, serif"), ["font-['Nico\\'s_Sans',serif]"]);
});
