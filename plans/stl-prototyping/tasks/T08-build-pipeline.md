# T08 — Build pipeline: spawn the CAD toolchain, with its seatbelt

**Phase:** 2 · **Depends on:** T00, T01 · **Weight:** medium

## Goal

Turn a recipe file into `.build/{slug}/model.stl`. This is the first task that spawns an
external process, and it is **the most dangerous thing in the project**: an external binary,
driven by machine-generated source, that can recurse without bound, allocate until the machine
swaps, or spin forever on a bad boolean. The seatbelt is not an enhancement to add later — it
is the reason this task exists as its own task, and it must be built and tested here.

The second half is the content-hash cache, which exists because T10's file watcher fires a
build on every editor save and an unconditional rebuild would make the live-reload loop
stutter.

## Design sections this implements

`DESIGN.md` §2.3 in full, §2.10 (build-failure, timeout, size-cap and concurrency rows),
§3.5 (atomic write), §5.2 (the seatbelt table).

> **Read `FINDINGS.md` first.** T00 chose the toolchain and its exact invocation; `DESIGN.md
> §5` names the binary. Do not reach for `brew install --cask openscad` — that cask is the
> deprecated 2021 build.

## Files

```
shell/cad.js            NEW — spawn, seatbelt, stderr surfacing
shell/build.js          NEW — hash cache, atomic write
test/cad.test.js        NEW
test/build.test.js      NEW
test/helpers/fake-cad.mjs  NEW — a stand-in binary the tests drive
```

**The tests must not require the real CAD toolchain.** `fake-cad.mjs` is a small Node script
that, by argument, writes a valid STL, writes garbage, sleeps forever, writes 300 MB, or exits
non-zero with a message on stderr. That is how the timeout and the size cap get tested at all —
provoking them with the real toolchain would mean deliberately running the unbounded thing,
which `DESIGN.md §5.2` forbids.

## Interface

```js
// shell/cad.js

/**
 * @typedef {{
 *   binary: string,              // from DESIGN.md §5, decided by T00
 *   args: (input: string, output: string) => string[],
 *   extension: string            // '.scad' | '.py'
 * }} Toolchain
 */
export const TOOLCHAIN = { /* filled in from T00's answer */ };

/**
 * @typedef {{ ok: true, outputPath: string, durationMs: number, stderr: string }
 *         | { ok: false, code: 'BUILD_FAILED'|'BUILD_TIMEOUT'|'BUILD_TOO_LARGE'
 *                             |'TOOLCHAIN_MISSING',
 *             message: string, stderr: string, durationMs: number }} CadResult
 */

/** @param {{inputPath, outputPath, toolchain, timeoutMs=30000, maxOutputBytes=200e6}} */
export async function runCad(opts)
```

Seatbelt requirements, each with its reason:

- **`timeoutMs` defaults to 30 000 and cannot be disabled.** An `Infinity` or `0` passed in is
  clamped to the default. There is no legitimate caller that wants an unbounded CSG operation,
  and an option that can be switched off will be switched off.
- **On timeout the whole process *group* is killed**, spawned with `detached: true` and killed
  via `process.kill(-pid, 'SIGKILL')`. CAD toolchains fork helpers; killing only the parent
  leaves them running and holding the machine. This is the part of the task that looks done
  and is not, and it is why the fake binary spawns a child of its own in the timeout test.
- **Output is polled against `maxOutputBytes`** during the run, not just checked afterwards. A
  runaway that writes 40 GB must be stopped while it is writing, not discovered when the disk
  is full.
- **Partial output is deleted on every failure path.** A truncated STL left behind would be
  parsed by the next `model check` and reported as a mesh problem, sending Claude to fix
  geometry that was never wrong.
- **The CAD process is given `.build/{slug}/` as its working directory** and an explicit output
  path. It is never pointed at `models/`.
- **`stderr` is surfaced verbatim, truncated to the first 40 lines**, never reworded. The
  compiler's own message is the only thing that lets Claude fix its recipe; a friendly
  paraphrase destroys the line number.
- **A missing binary produces `TOOLCHAIN_MISSING`** with the exact install command from
  `DESIGN.md §5` in the message — not an `ENOENT` stack trace.

```js
// shell/build.js

/**
 * @typedef {{ built: boolean, cached: boolean, stlPath: string, hash: string }
 *         | { built: false, error: CadResult }} BuildResult
 */
export async function buildModel(slug, { force = false, toolchain = TOOLCHAIN } = {})
```

- The cache key is `sha256(recipeBytes) + toolchain.binary + toolchainVersionString`. The
  recipe alone is not enough: upgrading the toolchain can change the mesh, and a stale cache
  would then hide the change.
- The hash is written to `.build/{slug}/model.hash` **only after** a successful atomic rename
  of the STL. Writing it first means a crash between the two leaves a hash claiming a mesh that
  is not there.
- The STL is written to `model.stl.tmp` in the same directory and `rename`d into place. Same
  filesystem, so the rename is atomic and a concurrent reader sees the old complete file or the
  new one, never a half-written mesh (`DESIGN.md §2.10`).
- `force: true` bypasses the cache check but not the seatbelt.

## Tests

*(all against `fake-cad.mjs`; none require the real toolchain)*

- [ ] A successful build writes the STL and returns `ok: true`
- [ ] A second build with an unchanged recipe returns `cached: true` and does not spawn the process
- [ ] Changing one byte of the recipe busts the cache
- [ ] Changing the recorded toolchain version busts the cache
- [ ] `force: true` rebuilds despite a valid cache
- [ ] A missing `model.hash` rebuilds
- [ ] A `model.hash` present with **no** `model.stl` rebuilds
- [ ] Non-zero exit: `BUILD_FAILED`, stderr surfaced verbatim, no STL left on disk
- [ ] stderr longer than 40 lines is truncated and says so
- [ ] A binary that never exits: `BUILD_TIMEOUT` fires at the configured timeout, ±1 s
- [ ] **A binary that spawns a child which outlives it: the child is dead after the timeout** (assert by pid)
- [ ] `timeoutMs: 0` and `timeoutMs: Infinity` are both clamped to 30 000
- [ ] Output exceeding `maxOutputBytes`: `BUILD_TOO_LARGE`, killed during writing, no file left
- [ ] A non-existent binary: `TOOLCHAIN_MISSING` whose message contains the install command
- [ ] Atomic write: no `.tmp` file remains after success or after any failure
- [ ] An invalid slug is rejected before any path is constructed
- [ ] The CAD process's working directory is `.build/{slug}/`, asserted by having the fake print `process.cwd()`

## Done when

- [ ] A fake toolchain that spawns a surviving child is fully cleaned up on timeout, proven by pid
- [ ] No failure path leaves an STL, a `.tmp` file, or a hash on disk
- [ ] The cache skips a rebuild for an unchanged recipe and busts for a changed one
