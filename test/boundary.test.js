// The architecture test. DESIGN.md §3.1: core/ is pure — it takes buffers, numbers and plain
// objects and returns plain objects. Nothing in it may reach for the filesystem, the network,
// a child process, the clock or a random number.
//
// If this test fails, the fix is to move the offending code into shell/. Never relax the test.
//
// This file lives in test/ rather than core/ for two reasons: it needs the filesystem to read
// core/, and it necessarily contains the forbidden substrings it looks for, so it would
// convict itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CORE_DIR = fileURLToPath(new URL('../core', import.meta.url));

// Bare specifiers that are Node builtins. A 'node:'-prefixed specifier is caught on the
// prefix, so this list only has to cover the bare spellings that still resolve.
const BUILTIN_BARE = new Set([
  'fs', 'path', 'http', 'https', 'os', 'net', 'child_process', 'crypto',
  'worker_threads', 'url', 'stream', 'process', 'dns', 'tls', 'zlib', 'v8', 'vm',
  'perf_hooks', 'timers', 'readline', 'tty', 'dgram', 'cluster', 'inspector',
]);

// Impurity that no import expresses: ambient state read straight out of the runtime.
const FORBIDDEN_SUBSTRINGS = ['Date.now', 'new Date', 'Math.random', 'process.'];

// Every extension Node will execute as a module. `.js` alone is a hole: a file named
// `.mjs` or `.cjs` in core/ runs exactly the same and would never be read.
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs'];

// Module specifiers in every position that loads one: static import ... from '', bare side
// effect import '', dynamic import(''), and require('') — in any of the three quotes.
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|(?:^|[\s;])import\s+)['"`]([^'"`]+)['"`]/gm;

/**
 * @param {{path: string, text: string}[]} files
 * @returns {{path: string, rule: string, detail: string}[]}
 */
export function findViolations(files) {
  const violations = [];
  for (const file of files) {
    for (const match of file.text.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1];
      const head = specifier.split('/')[0];
      if (specifier.startsWith('node:')) {
        violations.push({ path: file.path, rule: 'builtin-import', detail: specifier });
      } else if (BUILTIN_BARE.has(head)) {
        violations.push({ path: file.path, rule: 'builtin-import', detail: specifier });
      }
    }
    for (const needle of FORBIDDEN_SUBSTRINGS) {
      if (file.text.includes(needle)) {
        violations.push({ path: file.path, rule: 'ambient-state', detail: needle });
      }
    }
  }
  return violations;
}

/**
 * Every source file under core/, read as text. Recursive, because a subdirectory of core/
 * is still core/ and a check that only looks one level deep is a check with a hole in it.
 *
 * `!isDirectory()` rather than `isFile()`: a symlink is neither, so `isFile()` would walk
 * straight past a symlinked module. Reading one follows it, which is what we want — and a
 * symlink pointing at a directory or at nothing throws here, loudly, rather than passing.
 *
 * @param {string} dir absolute path
 * @returns {{path: string, text: string}[]}
 */
export function readCoreFiles(dir = CORE_DIR) {
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch (err) {
    // A missing core/ reads as empty here; the vacuity guard below is what fails on it.
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter(
      (entry) =>
        !entry.isDirectory() && SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)),
    )
    .map((entry) => {
      const full = `${entry.parentPath ?? entry.path}/${entry.name}`;
      return { path: full, text: readFileSync(full, 'utf8') };
    });
}

test('core/ contains files — an empty glob must not pass vacuously', () => {
  const files = readCoreFiles();
  assert.ok(
    files.length > 0,
    'boundary test found no files under core/ — the check would pass by finding nothing',
  );
});

test('core/ is pure', () => {
  const violations = findViolations(readCoreFiles());
  assert.deepEqual(
    violations,
    [],
    `core/ must stay pure; move the offending code into shell/:\n` +
      violations.map((v) => `  ${v.path}: ${v.rule} (${v.detail})`).join('\n'),
  );
});

test('a core/ with no files in it fails the check rather than passing vacuously', () => {
  const empty = fileURLToPath(new URL('./__empty_core.tmp/', import.meta.url));
  try {
    mkdirSync(empty, { recursive: true });
    const files = readCoreFiles(empty);
    assert.deepEqual(files, []);
    // This is the assertion the first test makes, and on an empty core/ it must throw.
    assert.throws(() => assert.ok(files.length > 0), assert.AssertionError);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('a real file importing node:fs in core/ fails the check', () => {
  const probe = `${CORE_DIR}/__boundary_probe.tmp.js`;
  try {
    writeFileSync(probe, "import fs from 'node:fs';\nexport const x = fs;\n");
    const violations = findViolations(readCoreFiles());
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, 'builtin-import');
    assert.equal(violations[0].detail, 'node:fs');
    assert.match(violations[0].path, /__boundary_probe\.tmp\.js$/);
  } finally {
    rmSync(probe, { force: true });
  }
  // and the tree is clean again
  assert.deepEqual(findViolations(readCoreFiles()), []);
});

test('every source extension in core/ is scanned, not just .js', () => {
  // A file named .mjs or .cjs is executed by Node exactly like a .js one. If the glob misses
  // it, core/ has a door in it that the test reports as a wall.
  for (const [name, text] of [
    ['__probe_mjs.tmp.mjs', "import fs from 'node:fs';\n"],
    ['__probe_cjs.tmp.cjs', 'const t = Date.now();\n'],
  ]) {
    const probe = `${CORE_DIR}/${name}`;
    try {
      writeFileSync(probe, text);
      const violations = findViolations(readCoreFiles());
      assert.equal(violations.length, 1, `not scanned: ${name}`);
      assert.match(violations[0].path, new RegExp(`${name.replace('.', '\\.')}$`));
    } finally {
      rmSync(probe, { force: true });
    }
  }
  assert.deepEqual(findViolations(readCoreFiles()), []);
});

test('a symlinked module in core/ is scanned, not stepped over', () => {
  // `isFile()` is false for a symlink, so the obvious filter walks past one silently.
  const target = fileURLToPath(new URL('./__symlink_target.tmp', import.meta.url));
  const link = `${CORE_DIR}/__probe_link.tmp.js`;
  try {
    writeFileSync(target, "import fs from 'node:fs';\nexport const x = fs;\n");
    symlinkSync(target, link);
    const violations = findViolations(readCoreFiles());
    assert.equal(violations.length, 1);
    assert.equal(violations[0].detail, 'node:fs');
  } finally {
    rmSync(link, { force: true });
    rmSync(target, { force: true });
  }
  assert.deepEqual(findViolations(readCoreFiles()), []);
});

test('every shape of builtin import is caught', () => {
  const cases = [
    "import fs from 'node:fs';",
    'import fs from "fs";',
    "import { join } from 'path';",
    "import 'node:os';",
    "const cp = require('child_process');",
    "const { readFile } = await import('node:fs/promises');",
    "import { readFile } from 'fs/promises';",
    "import http from 'http';",
    "import net from 'net';",
    "import crypto from 'node:crypto';",
    "import { Worker } from 'worker_threads';",
    "import { pathToFileURL } from 'url';",
    "import { Readable } from 'stream';",
    'const fs = require(`fs`);',
    'const os = await import(`node:os`);',
  ];
  for (const text of cases) {
    const violations = findViolations([{ path: 'core/x.js', text }]);
    assert.equal(violations.length, 1, `not caught: ${text}`);
    assert.equal(violations[0].rule, 'builtin-import');
  }
});

test('ambient state is caught wherever it appears', () => {
  for (const text of [
    'const t = Date.now();',
    'const d = new Date();',
    'const r = Math.random();',
    'const e = process.env.HOME;',
    '// a comment mentioning Date.now is still a violation',
  ]) {
    const violations = findViolations([{ path: 'core/x.js', text }]);
    assert.equal(violations.length, 1, `not caught: ${text}`);
    assert.equal(violations[0].rule, 'ambient-state');
  }
});

test('pure code and relative imports are not flagged', () => {
  const text = [
    "import { validateSlug } from './paths.js';",
    "import { boundingBox } from '../core/mesh.js';",
    'export const area = (w, h) => w * h;',
    'const stream = makeStream();',
    "const label = 'the path to the file';",
  ].join('\n');
  assert.deepEqual(findViolations([{ path: 'core/x.js', text }]), []);
});
