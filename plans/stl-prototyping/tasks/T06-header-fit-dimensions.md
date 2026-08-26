# T06 — Recipe header, build-volume fit, declared vs measured

**Phase:** 1 · **Depends on:** T03 · **Weight:** light

## Goal

Close the loop on the user's question *"how do I know Claude used the right measurements?"*
The recipe declares its own intended overall size in a comment header; this task parses that
declaration and compares it to what the mesh actually measures. A wrong number then cannot
hide: either it contradicts the declaration and the report says so, or the declaration itself
is visibly wrong to a reader, which is a thing a non-programmer can catch.

The same task answers "does it fit the bed", because both questions are the bounding box
compared against a number.

## Design sections this implements

`DESIGN.md` §2.2 (the header, in full), §2.4 items 2 and 3, §3.2 (`core/header.js`,
`core/fit.js`, `core/dimensions.js`).

## Files

```
core/header.js             NEW
core/fit.js                NEW
core/dimensions.js         NEW
test/header.test.js        NEW
test/fit.test.js           NEW
test/dimensions.test.js    NEW
```

## Interface

```js
// core/header.js — pure. Input is the recipe TEXT; it never reads a file.

/**
 * @typedef {{
 *   directives: { model?: string, units?: string, description?: string,
 *                 orientation?: string, material?: string,
 *                 expectBbox?: { size: [number,number,number], toleranceMm: number } },
 *   problems: Array<{ code: string, severity: 'error'|'warning', message: string }>
 * }} Header
 */

/** @param {string} recipeText @returns {Header} */
export function parseHeader(recipeText)
```

Parsing rules, all of which have a reason:

- Only the **leading run** of comment lines is read; parsing stops at the first line that is
  neither a comment nor blank. A recipe's body will contain `//` comments mentioning
  dimensions, and scanning the whole file would pick them up as directives.
- Both `//` and `#` markers are accepted, so the format survives whatever T00 chose and a
  later change of language.
- A directive is `@key value`, key case-insensitive, value trimmed. A repeated key is a
  `DUPLICATE_DIRECTIVE` warning and the **first** wins — silently taking the last would make a
  stale line at the top override a corrected one below it.
- **Unknown `@directives` are a warning, never an error.** A future directive must not break an
  old recipe.
- `@units` must be exactly `mm`. Anything else is an **error**, code `BAD_UNITS`. This is the
  cheapest guard in the project against the most expensive mistake in the domain.
- `@expect bbox` grammar: `W x D x H` with optional `+/- TOL` or `± TOL`; `x` or `*` as the
  separator; whitespace flexible. Default tolerance `0.5` mm. A malformed expression is
  `BAD_EXPECT_BBOX` (error) and leaves `expectBbox` undefined.
- Missing `model`, `units`, `description`, `orientation` or `expectBbox` each produce a
  `MISSING_DIRECTIVE` **warning**, not an error. `DESIGN.md §2.10`: a partial report beats no
  report, and blocking on a missing comment would be absurd.

```js
// core/fit.js — pure.

/**
 * @typedef {{
 *   fitsAsModelled: boolean,
 *   sizeMm: [number,number,number],
 *   usableVolumeMm: [number,number,number],   // buildVolume minus 2*margin per axis
 *   clearanceMm: [number,number,number],      // negative on any axis that overflows
 *   overflowAxes: Array<'x'|'y'|'z'>,
 *   orientationsThatFit: string[]             // rotation labels, [] if none
 * }} Fit
 */
export function checkFit(sizeMm, machine)
```

The usable volume subtracts `usableMarginMm` from **each** of the two ends of X and Y but only
from the top of Z — the bed's edges are eaten by clips and the purge line, but the first layer
starts at zero. So usable is `[220-10, 220-10, 240-5] = [210, 210, 235]`.

```js
// core/dimensions.js — pure.

/**
 * @typedef {{
 *   checked: boolean,                         // false when the header had no @expect bbox
 *   declaredMm?: [number,number,number],
 *   measuredMm: [number,number,number],
 *   toleranceMm?: number,
 *   deltasMm?: [number,number,number],        // measured - declared, signed
 *   withinTolerance?: boolean,
 *   worstAxis?: 'x'|'y'|'z'
 * }} DimensionCheck
 */
export function checkDimensions(expectBbox, measuredSizeMm)
```

Deltas are **signed** and reported per axis. "Off by 2 mm" is much less useful than "2 mm
taller than declared", and the sign is what tells Claude which way to correct.

## Tests

**Header**

- [ ] A well-formed header parses all six directives
- [ ] `#`-marked and `//`-marked headers parse identically
- [ ] Parsing stops at the first code line: a `// @model wrong` **below** code is ignored
- [ ] A blank line inside the leading comment run does not stop parsing
- [ ] `@units inch` is an error with code `BAD_UNITS`
- [ ] Missing `@units` is a warning, not an error
- [ ] `@expect bbox 40 x 20 x 8` parses with the default 0.5 tolerance
- [ ] `@expect bbox 40x20x8 +/- 0.2`, `40 * 20 * 8 ± 0.2` and mixed spacing all parse
- [ ] `@expect bbox 40 x 20` is `BAD_EXPECT_BBOX`; `expectBbox` is undefined; other directives still parse
- [ ] `@expect bbox 40 x 20 x -8` is `BAD_EXPECT_BBOX` (negative dimension)
- [ ] `@MODEL Cable-Clip` parses (key case-insensitive); the **value** keeps its case
- [ ] A duplicate `@model` warns and the first value wins
- [ ] `@flavour vanilla` is an `UNKNOWN_DIRECTIVE` warning and does not prevent the rest parsing
- [ ] Empty recipe text: no directives, all `MISSING_DIRECTIVE` warnings, no throw
- [ ] A recipe with no comments at all: same as above
- [ ] CRLF line endings parse identically to LF

**Fit**

- [ ] `[40, 30, 25]` fits; clearances are `[170, 180, 210]`
- [ ] `[210, 210, 235]` fits exactly (the boundary)
- [ ] `[210.1, 100, 100]` does not fit; `overflowAxes` is `['x']`; X clearance is negative
- [ ] `[100, 100, 300]` does not fit; a rotation appears in `orientationsThatFit`
- [ ] `[500, 500, 500]` does not fit and `orientationsThatFit` is empty
- [ ] `[230, 100, 100]` does not fit as modelled but a Z-rotation is offered

**Dimensions**

- [ ] Declared `[40,20,8]`, measured `[40,20,8]`: within tolerance, deltas all 0
- [ ] Declared `[40,20,8]`, measured `[40,20,8.4]`, tolerance 0.5: within tolerance, delta `+0.4`, `worstAxis` `z`
- [ ] Declared `[40,20,8]`, measured `[40,20,8.6]`: outside tolerance
- [ ] Measured **smaller** than declared gives a negative delta
- [ ] Exactly at the tolerance boundary (delta 0.5, tolerance 0.5) is **within** — inclusive
- [ ] No `@expect bbox`: `checked: false`, measured still reported, nothing throws

## Done when

- [ ] A header below a line of code cannot be parsed as a directive
- [ ] `@units inch` produces an error and `@flavour vanilla` produces only a warning
- [ ] Fit and dimension boundaries are asserted from both sides
