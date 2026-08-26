# T01 — Project skeleton, `npm test`, and the purity boundary

**Phase:** 1 · **Depends on:** — · **Weight:** light

## Goal

Create the smallest project that runs its own tests and defends its own architecture. Two
things matter here and nothing else does: `npm test` must work with zero installed
dependencies, and the test that enforces the pure/shell boundary must exist **before there is
any core code to tempt an exception**. A boundary rule added after the fact is a boundary rule
already broken.

This task is independent of T00 and can be done while the user is unavailable to run T00's
install.

## Design sections this implements

`DESIGN.md` §3.1 (the boundary and what enforces it), §5 (the test command, dependency
policy), §2.1 (slug validation, which lands in `core/paths.js` here because T12's destructive
delete depends on it existing and being tested long before T12).

## Files

```
package.json            "type": "module", test script, no dependencies
.gitignore              .build/  node_modules/  spike/
core/paths.js           NEW
test/boundary.test.js   NEW  — the architecture test
test/paths.test.js      NEW
README.md               NEW  — three paragraphs: what this is, how to run the tests, where
                             the plan lives. Not a manual; T14 writes the rules.
```

## Interface

```js
// package.json
{ "type": "module", "scripts": { "test": "node --test" }, "dependencies": {} }
```

```js
// core/paths.js — pure string functions. No `node:path`, deliberately: importing it would
// fail the boundary test, and every path this project builds is a POSIX-shaped repo-relative
// string, so joining with '/' is correct and testable.

/** @returns {{ok: true, slug: string} | {ok: false, reason: string}} */
export function validateSlug(input)
//   ^[a-z0-9]+(-[a-z0-9]+)*$, length 2..48.
//   Rejects: '', '..', 'a', 'A-b', '-a', 'a-', 'a--b', 'a/b', '/abs', 'a b', unicode,
//   anything over 48 chars. The reason string is user-facing.

export function modelDir(slug)        // 'models/cable-clip'
export function optionsDir(slug)      // 'models/cable-clip/options'
export function buildDir(slug)        // '.build/cable-clip'
export function notesPath(slug)       // 'models/cable-clip/NOTES.md'
export function recipePath(slug, ext) // 'models/cable-clip/model.scad'
export function stlPath(slug)         // '.build/cable-clip/model.stl'
export function reportPath(slug)      // '.build/cable-clip/model.report.json'
export function hashPath(slug)        // '.build/cable-clip/model.hash'
// Every one of these throws on an invalid slug rather than returning a bad path. A path
// function that returns something plausible for '..' is a path traversal waiting for a
// caller that forgot to validate.

/** True if `child` resolves to a location inside `root`, both POSIX-shaped repo-relative. */
export function isInside(root, child)
```

```js
// test/boundary.test.js — reads core/**/*.js as TEXT and fails on:
//   - import or require of any node: builtin, or bare 'fs'|'path'|'http'|'os'|'net'|
//     'child_process'|'crypto'|'worker_threads'|'url'|'stream'
//   - the substrings: 'Date.now', 'new Date', 'Math.random', 'process.'
// It must also assert that it found at least one file, so an empty or mis-globbed core/
// cannot pass vacuously — that is how this kind of test dies quietly.
```

## Tests

- [ ] `npm test` exits 0 on a clean checkout with no `npm install` having been run
- [ ] Boundary test fails when a file importing `node:fs` is placed in `core/` (prove it, then remove the file)
- [ ] Boundary test fails when a `core/` file contains `Date.now()`
- [ ] Boundary test fails if `core/` contains no files at all
- [ ] `validateSlug` accepts `ab`, `cable-clip`, `m3-bracket-v2`, a 48-char slug
- [ ] `validateSlug` rejects `''`, `'a'`, `'..'`, `'A-b'`, `'-a'`, `'a-'`, `'a--b'`, `'a/b'`, `'/abs'`, `'a b'`, `'café'`, a 49-char slug — each with a non-empty reason
- [ ] Every path function throws for `'..'` and for `'a/b'`
- [ ] `isInside('models/x', 'models/x/options')` is true; `isInside('models/x', 'models/x/../y')` is false; `isInside('models/x', 'models/xy')` is **false** (prefix matching is the classic bug here)

## Done when

- [ ] `npm test` passes from a clean checkout with an empty `node_modules`
- [ ] Adding `import fs from 'node:fs'` to any file in `core/` makes `npm test` fail
- [ ] `.gitignore` covers `.build/`, `node_modules/` and `spike/`
