# T04 — Solidity: watertight, boundary edges, degenerate triangles, winding

**Phase:** 1 · **Depends on:** T03 · **Weight:** medium

## Goal

Answer the first question the report asks: **is this actually a solid?** A mesh with holes in
it, inside-out faces or zero-area triangles is not printable by any slicer, and every number
below it in the report — volume, filament, even overhang area — is meaningless. So this is
reported first and marked `error`.

The subtlety is that STL has no vertex indices. Two triangles "share" an edge only in the
sense that they contain two vertices at the same coordinates, and deciding what "the same"
means is the whole task.

## Design sections this implements

`DESIGN.md` §2.4 item 1, §3.2 (`core/solidity.js`).

## Files

```
core/solidity.js         NEW
test/solidity.test.js    NEW
```

Extends `test/fixtures/` with `flipped-face.stl` (a closed cube with one triangle's winding
reversed) and `near-miss.stl` (a cube whose two halves are offset by 5e-4 mm at the seam —
closes at a 1e-3 weld tolerance but not at 1e-4).

## Interface

```js
// core/solidity.js — pure.

/**
 * @typedef {{
 *   watertight: boolean,
 *   weldToleranceUsed: number,      // the tolerance at which the verdict was reached
 *   boundaryEdgeCount: number,      // edges used by exactly one triangle
 *   nonManifoldEdgeCount: number,   // edges used by three or more triangles
 *   degenerateTriangleCount: number,
 *   inconsistentWindingCount: number,
 *   signedVolumeMm3: number,
 *   invertedOverall: boolean,       // signed volume < 0
 *   sampleBoundaryEdges: Array<{a: [number,number,number], b: [number,number,number]}>
 * }} Solidity
 */

/** @param {Float32Array} positions @param {{weldTolerance?: number}} opts @returns {Solidity} */
export function analyseSolidity(positions, opts)
```

**Vertex welding.** Coordinates are quantised onto a grid of `weldTolerance` (default
`1e-4` mm) and the quantised triple is the vertex key. 1e-4 mm is 100 nm — three orders of
magnitude below anything a 0.4 mm nozzle can express, and comfortably above float32 noise
(float32 relative precision at 200 mm is about 2e-5 mm).

**The retry rule.** If the mesh is not watertight at the default tolerance, re-run once at
`1e-3` mm. If it closes at the coarser tolerance, report `watertight: true` with
`weldToleranceUsed: 1e-3`. This is not fudging: a mesh that only closes at 1 µm is a real and
useful signal — it usually means the CAD tool emitted a seam — and T07 renders it as a note.
Reporting a false "not watertight" for a mesh that every slicer would handle is worse than
reporting the tolerance honestly.

**Degenerate triangles are excluded from edge pairing** before the analysis, and counted
separately. A zero-area triangle contributes edges that pair with nothing and would otherwise
make every mesh containing one look non-watertight.

**Winding consistency.** Two triangles sharing an edge must traverse it in opposite directions
(`a→b` in one, `b→a` in the other). A shared edge traversed the same way in both is a flipped
face; count them. This is independent of `invertedOverall`, which catches a mesh that is
consistently wound but inside-out as a whole.

**`sampleBoundaryEdges` is capped at 10.** The count is what matters; a report listing 40,000
boundary edges is not a report.

## Tests

- [ ] Closed cube: watertight, 0 boundary edges, 0 non-manifold, 0 degenerate, 0 inconsistent, positive volume
- [ ] `open-box.stl` (one face removed): not watertight, exactly **4** boundary edges
- [ ] `flipped-face.stl`: watertight, `inconsistentWindingCount` > 0
- [ ] Cube with all windings reversed: watertight, `invertedOverall: true`, `inconsistentWindingCount: 0`
- [ ] `degenerate.stl`: `degenerateTriangleCount` is 1, and the mesh is still reported watertight
- [ ] `near-miss.stl`: not watertight at 1e-4, watertight at 1e-3, and `weldToleranceUsed` reports `1e-3`
- [ ] Empty mesh: watertight `false`, all counts 0, no throw, no `NaN`
- [ ] A single lone triangle: not watertight, 3 boundary edges
- [ ] Two coincident cubes (an edge shared by four triangles): `nonManifoldEdgeCount` > 0
- [ ] `sampleBoundaryEdges` never exceeds 10 entries even when `boundaryEdgeCount` is large
- [ ] A 50,000-triangle synthetic mesh completes in well under a second (guards against an accidental O(n²) pairing)

## Done when

- [ ] Every fixture returns the verdict asserted above, including the 1e-3 retry on `near-miss.stl`
- [ ] No path returns `NaN` or throws on the empty or degenerate fixtures
- [ ] `npm test` passes; `core/solidity.js` imports only from `core/`
