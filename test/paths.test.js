// DESIGN.md §2.1: slug validation is the only thing standing between a slug that came out of
// a conversation and a path-traversal delete in `model pick`. It is tested long before T12
// needs it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSlug,
  modelDir,
  optionsDir,
  buildDir,
  notesPath,
  recipePath,
  stlPath,
  reportPath,
  hashPath,
  isInside,
} from '../core/paths.js';

const PATH_FUNCTIONS = {
  modelDir,
  optionsDir,
  buildDir,
  notesPath,
  recipePath,
  stlPath,
  reportPath,
  hashPath,
};

const FORTY_EIGHT = 'a'.repeat(48);
const FORTY_NINE = 'a'.repeat(49);

test('validateSlug accepts well-formed names', () => {
  for (const slug of ['ab', 'cable-clip', 'm3-bracket-v2', '12', 'x9', FORTY_EIGHT]) {
    assert.deepEqual(validateSlug(slug), { ok: true, slug }, slug);
  }
});

test('validateSlug rejects malformed names, each with a reason', () => {
  const rejected = [
    '',
    'a',
    '..',
    '.',
    'A-b',
    '-a',
    'a-',
    'a--b',
    'a/b',
    '/abs',
    'a b',
    'café',
    'a_b',
    'a.b',
    'ab\n',
    ' ab',
    FORTY_NINE,
  ];
  for (const slug of rejected) {
    const result = validateSlug(slug);
    assert.equal(result.ok, false, `should reject ${JSON.stringify(slug)}`);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0, `empty reason for ${JSON.stringify(slug)}`);
  }
});

test('validateSlug rejects things that are not strings', () => {
  for (const input of [undefined, null, 42, {}, ['ab'], Symbol('ab')]) {
    const result = validateSlug(input);
    assert.equal(result.ok, false);
    assert.ok(result.reason.length > 0);
  }
});

test('the length reasons name the actual length', () => {
  assert.match(validateSlug('a').reason, /at least 2/);
  assert.match(validateSlug(FORTY_NINE).reason, /at most 48 .*49/);
});

test('every path function builds the documented layout', () => {
  const slug = 'cable-clip';
  assert.equal(modelDir(slug), 'models/cable-clip');
  assert.equal(optionsDir(slug), 'models/cable-clip/options');
  assert.equal(buildDir(slug), '.build/cable-clip');
  assert.equal(notesPath(slug), 'models/cable-clip/NOTES.md');
  assert.equal(recipePath(slug), 'models/cable-clip/model.scad');
  assert.equal(recipePath(slug, 'scad'), 'models/cable-clip/model.scad');
  assert.equal(recipePath(slug, '.scad'), 'models/cable-clip/model.scad');
  assert.equal(stlPath(slug), '.build/cable-clip/model.stl');
  assert.equal(reportPath(slug), '.build/cable-clip/model.report.json');
  assert.equal(hashPath(slug), '.build/cable-clip/model.hash');
});

test('every path function throws on an invalid slug rather than returning a plausible path', () => {
  for (const [name, fn] of Object.entries(PATH_FUNCTIONS)) {
    for (const slug of ['..', 'a/b', '', '/abs', 'a-', 'A-b', undefined, '../../etc']) {
      assert.throws(
        () => fn(slug),
        /Invalid model name/,
        `${name}(${JSON.stringify(slug)}) should throw`,
      );
    }
  }
});

test('recipePath rejects an extension that is not a bare extension', () => {
  for (const ext of ['../x', 'sc/ad', '', 'SCAD', 'scad.bak', 'toolongext', 42, null]) {
    assert.throws(() => recipePath('cable-clip', ext), /Invalid recipe extension/, String(ext));
  }
});

test('isInside compares resolved segments, not string prefixes', () => {
  assert.equal(isInside('models/x', 'models/x/options'), true);
  assert.equal(isInside('models/x', 'models/x/options/a.scad'), true);
  assert.equal(isInside('models/x', 'models/x/../y'), false);
  // The classic bug: 'models/xy' starts with 'models/x' as text and is not inside it.
  assert.equal(isInside('models/x', 'models/xy'), false);
  assert.equal(isInside('models/x', 'models/xy/options'), false);
});

test('isInside is false for the directory itself and for anything outside it', () => {
  assert.equal(isInside('models/x', 'models/x'), false);
  assert.equal(isInside('models/x', 'models/x/'), false);
  assert.equal(isInside('models/x', 'models/x/./'), false);
  assert.equal(isInside('models/x', 'models'), false);
  assert.equal(isInside('models/x', 'models/y/options'), false);
  assert.equal(isInside('models/x', '..'), false);
  assert.equal(isInside('models/x', '../models/x/options'), false);
});

test('isInside refuses absolute paths and non-strings on both sides', () => {
  assert.equal(isInside('/models/x', '/models/x/options'), false);
  assert.equal(isInside('models/x', '/models/x/options'), false);
  assert.equal(isInside('', 'models/x'), false);
  assert.equal(isInside('models/x', ''), false);
  assert.equal(isInside(undefined, 'models/x'), false);
  assert.equal(isInside('models/x', null), false);
});

test('isInside tolerates redundant and dotted segments', () => {
  assert.equal(isInside('models/x', 'models//x//options'), true);
  assert.equal(isInside('models/./x', 'models/x/options'), true);
  assert.equal(isInside('models/x', 'models/x/a/../b'), true);
  assert.equal(isInside('models/x', 'models/x/a/../../y'), false);
});

test('the path functions and isInside agree — options/ is inside its model', () => {
  const slug = 'm3-bracket-v2';
  assert.equal(isInside(modelDir(slug), optionsDir(slug)), true);
  assert.equal(isInside(modelDir(slug), notesPath(slug)), true);
  assert.equal(isInside(modelDir(slug), buildDir(slug)), false);
  assert.equal(isInside(buildDir(slug), stlPath(slug)), true);
});
