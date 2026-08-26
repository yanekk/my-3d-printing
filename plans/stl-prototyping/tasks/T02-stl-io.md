# T02 — STL reading and writing

**Phase:** 1 · **Depends on:** T01 · **Weight:** medium

## Goal

Turn bytes into triangles and back. Dull, exacting, and everything else in the project sits on
top of it — a bug here shows up as a wrong volume in T03, a false "not watertight" in T04, and
an inexplicable report in T07. It is worth over-testing.

The one genuinely surprising thing about STL is that **you cannot tell ASCII from binary by
looking at the first five bytes.** Many binary writers put a model name into the 80-byte
header, so binary files routinely begin with `solid`. The reliable test is arithmetic: read
the little-endian `uint32` triangle count at offset 80 and check whether
`80 + 4 + 50 * count` equals the file length.

## Design sections this implements

`DESIGN.md` §2.10 (the ASCII/binary row), §3.2 (`core/stl.js`).

## Files

```
core/stl.js             NEW
test/stl.test.js        NEW
test/fixtures/          NEW — small hand-built STLs, committed
  cube-binary.stl         a 2 mm unit cube, 12 triangles, binary
  cube-ascii.stl          the same cube, ASCII
  binary-says-solid.stl   binary, whose 80-byte header begins with the text 'solid'
  open-box.stl            a cube with one face removed — 10 triangles
  degenerate.stl          contains one zero-area triangle
  empty.stl               valid binary header, triangle count 0
  truncated.stl           header claims 12 triangles, file holds 7
```

Fixtures are generated once by a small script kept in `test/fixtures/make-fixtures.mjs` and the
**output is committed**. Generating them at test time would mean the tests validate the
generator rather than the parser.

## Interface

```js
// core/stl.js — pure. Input is bytes; output is plain data.

/**
 * @typedef {{
 *   positions: Float32Array,   // length 9*n — v0x,v0y,v0z, v1x,..., v2z per triangle
 *   fileNormals: Float32Array, // length 3*n — as stored in the file, NOT trusted
 *   triangleCount: number,
 *   format: 'binary' | 'ascii',
 *   headerText: string         // binary only; '' for ascii
 * }} Mesh
 */

/** @param {Uint8Array} bytes @returns {Mesh} @throws {StlParseError} */
export function parseStl(bytes)

/** @returns {'binary'|'ascii'} — by the 80+4+50n length arithmetic, never by prefix. */
export function detectFormat(bytes)

/** @param {{positions: Float32Array, normals?: Float32Array, header?: string}} @returns {Uint8Array} */
export function writeBinaryStl({ positions, normals, header })
// Normals are written as zeros when not supplied. This is legal and every consumer
// recomputes them anyway; writing a wrong normal is worse than writing none.

export class StlParseError extends Error {}  // .code: 'TRUNCATED'|'BAD_ASCII'|'NOT_STL'
```

`fileNormals` is parsed and kept but **never used for geometry** — STL normals are wrong in
the wild often enough that trusting them is a known trap. T03 recomputes them from vertex
winding. Keeping them lets T04 detect a file whose stored normals disagree with its winding,
which is a genuine diagnostic signal.

Everything is `Float32Array` because STL stores float32 and promoting to float64 would invent
precision the file does not have. Where the arithmetic in T03 needs float64 accumulation, it
promotes locally.

## Tests

- [ ] `cube-binary.stl` parses: 12 triangles, format `binary`
- [ ] `cube-ascii.stl` parses to **bit-identical** `positions` as the binary cube
- [ ] `binary-says-solid.stl` is detected as `binary` — the headline case
- [ ] An ASCII file whose text genuinely starts with `solid ` is detected as `ascii`
- [ ] `empty.stl` parses to `triangleCount: 0` and a zero-length `positions`, without throwing
- [ ] `truncated.stl` throws `StlParseError` with code `TRUNCATED`
- [ ] A 3-byte buffer throws `NOT_STL`
- [ ] A zero-byte buffer throws `NOT_STL`
- [ ] Malformed ASCII (a `facet` with two vertices) throws `BAD_ASCII`
- [ ] ASCII parsing accepts CRLF line endings and both `1e-3` and `1E-3` exponent forms
- [ ] ASCII parsing accepts leading whitespace and blank lines between facets
- [ ] `writeBinaryStl` then `parseStl` round-trips positions exactly
- [ ] `writeBinaryStl` output length is exactly `84 + 50 * n`
- [ ] `writeBinaryStl` writes the per-triangle 2-byte attribute count as zero
- [ ] A file with a **negative or absurd** triangle count at offset 80 throws rather than allocating

## Done when

- [ ] All fixtures parse to the values asserted, and `binary-says-solid.stl` is read as binary
- [ ] Round-tripping any fixture through `writeBinaryStl` and back preserves positions exactly
- [ ] `npm test` passes and the boundary test still passes (`core/stl.js` imports nothing)
