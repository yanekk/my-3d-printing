# T07 — The report: the decision function and its plain-text rendering

**Phase:** 1 · **Depends on:** T04, T05, T06 · **Weight:** medium

## Goal

One function that takes a mesh, a recipe header and a machine profile, and returns everything
the user is ever told about a part. This is the design's decision function (`DESIGN.md §3.3`):
a function of its arguments and nothing else — no clock, no filesystem, no network — so that
a day of prototyping advice is testable in milliseconds and a regression in the advice is
caught by a golden-text test rather than by a failed print.

Its second half is the plain-text rendering, which is the thing Claude reads aloud in the
conversation. The user does not read code and will not open JSON; **the text output is the
product**, and it should be written for someone who has never used a slicer.

## Design sections this implements

`DESIGN.md` §2.4 in full, §3.3, §8 (the thin-wall limitation, which this task must state in
its own output).

## Files

```
core/report.js             NEW
test/report.test.js        NEW
test/golden/              NEW — committed expected text
  good-part.txt
  broken-part.txt
  no-header.txt
```

## Interface

```js
// core/report.js — pure.

/**
 * @typedef {{ code: string, severity: 'error'|'warning'|'note', message: string }} Finding
 *
 * @typedef {{
 *   reportVersion: 1,
 *   slug: string,
 *   header: import('./header.js').Header,
 *   mesh: { triangleCount: number, format: 'binary'|'ascii' },
 *   measurements: {
 *     bboxMm: { min: number[], max: number[], size: number[] },
 *     volumeMm3: number, surfaceAreaMm2: number, centroidMm: number[]
 *   },
 *   solidity: import('./solidity.js').Solidity,
 *   fit: import('./fit.js').Fit,
 *   dimensions: import('./dimensions.js').DimensionCheck,
 *   overhangs: import('./overhangs.js').OverhangAnalysis,
 *   bestOrientation: import('./overhangs.js').OrientationResult,
 *   filament: { volumeMm3: number, lengthMm: number, grams: number, material: string },
 *   findings: Finding[],
 *   worstSeverity: 'error'|'warning'|'note'|'none'
 * }} Report
 */

/** @returns {Report} */
export function buildReport({ slug, recipeText, stlBytes, machine })

/** @returns {string} — the text a human reads. */
export function renderReport(report, { colour = false } = {})
```

**Finding codes** are stable; message text is free to improve. The full set:

| Code | Severity | Raised when |
|---|---|---|
| `EMPTY_MESH` | error | zero triangles — all downstream measurements reported unavailable, **not** as zero |
| `NOT_WATERTIGHT` | error | open edges remain at the coarse weld tolerance |
| `NON_MANIFOLD` | error | an edge shared by three or more triangles |
| `INVERTED` | error | overall signed volume is negative |
| `INCONSISTENT_WINDING` | warning | some faces flipped relative to their neighbours |
| `DEGENERATE_TRIANGLES` | warning | zero-area triangles present |
| `LOOSE_WELD` | note | watertight only at the 1e-3 tolerance |
| `DOES_NOT_FIT` | error | exceeds the usable build volume as modelled |
| `FITS_ROTATED` | note | does not fit as modelled but a listed rotation would |
| `BBOX_MISMATCH` | error | measured size outside the declared tolerance |
| `NO_EXPECT_BBOX` | warning | header declared no size, so nothing was checked |
| `BAD_UNITS` / `MISSING_DIRECTIVE` / `UNKNOWN_DIRECTIVE` / `SLUG_MISMATCH` / `BAD_EXPECT_BBOX` / `DUPLICATE_DIRECTIVE` | from T06 | passed through unchanged |
| `SEVERE_OVERHANG` | warning | any `severe`-band area present |
| `UNSUPPORTED_CEILING` | warning | any `ceiling`-band area not sitting on the bed |
| `LOW_BED_CONTACT` | warning | bed contact under 200 mm² or under 5% of the footprint |
| `BETTER_ORIENTATION` | note | the best ranked orientation beats `identity` by more than 20% of support area |
| `TINY_FEATURE` | warning | bounding box smaller than `2 * nozzleMm` on any axis |
| `THIN_WALL_UNCHECKED` | note | **always emitted.** See below. |

**`THIN_WALL_UNCHECKED` is emitted on every report, unconditionally.** Proper thin-wall
detection needs a slicer's toolpath generation, which `DESIGN.md §8` puts out of scope. Silence
would imply coverage this project does not have, and a user who believes walls were checked
will print a part that fails. The note says, in plain words, that wall thickness was not
verified and that the recipe's own parameters are the place to check it.

**Ordering.** `findings` is sorted errors → warnings → notes, and within a severity in the
table's order above, so the text output is stable and diffable.

**`renderReport` structure**, in this order, because it is the order the questions matter in:

```
cable-clip — 40.0 x 30.0 x 25.0 mm, 12.4 g of PLA
────────────────────────────────────────────────
Solid            yes — closed, 1 240 triangles
Fits the bed     yes — 170 mm spare across, 215 mm of height
Measures         as declared (40 x 30 x 25, +/- 0.5)
Supports         12 % of the surface will need them — see below

Where supports are needed
  Steep (45-60°)     84 mm²   will sag a little on the underside
  Severe (60-85°)   210 mm²   needs supports
  Flat ceilings      40 mm²   needs supports unless it bridges between two walls

Sitting on the bed  1 200 mm² of first layer — plenty

Notes
  · Turning it 90° about X would remove almost all of the support (advice only —
    it ignores which faces you want to look good and which way the layers run).
  · Wall thickness was not checked. This needs a slicer, which this project
    deliberately does not have. Check the sizes at the top of the recipe.
```

`colour: false` is the default so golden tests compare plain text. `colour: true` adds ANSI
only; it must never change the words, or the golden tests stop protecting the real output.

**Numbers are rounded for display**, never in the data: one decimal for mm, whole numbers for
mm², two decimals for grams. The JSON keeps full precision because the viewer needs it.

## Tests

- [ ] Good part (closed cube with a valid header): `worstSeverity` is `note`; findings contain `THIN_WALL_UNCHECKED` and nothing worse
- [ ] `open-box.stl`: `NOT_WATERTIGHT` present with severity `error`
- [ ] Inverted cube: `INVERTED` present
- [ ] `near-miss.stl`: `LOOSE_WELD` note present, `NOT_WATERTIGHT` **absent**
- [ ] Empty mesh: `EMPTY_MESH` error; volume, filament and overhang fields reported unavailable, **not** as `0`
- [ ] A 300 mm tall part: `DOES_NOT_FIT` error and `FITS_ROTATED` note together
- [ ] A 500 mm cube: `DOES_NOT_FIT` and **no** `FITS_ROTATED`
- [ ] Declared 40 mm, measured 41 mm: `BBOX_MISMATCH` error naming the axis and the signed delta
- [ ] No header at all: `MISSING_DIRECTIVE` warnings, `NO_EXPECT_BBOX`, and every mesh-derived section still populated
- [ ] `@model` disagreeing with `slug`: `SLUG_MISMATCH`
- [ ] `shelf.stl`: `UNSUPPORTED_CEILING` and `BETTER_ORIENTATION` both present
- [ ] Cube sitting flat: **no** `UNSUPPORTED_CEILING` — its flat underside is bed contact, not a ceiling
- [ ] A 0.5 mm cube: `TINY_FEATURE`
- [ ] `THIN_WALL_UNCHECKED` is present in **every** one of the above
- [ ] `findings` is sorted error → warning → note in all cases
- [ ] Golden text: `good-part.txt`, `broken-part.txt`, `no-header.txt` match byte for byte
- [ ] `renderReport(r, {colour: true})` with ANSI stripped equals `renderReport(r)` exactly
- [ ] `buildReport` called twice on identical inputs returns deep-equal results (no hidden state)

## Done when

- [ ] The three golden files match byte for byte and are committed
- [ ] `THIN_WALL_UNCHECKED` appears in every report, and its wording says a slicer is needed
- [ ] `npm test` passes; `core/report.js` imports only from `core/`
