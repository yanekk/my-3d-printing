// core/solidity.js — the first question the report asks, and the one that decides whether the
// rest of the report means anything. A mesh with a hole in it, an inside-out face or a
// zero-area triangle is not printable by any slicer, and its volume is not a volume.
//
// Every expectation below is counted by hand from the fixture's own construction rather than
// taken from a run: a closed cube has 18 edges each used twice; taking the top face off leaves
// exactly 4 unpaired, because the two triangles that went with it also took their shared
// diagonal; one reversed face disagrees with its neighbours on exactly 3 edges.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseStl } from '../core/stl.js';
import { analyseSolidity } from '../core/solidity.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** @param {string} name @returns {Float32Array} the positions of a committed fixture */
const positionsOf = (name) =>
  parseStl(new Uint8Array(readFileSync(`${FIXTURES}${name}`))).positions;

const CUBE = positionsOf('cube-binary.stl');
const OPEN_BOX = positionsOf('open-box.stl');
const FLIPPED_FACE = positionsOf('flipped-face.stl');
const NEAR_MISS = positionsOf('near-miss.stl');
const DEGENERATE = positionsOf('degenerate.stl');
const EMPTY = positionsOf('empty.stl');
const TETRAHEDRON = positionsOf('tetrahedron.stl');

/** Every triangle's winding reversed, which turns a solid inside out without opening it. */
function reverseWinding(positions) {
  const out = new Float32Array(positions.length);
  for (let at = 0; at < positions.length; at += 9) {
    for (let axis = 0; axis < 3; axis++) {
      out[at + axis] = positions[at + axis];
      out[at + 3 + axis] = positions[at + 6 + axis];
      out[at + 6 + axis] = positions[at + 3 + axis];
    }
  }
  return out;
}

/** @param {...(ArrayLike<number>)} parts */
function concatMeshes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Asserts nothing in a Solidity is NaN — a blank in the report is worse than a wrong number. */
function assertNoBlanks(solidity, what) {
  for (const [key, value] of Object.entries(solidity)) {
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `${what}: ${key} is ${value}`);
    }
  }
}

// --- the happy answer ---------------------------------------------------------------------

test('a closed cube is a solid, and nothing is wrong with it', () => {
  const solidity = analyseSolidity(CUBE);
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.boundaryEdgeCount, 0);
  assert.equal(solidity.nonManifoldEdgeCount, 0);
  assert.equal(solidity.degenerateTriangleCount, 0);
  assert.equal(solidity.inconsistentWindingCount, 0);
  assert.equal(solidity.badCoordinateCount, 0);
  assert.equal(solidity.outOfRangeCoordinateCount, 0);
  assert.equal(solidity.invertedOverall, false);
  // 2 mm cube. The volume comes from core/mesh.js and is checked here only for its sign and
  // magnitude, because a positive number is what `invertedOverall` rests on.
  assert.ok(Math.abs(solidity.signedVolumeMm3 - 8) < 1e-6);
  assert.deepEqual(solidity.sampleBoundaryEdges, []);
  // Reached at the default tolerance, so no retry happened.
  assert.equal(solidity.weldToleranceUsed, 1e-4);
});

test('the tetrahedron is a solid too — four faces, six edges, none axis-aligned', () => {
  const solidity = analyseSolidity(TETRAHEDRON);
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.boundaryEdgeCount, 0);
  assert.equal(solidity.inconsistentWindingCount, 0);
  assert.ok(solidity.signedVolumeMm3 > 0);
});

// --- open meshes --------------------------------------------------------------------------

test('a cube with the top face removed has exactly four boundary edges', () => {
  const solidity = analyseSolidity(OPEN_BOX);
  assert.equal(solidity.watertight, false);
  // Four, not five: the top face's two triangles shared a diagonal, and that edge left with
  // them rather than becoming a boundary.
  assert.equal(solidity.boundaryEdgeCount, 4);
  assert.equal(solidity.nonManifoldEdgeCount, 0);
  assert.equal(solidity.inconsistentWindingCount, 0);
  assert.equal(solidity.sampleBoundaryEdges.length, 4);
  // The opening is the square rim at z = 2, so every sampled boundary vertex sits there.
  for (const edge of solidity.sampleBoundaryEdges) {
    assert.equal(edge.a[2], 2);
    assert.equal(edge.b[2], 2);
  }
});

test('a lone triangle is not a solid, and its three edges are all boundaries', () => {
  const solidity = analyseSolidity(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
  assert.equal(solidity.watertight, false);
  assert.equal(solidity.boundaryEdgeCount, 3);
  assert.equal(solidity.nonManifoldEdgeCount, 0);
  assert.equal(solidity.degenerateTriangleCount, 0);
  assertNoBlanks(solidity, 'lone triangle');
});

// --- winding ------------------------------------------------------------------------------

test('one reversed face is caught by winding, not by watertightness', () => {
  const solidity = analyseSolidity(FLIPPED_FACE);
  // Still closed. Reversing a triangle does not open a mesh, which is exactly why this needs
  // its own check — a boundary-edge count alone reports this cube as perfect.
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.boundaryEdgeCount, 0);
  assert.equal(solidity.nonManifoldEdgeCount, 0);
  // Its three edges, each now traversed the same way by both triangles that use it.
  assert.equal(solidity.inconsistentWindingCount, 3);
  // The mesh as a whole is still the right way out: one face out of twelve does not flip the
  // sign of the volume.
  assert.equal(solidity.invertedOverall, false);
});

test('a cube wound entirely inside-out is consistent, and inverted', () => {
  const solidity = analyseSolidity(reverseWinding(CUBE));
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.inconsistentWindingCount, 0);
  assert.equal(solidity.invertedOverall, true);
  assert.ok(Math.abs(solidity.signedVolumeMm3 + 8) < 1e-6);
});

// --- degenerate triangles -----------------------------------------------------------------

test('a zero-area triangle is counted, not paired', () => {
  const solidity = analyseSolidity(DEGENERATE);
  assert.equal(solidity.degenerateTriangleCount, 1);
  // The fixture is one honest triangle plus one collinear one. The honest triangle is an open
  // surface, so this mesh is not watertight — but the degenerate triangle contributed no
  // boundary edges of its own: 3, not 6.
  assert.equal(solidity.watertight, false);
  assert.equal(solidity.boundaryEdgeCount, 3);
  assertNoBlanks(solidity, 'degenerate fixture');
});

test('a degenerate triangle does not make a closed solid look open', () => {
  // The point of excluding degenerates, stated as the case that matters: a cube with a
  // zero-area triangle dropped into it is still a cube.
  const sliver = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  const solidity = analyseSolidity(concatMeshes(CUBE, sliver));
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.boundaryEdgeCount, 0);
  assert.equal(solidity.degenerateTriangleCount, 1);
});

test('a triangle whose corners weld together is degenerate too', () => {
  // Distinct coordinates, but two of them are 1e-6 mm apart — a hundredth of the weld
  // tolerance — so after welding this triangle has two corners, not three.
  const collapsed = new Float32Array([0, 0, 0, 1e-6, 0, 0, 0, 1, 0]);
  const solidity = analyseSolidity(concatMeshes(CUBE, collapsed));
  assert.equal(solidity.degenerateTriangleCount, 1);
  assert.equal(solidity.watertight, true);
});

// --- the weld tolerance and the retry ------------------------------------------------------

test('a 5e-4 mm seam is open at the default tolerance and closed at the coarse one', () => {
  const solidity = analyseSolidity(NEAR_MISS);
  // `weldToleranceUsed` is the proof of both halves at once: the coarse pass only runs when
  // the fine one failed, and its result is only returned when it closes. A 1e-3 here therefore
  // says the mesh was open at 1e-4 and closed at 1e-3, which is what the retry rule promises.
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.weldToleranceUsed, 1e-3);
  assert.equal(solidity.boundaryEdgeCount, 0);
  assert.equal(solidity.nonManifoldEdgeCount, 0);
  assert.equal(solidity.inconsistentWindingCount, 0);
});

test('naming the default tolerance explicitly changes nothing — the retry still applies', () => {
  // The rule is about the verdict, not about which number the caller passed.
  const solidity = analyseSolidity(NEAR_MISS, { weldTolerance: 1e-4 });
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.weldToleranceUsed, 1e-3);
});

test('a seam wider than both tolerances stays open, and reports the default tolerance', () => {
  // 2e-3 mm: past the coarse tolerance as well, so the retry finds nothing and the fine
  // result is what comes back rather than a coarse measurement that changed nothing.
  const shifted = new Float32Array(NEAR_MISS);
  for (let at = 2; at < shifted.length; at += 3) {
    if (shifted[at] > 1.0001) shifted[at] = Math.fround(shifted[at] + 1.5e-3);
  }
  const solidity = analyseSolidity(shifted);
  assert.equal(solidity.watertight, false);
  assert.equal(solidity.weldToleranceUsed, 1e-4);
  assert.equal(solidity.boundaryEdgeCount, 8);
});

test('a caller may weld more tightly than the default', () => {
  const solidity = analyseSolidity(NEAR_MISS, { weldTolerance: 1e-6 });
  assert.equal(solidity.watertight, true, 'the 1e-3 retry still applies');
  const strict = analyseSolidity(CUBE, { weldTolerance: 1e-9 });
  assert.equal(strict.watertight, true, 'a cube welds at any tolerance — its corners are exact');
});

// The float32 value immediately below 1.0. It is 5.96e-8 mm from the seam — sixteen hundred
// times inside the default weld tolerance — and it is on the far side of the grid line at
// z = 1.0: 1.0 quantises to cell 10000 and this quantises to 9999. Verified by walking the
// float32 bit pattern rather than assumed, because which side of a cell wall a float lands on
// is not something to reason about in your head.
const JUST_BELOW_ONE = Math.fround(0.99999994);

test('a vertex pair straddling a grid line still welds', () => {
  // This is the whole reason the weld measures distance instead of comparing quantised keys.
  // The seam here is far smaller than any tolerance in this project, and a quantising weld
  // still reports a perfectly closed cube as open — a false 'not watertight', which the task
  // doc names as the worse of the two failures.
  assert.notEqual(
    Math.floor(1 / 1e-4),
    Math.floor(JUST_BELOW_ONE / 1e-4),
    'the fixture must actually straddle a cell wall, or this test proves nothing',
  );
  assert.ok(1 - JUST_BELOW_ONE < 1e-4 / 1000);

  const straddled = new Float32Array(NEAR_MISS);
  for (let at = 2; at < straddled.length; at += 3) {
    if (straddled[at] > 1.0001) straddled[at] = JUST_BELOW_ONE;
  }
  const solidity = analyseSolidity(straddled);
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.weldToleranceUsed, 1e-4, 'closed at the default tolerance, so no retry');
});

// --- non-manifold ---------------------------------------------------------------------------

test('an edge used by exactly three triangles is non-manifold', () => {
  // The shape a T-junction makes: a closed cube with one loose flap welded onto an edge it
  // already had. Three is the smallest count that is neither a boundary nor a proper pair, and
  // it is the count a coincident-solid fixture never reaches — an edge shared by four passes a
  // check written as `> 3` and this one does not.
  const flap = new Float32Array([0, 0, 0, 2, 0, 0, 1, -1, -1]);
  const solidity = analyseSolidity(concatMeshes(CUBE, flap));
  assert.equal(solidity.nonManifoldEdgeCount, 1);
  assert.equal(solidity.watertight, false);
  // The flap's other two edges are used by nothing else.
  assert.equal(solidity.boundaryEdgeCount, 2);
});

test('two cubes in the same place share every edge four ways', () => {
  const solidity = analyseSolidity(concatMeshes(CUBE, CUBE));
  assert.ok(solidity.nonManifoldEdgeCount > 0);
  // All 18 of the cube's edges, each now used by four triangles.
  assert.equal(solidity.nonManifoldEdgeCount, 18);
  assert.equal(solidity.boundaryEdgeCount, 0);
  // DESIGN.md §2.4: watertight means every edge used by exactly two triangles. Four is not two.
  assert.equal(solidity.watertight, false);
});

// --- broken coordinates -----------------------------------------------------------------------

test('an Infinity vertex is named, and the rest of the mesh is still measured', () => {
  // DESIGN.md §2.10, user decision 2026-08-28: report the triangle, do not refuse the mesh.
  const broken = concatMeshes(CUBE, new Float32Array([0, 0, 0, 1, 0, 0, Infinity, 1, 0]));
  const solidity = analyseSolidity(broken);
  assert.equal(solidity.badCoordinateCount, 1);
  assert.deepEqual(solidity.sampleBadTriangles, [12]);
  // The cube underneath is untouched: it still pairs, and it is still closed.
  assert.equal(solidity.boundaryEdgeCount, 0);
  assert.equal(solidity.watertight, true);
  assert.equal(solidity.degenerateTriangleCount, 0);
});

test('a NaN vertex counts the same way', () => {
  const broken = concatMeshes(CUBE, new Float32Array([0, 0, 0, 1, 0, 0, 0, NaN, 0]));
  const solidity = analyseSolidity(broken);
  assert.equal(solidity.badCoordinateCount, 1);
  assert.equal(solidity.outOfRangeCoordinateCount, 0);
});

test('a broken coordinate leaves the volume blank rather than claiming a value', () => {
  const broken = concatMeshes(CUBE, new Float32Array([0, 0, 0, 1, 0, 0, Infinity, 1, 0]));
  const solidity = analyseSolidity(broken);
  // The signed volume is a sum over every triangle, so one broken triangle does touch it.
  assert.ok(Number.isNaN(solidity.signedVolumeMm3));
  // And an unmeasurable volume must not read as "the right way out" or as "inside out".
  assert.equal(solidity.invertedOverall, false);
});

test('the samples of broken triangles are capped at ten', () => {
  const parts = [CUBE];
  for (let n = 0; n < 25; n++) parts.push(new Float32Array([0, 0, 0, 1, 0, 0, NaN, 1, 0]));
  const solidity = analyseSolidity(concatMeshes(...parts));
  assert.equal(solidity.badCoordinateCount, 25);
  assert.equal(solidity.sampleBadTriangles.length, 10);
});

test('a coordinate too large for the weld grid is counted apart from a broken one', () => {
  // 1e15 mm — a billion kilometres. Real, finite, parses and writes back without complaint,
  // and past the point where the cell grid has distinct integers to address it, so this file
  // cannot say whether two such vertices are the same point.
  const huge = concatMeshes(CUBE, new Float32Array([0, 0, 0, 1, 0, 0, 1e15, 1, 0]));
  const solidity = analyseSolidity(huge);
  assert.equal(solidity.outOfRangeCoordinateCount, 1);
  assert.equal(solidity.badCoordinateCount, 0, 'it is a real number, and must not be called one');
  assert.deepEqual(solidity.sampleOutOfRangeTriangles, [12]);
  // Everything that does not touch that triangle still holds.
  assert.equal(solidity.boundaryEdgeCount, 0);
  assert.equal(solidity.watertight, true);
});

test('the out-of-range threshold sits exactly where DESIGN.md says it does', () => {
  // DESIGN.md §2.10: the line is `weldTolerance * 2^53` — 900 719 925 474 mm at the default,
  // about 900 000 km. Pinned from both sides, because the threshold is a number the user's
  // error message rests on and nothing else in the suite would notice it moving.
  const limit = 1e-4 * 2 ** 53;
  const at = (coordinate) => {
    // Float64Array: a Float32Array would round the coordinate away from the threshold before
    // the module ever saw it.
    const mesh = new Float64Array(CUBE.length + 9);
    mesh.set(CUBE, 0);
    mesh.set([0, 0, 0, 1, 0, 0, coordinate, 1, 0], CUBE.length);
    return analyseSolidity(mesh).outOfRangeCoordinateCount;
  };
  assert.equal(at(limit * 0.999), 0, 'just inside the limit is an ordinary coordinate');
  assert.equal(at(limit), 0, 'the limit itself is still weldable');
  assert.equal(at(limit * 1.001), 1, 'just outside it, the grid can no longer address it');
  assert.equal(at(-limit * 1.001), 1, 'and the same going the other way');
});

test('the coarse retry does not make an out-of-range triangle stop being out of range', () => {
  // The retry welds at 1e-3, where `tolerance * 2^53` is ten times larger — so a coordinate
  // between the two limits used to be out of range on a clean mesh and in range on the same
  // mesh with an unrelated seam somewhere else, purely because the seam triggered the retry.
  // COORDINATE_OUT_OF_RANGE is a stable code the user acts on; it must not depend on that.
  const scale = 5e12; // above 1e-4 * 2^53, below 1e-3 * 2^53
  const corners = [
    [0, 0, 0],
    [scale, 0, 0],
    [0, scale, 0],
    [0, 0, scale],
  ];
  // A closed tetrahedron, so it cannot open the mesh once it is welded in — without that, the
  // retry would fail for the wrong reason and the bug would hide.
  const tetrahedron = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]
    .flatMap((face) => face.flatMap((corner) => corners[corner]));

  const withHugePart = (base) => {
    const mesh = new Float64Array(base.length + tetrahedron.length);
    mesh.set(base, 0);
    mesh.set(tetrahedron, base.length);
    return analyseSolidity(mesh);
  };

  // NEAR_MISS closes only at 1e-3, so this mesh is the one the retry rescues.
  const retried = withHugePart(NEAR_MISS);
  assert.equal(retried.weldToleranceUsed, 1e-3, 'the retry must actually have won, or this proves nothing');
  assert.equal(retried.outOfRangeCoordinateCount, 4);
  assert.deepEqual(retried.sampleOutOfRangeTriangles.length, 4);

  // The identical part on a mesh with no seam, where no retry happens: the same answer.
  const direct = withHugePart(CUBE);
  assert.equal(direct.weldToleranceUsed, 1e-4);
  assert.equal(direct.outOfRangeCoordinateCount, 4);
});

test('an ordinary large part is not out of range', () => {
  // The threshold has to sit far past anything a person could mean. A 400 000 mm coordinate —
  // the far end of the mesh core/mesh.js is tested against — is ordinary as far as this is
  // concerned.
  const far = new Float32Array(CUBE);
  for (let at = 0; at < far.length; at++) far[at] = Math.fround(far[at] + 400000);
  const solidity = analyseSolidity(far);
  assert.equal(solidity.outOfRangeCoordinateCount, 0);
  assert.equal(solidity.watertight, true);
});

// --- the empty mesh ---------------------------------------------------------------------------

test('an empty mesh is not a solid, and answers every question with zero', () => {
  const solidity = analyseSolidity(EMPTY);
  assert.equal(solidity.watertight, false);
  assert.equal(solidity.boundaryEdgeCount, 0);
  assert.equal(solidity.nonManifoldEdgeCount, 0);
  assert.equal(solidity.degenerateTriangleCount, 0);
  assert.equal(solidity.inconsistentWindingCount, 0);
  assert.equal(solidity.badCoordinateCount, 0);
  assert.equal(solidity.outOfRangeCoordinateCount, 0);
  assert.equal(solidity.signedVolumeMm3, 0);
  assert.equal(solidity.invertedOverall, false);
  assert.deepEqual(solidity.sampleBoundaryEdges, []);
  assertNoBlanks(solidity, 'empty mesh');
});

test('a mesh of nothing but degenerate triangles is not a solid either', () => {
  const flat = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0, 3, 0, 0, 5, 0, 0]);
  const solidity = analyseSolidity(flat);
  assert.equal(solidity.watertight, false);
  assert.equal(solidity.degenerateTriangleCount, 2);
  assert.equal(solidity.boundaryEdgeCount, 0);
  assertNoBlanks(solidity, 'all-degenerate mesh');
});

// --- the sample cap ----------------------------------------------------------------------------

test('sampleBoundaryEdges stops at ten however open the mesh is', () => {
  // Forty separate triangles floating in space: 120 boundary edges, none of them paired.
  const parts = [];
  for (let n = 0; n < 40; n++) {
    parts.push(new Float32Array([n * 10, 0, 0, n * 10 + 1, 0, 0, n * 10, 1, 0]));
  }
  const solidity = analyseSolidity(concatMeshes(...parts));
  assert.equal(solidity.boundaryEdgeCount, 120);
  assert.equal(solidity.sampleBoundaryEdges.length, 10);
  for (const edge of solidity.sampleBoundaryEdges) {
    assert.equal(edge.a.length, 3);
    assert.equal(edge.b.length, 3);
  }
});

// --- caller bugs --------------------------------------------------------------------------------

test('a wrong type or a ragged length is a caller bug, not a bad mesh', () => {
  assert.throws(() => analyseSolidity('cube-binary.stl'), TypeError);
  assert.throws(() => analyseSolidity(new Float32Array(8)), RangeError);
  assert.throws(() => analyseSolidity(CUBE, { weldTolerance: 0 }), TypeError);
  assert.throws(() => analyseSolidity(CUBE, { weldTolerance: -1e-4 }), TypeError);
  assert.throws(() => analyseSolidity(CUBE, { weldTolerance: NaN }), TypeError);
});

// --- cost ----------------------------------------------------------------------------------------

test('50 000 triangles are paired in well under a second', () => {
  // The guard against an accidental O(n^2) pairing. A grid of open quads: every interior edge
  // is shared, so the welding and the edge map both do real work rather than finding one
  // vertex forty thousand times.
  const side = 159; // 159 * 159 * 2 = 50 562 triangles
  const positions = new Float32Array(side * side * 2 * 9);
  let at = 0;
  const put = (x, y) => {
    positions[at++] = x;
    positions[at++] = y;
    positions[at++] = 0;
  };
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      put(col, row);
      put(col + 1, row);
      put(col + 1, row + 1);
      put(col, row);
      put(col + 1, row + 1);
      put(col, row + 1);
    }
  }
  assert.equal(positions.length / 9, 50562);

  const started = performance.now();
  const solidity = analyseSolidity(positions);
  const elapsed = performance.now() - started;

  // The sheet is open, so the perimeter is a boundary: 4 * 159 edges around the outside.
  assert.equal(solidity.boundaryEdgeCount, 636);
  assert.equal(solidity.nonManifoldEdgeCount, 0);
  assert.equal(solidity.degenerateTriangleCount, 0);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)} ms`);
});
