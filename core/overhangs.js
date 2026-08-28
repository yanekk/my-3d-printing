// Overhang analysis: which faces will need supports, and how steeply they hang.
//
// DESIGN.md §2.5 in full. This is the module that answers the user's actual question — they
// print with supports willingly and do not want geometry contorted to avoid them; they want to
// be told where the supports will be.
//
// Pure: positions and a machine profile in, numbers out. No clock, no randomness, no I/O.

import { boundingBox, triangleAreas, triangleNormals } from './mesh.js';

const COORDS_PER_TRIANGLE = 9;
const DEGREES_PER_RADIAN = 180 / Math.PI;

// The five bands in the order DESIGN.md §2.5 lists them, gentlest first. Always all five,
// even when four are empty: a report whose table gains and loses rows depending on the part
// is harder to read across two parts than one with a zero in it.
const BAND_NAMES = /** @type {const} */ (['none', 'mild', 'steep', 'severe', 'ceiling']);

/**
 * @typedef {'none'|'mild'|'steep'|'severe'|'ceiling'} Band
 */

/**
 * @typedef {{
 *   buildDirection: [0, 0, 1],
 *   bands: Array<{ band: Band, minAngleDeg: number, maxAngleDeg: number,
 *                  areaMm2: number, triangleCount: number }>,
 *   totalSupportAreaMm2: number,
 *   maxOverhangAngleDeg: number,
 *   bedContactAreaMm2: number,
 *   bedContactFraction: number,
 *   footprintMm2: number
 * }} OverhangAnalysis
 */

/**
 * @typedef {{ rotation: string,
 *             totalSupportAreaMm2: number,
 *             bedContactAreaMm2: number,
 *             sizeMm: [number, number, number] }} OrientationResult
 */

/** @param {unknown} machine @returns {import('./machine.js').Machine} */
function requireMachine(machine) {
  const bands = /** @type {any} */ (machine)?.overhangBandsDeg;
  if (!bands || typeof bands.steep !== 'number') {
    throw new TypeError(
      'machine must be a profile from core/machine.js: it needs overhangBandsDeg with ' +
        'mild/steep/severe/ceiling thresholds in degrees.',
    );
  }
  return /** @type {any} */ (machine);
}

/**
 * The overhang angle of one face, in degrees **from vertical** — the slicer's convention, and
 * the whole point of the number: it is what the user types into their support threshold.
 *
 *   d = -n.z          1 → the face points straight down
 *   a = asin(d)       a <= 0 → the face is vertical or points upward: no overhang at all
 *
 * The snap. An STL stores float32, so a face a designer drew at exactly 45 degrees measures
 * 45.000003 about one time in twenty-five (FINDINGS.md, 2026-08-28). Left alone, the commonest
 * feature on a printed part — a 45 degree chamfer — gets called "will show sag" at random, and
 * two exports of the same model contradict each other. An angle within
 * `bandEdgeToleranceDeg` of a band edge is therefore pulled onto the edge exactly, and the
 * half-open bands below then place it.
 *
 * At 30, 45 and 60 the edge belongs to the gentler band, which is the user's decision of
 * 2026-08-28: round to the kind side. At 85 DESIGN.md's own table closes the edge upward
 * (`ceiling` is `a >= 85`), so the snap lands in `ceiling` there — which is the direction that
 * matters at that end, because a flat underside has to be recognised as flat before it can be
 * credited as bed contact. Both bands need support, so the headline number does not move.
 *
 * @param {number} normalZ the z component of the unit normal
 * @param {number[]} edges the band edges, ascending
 * @param {number} toleranceDeg
 * @returns {number}
 */
function overhangAngleDeg(normalZ, edges, toleranceDeg) {
  const down = Math.min(Math.max(-normalZ, -1), 1);
  const angle = Math.asin(down) * DEGREES_PER_RADIAN;
  for (const edge of edges) {
    if (Math.abs(angle - edge) <= toleranceDeg) return edge;
  }
  return angle;
}

/**
 * Half-open upward, exactly as DESIGN.md §2.5 tabulates it:
 * `none` a <= 30, `mild` 30 < a <= 45, `steep` 45 < a <= 60, `severe` 60 < a < 85,
 * `ceiling` a >= 85.
 *
 * @param {number} angleDeg
 * @param {{mild: number, steep: number, severe: number, ceiling: number}} bands
 * @returns {Band}
 */
function bandOf(angleDeg, bands) {
  if (angleDeg <= bands.mild) return 'none';
  if (angleDeg <= bands.steep) return 'mild';
  if (angleDeg <= bands.severe) return 'steep';
  if (angleDeg < bands.ceiling) return 'severe';
  return 'ceiling';
}

/**
 * Sort every face into an overhang band, and measure the footprint it would print on.
 *
 * **Excluded triangles.** A degenerate triangle has a zero normal (core/mesh.js returns
 * `[0,0,0]` rather than dividing by zero) and a face whose coordinates are infinite has a
 * normal of NaN — FINDINGS.md, 2026-08-28: core/mesh.js's guard catches a NaN cross product
 * but not an Infinity one, so this module must not assume the normals are clean. Neither has a
 * direction, so neither belongs in a band: `asin(0)` would silently file every zero-area
 * triangle under `none`, and a NaN would fail every comparison and fall through to `ceiling`,
 * putting a face that does not exist into the number that decides supports. Both are dropped,
 * which is why the band counts need not add up to the mesh's triangle count. T04 already
 * reports such a mesh as `BAD_COORDINATE`, so the user is told about it there.
 *
 * **Bed contact** is the part of the underside actually resting on the plate: triangles in the
 * `ceiling` band whose three vertices all sit within `bedContactToleranceMm` of the mesh's own
 * minimum Z. Both halves are needed. Without the band test, a tiny steep sliver at the bottom
 * of the part counts as footprint; without the height test, the flat ceiling of an internal
 * cavity does. It is measured against the mesh's minimum, not against absolute zero, because a
 * recipe that models a part floating at z = 10 still prints it on the bed.
 *
 * **Bed contact is not support area.** A flat bottom face points straight down and is
 * geometrically identical to an unsupported ceiling; the only thing saving it is that it is
 * resting on the plate. So it is subtracted from `totalSupportAreaMm2` (user's decision,
 * 2026-08-28, correcting DESIGN.md §2.5's "steep + severe + ceiling"). Without the
 * subtraction a plain cube reports its own footprint as needing support, and — far worse —
 * `rankOrientations` below would prefer whichever way up gives the *smallest* footprint, and
 * advise standing a flat plate on its edge.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @param {import('./machine.js').Machine} machine
 * @returns {OverhangAnalysis}
 */
export function analyseOverhangs(positions, machine) {
  requireMachine(machine);
  // Validation of `positions` is core/mesh.js's, deliberately: calling it first means a bad
  // argument throws the same TypeError/RangeError here as everywhere else in core/, rather
  // than a third copy of the same check drifting from the other two (FINDINGS.md 2026-08-28).
  const normals = triangleNormals(positions);
  const areas = triangleAreas(positions);
  const box = boundingBox(positions);
  const count = areas.length;

  const bandEdges = machine.overhangBandsDeg;
  const edges = [bandEdges.mild, bandEdges.steep, bandEdges.severe, bandEdges.ceiling];
  const tolerance = machine.bandEdgeToleranceDeg ?? 0;

  const areaByBand = { none: 0, mild: 0, steep: 0, severe: 0, ceiling: 0 };
  const countByBand = { none: 0, mild: 0, steep: 0, severe: 0, ceiling: 0 };
  let steepestDeg = 0;
  let bedContactAreaMm2 = 0;

  const minZ = box.min[2];
  const bedTolerance = machine.bedContactToleranceMm;

  for (let tri = 0; tri < count; tri++) {
    const nx = normals[tri * 3];
    const ny = normals[tri * 3 + 1];
    const nz = normals[tri * 3 + 2];
    const usable = Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz);
    if (!usable || (nx === 0 && ny === 0 && nz === 0)) continue;

    const angle = overhangAngleDeg(nz, edges, tolerance);
    const band = bandOf(angle, bandEdges);
    const area = areas[tri];
    areaByBand[band] += area;
    countByBand[band] += 1;
    if (angle > steepestDeg) steepestDeg = angle;

    if (band === 'ceiling') {
      const at = tri * COORDS_PER_TRIANGLE;
      const onBed =
        positions[at + 2] - minZ <= bedTolerance &&
        positions[at + 5] - minZ <= bedTolerance &&
        positions[at + 8] - minZ <= bedTolerance;
      if (onBed) bedContactAreaMm2 += area;
    }
  }

  const footprintMm2 = box.size[0] * box.size[1];
  const supportBands = areaByBand.steep + areaByBand.severe + areaByBand.ceiling;

  return {
    buildDirection: [0, 0, 1],
    bands: BAND_NAMES.map((band, index) => ({
      band,
      // `none` reaches all the way down to -90: a face pointing straight up is as far from an
      // overhang as a face can be, and the band has to hold it.
      minAngleDeg: index === 0 ? -90 : edges[index - 1],
      maxAngleDeg: index === BAND_NAMES.length - 1 ? 90 : edges[index],
      areaMm2: areaByBand[band],
      triangleCount: countByBand[band],
    })),
    totalSupportAreaMm2: Math.max(0, supportBands - bedContactAreaMm2),
    // Clamped at zero because DESIGN.md §2.5 defines a <= 0 as "no overhang": a part whose
    // steepest face measures -90 has no overhang, and reporting "-90 degrees" as the worst
    // overhang would be read as a measurement rather than as an absence. An empty mesh reports
    // 0 for the same reason, and never NaN.
    maxOverhangAngleDeg: steepestDeg,
    bedContactAreaMm2,
    bedContactFraction: footprintMm2 > 0 ? bedContactAreaMm2 / footprintMm2 : 0,
    footprintMm2,
  };
}

// --- the orientation search ---------------------------------------------------------------

/**
 * The 24 rotations of the cube, as signed axis permutations.
 *
 * Six choices of which way is up, times four turns about the vertical — the base is applied
 * first and the spin second, matching how the name reads: `x+90,z+180` is x+90 and then z+180.
 * All 24 are proper rotations (determinant +1). A reflection would also map the axes onto each
 * other and would silently propose printing a mirror image of the part.
 *
 * Each entry says, for each output axis, which input axis feeds it and with what sign — so
 * applying one is a copy with a sign flip and introduces **no arithmetic error at all**. That
 * exactness is what makes the identity tie-break below actually hold: two orientations of a
 * symmetric part produce bit-identical areas rather than areas that differ in the last place.
 */
const ROTATIONS = buildRotations();

function buildRotations() {
  /** @param {number[]} v */
  const bases = [
    ['identity', (v) => v],
    ['x+90', ([x, y, z]) => [x, -z, y]],
    ['x+180', ([x, y, z]) => [x, -y, -z]],
    ['x+270', ([x, y, z]) => [x, z, -y]],
    ['y+90', ([x, y, z]) => [z, y, -x]],
    ['y+270', ([x, y, z]) => [-z, y, x]],
  ];
  const spins = [
    ['', (v) => v],
    ['z+90', ([x, y, z]) => [-y, x, z]],
    ['z+180', ([x, y, z]) => [-x, -y, z]],
    ['z+270', ([x, y, z]) => [y, -x, z]],
  ];

  const out = [];
  for (const [baseName, base] of bases) {
    for (const [spinName, spin] of spins) {
      const name =
        baseName === 'identity' ? spinName || 'identity' : spinName ? `${baseName},${spinName}` : baseName;
      // The image of each input axis, which read the other way gives the source axis and sign
      // of each output component.
      const images = [
        spin(base([1, 0, 0])),
        spin(base([0, 1, 0])),
        spin(base([0, 0, 1])),
      ];
      const sourceAxis = [0, 0, 0];
      const sign = [1, 1, 1];
      for (let axis = 0; axis < 3; axis++) {
        for (let from = 0; from < 3; from++) {
          if (images[from][axis] !== 0) {
            sourceAxis[axis] = from;
            sign[axis] = images[from][axis];
          }
        }
      }
      out.push({ name, sourceAxis, sign });
    }
  }
  return out;
}

/**
 * Writes `positions` turned by one rotation into `out`.
 *
 * Exact: every output coordinate is an input coordinate with, at most, its sign flipped, so no
 * arithmetic error enters and two orientations of a symmetric part measure bit-identically —
 * which is what lets the identity tie-break in `rankOrientations` mean anything. The one
 * artefact is that negating a zero gives -0, numerically identical to 0 everywhere it is used
 * and worth knowing only if a later task compares these coordinates with Object.is.
 */
function rotateInto(positions, rotation, out) {
  const { sourceAxis, sign } = rotation;
  for (let at = 0; at < positions.length; at += 3) {
    out[at] = sign[0] * positions[at + sourceAxis[0]];
    out[at + 1] = sign[1] * positions[at + sourceAxis[1]];
    out[at + 2] = sign[2] * positions[at + sourceAxis[2]];
  }
  return out;
}

/**
 * Turn a mesh by one of the 24 rotations, named as `rankOrientations` names it.
 *
 * Exported beyond what tasks/T05 specifies, for two reasons. The first is that a caller acting
 * on the recommendation — showing the part the suggested way up, or writing it back out — must
 * not re-derive the transform from the string: a second copy of this table is a table that can
 * drift, and the report would then advise one rotation and the viewer show another.
 *
 * The second is that without it the 24 cannot be proved distinct. A turn about the vertical
 * changes no face's overhang angle and no bounding-box size, so `z+90` and `z+270` are
 * indistinguishable through everything `OrientationResult` publishes — two of the 24 could
 * collapse onto the same transform, one real orientation would never be searched, and every
 * test in the suite would still pass. Making the transform reachable is what closes that.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @param {string} rotationName
 * @returns {Float64Array}
 */
export function applyRotation(positions, rotationName) {
  triangleNormals(positions); // validate with core/mesh.js's own message
  const rotation = ROTATIONS.find((candidate) => candidate.name === rotationName);
  if (!rotation) {
    throw new RangeError(
      `unknown rotation ${JSON.stringify(rotationName)}; expected one of ` +
        `${ROTATIONS.map((candidate) => candidate.name).join(', ')}.`,
    );
  }
  return rotateInto(positions, rotation, new Float64Array(positions.length));
}

/**
 * Every axis-aligned orientation, best first — which way up to print this.
 *
 * Ranked by the least support area; ties broken by the **most** bed contact, because between
 * two orientations that need the same supports the one that grips the plate harder is the one
 * that finishes. Remaining ties go to `identity`, so a part that already sits the right way up
 * is never gratuitously told to rotate. That last tie-break rides on a stable sort with
 * `identity` generated first, and on the exactness noted at ROTATIONS.
 *
 * Each candidate is measured by rotating the coordinates and running `analyseOverhangs` on
 * them — the same code path, not a shortcut through permuted normals. A faster version that
 * permuted the normals in place is possible, but then the ranking could disagree with the
 * analysis the report actually prints, and a wrong orientation suggestion is worse than none:
 * the user has no way to check it.
 *
 * **This is advice, not an instruction, and T07 must render it as such.** It is blind to
 * cosmetic faces, to layer-line direction versus load, and to bed adhesion beyond raw contact
 * area — all three of which routinely outrank support area in a real decision.
 *
 * @param {Float32Array | Float64Array | number[]} positions
 * @param {import('./machine.js').Machine} machine
 * @returns {OrientationResult[]}
 */
export function rankOrientations(positions, machine) {
  requireMachine(machine);
  triangleNormals(positions); // validate once, with core/mesh.js's own message
  const length = positions.length;
  const rotated = new Float64Array(length);

  const results = ROTATIONS.map((rotation) => {
    const name = rotation.name;
    rotateInto(positions, rotation, rotated);
    const analysis = analyseOverhangs(rotated, machine);
    const box = boundingBox(rotated);
    return {
      rotation: name,
      totalSupportAreaMm2: analysis.totalSupportAreaMm2,
      bedContactAreaMm2: analysis.bedContactAreaMm2,
      sizeMm: box.size,
    };
  });

  return results.sort(
    (a, b) =>
      a.totalSupportAreaMm2 - b.totalSupportAreaMm2 ||
      b.bedContactAreaMm2 - a.bedContactAreaMm2,
  );
}
