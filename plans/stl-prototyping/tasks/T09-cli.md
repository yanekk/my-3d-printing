# T09 — The command line: `new`, `list`, `build`, `check`

**Phase:** 2 · **Depends on:** T07, T08 · **Weight:** medium

## Goal

Make the whole headless loop usable in one command each. At the end of this task Claude can
create a model, write a recipe, run one command, and read a correct printability report aloud
to the user — with nothing on screen and every judgement in it already proven by tests.

This is the point at which the project becomes useful, and it is deliberately reached before
anything draws a pixel.

## Design sections this implements

`DESIGN.md` §2.1 (the library layout), §2.3, §2.4, §2.10 (the header-mismatch and empty-mesh
rows as they surface to a user).

## Files

```
shell/library.js          NEW — new, list; reads and writes models/
shell/cli.js              NEW — argv dispatch
bin/model                 NEW — #!/usr/bin/env node, execs shell/cli.js
package.json              MODIFIED — "bin": { "model": "./bin/model" }
test/library.test.js      NEW
test/cli.test.js          NEW
```

## Interface

```
model new <slug> [--description "..."]
    Creates models/<slug>/ with NOTES.md and a model.<ext> stub carrying a complete,
    valid header and a single small solid. Refuses if the folder exists — never
    overwrites a recipe, because that is the user's only copy outside git.

model list
    One line per model: slug, its @description, its declared size, and whether a
    built mesh is currently cached. Sorted by slug. Reads headers only; builds nothing.

model build <slug> [--force]
    Builds. Prints cached/built and the duration. Exit 1 on a build failure.

model check <slug> [--json] [--no-build]
    Builds if needed, then prints the rendered report. --json prints the Report object
    instead. --no-build fails rather than building, for use inside the watcher.
    EXIT CODE IS 0 EVEN WITH ERRORS IN THE REPORT.
```

**That last line is a design rule, not an oversight** (`DESIGN.md §2.4`). The user chose
report-never-block. A non-zero exit on an unprintable mesh would turn every advisory finding
into a wall at exactly the moment they are deliberately experimenting. Exit 1 is reserved for
*the command failing* — a build error, a missing model, an unreadable file — never for the
mesh being bad news.

```js
// shell/library.js
export async function createModel(slug, { description, toolchain })  // -> {created, paths}
export async function listModels()                                    // -> ModelSummary[]
/** @typedef {{slug, description, declaredSizeMm, hasCachedMesh, recipePath}} ModelSummary */
```

**The stub written by `model new` matters more than it looks.** It is the template every model
starts from and therefore the thing that makes the header habit stick. It must carry all six
directives filled in plausibly, the dimensions as named constants at the top of the body, and
a comment saying that the numbers at the top are the ones to change. A stub with a `TODO`
header teaches the opposite lesson.

**`model list` never builds.** It parses headers and stats the cache. Listing must stay
instant even with fifty models, or the user stops using it.

## Tests

- [ ] `model new cable-clip` creates the folder, `NOTES.md`, and a stub whose header parses with **zero** problems from T06
- [ ] The stub produced by `model new` builds successfully through the fake toolchain and reports `worstSeverity: 'note'`
- [ ] `model new` on an existing slug exits 1 and **does not touch** the existing recipe (asserted by mtime and content)
- [ ] `model new ../evil` is rejected by slug validation before any path is built
- [ ] `model list` on an empty `models/` prints a friendly empty message, exit 0
- [ ] `model list` reports a model with a malformed header without throwing, showing what it could parse
- [ ] `model list` does not create anything in `.build/`
- [ ] `model check` on a mesh with `NOT_WATERTIGHT` prints the error **and exits 0**
- [ ] `model check` on a missing slug exits 1 with a message naming the slug
- [ ] `model check --json` emits parseable JSON with `reportVersion: 1` and nothing else on stdout
- [ ] `model check --no-build` with no cached mesh exits 1 rather than building
- [ ] `model build` on a failing recipe exits 1 and prints the toolchain's stderr verbatim
- [ ] An unknown subcommand prints usage and exits 1
- [ ] No subcommand at all prints usage and exits 0
- [ ] Every command run from a subdirectory of the repo resolves paths against the repo root, not the cwd

## Done when

- [ ] `model new x && model check x` works end to end against the fake toolchain and reports a clean part
- [ ] `model check` exits 0 on a report full of errors, and exits 1 when the command itself fails
- [ ] `model list` builds nothing and touches nothing under `.build/`
