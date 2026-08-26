# T05 — Overhangs, bands, bed contact, and the best orientation

**Phase:** 1 · **Depends on:** T03 · **Weight:** heavy

## Goal

This is the task that answers the user's actual question: **which faces will need supports, and
how steeply do they hang?** They print with supports willingly and do not want geometry
contorted to avoid them — they want to be told where they will be. It is also the heaviest
core task, because every band boundary needs a hand-computed fixture and the orientation
search multiplies the work by 24.

## Design sections this implements

`DESIGN.md` §2.5 in full, §2.4 item 4, §3.2 (`core/overhangs.js`, `core/machine.js`).

## Files

```
core/machine.js           NEW — the profile table, no logic
core/overhangs.js         NEW
test/overhangs.test.js    NEW
test/machine.test.js      NEW
```

Extends `test/fixtures/` with `wedge45.stl` (a right prism whose sloped face is at exactly 45°
from vertical — the band boundary), `shelf.stl` (a vertical post with a horizontal ledge
cantilevered off it, giving a flat unsupported ceiling of known area) and `sphere.stl` (an
icosphere, giving a smooth distribution across every band).

## Interface

```js
// core/machine.js — data only. Every threshold in this project lives here so that retuning
// after a real print is a one-line change, not a hunt.
export const ENDER3_V3_KE = {
  name: 'Creality Ender-3 V3 KE',
  buildVolumeMm: [220, 220, 240],
  usableMarginMm: 5,            // bed clips and the purge line eat the edges
  nozzleMm: 0.4,
  layerHeightMm: 0.2,
  minWallMm: 0.86,              // two perimeters at 0.43 mm extrusion width
  preferredMinWallMm: 1.2,
  bedContactToleranceMm: 0.05,
  overhangBandsDeg: { mild: 30, steep: 45, severe: 60, ceiling: 85 },
  materials: {
    pla:  { densityGPerCm3: 1.24, label: 'PLA'  },
    petg: { densityGPerCm3: 1.27, label: 'PETG' },
  },
};
```

```js
// core/overhangs.js — pure.

/**
 * @typedef {{
 *   buildDirection: [0,0,1],
 *   bands: Array<{ band: 'none'|'mild'|'steep'|'severe'|'ceiling',
 *                  minAngleDeg: number, maxAngleDeg: number,
 *                  areaMm2: number, triangleCount: number }>,
 *   totalSupportAreaMm2: number,   // steep + severe + ceiling
 *   maxOverhangAngleDeg: number,
 *   bedContactAreaMm2: number,
 *   bedContactFraction: number,    // of the total footprint of the bounding box
 *   footprintMm2: number           // bbox X * bbox Y
 * }} OverhangAnalysis
 */

/** @param {Float32Array} positions @param {object} machine @returns {OverhangAnalysis} */
export function analyseOverhangs(positions, machine)

/**
 * @typedef {{ rotation: string,             // 'identity' | 'x+90' | 'x+90,z+180' | ...
 *             totalSupportAreaMm2: number,
 *             bedContactAreaMm2: number,
 *             sizeMm: [number,number,number] }} OrientationResult
 */

/** All 24 axis-aligned rotations, best first. @returns {OrientationResult[]} */
export function rankOrientations(positions, machine)
```

**The angle.** For a triangle with recomputed unit normal `n`:

```
d = -n.z                                   // 1 → faces straight down
a = degrees(asin(clamp(d, -1, 1)))         // a <= 0 → no overhang
```

`a` is measured **from vertical**, matching every slicer's support-threshold setting. This is
the point of the number: the user types it into their slicer. Measuring from horizontal would
be equally valid geometry and useless in practice.

**Band assignment** uses the thresholds in `machine.overhangBandsDeg`, half-open upward:
`none` is `a <= 30`, `mild` is `30 < a <= 45`, `steep` is `45 < a <= 60`, `severe` is
`60 < a < 85`, `ceiling` is `a >= 85`. A face at exactly 45.0° is `mild` — the friendlier side
of the boundary, because 45° is the number everyone quotes as "fine" and reporting it as a
problem would train the user to ignore the report.

**Bed contact** is the summed area of triangles that are in the `ceiling` band **and** whose
three vertices all lie within `machine.bedContactToleranceMm` of the mesh's minimum Z. Both
conditions are required: a horizontal face at the bottom that points *upward* is the inside of
a cavity, not the footprint.

**Degenerate triangles** (zero normal from T03) are excluded from every band and from bed
contact. They have no area and no direction; including them would put a spurious count into
whichever band `asin(0)` lands in.

**`rankOrientations`** applies each of the 24 rotations of the cube to the positions and
re-runs the analysis. Ranking: lowest `totalSupportAreaMm2` first; ties broken by **higher**
`bedContactAreaMm2`; remaining ties broken in favour of `identity`, so a part that is already
oriented well is never gratuitously told to rotate.

**This is advice, not an instruction, and T07 must render it as such.** It is blind to
cosmetic faces, to layer-line direction versus load, and to bed adhesion beyond raw contact
area — all three of which routinely outrank support area in a real decision.

## Tests

- [ ] Axis-aligned cube: every triangle in `none` or `ceiling`; `totalSupportAreaMm2` is 0; bed contact equals one face's area
- [ ] `wedge45.stl`: the sloped face lands in `mild`, not `steep` — the exact-45° boundary
- [ ] A face at 45.1°: `steep`. A face at 44.9°: `mild`
- [ ] A face at exactly 60.0°: `steep`. At 60.1°: `severe`
- [ ] A face at exactly 85.0°: `ceiling`
- [ ] `shelf.stl`: the ledge underside is `ceiling` with area equal to the hand-computed ledge area (within 1e-3)
- [ ] `shelf.stl`: `maxOverhangAngleDeg` is 90
- [ ] Vertical wall (normal in XY): `a = 0`, band `none`
- [ ] Upward-facing horizontal face: `a` is negative, band `none`, and it is **not** counted as bed contact even when it sits at minimum Z
- [ ] `sphere.stl`: band areas sum to the total surface area within 1e-3
- [ ] Bed contact of a cube sitting at z=0 equals `X*Y`; `bedContactFraction` is 1
- [ ] A cube raised to z=10: bed contact of the bottom face is unchanged (it is relative to the mesh minimum, not to absolute zero)
- [ ] `degenerate.stl`: the zero-area triangle appears in no band and in no count
- [ ] Empty mesh: all areas 0, `maxOverhangAngleDeg` 0, no `NaN`
- [ ] `rankOrientations` on `shelf.stl` puts a rotation that removes the ceiling ahead of `identity`
- [ ] `rankOrientations` on a cube returns `identity` first (all 24 tie; the identity tiebreak holds)
- [ ] `rankOrientations` returns exactly 24 distinct rotations
- [ ] `rankOrientations` preserves size as a permutation of the original bbox size
- [ ] A 50,000-triangle mesh through `rankOrientations` completes in under ~3 s

## Done when

- [ ] Every band boundary (45.0, 60.0, 85.0) is asserted from both sides and lands as specified
- [ ] `shelf.stl`'s ceiling area matches the hand-computed value, and `rankOrientations` finds the orientation that removes it
- [ ] `npm test` passes; `core/overhangs.js` imports only from `core/`

## Where this may overrun

The 24-orientation search is the risk. If the fixtures for "which orientation should win"
become unmanageable, **ship the six axis-aligned orientations instead of all 24 and record the
reduction in `FINDINGS.md`.** Do not ship an untested search — a wrong orientation suggestion
is worse than no suggestion, because the user has no way to check it.
