// core/stl.js — the parser and the writer everything else in the project sits on. A bug here
// surfaces as a wrong volume in T03, a false "not watertight" in T04 and an inexplicable
// report in T07, so this file over-tests on purpose.
//
// The fixtures under test/fixtures/ are committed bytes, written by tools/make-fixtures.mjs,
// which shares no code with core/stl.js. Reading them from disk rather than generating them
// here is what makes these tests check the parser against the format instead of against a
// writer that could be wrong in the same direction.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseStl, detectFormat, writeBinaryStl, StlParseError } from '../core/stl.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** @param {string} name @returns {Uint8Array} */
const fixture = (name) => new Uint8Array(readFileSync(`${FIXTURES}${name}`));

/** @param {string} text @returns {Uint8Array} */
const asBytes = (text) => new TextEncoder().encode(text);

/**
 * Assert that `fn` throws an StlParseError carrying `code`. Checking the class as well as the
 * code matters: a TypeError with a .code property would otherwise slip through.
 *
 * @param {() => unknown} fn
 * @param {'TRUNCATED' | 'BAD_ASCII' | 'NOT_STL'} code
 */
function assertParseError(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof StlParseError, `expected StlParseError, got ${err?.name}: ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code} — ${err.message}`);
    return true;
  });
}

// The 2 mm cube's first triangle, from tools/make-fixtures.mjs: the bottom face, wound so the
// right-hand rule points at -Z.
const FIRST_TRIANGLE = [0, 0, 0, 2, 2, 0, 2, 0, 0];

// --- the fixtures -----------------------------------------------------------------------

test('cube-binary.stl parses: 12 triangles, format binary', () => {
  const mesh = parseStl(fixture('cube-binary.stl'));
  assert.equal(mesh.triangleCount, 12);
  assert.equal(mesh.format, 'binary');
  assert.equal(mesh.positions.length, 12 * 9);
  assert.equal(mesh.fileNormals.length, 12 * 3);
  assert.equal(mesh.headerText, 'cube 2mm binary fixture');
  assert.deepEqual([...mesh.positions.slice(0, 9)], FIRST_TRIANGLE);
  assert.deepEqual([...mesh.fileNormals.slice(0, 3)], [0, 0, -1]);
  // A 2 mm cube at the origin: every coordinate is 0 or 2, and both appear.
  assert.deepEqual([...new Set(mesh.positions)].sort(), [0, 2]);
});

test('cube-ascii.stl parses to bit-identical positions as the binary cube', () => {
  const ascii = parseStl(fixture('cube-ascii.stl'));
  const binary = parseStl(fixture('cube-binary.stl'));
  assert.equal(ascii.format, 'ascii');
  assert.equal(ascii.triangleCount, 12);
  // Compared as raw bytes, not as numbers: two Float32Arrays that print the same can still
  // differ in the last bit, and a rounding bug in the ASCII reader looks like exactly that.
  assert.deepEqual(new Uint8Array(ascii.positions.buffer), new Uint8Array(binary.positions.buffer));
  assert.deepEqual(
    new Uint8Array(ascii.fileNormals.buffer),
    new Uint8Array(binary.fileNormals.buffer),
  );
  // ASCII has no 80-byte header, so there is nothing honest to put here.
  assert.equal(ascii.headerText, '');
});

test('binary-says-solid.stl is detected as binary — the headline case', () => {
  const bytes = fixture('binary-says-solid.stl');
  // The trap, spelled out: the file really does begin with the five bytes 'solid'.
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), 'solid');
  assert.equal(detectFormat(bytes), 'binary');
  const mesh = parseStl(bytes);
  assert.equal(mesh.format, 'binary');
  assert.equal(mesh.triangleCount, 12);
  assert.deepEqual(
    new Uint8Array(mesh.positions.buffer),
    new Uint8Array(parseStl(fixture('cube-binary.stl')).positions.buffer),
  );
});

test('an ASCII file whose text genuinely starts with solid is detected as ascii', () => {
  const bytes = fixture('cube-ascii.stl');
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 6)), 'solid ');
  assert.equal(detectFormat(bytes), 'ascii');
});

test('empty.stl parses to zero triangles without throwing', () => {
  const mesh = parseStl(fixture('empty.stl'));
  assert.equal(mesh.triangleCount, 0);
  assert.equal(mesh.positions.length, 0);
  assert.equal(mesh.fileNormals.length, 0);
  assert.equal(mesh.format, 'binary');
});

test('open-box.stl parses to 10 triangles', () => {
  const mesh = parseStl(fixture('open-box.stl'));
  assert.equal(mesh.triangleCount, 10);
  // The top face is the one missing, so nothing reaches z = 2 except the four side walls.
  const zs = [...mesh.positions].filter((_, i) => i % 3 === 2);
  assert.ok(zs.includes(2), 'the side walls still reach the top');
});

test('degenerate.stl parses, zero-area triangle and all', () => {
  const mesh = parseStl(fixture('degenerate.stl'));
  assert.equal(mesh.triangleCount, 2);
  // Parsing must not judge the geometry: the second triangle's three vertices are collinear,
  // which is T04's problem to report, not this module's to refuse.
  assert.deepEqual([...mesh.positions.slice(9, 18)], [0, 0, 0, 1, 0, 0, 2, 0, 0]);
});

test('truncated.stl throws TRUNCATED, naming both numbers', () => {
  const bytes = fixture('truncated.stl');
  // It must not be mistaken for text on the way to the error, or the complaint would be
  // about ASCII syntax in a file that has none.
  assert.equal(detectFormat(bytes), 'binary');
  assert.throws(
    () => parseStl(bytes),
    (err) => {
      assert.equal(err.code, 'TRUNCATED');
      assert.match(err.message, /12 triangles/);
      assert.match(err.message, /684 bytes/);
      assert.match(err.message, /434 bytes/);
      return true;
    },
  );
});

test('every fixture round-trips through writeBinaryStl with its positions intact', () => {
  for (const name of [
    'cube-binary.stl',
    'cube-ascii.stl',
    'binary-says-solid.stl',
    'open-box.stl',
    'degenerate.stl',
    'empty.stl',
  ]) {
    const original = parseStl(fixture(name));
    const rewritten = parseStl(
      writeBinaryStl({ positions: original.positions, normals: original.fileNormals }),
    );
    assert.equal(rewritten.triangleCount, original.triangleCount, name);
    assert.deepEqual(
      new Uint8Array(rewritten.positions.buffer),
      new Uint8Array(original.positions.buffer),
      `positions changed round-tripping ${name}`,
    );
    assert.deepEqual(
      new Uint8Array(rewritten.fileNormals.buffer),
      new Uint8Array(original.fileNormals.buffer),
      `normals changed round-tripping ${name}`,
    );
  }
});

// --- what is not an STL at all ------------------------------------------------------------

test('a 3-byte buffer throws NOT_STL', () => {
  assertParseError(() => parseStl(asBytes('abc')), 'NOT_STL');
});

test('a zero-byte buffer throws NOT_STL', () => {
  assertParseError(() => parseStl(new Uint8Array(0)), 'NOT_STL');
});

test("a file beginning 'solidarity' is not read as an ASCII STL", () => {
  // 'solid' has to be a whole word. Matching it as a prefix would send a binary file whose
  // header happens to start that way into the ASCII parser.
  assertParseError(() => parseStl(asBytes('solidarity is not a mesh\n')), 'NOT_STL');
});

test('a non-Uint8Array argument is a caller bug, not a bad file', () => {
  for (const wrong of ['solid x', null, undefined, 42, {}, new Float32Array(9)]) {
    assert.throws(() => parseStl(wrong), TypeError);
    assert.throws(() => detectFormat(wrong), TypeError);
  }
});

test('a negative or absurd triangle count throws rather than allocating', () => {
  for (const count of [0xffffffff, 0x7fffffff, 0x80000000]) {
    const bytes = new Uint8Array(84);
    new DataView(bytes.buffer).setUint32(80, count, true);
    // If this ever hangs or dies on memory rather than throwing, the count is being trusted
    // before it is checked. 0xffffffff triangles is 154 GB of Float32Array.
    assertParseError(() => parseStl(bytes), 'TRUNCATED');
  }
});

test('a binary file with trailing rubbish after its last triangle is refused', () => {
  const good = fixture('cube-binary.stl');
  const padded = new Uint8Array(good.length + 5);
  padded.set(good, 0);
  assertParseError(() => parseStl(padded), 'TRUNCATED');
});

// --- ASCII shapes that turn up in the wild -------------------------------------------------

/** @param {{normal?: string, vertices?: string[], name?: string}} [spec] @returns {string} */
function asciiFacet({ normal = '0 0 1', vertices = ['0 0 0', '1 0 0', '0 1 0'] } = {}) {
  return [
    `  facet normal ${normal}`,
    '    outer loop',
    ...vertices.map((v) => `      vertex ${v}`),
    '    endloop',
    '  endfacet',
  ].join('\n');
}

/** @param {string} body @returns {string} */
const asciiSolid = (body) => `solid probe\n${body}\nendsolid probe\n`;

test('malformed ASCII — a facet with two vertices — throws BAD_ASCII', () => {
  const text = asciiSolid(asciiFacet({ vertices: ['0 0 0', '1 0 0'] }));
  assertParseError(() => parseStl(asBytes(text)), 'BAD_ASCII');
});

test('a facet with four vertices throws BAD_ASCII', () => {
  const text = asciiSolid(asciiFacet({ vertices: ['0 0 0', '1 0 0', '0 1 0', '1 1 0'] }));
  assertParseError(() => parseStl(asBytes(text)), 'BAD_ASCII');
});

test('a vertex with a non-number throws BAD_ASCII naming the line', () => {
  for (const bad of ['0 0 wide', '0 0 Infinity', '0 0 NaN', '0 0 0x10', '0 0']) {
    const text = asciiSolid(asciiFacet({ vertices: ['0 0 0', '1 0 0', bad] }));
    assertParseError(() => parseStl(asBytes(text)), 'BAD_ASCII');
  }
});

test('a file that ends without endsolid throws BAD_ASCII', () => {
  assertParseError(() => parseStl(asBytes(`solid probe\n${asciiFacet()}\n`)), 'BAD_ASCII');
});

test('content after endsolid is refused rather than half-read', () => {
  const text = `${asciiSolid(asciiFacet())}solid second\n${asciiFacet()}\nendsolid second\n`;
  assertParseError(() => parseStl(asBytes(text)), 'BAD_ASCII');
});

test('ASCII parsing accepts CRLF line endings and both 1e-3 and 1E-3', () => {
  const text = asciiSolid(
    asciiFacet({ normal: '0 0 1', vertices: ['1e-3 0 0', '1E-3 1 0', '-2.5E+2 .5 +7.'] }),
  ).replace(/\n/g, '\r\n');
  const mesh = parseStl(asBytes(text));
  assert.equal(mesh.format, 'ascii');
  assert.equal(mesh.triangleCount, 1);
  assert.deepEqual(
    [...mesh.positions],
    [0.001, 0, 0, 0.001, 1, 0, -250, 0.5, 7].map((v) => Math.fround(v)),
  );
});

test('ASCII parsing accepts leading whitespace and blank lines between facets', () => {
  const text = [
    '',
    '   ',
    '\tsolid probe',
    '',
    asciiFacet(),
    '',
    '\t\t',
    asciiFacet({ normal: '0 0 -1' }),
    '',
    '   endsolid probe',
    '',
  ].join('\n');
  const mesh = parseStl(asBytes(text));
  assert.equal(mesh.format, 'ascii');
  assert.equal(mesh.triangleCount, 2);
  assert.deepEqual([...mesh.fileNormals], [0, 0, 1, 0, 0, -1]);
});

test('ASCII keywords are accepted in any case, and a solid name may have spaces', () => {
  const text = ['SOLID my little cube', asciiFacet().toUpperCase(), 'EndSolid my little cube'].join(
    '\n',
  );
  const mesh = parseStl(asBytes(text));
  assert.equal(mesh.triangleCount, 1);
  assert.deepEqual([...mesh.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('an ASCII solid with no facets is a legal empty mesh', () => {
  const mesh = parseStl(asBytes('solid nothing\nendsolid nothing\n'));
  assert.equal(mesh.format, 'ascii');
  assert.equal(mesh.triangleCount, 0);
  assert.equal(mesh.positions.length, 0);
});

// --- the writer ----------------------------------------------------------------------------

test('writeBinaryStl output length is exactly 84 + 50n', () => {
  for (const count of [0, 1, 12, 97]) {
    const bytes = writeBinaryStl({ positions: new Float32Array(count * 9) });
    assert.equal(bytes.length, 84 + 50 * count, `${count} triangles`);
    // And therefore detectFormat's arithmetic agrees with it.
    assert.equal(detectFormat(bytes), 'binary');
  }
});

test('writeBinaryStl writes the per-triangle attribute count as zero', () => {
  const positions = parseStl(fixture('cube-binary.stl')).positions;
  const bytes = writeBinaryStl({ positions });
  const view = new DataView(bytes.buffer);
  for (let tri = 0; tri < 12; tri++) {
    assert.equal(view.getUint16(84 + 50 * tri + 48, true), 0, `triangle ${tri}`);
  }
});

test('writeBinaryStl writes zero normals when none are supplied', () => {
  const mesh = parseStl(writeBinaryStl({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }));
  assert.deepEqual([...mesh.fileNormals], [0, 0, 0]);
  assert.deepEqual([...mesh.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('writeBinaryStl round-trips a header, and cuts an over-long one at a character', () => {
  const written = parseStl(writeBinaryStl({ positions: [], header: 'stl-prototyping' }));
  assert.equal(written.headerText, 'stl-prototyping');
  // Em dashes are three bytes each, so 26 fit in 80 and the 27th must not be left half
  // written — a stray continuation byte would decode as U+FFFD.
  const long = parseStl(writeBinaryStl({ positions: [], header: '—'.repeat(40) }));
  assert.equal(long.headerText, '—'.repeat(26));
  assert.ok(!long.headerText.includes('�'));
  assert.equal(parseStl(writeBinaryStl({ positions: [] })).headerText, '');
});

test('writeBinaryStl refuses input it would otherwise turn into silent garbage', () => {
  assert.throws(() => writeBinaryStl({ positions: new Float32Array(10) }), RangeError);
  assert.throws(() => writeBinaryStl({ positions: [0, 0, 0, 1, 0, 0, 0, 1, NaN] }), RangeError);
  assert.throws(
    () => writeBinaryStl({ positions: [0, 0, 0, 1, 0, 0, 0, 1, Infinity] }),
    RangeError,
  );
  // Nine positions is one triangle, which needs three normals, not six.
  assert.throws(
    () => writeBinaryStl({ positions: new Float32Array(9), normals: new Float32Array(6) }),
    RangeError,
  );
  assert.throws(() => writeBinaryStl({ positions: 'solid' }), TypeError);
  assert.throws(() => writeBinaryStl({ positions: [], header: 7 }), TypeError);
  assert.throws(() => writeBinaryStl(), TypeError);
});

test('a mesh written from a plain array reads back through the binary parser', () => {
  const positions = [0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 5];
  const normals = [0, 0, 1, -1, 0, 0];
  const mesh = parseStl(writeBinaryStl({ positions, normals, header: 'two triangles' }));
  assert.equal(mesh.triangleCount, 2);
  assert.deepEqual([...mesh.positions], positions);
  assert.deepEqual([...mesh.fileNormals], normals);
  assert.equal(mesh.headerText, 'two triangles');
});

// --- the awkward corners -------------------------------------------------------------------

test('bytes at a non-zero offset in a larger buffer parse correctly', () => {
  // Node hands out pooled Buffers whose byteOffset is not zero, so a DataView built on
  // `bytes.buffer` alone reads somebody else's data. This is the test that catches it.
  const file = fixture('cube-binary.stl');
  const backing = new Uint8Array(file.length + 7);
  backing.set(file, 3);
  const offsetView = backing.subarray(3, 3 + file.length);
  assert.notEqual(offsetView.byteOffset, 0);
  const mesh = parseStl(offsetView);
  assert.equal(mesh.triangleCount, 12);
  assert.equal(mesh.headerText, 'cube 2mm binary fixture');
  assert.deepEqual([...mesh.positions.slice(0, 9)], FIRST_TRIANGLE);
});

test('a Node Buffer is accepted as file bytes', () => {
  const mesh = parseStl(readFileSync(`${FIXTURES}cube-binary.stl`));
  assert.equal(mesh.triangleCount, 12);
});

test('a header padded with NULs and spaces reads back without them', () => {
  const bytes = writeBinaryStl({ positions: [], header: 'name   ' });
  assert.equal(parseStl(bytes).headerText, 'name');
  // Everything after the text really is zero padding, not leftover memory.
  assert.deepEqual([...bytes.subarray(7, 80)], new Array(73).fill(0));
});
