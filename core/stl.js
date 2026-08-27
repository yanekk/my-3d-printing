// STL in and out. Pure: bytes in, plain data out, no filesystem and no allocation the caller
// did not pay for.
//
// The one genuinely surprising thing about the format: you cannot tell an ASCII STL from a
// binary one by looking at the start of the file. Binary writers put a model name into the
// 80-byte header, so binary files routinely begin with the text 'solid' — OpenSCAD's own
// begin 'OpenSCAD Model'. The reliable test is arithmetic: a binary STL is exactly
// 80 + 4 + 50 * triangleCount bytes long, and nothing else is. DESIGN.md §2.10.

const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
// 12 float32 — one normal and three vertices — plus a 2-byte attribute count nobody uses.
const TRIANGLE_BYTES = 50;
const BINARY_PREFIX = HEADER_BYTES + COUNT_BYTES;

// How far into a file to look before deciding it is text. Four kilobytes covers the header
// and the first eighty-odd triangles of a binary file, which is far more than enough to meet
// a byte no text file would contain.
const ASCII_SNIFF_BYTES = 4096;

const SOLID = [0x73, 0x6f, 0x6c, 0x69, 0x64]; // 'solid', lowercase

// Deliberately narrower than Number(): 'Infinity', 'NaN', '0x10' and '' all parse happily
// through Number and none of them belongs in a vertex.
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * @typedef {{
 *   positions: Float32Array,
 *   fileNormals: Float32Array,
 *   triangleCount: number,
 *   format: 'binary' | 'ascii',
 *   headerText: string
 * }} Mesh
 */

export class StlParseError extends Error {
  /**
   * @param {string} message
   * @param {'TRUNCATED' | 'BAD_ASCII' | 'NOT_STL'} code
   */
  constructor(message, code) {
    super(message);
    this.name = 'StlParseError';
    this.code = code;
  }
}

/**
 * Byte arrays only. Checked by element size rather than `instanceof Uint8Array` so that a
 * Buffer, a Uint8ClampedArray or a Uint8Array from another realm all pass.
 *
 * A wrong type here is a caller's bug, not a bad file, so it throws TypeError rather than
 * StlParseError — a report that says "not an STL" about a string would send whoever reads it
 * looking at the wrong thing.
 *
 * @param {unknown} bytes
 * @returns {Uint8Array}
 */
function requireBytes(bytes) {
  if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1) {
    throw new TypeError('Expected the file contents as a Uint8Array of bytes.');
  }
  return /** @type {Uint8Array} */ (bytes);
}

/** @param {Uint8Array} bytes @returns {DataView} */
function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** @param {number} byte @returns {boolean} */
function isSpaceByte(byte) {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

/**
 * True when the file length is exactly what its own declared triangle count requires.
 *
 * The comparison happens in float64, where 50 x 4294967295 is an ordinary number, so an
 * absurd or sign-flipped count fails the test instead of wrapping round into a plausible one.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function binaryLengthMatches(bytes) {
  if (bytes.length < BINARY_PREFIX) return false;
  const count = viewOf(bytes).getUint32(HEADER_BYTES, true);
  return BINARY_PREFIX + TRIANGLE_BYTES * count === bytes.length;
}

/**
 * The word 'solid' as the first thing in the file, ignoring leading whitespace, and followed
 * by a space or the end of the file — so that a binary header beginning 'solidarity' is not
 * mistaken for the keyword.
 *
 * This is never used on its own to choose a format. It only breaks the tie once the length
 * arithmetic has already said the file is not a well-formed binary.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function startsWithSolid(bytes) {
  let at = 0;
  while (at < bytes.length && isSpaceByte(bytes[at])) at++;
  for (let k = 0; k < SOLID.length; k++) {
    // 0x20 lowercases an ASCII letter, so 'SOLID' and 'Solid' match too.
    if (at + k >= bytes.length || (bytes[at + k] | 0x20) !== SOLID[k]) return false;
  }
  const after = at + SOLID.length;
  return after === bytes.length || isSpaceByte(bytes[after]);
}

/**
 * Whether the file is plausibly text at all, which is the tie-break the format detection
 * rests on once the length arithmetic has said the file is not a well-formed binary.
 *
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeText(bytes) {
  if (bytes.length === 0) return false;
  const limit = Math.min(bytes.length, ASCII_SNIFF_BYTES);
  for (let at = 0; at < limit; at++) {
    const byte = bytes[at];
    // Tab, newline, vertical tab, form feed and carriage return are the only control bytes a
    // text file has any business holding. Binary float data is full of the others — a run of
    // zeros appears in the very first vertex of any model touching the origin. Bytes above
    // 0x7e are allowed through, so a solid named in UTF-8 still reads as text.
    if ((byte < 0x20 && !(byte >= 0x09 && byte <= 0x0d)) || byte === 0x7f) return false;
  }
  return true;
}

/**
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
function looksLikeAsciiStl(bytes) {
  return looksLikeText(bytes) && startsWithSolid(bytes);
}

/**
 * Which of the two encodings this file uses.
 *
 * By the length arithmetic first and always, never by the leading bytes. A file that is
 * neither a well-formed binary nor plausible text is reported as binary, so that parseStl
 * fails with the specific complaint — a truncated binary read as ASCII produces "this is not
 * text", which is true and tells nobody anything.
 *
 * @param {Uint8Array} bytes
 * @returns {'binary' | 'ascii'}
 */
export function detectFormat(bytes) {
  requireBytes(bytes);
  if (binaryLengthMatches(bytes)) return 'binary';
  if (looksLikeAsciiStl(bytes)) return 'ascii';
  return 'binary';
}

/**
 * @param {Uint8Array} bytes
 * @returns {Mesh}
 * @throws {StlParseError}
 */
export function parseStl(bytes) {
  requireBytes(bytes);
  return detectFormat(bytes) === 'ascii' ? parseAscii(bytes) : parseBinary(bytes);
}

/**
 * The 80-byte header as text, cut at the first NUL — which is padding, not content — and with
 * trailing spaces removed. Decoded as UTF-8 because writers do put non-ASCII in there.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function headerTextOf(bytes) {
  let end = 0;
  while (end < HEADER_BYTES && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(0, end)).trimEnd();
}

/**
 * @param {Uint8Array} bytes
 * @returns {Mesh}
 */
function parseBinary(bytes) {
  // Text that is not an ASCII STL is not a damaged binary one, and must not be reported as
  // though the bytes were a mesh. A recipe, an error page or a log handed to the wrong
  // command lands here, and reading its 81st to 84th bytes as a triangle count produces
  // "the header declares 744845417 triangles" — true of the bytes, and no help at all.
  if (looksLikeText(bytes) && !startsWithSolid(bytes)) {
    throw new StlParseError(
      `Not an STL file: the contents are text, but they do not begin with 'solid', so this is ` +
        'neither an ASCII STL nor a binary one.',
      'NOT_STL',
    );
  }
  if (bytes.length < BINARY_PREFIX) {
    throw new StlParseError(
      `Not an STL file: ${bytes.length} bytes is shorter than the ${BINARY_PREFIX}-byte header ` +
        'and 4-byte triangle count that even an empty binary STL carries.',
      'NOT_STL',
    );
  }
  const view = viewOf(bytes);
  const count = view.getUint32(HEADER_BYTES, true);
  const needed = BINARY_PREFIX + TRIANGLE_BYTES * count;
  if (needed !== bytes.length) {
    // Checked before anything is sized from `count`. A corrupt or hostile file can declare
    // 4294967295 triangles, which is 154 GB of Float32Array if the number is believed first
    // and questioned afterwards.
    throw new StlParseError(
      `Truncated or corrupt binary STL: the header declares ${count} triangle` +
        `${count === 1 ? '' : 's'}, which needs ${needed} bytes, but the file is ` +
        `${bytes.length} bytes.`,
      'TRUNCATED',
    );
  }

  const positions = new Float32Array(count * 9);
  const fileNormals = new Float32Array(count * 3);
  let at = BINARY_PREFIX;
  for (let tri = 0; tri < count; tri++) {
    for (let k = 0; k < 3; k++) {
      fileNormals[tri * 3 + k] = view.getFloat32(at + k * 4, true);
    }
    for (let k = 0; k < 9; k++) {
      positions[tri * 9 + k] = view.getFloat32(at + 12 + k * 4, true);
    }
    // The 2-byte attribute count at the end of each triangle is skipped. Some writers put a
    // colour there and it is not part of the geometry.
    at += TRIANGLE_BYTES;
  }

  return {
    positions,
    fileNormals,
    triangleCount: count,
    format: 'binary',
    headerText: headerTextOf(bytes),
  };
}

/**
 * ASCII STL is one keyword per line, which is what every writer emits and what this parser
 * requires. Lines are split on LF, CRLF or a bare CR, blank lines are ignored wherever they
 * appear, and leading indentation is free — real files are indented and Windows-written ones
 * carry CRLF.
 *
 * @param {Uint8Array} bytes
 * @returns {Mesh}
 */
function parseAscii(bytes) {
  const lines = new TextDecoder().decode(bytes).split(/\r\n|\n|\r/);
  let cursor = 0;

  /** @returns {{tokens: string[], line: number} | null} the next line with anything on it */
  const nextLine = () => {
    while (cursor < lines.length) {
      const tokens = lines[cursor++].trim().split(/\s+/).filter((token) => token.length > 0);
      if (tokens.length > 0) return { tokens, line: cursor };
    }
    return null;
  };

  /** @param {string} detail @param {number} line @returns {StlParseError} */
  const bad = (detail, line) =>
    new StlParseError(`Malformed ASCII STL at line ${line}: ${detail}.`, 'BAD_ASCII');

  /** @param {string} token @param {number} line @returns {number} */
  const number = (token, line) => {
    if (!NUMBER_PATTERN.test(token)) throw bad(`'${token}' is not a number`, line);
    return Number(token);
  };

  /** @param {...string} words a line that must read exactly these lowercase keywords */
  const expect = (...words) => {
    const record = nextLine();
    if (record === null) {
      throw bad(`the file ends where '${words.join(' ')}' was expected`, lines.length);
    }
    const matches =
      record.tokens.length === words.length &&
      record.tokens.every((token, k) => token.toLowerCase() === words[k]);
    if (!matches) {
      throw bad(`expected '${words.join(' ')}', found '${record.tokens.join(' ')}'`, record.line);
    }
  };

  const opening = nextLine();
  if (opening === null || opening.tokens[0].toLowerCase() !== 'solid') {
    throw new StlParseError("Not an STL file: it has no 'solid' line.", 'NOT_STL');
  }

  const positions = [];
  const normals = [];

  for (;;) {
    const record = nextLine();
    if (record === null) throw bad("the file ends without an 'endsolid' line", lines.length);

    const keyword = record.tokens[0].toLowerCase();
    if (keyword === 'endsolid') break;
    if (keyword !== 'facet') {
      throw bad(`expected 'facet' or 'endsolid', found '${record.tokens[0]}'`, record.line);
    }
    if (record.tokens.length !== 5 || record.tokens[1].toLowerCase() !== 'normal') {
      throw bad(
        `a facet line must read 'facet normal <x> <y> <z>', not '${record.tokens.join(' ')}'`,
        record.line,
      );
    }
    for (let k = 2; k < 5; k++) normals.push(number(record.tokens[k], record.line));

    expect('outer', 'loop');
    for (let corner = 0; corner < 3; corner++) {
      const vertex = nextLine();
      if (vertex === null) throw bad('the file ends in the middle of a facet', lines.length);
      if (vertex.tokens.length !== 4 || vertex.tokens[0].toLowerCase() !== 'vertex') {
        throw bad(
          `expected vertex ${corner + 1} of 3, found '${vertex.tokens.join(' ')}' — a facet has ` +
            'exactly three vertices',
          vertex.line,
        );
      }
      for (let k = 1; k < 4; k++) positions.push(number(vertex.tokens[k], vertex.line));
    }
    expect('endloop');
    expect('endfacet');
  }

  // Refused rather than half-read. A second solid in the same file is legal in the wild and
  // silently dropping it would report a mesh with missing geometry as if it were complete,
  // which is the worst outcome available here.
  const trailing = nextLine();
  if (trailing !== null) {
    throw bad(
      `content after 'endsolid': '${trailing.tokens.join(' ')}'. A file holding more than one ` +
        'solid is refused rather than read in part',
      trailing.line,
    );
  }

  return {
    positions: Float32Array.from(positions),
    fileNormals: Float32Array.from(normals),
    triangleCount: normals.length / 3,
    format: 'ascii',
    headerText: '',
  };
}

/**
 * Coordinates as a plain array-like, with every value checked.
 *
 * NaN and Infinity are rejected rather than written: setFloat32 accepts both without
 * complaint, and a mesh file carrying them fails much later, somewhere that cannot say where
 * they came from.
 *
 * @param {unknown} value
 * @param {string} what the parameter name, for the message
 * @returns {ArrayLike<number>}
 */
function coordinatesOf(value, what) {
  const arrayLike =
    value instanceof Float32Array || value instanceof Float64Array || Array.isArray(value);
  if (!arrayLike) {
    throw new TypeError(`${what} must be a Float32Array or an array of numbers.`);
  }
  for (let at = 0; at < value.length; at++) {
    // Math.fround, not Number.isFinite alone: an STL stores float32, and 1e40 is an ordinary
    // float64 that becomes Infinity the moment setFloat32 writes it. Checking only the value
    // handed in would let the writer produce exactly the file this check exists to prevent.
    if (!Number.isFinite(Math.fround(value[at]))) {
      throw new RangeError(
        `${what}[${at}] is ${value[at]}, which an STL cannot carry: a coordinate is stored as a ` +
          '32-bit float, and NaN, Infinity and anything beyond ±3.4e38 have no representation.',
      );
    }
  }
  return value;
}

/**
 * @param {{positions: Float32Array | number[], normals?: Float32Array | number[], header?: string}} spec
 * @returns {Uint8Array}
 */
export function writeBinaryStl({ positions, normals, header = '' } = {}) {
  const vertexCoordinates = coordinatesOf(positions, 'positions');
  if (vertexCoordinates.length % 9 !== 0) {
    throw new RangeError(
      `positions has ${vertexCoordinates.length} values, which is not a whole number of ` +
        'triangles; a triangle is 9 — three vertices of x, y, z.',
    );
  }
  const count = vertexCoordinates.length / 9;

  let normalCoordinates = null;
  if (normals !== undefined && normals !== null) {
    normalCoordinates = coordinatesOf(normals, 'normals');
    if (normalCoordinates.length !== count * 3) {
      throw new RangeError(
        `normals has ${normalCoordinates.length} values but ${count} triangles need ` +
          `${count * 3}.`,
      );
    }
  }

  if (typeof header !== 'string') throw new TypeError('header must be a string.');

  const bytes = new Uint8Array(BINARY_PREFIX + TRIANGLE_BYTES * count);
  const view = new DataView(bytes.buffer);
  // encodeInto writes only whole code points that fit, so an over-long header is cut at a
  // character boundary rather than leaving half of one in the file.
  new TextEncoder().encodeInto(header, bytes.subarray(0, HEADER_BYTES));
  view.setUint32(HEADER_BYTES, count, true);

  let at = BINARY_PREFIX;
  for (let tri = 0; tri < count; tri++) {
    for (let k = 0; k < 3; k++) {
      // Zero when the caller supplied none. That is legal, and every consumer recomputes
      // normals from the winding anyway: a wrong normal is worse than an absent one, because
      // something downstream will believe it.
      view.setFloat32(at + k * 4, normalCoordinates ? normalCoordinates[tri * 3 + k] : 0, true);
    }
    for (let k = 0; k < 9; k++) {
      view.setFloat32(at + 12 + k * 4, vertexCoordinates[tri * 9 + k], true);
    }
    // The attribute byte count stays zero. Writers that use it for colour are why some
    // viewers show a mesh in random colours, and nothing here has a colour to record.
    at += TRIANGLE_BYTES;
  }
  return bytes;
}
