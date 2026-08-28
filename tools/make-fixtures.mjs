// Generates the committed STL fixtures in test/fixtures/.
//
//   node tools/make-fixtures.mjs
//
// The output is committed and the tests read those bytes from disk. They are NOT regenerated
// at test time: fixtures built during the run would mean the suite checks core/stl.js against
// this script rather than against the format, and the two would agree on any shared
// misunderstanding.
//
// For the same reason this file deliberately does not import core/stl.js. It writes the bytes
// itself, from the specification, so the parser is tested against an independent writer.
//
// It lives in tools/ rather than test/fixtures/ (where tasks/T02-stl-io.md put it) because
// `node --test` executes every .js/.mjs/.cjs file under test/, so a generator kept there would
// rewrite the fixtures on every `npm test` — and silently repair a corrupted one.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../test/fixtures/', import.meta.url));

// --- the shapes -------------------------------------------------------------------------

// A 2 mm cube with one corner at the origin. Every face is two triangles, wound
// counter-clockwise seen from outside, so the right-hand rule gives the outward normal that
// is also stored in the file. T04 will lean on that winding being correct.
const S = 2;
const CORNERS = {
  o: [0, 0, 0], x: [S, 0, 0], xy: [S, S, 0], y: [0, S, 0],
  z: [0, 0, S], xz: [S, 0, S], xyz: [S, S, S], yz: [0, S, S],
};

/** @param {[string,string,string]} names @param {number[]} normal */
const face = (names, normal) => ({
  n: normal,
  v: names.flatMap((name) => CORNERS[name]),
});

const BOTTOM = [face(['o', 'xy', 'x'], [0, 0, -1]), face(['o', 'y', 'xy'], [0, 0, -1])];
const TOP = [face(['z', 'xz', 'xyz'], [0, 0, 1]), face(['z', 'xyz', 'yz'], [0, 0, 1])];
const FRONT = [face(['o', 'x', 'xz'], [0, -1, 0]), face(['o', 'xz', 'z'], [0, -1, 0])];
const BACK = [face(['y', 'yz', 'xyz'], [0, 1, 0]), face(['y', 'xyz', 'xy'], [0, 1, 0])];
const LEFT = [face(['o', 'z', 'yz'], [-1, 0, 0]), face(['o', 'yz', 'y'], [-1, 0, 0])];
const RIGHT = [face(['x', 'xy', 'xyz'], [1, 0, 0]), face(['x', 'xyz', 'xz'], [1, 0, 0])];

const CUBE = [...BOTTOM, ...TOP, ...FRONT, ...BACK, ...LEFT, ...RIGHT];

// The same cube with the top face left off: 10 triangles, four boundary edges around the
// opening. This is the fixture T04 needs to prove that "not watertight" is detected.
const OPEN_BOX = [...BOTTOM, ...FRONT, ...BACK, ...LEFT, ...RIGHT];

// One honest triangle and one whose three vertices are collinear, so its area is exactly
// zero. Collinear rather than repeated-vertex, because a repeated vertex is the easy case
// and every degenerate-detection bug this fixture exists to catch hides in the other one.
const DEGENERATE = [
  { n: [0, 0, 1], v: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
  { n: [0, 0, 0], v: [0, 0, 0, 1, 0, 0, 2, 0, 0] },
];

// A regular tetrahedron of edge 10, centred on the origin. It exists because a cube is a bad
// volume fixture: 8 mm^3 is what a 2 mm cube gives under the correct formula and under several
// wrong ones, and the cube's axis-aligned faces hide sign and cross-product mistakes entirely.
// This solid shares no such coincidence — volume 1000/(6*sqrt(2)) = 117.851..., surface area
// sqrt(3)*100 = 173.205... — and not one of its faces is axis-aligned.
//
// The four vertices are alternate corners of a cube, which is the construction that makes them
// exact ratios of one another; the edge of that arrangement is 2*sqrt(2), so scaling by
// 10/(2*sqrt(2)) gives edge 10. Windings are chosen so the right-hand rule points away from
// the centre, i.e. outward, and the stored normals are the exact +/-1/sqrt(3) triples.
const K = 10 / (2 * Math.SQRT2);
const T = {
  a: [K, K, K],
  b: [K, -K, -K],
  c: [-K, K, -K],
  d: [-K, -K, K],
};
const R3 = 1 / Math.sqrt(3);

/** @param {[string,string,string]} names @param {number[]} normal */
const tetFace = (names, normal) => ({ n: normal, v: names.flatMap((name) => T[name]) });

const TETRAHEDRON = [
  tetFace(['b', 'd', 'c'], [-R3, -R3, -R3]), // the face opposite a
  tetFace(['a', 'c', 'd'], [-R3, R3, R3]), //  opposite b
  tetFace(['a', 'd', 'b'], [R3, -R3, R3]), //  opposite c
  tetFace(['a', 'b', 'c'], [R3, R3, -R3]), //  opposite d
];

// The same cube with a single triangle wound backwards, its stored normal flipped with it —
// which is what a genuinely inside-out face looks like in a file. The mesh stays closed: every
// edge is still shared by exactly two triangles, and only the direction of travel disagrees, on
// the three edges of that one face. That is why T04 checks winding separately from
// watertightness; neither check finds this on its own.
const flip = (tri) => ({
  n: tri.n.map((component) => -component),
  v: [...tri.v.slice(6, 9), ...tri.v.slice(3, 6), ...tri.v.slice(0, 3)],
});

// Index 2 is the first triangle of the top face: CUBE is [...BOTTOM, ...TOP, ...].
const FLIPPED_FACE = CUBE.map((tri, index) => (index === 2 ? flip(tri) : tri));

// A cube whose two halves do not quite meet. The side walls are cut at z = 1 and the upper
// half is lifted by 5e-4 mm, leaving a hairline seam all the way round.
//
// 5e-4 sits deliberately between T04's two weld tolerances — five times the default 1e-4 and
// half the coarse 1e-3 — so the identical mesh is open at one and closed at the other. It is
// the fixture for the retry rule, and it is what a real CAD seam looks like: a slicer would
// print this without complaint and a strict edge count calls it broken.
const SEAM_GAP = 5e-4;

/** Two triangles for a quad, given in order around its face. @param {number[][]} corners */
const quad = (corners, normal) => [
  { n: normal, v: [...corners[0], ...corners[1], ...corners[2]] },
  { n: normal, v: [...corners[0], ...corners[2], ...corners[3]] },
];

/** The four side walls of the cube between two heights, wound outward. */
const walls = (low, high) => [
  quad([[0, 0, low], [S, 0, low], [S, 0, high], [0, 0, high]], [0, -1, 0]), // front, y = 0
  quad([[S, 0, low], [S, S, low], [S, S, high], [S, 0, high]], [1, 0, 0]), //  right, x = S
  quad([[S, S, low], [0, S, low], [0, S, high], [S, S, high]], [0, 1, 0]), //  back,  y = S
  quad([[0, S, low], [0, 0, low], [0, 0, high], [0, S, high]], [-1, 0, 0]), // left,  x = 0
].flat();

const NEAR_MISS = [...BOTTOM, ...walls(0, 1), ...walls(1 + SEAM_GAP, S), ...TOP];

// --- the writers ------------------------------------------------------------------------

const HEADER_BYTES = 80;
const TRIANGLE_BYTES = 50;

/**
 * @param {string} header up to 80 bytes; the rest is zero-padded
 * @param {{n: number[], v: number[]}[]} tris
 * @returns {Uint8Array}
 */
function binaryStl(header, tris) {
  const bytes = new Uint8Array(HEADER_BYTES + 4 + TRIANGLE_BYTES * tris.length);
  const view = new DataView(bytes.buffer);
  new TextEncoder().encodeInto(header, bytes.subarray(0, HEADER_BYTES));
  view.setUint32(HEADER_BYTES, tris.length, true);
  let at = HEADER_BYTES + 4;
  for (const tri of tris) {
    for (const value of [...tri.n, ...tri.v]) {
      view.setFloat32(at, value, true);
      at += 4;
    }
    view.setUint16(at, 0, true); // attribute byte count, unused
    at += 2;
  }
  return bytes;
}

/**
 * The shortest decimal spelling that reads back as the identical float32. Anything shorter
 * would make the ASCII cube parse to different bits than the binary one, and the test that
 * they are bit-identical is one of the few ways a rounding bug in the parser shows up at all.
 *
 * @param {number} value
 * @returns {string}
 */
function f32(value) {
  const exact = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = exact.toPrecision(digits);
    if (Object.is(Math.fround(Number(text)), exact)) return String(Number(text));
  }
  return String(exact);
}

/**
 * @param {string} name
 * @param {{n: number[], v: number[]}[]} tris
 * @returns {string}
 */
function asciiStl(name, tris) {
  const lines = [`solid ${name}`];
  for (const tri of tris) {
    lines.push(`  facet normal ${tri.n.map(f32).join(' ')}`);
    lines.push('    outer loop');
    for (let corner = 0; corner < 3; corner++) {
      lines.push(`      vertex ${tri.v.slice(corner * 3, corner * 3 + 3).map(f32).join(' ')}`);
    }
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${name}`);
  return `${lines.join('\n')}\n`;
}

// --- the fixtures -----------------------------------------------------------------------

/** @param {string} name @param {Uint8Array | string} contents */
function emit(name, contents) {
  const bytes = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
  writeFileSync(`${OUT}${name}`, bytes);
  console.log(`${name}  ${bytes.length} bytes`);
}

emit('cube-binary.stl', binaryStl('cube 2mm binary fixture', CUBE));
emit('cube-ascii.stl', asciiStl('cube', CUBE));

// The headline trap. A perfectly ordinary binary STL whose 80-byte header happens to begin
// with the text 'solid', which is what most binary writers produce. Sniffing the first five
// bytes calls this ASCII and then fails to parse a file that is not broken at all.
emit(
  'binary-says-solid.stl',
  binaryStl('solid cube — binary, despite how this header reads', CUBE),
);

emit('tetrahedron.stl', binaryStl('regular tetrahedron, edge 10mm', TETRAHEDRON));
emit('open-box.stl', binaryStl('open box: cube with no top', OPEN_BOX));
emit('degenerate.stl', binaryStl('one good triangle, one of zero area', DEGENERATE));
emit('empty.stl', binaryStl('empty: a valid header declaring no triangles', []));

// Declares 12 triangles and carries 7. The header deliberately does not begin with 'solid',
// so the file has no way to be mistaken for text and must be reported as a truncated binary
// rather than as unreadable ASCII.
emit(
  'truncated.stl',
  binaryStl('cut short: declares 12 triangles, holds 7', CUBE).slice(
    0,
    HEADER_BYTES + 4 + TRIANGLE_BYTES * 7,
  ),
);

emit('flipped-face.stl', binaryStl('closed cube, one face wound backwards', FLIPPED_FACE));
emit('near-miss.stl', binaryStl('cube with a 5e-4 mm seam between its halves', NEAR_MISS));
