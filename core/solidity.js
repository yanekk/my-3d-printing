// Is this actually a solid? DESIGN.md §2.4 item 1 and §3.2.
//
// An STL has no vertex indices. Two triangles "share" an edge only in the sense that they
// carry two vertices at the same coordinates, so every answer in this file rests on one
// prior decision: **when are two coordinate triples the same point?** That decision is the
// weld, and it is the only place a tolerance appears.
//
// The weld is distance-based, not grid-based. Vertices are bucketed into cells of one
// tolerance so the search stays linear, but two vertices are merged only if they are
// genuinely within `weldTolerance` of each other, and the search covers the 27 cells around
// a vertex so a pair straddling a cell wall is still found. The obvious cheaper scheme —
// quantise each coordinate and use the quantised triple as the key, which is what
// tasks/T04 specifies — is wrong in a way that matters here: two vertices a nanometre apart
// land in different cells whenever they straddle a grid line, and the mesh is then reported
// not watertight for no reason at all. The task doc's own rule says a false "not watertight"
// is the worse failure, and 50 % of a seam of exactly half a cell would earn one. See
// PROGRESS.md for the deviation and FINDINGS.md for what it costs.
//
// Three classes of triangle never reach the edge pairing, and each is counted instead:
//
//   * **Bad coordinate** — a vertex that is not a finite number. DESIGN.md §2.10 (user
//     decision, 2026-08-28): the mesh still loads, still previews, and everything that does
//     not touch that triangle is still reported. A NaN or an Infinity has no cell and no
//     distance, so it cannot be welded and the triangle is set aside.
//   * **Out of range** — a vertex whose magnitude is so large that the weld grid runs out of
//     integers to address it: |c| > weldTolerance * 2^53, about 900 000 km at the default
//     tolerance. Past that, cell indices stop being distinct and "the same point" has no
//     meaning. This is also, and not by coincidence, well below the point where a triangle's
//     area stops fitting in float32 (about 1.3e19 mm) — the hole T03 left open.
//
//     DESIGN.md §2.10 (user decision, 2026-08-28): this gets its own error code,
//     COORDINATE_OUT_OF_RANGE, rather than being folded into BAD_COORDINATE, because it is a
//     different mistake with a different fix — a runaway scale in a recipe, not a division by
//     zero — and "not a real number" is the wrong sentence to say about a real number.
//   * **Degenerate** — zero area, or two corners that weld together. It contributes edges
//     that pair with nothing, so leaving it in would make every mesh containing one look
//     non-watertight. Counted, and excluded before anything else is measured.

import { signedVolume } from './mesh.js';

// One triangle is nine coordinates: three vertices of x, y, z.
const COORDS_PER_TRIANGLE = 9;

// 100 nm — three orders of magnitude below anything a 0.4 mm nozzle can express, and
// comfortably above float32 noise, which at 200 mm is about 2e-5 mm.
const DEFAULT_WELD_TOLERANCE = 1e-4;

// 1 µm. A mesh that only closes here is a real signal rather than a fudge: it usually means
// the CAD tool emitted a seam, and T07 renders it as a note rather than hiding it.
const COARSE_WELD_TOLERANCE = 1e-3;

// The count is what matters. A report listing 40 000 boundary edges is not a report.
const MAX_SAMPLES = 10;

/**
 * @typedef {{a: [number, number, number], b: [number, number, number]}} EdgeSample
 *
 * @typedef {{
 *   watertight: boolean,
 *   weldToleranceUsed: number,
 *   boundaryEdgeCount: number,
 *   nonManifoldEdgeCount: number,
 *   degenerateTriangleCount: number,
 *   inconsistentWindingCount: number,
 *   badCoordinateCount: number,
 *   outOfRangeCoordinateCount: number,
 *   signedVolumeMm3: number,
 *   invertedOverall: boolean,
 *   sampleBoundaryEdges: EdgeSample[],
 *   sampleBadTriangles: number[],
 *   sampleOutOfRangeTriangles: number[]
 * }} Solidity
 */

/**
 * Coordinates as an array-like holding a whole number of triangles. Same contract, and the
 * same error types, as core/mesh.js: a wrong type or a ragged length is a caller's bug rather
 * than a bad mesh, and an error saying "not a mesh" about a string sends whoever reads it
 * looking in the wrong place.
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

/**
 * Merge coincident vertices, returning one representative index per vertex.
 *
 * `ids[v]` is -1 for a vertex that cannot be welded — one that is not a finite number, or one
 * so far from the origin that the cell grid cannot address it. The caller sets those triangles
 * aside rather than guessing.
 *
 * Cells are one tolerance across, so any two vertices within the tolerance are in the same
 * cell or in one of its 26 neighbours. The own-cell lookup comes first because it is the
 * overwhelmingly common case: a well-formed mesh repeats each vertex bit for bit, and every
 * repeat lands in the cell its first occurrence claimed.
 *
 * @param {ArrayLike<number>} positions
 * @param {number} tolerance
 * @returns {{ids: Int32Array, x: number[], y: number[], z: number[]}}
 */
function weld(positions, tolerance) {
  const vertexCount = positions.length / 3;
  const ids = new Int32Array(vertexCount).fill(-1);
  /** @type {Map<string, number[]>} */
  const cells = new Map();
  /** @type {number[]} */ const x = [];
  /** @type {number[]} */ const y = [];
  /** @type {number[]} */ const z = [];

  // Beyond this, `coordinate / tolerance` stops producing distinct integers and the grid
  // silently folds distant points onto the same cell.
  const maxCoordinate = tolerance * 2 ** 53;
  const squaredTolerance = tolerance * tolerance;

  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const at = vertex * 3;
    const px = positions[at];
    const py = positions[at + 1];
    const pz = positions[at + 2];
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
    if (
      Math.abs(px) > maxCoordinate ||
      Math.abs(py) > maxCoordinate ||
      Math.abs(pz) > maxCoordinate
    ) {
      continue;
    }

    const cx = Math.floor(px / tolerance);
    const cy = Math.floor(py / tolerance);
    const cz = Math.floor(pz / tolerance);

    let found = searchCell(cells, `${cx},${cy},${cz}`, px, py, pz, x, y, z, squaredTolerance);
    if (found < 0) {
      for (let dx = -1; dx <= 1 && found < 0; dx++) {
        for (let dy = -1; dy <= 1 && found < 0; dy++) {
          for (let dz = -1; dz <= 1 && found < 0; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const key = `${cx + dx},${cy + dy},${cz + dz}`;
            found = searchCell(cells, key, px, py, pz, x, y, z, squaredTolerance);
          }
        }
      }
    }

    if (found < 0) {
      found = x.length;
      x.push(px);
      y.push(py);
      z.push(pz);
      const key = `${cx},${cy},${cz}`;
      const bucket = cells.get(key);
      if (bucket) bucket.push(found);
      else cells.set(key, [found]);
    }
    ids[vertex] = found;
  }

  return { ids, x, y, z };
}

/**
 * The first representative in one cell within the tolerance of a point, or -1.
 *
 * @param {Map<string, number[]>} cells
 * @param {string} key
 * @param {number} px @param {number} py @param {number} pz
 * @param {number[]} x @param {number[]} y @param {number[]} z
 * @param {number} squaredTolerance
 * @returns {number}
 */
function searchCell(cells, key, px, py, pz, x, y, z, squaredTolerance) {
  const bucket = cells.get(key);
  if (bucket === undefined) return -1;
  for (const id of bucket) {
    const dx = x[id] - px;
    const dy = y[id] - py;
    const dz = z[id] - pz;
    if (dx * dx + dy * dy + dz * dz <= squaredTolerance) return id;
  }
  return -1;
}

/**
 * One full pass at one weld tolerance.
 *
 * @param {ArrayLike<number>} positions
 * @param {number} tolerance
 * @param {number} volume the signed volume, which does not depend on the tolerance
 * @returns {Solidity}
 */
function analyseAtTolerance(positions, tolerance, volume) {
  const triangleCount = positions.length / COORDS_PER_TRIANGLE;
  const { ids, x, y, z } = weld(positions, tolerance);

  let badCoordinateCount = 0;
  let outOfRangeCoordinateCount = 0;
  let degenerateTriangleCount = 0;
  let pairedTriangleCount = 0;
  /** @type {number[]} */ const sampleBadTriangles = [];
  /** @type {number[]} */ const sampleOutOfRangeTriangles = [];

  // Undirected edge key -> how many triangles use it, and how many traverse it each way.
  /** @type {Map<string, {uses: number, forward: number, low: number, high: number}>} */
  const edges = new Map();

  for (let tri = 0; tri < triangleCount; tri++) {
    const at = tri * COORDS_PER_TRIANGLE;
    const i0 = ids[tri * 3];
    const i1 = ids[tri * 3 + 1];
    const i2 = ids[tri * 3 + 2];

    if (i0 < 0 || i1 < 0 || i2 < 0) {
      // Two ways to fail the weld, and they are different errors to the user: a recipe that
      // divided by zero, versus a recipe scaled a billion times too big.
      if (hasNonFiniteCoordinate(positions, at)) {
        badCoordinateCount++;
        if (sampleBadTriangles.length < MAX_SAMPLES) sampleBadTriangles.push(tri);
      } else {
        outOfRangeCoordinateCount++;
        if (sampleOutOfRangeTriangles.length < MAX_SAMPLES) sampleOutOfRangeTriangles.push(tri);
      }
      continue;
    }

    // Degenerate two ways: corners that weld onto each other, and corners that are distinct
    // but collinear. The second is the one that hides — a repeated vertex is caught by any
    // implementation, a collinear triple by none that only compares indices.
    if (i0 === i1 || i1 === i2 || i2 === i0 || triangleIsFlat(positions, at)) {
      degenerateTriangleCount++;
      continue;
    }

    pairedTriangleCount++;
    addEdge(edges, i0, i1);
    addEdge(edges, i1, i2);
    addEdge(edges, i2, i0);
  }

  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  let inconsistentWindingCount = 0;
  /** @type {EdgeSample[]} */ const sampleBoundaryEdges = [];

  for (const edge of edges.values()) {
    if (edge.uses === 1) {
      boundaryEdgeCount++;
      if (sampleBoundaryEdges.length < MAX_SAMPLES) {
        sampleBoundaryEdges.push({
          a: [x[edge.low], y[edge.low], z[edge.low]],
          b: [x[edge.high], y[edge.high], z[edge.high]],
        });
      }
    } else if (edge.uses >= 3) {
      nonManifoldEdgeCount++;
    } else if (edge.forward !== 1) {
      // Two triangles sharing an edge must traverse it in opposite directions. Both going the
      // same way means one of them is flipped relative to the other. Counted per edge, not per
      // face, because "which of the two is the flipped one" has no answer from the pair alone —
      // one reversed triangle in a closed mesh shows up here as 3.
      inconsistentWindingCount++;
    }
  }

  return {
    // DESIGN.md §2.4: watertight is "every edge shared by exactly two triangles", so an edge
    // used by four fails it just as an unpaired edge does. A mesh with nothing left to pair —
    // empty, or every triangle set aside — is not a solid either.
    watertight: pairedTriangleCount > 0 && boundaryEdgeCount === 0 && nonManifoldEdgeCount === 0,
    weldToleranceUsed: tolerance,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    degenerateTriangleCount,
    inconsistentWindingCount,
    badCoordinateCount,
    outOfRangeCoordinateCount,
    signedVolumeMm3: volume,
    // NaN < 0 is false, so a mesh whose volume could not be measured is not claimed to be
    // inside-out. It is claimed to be nothing, which is the honest answer.
    invertedOverall: volume < 0,
    sampleBoundaryEdges,
    sampleBadTriangles,
    sampleOutOfRangeTriangles,
  };
}

/**
 * @param {ArrayLike<number>} positions
 * @param {number} at index of the triangle's first coordinate
 * @returns {boolean}
 */
function hasNonFiniteCoordinate(positions, at) {
  for (let offset = 0; offset < COORDS_PER_TRIANGLE; offset++) {
    if (!Number.isFinite(positions[at + offset])) return true;
  }
  return false;
}

/**
 * Whether a triangle's three corners are collinear, i.e. its area is exactly zero.
 *
 * The cross product of the two edge vectors, computed in float64 the way core/mesh.js does it,
 * so a triangle this calls flat is one core/mesh.js measures at zero area. Exact zero rather
 * than a tolerance: a sliver with a real if tiny area is a legitimate triangle that pairs its
 * edges normally, and calling it degenerate would silently drop it out of the analysis.
 *
 * @param {ArrayLike<number>} positions
 * @param {number} at index of the triangle's first coordinate
 * @returns {boolean}
 */
function triangleIsFlat(positions, at) {
  const ax = positions[at + 3] - positions[at];
  const ay = positions[at + 4] - positions[at + 1];
  const az = positions[at + 5] - positions[at + 2];
  const bx = positions[at + 6] - positions[at];
  const by = positions[at + 7] - positions[at + 1];
  const bz = positions[at + 8] - positions[at + 2];
  return (
    ay * bz - az * by === 0 && az * bx - ax * bz === 0 && ax * by - ay * bx === 0
  );
}

/**
 * Record one directed use of an undirected edge.
 *
 * @param {Map<string, {uses: number, forward: number, low: number, high: number}>} edges
 * @param {number} from
 * @param {number} to
 */
function addEdge(edges, from, to) {
  const low = from < to ? from : to;
  const high = from < to ? to : from;
  const key = `${low}|${high}`;
  const edge = edges.get(key);
  if (edge === undefined) {
    edges.set(key, { uses: 1, forward: from === low ? 1 : 0, low, high });
    return;
  }
  edge.uses++;
  if (from === low) edge.forward++;
}

/**
 * Whether the mesh is a closed solid, and everything that goes wrong on the way to that
 * answer.
 *
 * **The retry.** A mesh that is not watertight at the default tolerance is measured once more
 * at 1e-3 mm, and the coarse verdict is used *only if it closes*. If it does not, the fine
 * result is what comes back, because 1e-4 mm is the tolerance this project claims and a coarse
 * measurement that changed nothing would only misreport which tolerance produced the numbers.
 * `weldToleranceUsed` always names the pass the returned figures came from.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @param {{weldTolerance?: number}} [opts]
 * @returns {Solidity}
 */
export function analyseSolidity(positions, opts = {}) {
  requirePositions(positions);
  const { weldTolerance = DEFAULT_WELD_TOLERANCE } = opts ?? {};
  if (typeof weldTolerance !== 'number' || !Number.isFinite(weldTolerance) || weldTolerance <= 0) {
    throw new TypeError(`weldTolerance must be a positive finite number, not ${weldTolerance}.`);
  }

  // Tolerance-independent, and meaningless on a mesh that is not closed — which is exactly
  // what `watertight` is here to tell the caller.
  const volume = signedVolume(positions);

  const fine = analyseAtTolerance(positions, weldTolerance, volume);
  if (fine.watertight || positions.length === 0 || weldTolerance >= COARSE_WELD_TOLERANCE) {
    return fine;
  }

  const coarse = analyseAtTolerance(positions, COARSE_WELD_TOLERANCE, volume);
  return coarse.watertight ? coarse : fine;
}
