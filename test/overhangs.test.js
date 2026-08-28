// core/overhangs.js — which faces will need supports, and how steeply they hang.
//
// Every expectation below is worked out from the fixture's own construction, not read off a
// run. The wedge's sloped face is 10*sqrt(2) by 10 = 141.421...; the shelf's ledge underside is
// 20 by 10 = 200 exactly, and its base another 100 that must NOT be counted as an overhang
// because it is standing on it.
//
// The band edges are pinned from **both** sides, and the snap that holds a 45 degree chamfer in
// `mild` is pinned from both sides too. Pinning only one side would let a tolerance of ten
// degrees pass, and that is exactly the mutation that would ruin the report.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseStl } from '../core/stl.js';
import { surfaceArea, boundingBox, signedVolume } from '../core/mesh.js';
import { analyseOverhangs, applyRotation, rankOrientations } from '../core/overhangs.js';
import { ENDER3_V3_KE } from '../core/machine.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** @param {string} name @returns {Float32Array} the positions of a committed fixture */
const positionsOf = (name) =>
  parseStl(new Uint8Array(readFileSync(`${FIXTURES}${name}`))).positions;

const CUBE = positionsOf('cube-binary.stl'); // 2 mm, one corner at the origin
const WEDGE45 = positionsOf('wedge45.stl');
const SHELF = positionsOf('shelf.stl');
const SPHERE = positionsOf('sphere.stl');
const DEGENERATE = positionsOf('degenerate.stl');
const EMPTY = positionsOf('empty.stl');

const M = ENDER3_V3_KE;

/** @param {OverhangAnalysis} analysis @param {string} band */
const bandOf = (analysis, band) => analysis.bands.find((row) => row.band === band);

/**
 * One triangle whose outward normal hangs at exactly `angleDeg` from vertical.
 *
 * n = (cos a, 0, -sin a), so -n.z = sin a and the overhang angle is a by construction. The two
 * edges are the unit vectors perpendicular to n, wound so the right-hand rule gives n back.
 * Built in float64 and left there: these are the cases where a tenth of a degree decides the
 * answer, and rounding them through float32 first would test the format, not the bands.
 *
 * @param {number} angleDeg @param {number} scale
 */
function faceAt(angleDeg, scale = 1) {
  const a = (angleDeg * Math.PI) / 180;
  return [0, 0, 0, 0, scale, 0, Math.sin(a) * scale, 0, Math.cos(a) * scale];
}

/** The band a single face at this angle falls in. */
const bandAt = (angleDeg) => {
  const bands = analyseOverhangs(faceAt(angleDeg), M).bands.filter((row) => row.triangleCount > 0);
  assert.equal(bands.length, 1, `a single face landed in ${bands.length} bands`);
  return bands[0].band;
};

/** @param {ArrayLike<number>} positions @param {number} dz */
function raisedBy(positions, dz) {
  const out = Float64Array.from(positions);
  for (let at = 2; at < out.length; at += 3) out[at] += dz;
  return out;
}

/** @param {...ArrayLike<number>} parts */
function concatMeshes(...parts) {
  const out = new Float64Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Coordinate-by-coordinate equality, deliberately numeric rather than `deepStrictEqual`.
 *
 * Negating an axis turns 0 into -0, which every comparison and every sum in this project
 * treats as 0 — but which `deepStrictEqual` calls a difference. Asserting on the bit pattern
 * would be asserting on something no behaviour depends on.
 */
function assertSameCoordinates(actual, expected, what) {
  assert.equal(actual.length, expected.length, `${what}: length`);
  for (let at = 0; at < expected.length; at++) {
    // `===` rather than assert.equal, which is strict here and so uses Object.is: it would
    // call -0 and 0 a difference.
    assert.ok(
      actual[at] === expected[at],
      `${what}: coordinate ${at} is ${actual[at]}, expected ${expected[at]}`,
    );
  }
}

/** Asserts no number anywhere in an analysis is NaN — a blank in the report explains nothing. */
function assertNoBlanks(analysis, what) {
  const walk = (value, path) => {
    if (typeof value === 'number') {
      assert.ok(Number.isFinite(value), `${what}: ${path} is ${value}`);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    }
  };
  walk(analysis, what);
}

// --- the shape of the answer ---------------------------------------------------------------

test('all five bands are always present, in order, spanning -90 to 90 without a gap', () => {
  for (const [name, positions] of [['cube', CUBE], ['empty', EMPTY], ['sphere', SPHERE]]) {
    const { bands } = analyseOverhangs(positions, M);
    assert.deepEqual(
      bands.map((row) => row.band),
      ['none', 'mild', 'steep', 'severe', 'ceiling'],
      name,
    );
    assert.equal(bands[0].minAngleDeg, -90, name);
    assert.equal(bands.at(-1).maxAngleDeg, 90, name);
    for (let i = 1; i < bands.length; i++) {
      assert.equal(bands[i].minAngleDeg, bands[i - 1].maxAngleDeg, `${name}: gap before ${bands[i].band}`);
    }
  }
});

test('the build direction is up, and says so', () => {
  assert.deepEqual(analyseOverhangs(CUBE, M).buildDirection, [0, 0, 1]);
});

// --- the cube: the case with no overhang at all ---------------------------------------------

test('an axis-aligned cube has every face in `none` or `ceiling`, and needs no supports', () => {
  const analysis = analyseOverhangs(CUBE, M);
  for (const row of analysis.bands) {
    if (row.band === 'none' || row.band === 'ceiling') continue;
    assert.equal(row.triangleCount, 0, `${row.band} should be empty on a cube`);
    assert.equal(row.areaMm2, 0, `${row.band} should be empty on a cube`);
  }
  // 5 faces of 4 mm^2 up and sideways, 1 face of 4 mm^2 down. The downward one is the bed.
  assert.equal(bandOf(analysis, 'none').areaMm2, 20);
  assert.equal(bandOf(analysis, 'none').triangleCount, 10);
  assert.equal(bandOf(analysis, 'ceiling').areaMm2, 4);
  assert.equal(bandOf(analysis, 'ceiling').triangleCount, 2);

  // The whole point of the decision of 2026-08-28: the face it is standing on is not an
  // overhang. Without the subtraction this reads 4 mm^2 and the report tells the user to
  // support the bottom of a cube.
  assert.equal(analysis.totalSupportAreaMm2, 0);
  assert.equal(analysis.bedContactAreaMm2, 4);
});

test('a cube on the bed has full bed contact: the footprint is one face', () => {
  const analysis = analyseOverhangs(CUBE, M);
  const { size } = boundingBox(CUBE);
  assert.equal(analysis.footprintMm2, size[0] * size[1]);
  assert.equal(analysis.bedContactAreaMm2, size[0] * size[1]);
  assert.equal(analysis.bedContactFraction, 1);
});

test('bed contact is measured from the mesh, not from absolute zero', () => {
  // A recipe that models a part floating at z = 10 still prints it on the plate.
  const onBed = analyseOverhangs(CUBE, M);
  const raised = analyseOverhangs(raisedBy(CUBE, 10), M);
  assert.equal(raised.bedContactAreaMm2, onBed.bedContactAreaMm2);
  assert.equal(raised.bedContactFraction, 1);
  assert.equal(raised.totalSupportAreaMm2, 0);

  // ...and downward: a part modelled below the plate behaves the same way.
  const sunk = analyseOverhangs(raisedBy(CUBE, -37.5), M);
  assert.equal(sunk.bedContactAreaMm2, onBed.bedContactAreaMm2);
});

// --- the band edges, from both sides --------------------------------------------------------

test('wedge45.stl: the sloped face is `mild`, the friendly side of the 45 degree line', () => {
  const analysis = analyseOverhangs(WEDGE45, M);
  // 10*sqrt(2) long by 10 deep.
  assert.ok(Math.abs(bandOf(analysis, 'mild').areaMm2 - 100 * Math.SQRT2) < 1e-3);
  assert.equal(bandOf(analysis, 'mild').triangleCount, 2);
  assert.equal(bandOf(analysis, 'steep').areaMm2, 0);
  assert.ok(Math.abs(analysis.maxOverhangAngleDeg - 45) < 1e-6);
  // Nothing on this wedge faces flat down, so nothing holds it to the plate.
  assert.equal(analysis.bedContactAreaMm2, 0);
  assert.equal(analysis.bedContactFraction, 0);
  assert.equal(analysis.totalSupportAreaMm2, 0);
});

test('45.0 is `mild` and 45.1 is `steep`', () => {
  assert.equal(bandAt(45), 'mild');
  assert.equal(bandAt(45.1), 'steep');
  assert.equal(bandAt(44.9), 'mild');
});

test('60.0 is `steep` and 60.1 is `severe`', () => {
  assert.equal(bandAt(60), 'steep');
  assert.equal(bandAt(60.1), 'severe');
  assert.equal(bandAt(59.9), 'steep');
});

test('85.0 is `ceiling` and 84.9 is `severe`', () => {
  assert.equal(bandAt(85), 'ceiling');
  assert.equal(bandAt(84.9), 'severe');
  assert.equal(bandAt(90), 'ceiling');
});

test('30.0 is `none` and 30.1 is `mild`', () => {
  assert.equal(bandAt(30), 'none');
  assert.equal(bandAt(30.1), 'mild');
  assert.equal(bandAt(29.9), 'none');
});

test('the float32 scatter around 45 degrees does not move a chamfer into `steep`', () => {
  // FINDINGS.md, 2026-08-28: of 1060 geometrically exact 45 degree faces, 39 measured above
  // the line once their coordinates had been through float32, scattering to +3.8e-6 degrees.
  // Every one of those must still read `mild`, or two exports of one model disagree.
  for (const drift of [1e-7, 1e-6, 3.8e-6, 1e-5, 1e-4, 1e-3]) {
    assert.equal(bandAt(45 + drift), 'mild', `+${drift} degrees`);
    assert.equal(bandAt(60 + drift), 'steep', `+${drift} degrees`);
    assert.equal(bandAt(30 + drift), 'none', `+${drift} degrees`);
  }
});

test('the snap is a hair wide, not a band wide', () => {
  // Pinned from the far side as well. Without this, a tolerance of ten degrees passes every
  // other test in this file, and the report stops distinguishing a chamfer from a wall.
  const tolerance = M.bandEdgeToleranceDeg;
  assert.equal(bandAt(45 + tolerance * 0.9), 'mild');
  assert.equal(bandAt(45 + tolerance * 2), 'steep');
  assert.equal(bandAt(60 + tolerance * 2), 'severe');
  assert.equal(bandAt(30 + tolerance * 2), 'mild');
  // Half a degree is a real difference and must survive.
  assert.equal(bandAt(45.5), 'steep');
});

test('a vertical wall is 0 degrees and needs nothing', () => {
  assert.equal(bandAt(0), 'none');
  const wall = analyseOverhangs(faceAt(0), M);
  assert.equal(wall.maxOverhangAngleDeg, 0);
  assert.equal(wall.totalSupportAreaMm2, 0);
});

test('an upward-facing face is a negative angle, is `none`, and is never bed contact', () => {
  // faceAt(-90) points straight up. Placed at the mesh minimum it satisfies the height half of
  // the bed-contact rule and must still fail the direction half: a horizontal face at the
  // bottom that points upward is the inside of a cavity, not the footprint.
  const up = faceAt(-90);
  const analysis = analyseOverhangs(up, M);
  assert.equal(bandOf(analysis, 'none').triangleCount, 1);
  assert.equal(analysis.maxOverhangAngleDeg, 0); // no overhang, reported as 0 rather than -90
  assert.equal(analysis.bedContactAreaMm2, 0);

  // And in company: a downward face and an upward face at the same height. Only one is bed.
  const both = concatMeshes(faceAt(90), faceAt(-90));
  const mixed = analyseOverhangs(both, M);
  assert.equal(bandOf(mixed, 'ceiling').triangleCount, 1);
  assert.equal(mixed.bedContactAreaMm2, bandOf(mixed, 'ceiling').areaMm2);
});

// --- the shelf: the case the user actually has -----------------------------------------------

test('shelf.stl: the ledge underside is unsupported ceiling of exactly 200 mm^2', () => {
  const analysis = analyseOverhangs(SHELF, M);
  // 300 mm^2 faces downward in total: the 20 x 10 ledge underside at z = 30 and the 10 x 10
  // base at z = 0. Only the base is standing on anything.
  assert.ok(Math.abs(bandOf(analysis, 'ceiling').areaMm2 - 300) < 1e-3);
  assert.ok(Math.abs(analysis.bedContactAreaMm2 - 100) < 1e-3);
  assert.ok(
    Math.abs(analysis.totalSupportAreaMm2 - 200) < 1e-3,
    `ledge underside measured ${analysis.totalSupportAreaMm2}`,
  );
  assert.equal(analysis.footprintMm2, 300); // 30 x 10 bounding box
  assert.ok(Math.abs(analysis.bedContactFraction - 1 / 3) < 1e-9);
});

test('shelf.stl: the worst overhang is a flat 90 degrees', () => {
  assert.equal(analyseOverhangs(SHELF, M).maxOverhangAngleDeg, 90);
});

// --- the sphere: every band at once ----------------------------------------------------------

test('sphere.stl: the band areas add back up to the surface area', () => {
  const analysis = analyseOverhangs(SPHERE, M);
  const summed = analysis.bands.reduce((sum, row) => sum + row.areaMm2, 0);
  assert.ok(
    Math.abs(summed - surfaceArea(SPHERE)) < 1e-3,
    `bands sum to ${summed}, surface is ${surfaceArea(SPHERE)}`,
  );
  const counted = analysis.bands.reduce((sum, row) => sum + row.triangleCount, 0);
  assert.equal(counted, SPHERE.length / 9);
  // A smooth closed surface has faces in several bands, so this fixture is actually exercising
  // the boundaries rather than sitting in one of them.
  assert.ok(analysis.bands.filter((row) => row.triangleCount > 0).length >= 4);
});

// --- what is left out --------------------------------------------------------------------------

test('degenerate.stl: the zero-area triangle is in no band and no count', () => {
  const analysis = analyseOverhangs(DEGENERATE, M);
  const counted = analysis.bands.reduce((sum, row) => sum + row.triangleCount, 0);
  assert.equal(DEGENERATE.length / 9, 2);
  assert.equal(counted, 1); // the honest triangle only
  assert.equal(bandOf(analysis, 'none').triangleCount, 1);
  assert.equal(analysis.totalSupportAreaMm2, 0);
  assertNoBlanks(analysis, 'degenerate');
});

test('a face with an infinite coordinate is left out rather than filed under `ceiling`', () => {
  // FINDINGS.md, 2026-08-28: core/mesh.js's normal guard catches a NaN cross product but not an
  // Infinity one, so the normal here is NaN. Every band comparison against NaN is false, and a
  // chain of ifs would fall through to the last branch — putting a face that does not exist
  // into the number that decides supports.
  const broken = concatMeshes(faceAt(90), [0, 0, 0, 1, 0, 0, 0, Infinity, 0]);
  const analysis = analyseOverhangs(broken, M);
  const counted = analysis.bands.reduce((sum, row) => sum + row.triangleCount, 0);
  assert.equal(counted, 1);
  assert.equal(bandOf(analysis, 'ceiling').triangleCount, 1);

  // Every band and every area stays a number: the broken face contributes to nothing.
  for (const row of analysis.bands) assert.ok(Number.isFinite(row.areaMm2), row.band);
  assert.ok(Number.isFinite(analysis.totalSupportAreaMm2));
  assert.ok(Number.isFinite(analysis.bedContactAreaMm2));
  assert.ok(Number.isFinite(analysis.maxOverhangAngleDeg));

  // The footprint is the one honest exception, and it is T03's rule rather than this module's:
  // a mesh with an infinite coordinate has an infinite bounding box, and DESIGN.md §2.10 says
  // such a mesh is reported rather than repaired. Inventing a finite footprint here would hide
  // the very thing T04 reports as BAD_COORDINATE.
  assert.equal(analysis.footprintMm2, Infinity);
  assert.equal(analysis.bedContactFraction, 0);
});

test('an empty mesh measures zero everywhere and never NaN', () => {
  const analysis = analyseOverhangs(EMPTY, M);
  assert.equal(analysis.totalSupportAreaMm2, 0);
  assert.equal(analysis.maxOverhangAngleDeg, 0);
  assert.equal(analysis.bedContactAreaMm2, 0);
  assert.equal(analysis.bedContactFraction, 0); // 0/0 is the trap here
  assert.equal(analysis.footprintMm2, 0);
  for (const row of analysis.bands) {
    assert.equal(row.areaMm2, 0);
    assert.equal(row.triangleCount, 0);
  }
  assertNoBlanks(analysis, 'empty');
});

// --- bad arguments ------------------------------------------------------------------------------

test('a bad mesh throws core/mesh.js own error, not a third dialect of it', () => {
  assert.throws(() => analyseOverhangs('not a mesh', M), TypeError);
  assert.throws(() => analyseOverhangs(new Float32Array(7), M), RangeError);
  assert.throws(() => rankOrientations(new Float32Array(7), M), RangeError);
});

test('a missing or malformed machine profile says so', () => {
  assert.throws(() => analyseOverhangs(CUBE, undefined), /machine must be a profile/);
  assert.throws(() => analyseOverhangs(CUBE, {}), /machine must be a profile/);
  assert.throws(() => rankOrientations(CUBE, {}), /machine must be a profile/);
});

// --- the orientation search ------------------------------------------------------------------------

test('rankOrientations returns exactly 24 rotations with 24 distinct names', () => {
  const ranked = rankOrientations(SHELF, M);
  assert.equal(ranked.length, 24);
  assert.equal(new Set(ranked.map((r) => r.rotation)).size, 24);
  assert.ok(ranked.some((r) => r.rotation === 'identity'));
});

test('the 24 are distinct as transforms, not merely as names', () => {
  // Distinct names are cheap and prove nothing: a turn about the vertical changes no face's
  // overhang angle and no bounding-box size, so if `z+90` and `z+270` ever became the same
  // transform, one real orientation would never be searched and every other test here would
  // still pass. The probe is chiral — three different lengths on three different axes — so
  // each of the 24 sends it somewhere its own.
  const probe = [1, 0, 0, 0, 2, 0, 0, 0, 3];
  const images = rankOrientations(SHELF, M).map((r) => [...applyRotation(probe, r.rotation)].join(','));
  assert.equal(new Set(images).size, 24);
});

test('applyRotation turns a mesh by name, and refuses a name it does not have', () => {
  const probe = [1, 0, 0, 0, 2, 0, 0, 0, 3];
  assertSameCoordinates(applyRotation(probe, 'identity'), probe, 'identity');
  // x+90 sends y to z and z to -y, by hand.
  assertSameCoordinates(applyRotation(probe, 'x+90'), [1, 0, 0, 0, 0, 2, 0, -3, 0], 'x+90');
  // z+180 negates x and y and leaves z alone.
  assertSameCoordinates(applyRotation(probe, 'z+180'), [-1, 0, 0, 0, -2, 0, 0, 0, 3], 'z+180');
  // Four quarter turns about the same axis come back to where they started.
  let turned = Float64Array.from(probe);
  for (let quarter = 0; quarter < 4; quarter++) turned = applyRotation(turned, 'z+90');
  assertSameCoordinates(turned, probe, 'four quarter turns');

  assert.throws(() => applyRotation(probe, 'x+45'), /unknown rotation/);
  assert.throws(() => applyRotation(probe, 'identity,z+90'), /unknown rotation/);
  assert.throws(() => applyRotation(new Float32Array(7), 'identity'), RangeError);
});

test('rankOrientations only ever permutes the size — it never scales or mirrors the part', () => {
  const original = [...boundingBox(SHELF).size].sort((a, b) => a - b);
  for (const result of rankOrientations(SHELF, M)) {
    const rotated = [...result.sizeMm].sort((a, b) => a - b);
    rotated.forEach((value, i) => {
      assert.ok(Math.abs(value - original[i]) < 1e-9, `${result.rotation} changed the size`);
    });
  }
});

test('each rotation does what its name says, and every one is a real rotation', () => {
  // The strongest check in this file: the 24 transforms are rebuilt here from their published
  // names, independently of core/overhangs.js, and the whole analysis is re-run on each. If a
  // name and its matrix ever drift apart the report would tell the user to rotate a part one
  // way and have measured it another, and nothing else here would notice.
  //
  // Reflections matter as much as names. A mirror also maps the axes onto each other, and
  // FINDINGS.md (2026-08-27) is blunt about the consequence: a mirrored part passes every
  // measurement there is and is only caught by looking at it. A preserved signed volume is the
  // arithmetic that rules one out.
  const steps = {
    'x+90': ([x, y, z]) => [x, -z, y],
    'x+180': ([x, y, z]) => [x, -y, -z],
    'x+270': ([x, y, z]) => [x, z, -y],
    'y+90': ([x, y, z]) => [z, y, -x],
    'y+270': ([x, y, z]) => [-z, y, x],
    'z+90': ([x, y, z]) => [-y, x, z],
    'z+180': ([x, y, z]) => [-x, -y, z],
    'z+270': ([x, y, z]) => [y, -x, z],
  };

  /** Applies the named turns left to right, exactly as the name reads. */
  const applyByName = (name, positions) => {
    const out = Float64Array.from(positions);
    if (name === 'identity') return out;
    for (const step of name.split(',')) {
      const turn = steps[step];
      assert.ok(turn, `unknown rotation step ${step} in ${name}`);
      for (let at = 0; at < out.length; at += 3) {
        const [x, y, z] = turn([out[at], out[at + 1], out[at + 2]]);
        out[at] = x;
        out[at + 1] = y;
        out[at + 2] = z;
      }
    }
    return out;
  };

  const volume = signedVolume(SHELF);
  assert.ok(volume > 0);

  for (const result of rankOrientations(SHELF, M)) {
    const rotated = applyByName(result.rotation, SHELF);
    const where = result.rotation;

    // Coordinate for coordinate against the module's own transform. A signed axis permutation
    // is exact, so this is an equality and not a tolerance.
    assertSameCoordinates(applyRotation(SHELF, where), rotated, where);

    // A rotation, not a reflection: the sign and the magnitude of the volume both survive.
    assert.ok(Math.abs(signedVolume(rotated) - volume) < 1e-6, `${where} changed the volume`);

    // And the numbers the ranking published are the numbers this mesh actually measures.
    const analysis = analyseOverhangs(rotated, M);
    assert.ok(
      Math.abs(analysis.totalSupportAreaMm2 - result.totalSupportAreaMm2) < 1e-6,
      `${where}: support area disagrees with its own name`,
    );
    assert.ok(
      Math.abs(analysis.bedContactAreaMm2 - result.bedContactAreaMm2) < 1e-6,
      `${where}: bed contact disagrees with its own name`,
    );
    boundingBox(rotated).size.forEach((value, axis) => {
      assert.ok(Math.abs(value - result.sizeMm[axis]) < 1e-9, `${where}: size disagrees on axis ${axis}`);
    });
  }
});

test('rankOrientations on shelf.stl puts a rotation that removes the ceiling ahead of identity', () => {
  const ranked = rankOrientations(SHELF, M);
  const best = ranked[0];
  const identity = ranked.find((r) => r.rotation === 'identity');

  assert.notEqual(best.rotation, 'identity');
  assert.equal(best.totalSupportAreaMm2, 0);
  assert.ok(Math.abs(identity.totalSupportAreaMm2 - 200) < 1e-3);
  assert.ok(best.totalSupportAreaMm2 < identity.totalSupportAreaMm2);

  // Laid on its back the whole L-shaped side is on the plate: 600 mm^2, twice what standing it
  // upside down would give, which is why the bed-contact tie-break is not decoration.
  assert.ok(Math.abs(best.bedContactAreaMm2 - 600) < 1e-3);
  assert.ok(ranked.every((r) => r.totalSupportAreaMm2 >= best.totalSupportAreaMm2));
});

test('the ranking is ordered: support ascending, then bed contact descending', () => {
  const ranked = rankOrientations(SHELF, M);
  for (let i = 1; i < ranked.length; i++) {
    const before = ranked[i - 1];
    const after = ranked[i];
    assert.ok(before.totalSupportAreaMm2 <= after.totalSupportAreaMm2, `${before.rotation} then ${after.rotation}`);
    if (before.totalSupportAreaMm2 === after.totalSupportAreaMm2) {
      assert.ok(before.bedContactAreaMm2 >= after.bedContactAreaMm2, `${before.rotation} then ${after.rotation}`);
    }
  }
});

test('rankOrientations on a cube returns identity first, because all 24 tie', () => {
  const ranked = rankOrientations(CUBE, M);
  assert.equal(ranked[0].rotation, 'identity');
  // The tie is exact, not approximate: a signed axis permutation is a copy with a sign flip and
  // introduces no arithmetic error, which is the only reason the tie-break can be relied on.
  for (const result of ranked) {
    assert.equal(result.totalSupportAreaMm2, ranked[0].totalSupportAreaMm2);
    assert.equal(result.bedContactAreaMm2, ranked[0].bedContactAreaMm2);
  }
});

test('rankOrientations survives an empty mesh', () => {
  const ranked = rankOrientations(EMPTY, M);
  assert.equal(ranked.length, 24);
  assert.equal(ranked[0].rotation, 'identity');
  for (const result of ranked) assertNoBlanks(result, result.rotation);
});

test('50,000 triangles through all 24 orientations stays inside the budget', () => {
  // DESIGN.md §5.2 caps an STL at 200 MB, which is four million triangles; the task's budget
  // for this search is ~3 s at fifty thousand. Deterministic input: a seeded generator, so a
  // slow run is a slow machine or a slow algorithm and never a different mesh.
  const count = 50_000;
  const positions = new Float32Array(count * 9);
  let seed = 20260828;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 100 - 50;
  };
  for (let i = 0; i < positions.length; i++) positions[i] = next();

  const started = process.hrtime.bigint();
  const ranked = rankOrientations(positions, M);
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;

  assert.equal(ranked.length, 24);
  assert.ok(seconds < 3, `rankOrientations took ${seconds.toFixed(2)} s for ${count} triangles`);
});
