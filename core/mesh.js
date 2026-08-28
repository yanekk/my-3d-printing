// Measurements over a triangle soup. Pure: numbers in, numbers out. DESIGN.md §2.4 (1, 2, 3
// and 5) and §3.2.
//
// Everything here has a closed-form answer on a simple solid, which is why the tests check
// arithmetic rather than checking this file against itself. A cube alone is not enough — too
// many wrong volume formulas give 8 for a 2 mm cube — so the fixtures include a regular
// tetrahedron, whose volume and area share no common factor with a cube's.
//
// Two rules run through the whole file:
//
//   * **Accumulate in float64.** The coordinates arrive as float32 because that is what an
//     STL stores, and the running sums are kept in ordinary Numbers so the accumulation adds
//     no error of its own. It is worth saying what this does *not* buy: on a large mesh sitting
//     far from the origin the float32 coordinates dominate the error completely — 80 000
//     triangles at 400 000 mm measure their own volume to about three significant figures, and
//     accumulating in float32 instead happens to land no further off. So this rule removes one
//     error source and leaves the bigger one in place; a measured volume is not eight-digit
//     data and T07 must not print it as though it were. See FINDINGS.md.
//   * **Never return NaN or Infinity** — for any mesh whose coordinates are real numbers of a
//     sane magnitude. A blank in the report is worse than a wrong number, because a wrong
//     number gets questioned and a blank gets skipped. The degenerate and empty cases each
//     have a defined answer below.
//
//     Two cases escape it, and neither is T03's to decide, so both are stated here rather
//     than quietly assumed away:
//
//       1. A coordinate that is not a real number. One Infinity or NaN vertex turns the
//          bounding box, the volume, the normals and the centroid into Infinity or NaN, and
//          `triangleNormals`' guard catches a NaN cross product but not an Infinity one.
//          DESIGN.md §2.10 makes this a BAD_COORDINATE error that **T04 detects**.
//       2. A coordinate that is a real number but astronomically large. Above roughly
//          2.6e19 mm the area of a triangle exceeds what float32 holds, so `triangleAreas`
//          — a Float32Array by interface — stores Infinity while `surfaceArea`, which
//          accumulates in float64, stays finite. The parts then do not sum to the whole.
//          Nothing detects this today; see FINDINGS.md.

// Cross-sectional area of 1.75 mm filament, in mm^2: PI * (1.75 / 2)^2.
const FILAMENT_AREA_MM2 = Math.PI * (1.75 / 2) ** 2;

// One triangle is nine coordinates: three vertices of x, y, z.
const COORDS_PER_TRIANGLE = 9;

/**
 * @typedef {{
 *   min: [number, number, number],
 *   max: [number, number, number],
 *   size: [number, number, number],
 *   isEmpty: boolean
 * }} BoundingBox
 */

/**
 * Coordinates as an array-like of numbers, holding a whole number of triangles.
 *
 * A wrong type or a ragged length is a caller's bug rather than a bad mesh, so it throws
 * TypeError/RangeError the way core/stl.js does: an error that says "not a mesh" about a
 * string sends whoever reads it looking in the wrong place.
 *
 * @param {unknown} positions
 * @returns {ArrayLike<number>}
 */
function requirePositions(positions) {
  const arrayLike =
    positions instanceof Float32Array ||
    positions instanceof Float64Array ||
    Array.isArray(positions);
  if (!arrayLike) {
    throw new TypeError('positions must be a Float32Array or an array of numbers.');
  }
  if (positions.length % COORDS_PER_TRIANGLE !== 0) {
    throw new RangeError(
      `positions has ${positions.length} values, which is not a whole number of triangles; ` +
        'a triangle is 9 — three vertices of x, y, z.',
    );
  }
  return positions;
}

/** @param {ArrayLike<number>} positions @returns {number} */
function triangleCountOf(positions) {
  return positions.length / COORDS_PER_TRIANGLE;
}

/**
 * Twice the area vector of one triangle: (v1 - v0) x (v2 - v0).
 *
 * Its length is twice the area and its direction is the outward normal under counter-clockwise
 * winding, so area and normal both come from this one quantity and cannot disagree.
 *
 * Written into `out` rather than returned, because this runs once per triangle on meshes of a
 * hundred thousand and allocating a three-element array each time is the whole cost.
 *
 * @param {ArrayLike<number>} positions
 * @param {number} tri triangle index
 * @param {number[]} out length 3
 */
function crossOf(positions, tri, out) {
  const at = tri * COORDS_PER_TRIANGLE;
  const ax = positions[at + 3] - positions[at];
  const ay = positions[at + 4] - positions[at + 1];
  const az = positions[at + 5] - positions[at + 2];
  const bx = positions[at + 6] - positions[at];
  const by = positions[at + 7] - positions[at + 1];
  const bz = positions[at + 8] - positions[at + 2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
}

/**
 * The axis-aligned bounding box, in mm.
 *
 * A zero-triangle mesh returns all-zeros with `isEmpty: true`, not the Infinity/-Infinity that
 * the naive fold produces. Those values do not stay put: they flow into the fit check, the
 * declared-vs-measured comparison and the report, and every one of them then reads as a
 * measurement of something. DESIGN.md §2.10 says an empty mesh is an absence, and `isEmpty` is
 * how a caller tells the absence from a mesh that genuinely measures zero.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @returns {BoundingBox}
 */
export function boundingBox(positions) {
  requirePositions(positions);
  if (positions.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], isEmpty: true };
  }

  const min = [positions[0], positions[1], positions[2]];
  const max = [positions[0], positions[1], positions[2]];
  for (let at = 3; at < positions.length; at += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[at + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }

  return {
    min: /** @type {[number, number, number]} */ (min),
    max: /** @type {[number, number, number]} */ (max),
    size: /** @type {[number, number, number]} */ ([
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
    ]),
    isEmpty: false,
  };
}

/**
 * Signed volume in mm^3, by the divergence theorem: V = (1/6) * sum(v0 . (v1 x v2)).
 *
 * Each triangle contributes the signed volume of the tetrahedron it forms with the origin. On
 * a closed surface the parts outside the solid cancel exactly, whatever the origin is, so this
 * needs no assumption about where the mesh sits.
 *
 * **Signed on purpose.** A negative result means the mesh is wound inside-out overall, which
 * T04 reports as a finding — taking the absolute value here would hide the single clearest
 * symptom a broken mesh has.
 *
 * The result is meaningless, rather than merely imprecise, on a mesh that is not closed: an
 * open box has a volume that depends on where the origin is. Callers get that from T04's
 * watertightness check, not from here.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @returns {number}
 */
export function signedVolume(positions) {
  requirePositions(positions);
  const count = triangleCountOf(positions);
  const cross = [0, 0, 0];
  let total = 0;
  for (let tri = 0; tri < count; tri++) {
    // v0 . (v1 x v2) equals v0 . ((v1 - v0) x (v2 - v0)) — the v0 terms cancel — so the same
    // cross product serves the volume, the area and the normal.
    crossOf(positions, tri, cross);
    const at = tri * COORDS_PER_TRIANGLE;
    total +=
      positions[at] * cross[0] + positions[at + 1] * cross[1] + positions[at + 2] * cross[2];
  }
  return total / 6;
}

/**
 * Total surface area in mm^2: the sum of 0.5 * |(v1 - v0) x (v2 - v0)|.
 *
 * Unsigned, and so unaffected by winding: a mesh wound inside-out has the same surface area,
 * only a negative volume.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @returns {number}
 */
export function surfaceArea(positions) {
  requirePositions(positions);
  const count = triangleCountOf(positions);
  const cross = [0, 0, 0];
  let total = 0;
  for (let tri = 0; tri < count; tri++) {
    crossOf(positions, tri, cross);
    total += Math.hypot(cross[0], cross[1], cross[2]) / 2;
  }
  return total;
}

/**
 * Per-triangle area in mm^2.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @returns {Float32Array} length n
 */
export function triangleAreas(positions) {
  requirePositions(positions);
  const count = triangleCountOf(positions);
  const areas = new Float32Array(count);
  const cross = [0, 0, 0];
  for (let tri = 0; tri < count; tri++) {
    crossOf(positions, tri, cross);
    areas[tri] = Math.hypot(cross[0], cross[1], cross[2]) / 2;
  }
  return areas;
}

/**
 * Unit outward normals, one per triangle, **recomputed from the winding and never read from
 * the file.**
 *
 * The normal an STL carries is advisory and writers get it wrong; the winding is what every
 * slicer actually believes, and a stored normal that disagrees with it would silently move
 * triangles between overhang bands. core/stl.js keeps the file's normals under `fileNormals`
 * so T04 can compare the two, and nothing else uses them.
 *
 * A zero-area triangle yields `[0, 0, 0]`. The mathematically honest answer is that it has no
 * normal, and dividing by its zero length would put NaN into the overhang bands — which does
 * not fail, it produces a report with blanks in it and no explanation of why.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @returns {Float32Array} length 3n
 */
export function triangleNormals(positions) {
  requirePositions(positions);
  const count = triangleCountOf(positions);
  const normals = new Float32Array(count * 3);
  const cross = [0, 0, 0];
  for (let tri = 0; tri < count; tri++) {
    crossOf(positions, tri, cross);
    const length = Math.hypot(cross[0], cross[1], cross[2]);
    // Written as `> 0` rather than `!== 0` so that a NaN length — reachable only from a mesh
    // already carrying NaN — leaves the zero vector rather than propagating.
    if (length > 0) {
      normals[tri * 3] = cross[0] / length;
      normals[tri * 3 + 1] = cross[1] / length;
      normals[tri * 3 + 2] = cross[2] / length;
    }
  }
  return normals;
}

/**
 * The volume-weighted centroid in mm — the centre of mass of the solid, assuming uniform
 * density, which is what "where is the middle of this part" means for printing.
 *
 * Same tetrahedral decomposition as `signedVolume`: each triangle's tetrahedron with the
 * origin has centroid (v0 + v1 + v2 + origin) / 4, and the signed volumes cancel outside the
 * solid exactly as they do there.
 *
 * **The fallbacks.** That formula divides by the total volume, so it says nothing about a mesh
 * whose volume is zero or near it — an open surface, a flat plate of triangles, the degenerate
 * fixture. Rather than pick a tolerance out of the air, the result is checked against the one
 * thing that is true of every real centre of mass: it lies inside the convex hull of the
 * points, and therefore inside the bounding box. A result that escapes the box is arithmetic
 * noise divided by nearly nothing, and the chain falls back:
 *
 *   volume-weighted  ->  area-weighted (the centroid of the surface, for an open mesh)
 *                    ->  the plain average of the vertices (for a mesh of zero area)
 *                    ->  [0, 0, 0] (for no triangles at all)
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @returns {[number, number, number]}
 */
export function centroid(positions) {
  requirePositions(positions);
  const count = triangleCountOf(positions);
  if (count === 0) return [0, 0, 0];

  const cross = [0, 0, 0];
  let volume = 0;
  const volumeMoment = [0, 0, 0];
  let area = 0;
  const areaMoment = [0, 0, 0];
  const vertexSum = [0, 0, 0];

  for (let tri = 0; tri < count; tri++) {
    crossOf(positions, tri, cross);
    const at = tri * COORDS_PER_TRIANGLE;
    const six =
      positions[at] * cross[0] + positions[at + 1] * cross[1] + positions[at + 2] * cross[2];
    const faceArea = Math.hypot(cross[0], cross[1], cross[2]) / 2;
    volume += six;
    area += faceArea;
    for (let axis = 0; axis < 3; axis++) {
      const corners =
        positions[at + axis] + positions[at + 3 + axis] + positions[at + 6 + axis];
      // The tetrahedron's own centroid is (v0 + v1 + v2 + 0) / 4; the /4 and the /6 in the
      // volume both divide out of the final ratio, so neither is applied here.
      volumeMoment[axis] += six * corners;
      areaMoment[axis] += faceArea * (corners / 3);
      vertexSum[axis] += corners;
    }
  }

  const box = boundingBox(positions);
  if (volume !== 0) {
    const byVolume = /** @type {[number, number, number]} */ ([
      volumeMoment[0] / (volume * 4),
      volumeMoment[1] / (volume * 4),
      volumeMoment[2] / (volume * 4),
    ]);
    if (isInside(byVolume, box)) return byVolume;
  }
  if (area > 0) {
    return /** @type {[number, number, number]} */ ([
      areaMoment[0] / area,
      areaMoment[1] / area,
      areaMoment[2] / area,
    ]);
  }
  const vertices = count * 3;
  return /** @type {[number, number, number]} */ ([
    vertexSum[0] / vertices,
    vertexSum[1] / vertices,
    vertexSum[2] / vertices,
  ]);
}

/**
 * Whether a point lies within the bounding box, with a margin for the float64 arithmetic that
 * produced it. The margin is relative to the box, so it means the same thing on a 2 mm part
 * and a 200 mm one.
 *
 * A NaN coordinate fails both comparisons and so is reported outside, which is the answer that
 * sends `centroid` to its fallbacks.
 *
 * @param {[number, number, number]} point
 * @param {BoundingBox} box
 * @returns {boolean}
 */
function isInside(point, box) {
  for (let axis = 0; axis < 3; axis++) {
    const slack = Math.max(box.size[axis], 1) * 1e-6;
    if (!(point[axis] >= box.min[axis] - slack && point[axis] <= box.max[axis] + slack)) {
      return false;
    }
  }
  return true;
}

/**
 * Filament for a given volume of material, as a length of 1.75 mm filament and a mass.
 *
 * **This is a floor, not an estimate.** It is the volume of the solid, and a printed part is
 * not solid: it has a sparse infill and a shell of perimeters that a slicer decides on, plus
 * whatever supports and skirt the print needs. The real figure is always larger, and often
 * much larger for a chunky part at 15% infill. DESIGN.md §2.4 requires T07 to say so in those
 * words, because a number handed over without that sentence will be believed.
 *
 * A negative volume is passed straight through to a negative length rather than being made
 * positive: it means the mesh is wound inside-out, T04 says so, and quietly returning a
 * confident positive number for a broken mesh is the worse of the two failures.
 *
 * @param {number} volumeMm3
 * @param {number} densityGPerCm3 e.g. 1.24 for PLA
 * @returns {{volumeMm3: number, lengthMm: number, grams: number}}
 */
export function filamentFromVolume(volumeMm3, densityGPerCm3) {
  if (typeof volumeMm3 !== 'number' || !Number.isFinite(volumeMm3)) {
    throw new TypeError(`volumeMm3 must be a finite number, not ${volumeMm3}.`);
  }
  if (typeof densityGPerCm3 !== 'number' || !Number.isFinite(densityGPerCm3)) {
    throw new TypeError(`densityGPerCm3 must be a finite number, not ${densityGPerCm3}.`);
  }
  return {
    volumeMm3,
    lengthMm: volumeMm3 / FILAMENT_AREA_MM2,
    // 1 cm^3 is 1000 mm^3. Densities are quoted per cm^3 on every spool.
    grams: (volumeMm3 / 1000) * densityGPerCm3,
  };
}
