# T03 — Mesh measurements

**Phase:** 1 · **Depends on:** T02 · **Weight:** light

## Goal

Measure a triangle soup: how big it is, how much material it contains, which way each face
points. These are the numbers the whole report is built from — the bounding box drives the fit
check and the dimension check, the normals drive the overhang analysis, and the volume drives
the filament estimate.

Every function here has a closed-form answer for simple solids, so every one of them can be
tested against arithmetic rather than against itself.

## Design sections this implements

`DESIGN.md` §2.4 (measurements 1, 2, 3 and 5), §3.2 (`core/mesh.js`).

## Files

```
core/mesh.js          NEW
test/mesh.test.js     NEW
```

Extends `test/fixtures/` with `tetrahedron.stl` (a regular tetrahedron of edge 10, whose
volume is `1000/(6*sqrt(2)) = 117.851...` mm³ and surface area `sqrt(3)*100 = 173.205...` mm²).
A cube alone is a bad fixture for volume: too many wrong formulas give the right answer on it.

## Interface

```js
// core/mesh.js — pure.

/** @param {Float32Array} positions @returns {{min: [number,number,number], max: [...], size: [...]}} */
export function boundingBox(positions)
// Returns all-zeros with a `isEmpty: true` flag for a zero-triangle mesh rather than
// Infinity/-Infinity, which is what the naive fold produces and which then poisons every
// downstream number silently.

/** Signed volume in mm^3 by the divergence theorem: V = (1/6) * sum(v0 . (v1 x v2)). */
export function signedVolume(positions)
// Signed on purpose. A negative volume means the mesh is wound inside-out overall, and T04
// reports that as a finding. Accumulate in float64 (Number), not float32: a 100k-triangle
// mesh loses meaningful precision otherwise.

export function surfaceArea(positions)      // mm^2, sum of 0.5*|(v1-v0) x (v2-v0)|

/** @returns {Float32Array} length 3*n — unit normals recomputed from winding, NOT from file. */
export function triangleNormals(positions)
// A degenerate (zero-area) triangle yields [0,0,0] rather than NaN. NaN propagates into the
// overhang bands and produces a report full of blanks with no explanation.

export function triangleAreas(positions)    // Float32Array length n, mm^2

/** Volume-weighted centroid. @returns {[number,number,number]} */
export function centroid(positions)

/** @returns {{volumeMm3, lengthMm, grams}} for 1.75 mm filament at the given density. */
export function filamentFromVolume(volumeMm3, densityGPerCm3)
// length = volumeMm3 / (PI * (1.75/2)^2)  = volumeMm3 / 2.4053...
// This ignores infill and perimeters, so it is a FLOOR, not an estimate. T07's rendering
// must say so in words; a number presented without that caveat will be believed.
```

## Tests

- [ ] Unit cube (2 mm): bbox size `[2,2,2]`, volume `8`, surface area `24`, centroid `[1,1,1]` (within 1e-4)
- [ ] Regular tetrahedron edge 10: volume `117.8511...`, surface area `173.2050...` (within 1e-3)
- [ ] Cube translated by `[100, -50, 7]`: volume and area unchanged, centroid translated
- [ ] Cube scaled 10x: volume x1000, area x100
- [ ] A cube with every triangle's winding reversed yields a **negative** volume of the same magnitude
- [ ] Empty mesh: `boundingBox` reports `isEmpty`, volume `0`, area `0`; nothing returns `Infinity` or `NaN`
- [ ] `triangleNormals` on the cube returns exactly the six axis directions, each twice
- [ ] `triangleNormals` on `degenerate.stl` returns `[0,0,0]` for the degenerate triangle and no `NaN` anywhere
- [ ] `triangleAreas` sums to `surfaceArea`
- [ ] `filamentFromVolume(2405.28, 1.24)` returns length ≈ `1000` mm and grams ≈ `2.98`
- [ ] `filamentFromVolume(0, 1.24)` returns zeros, not `NaN`

## Done when

- [ ] Cube and tetrahedron measurements match hand-computed values to 1e-3
- [ ] No function returns `NaN` or `Infinity` for the empty or degenerate fixtures
- [ ] `npm test` passes; `core/mesh.js` imports only `core/stl.js`
