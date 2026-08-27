# stl-prototyping — Design

> Read this before changing behaviour. Every rule below carries its reason; a rule whose
> reason you disagree with is a conversation with the user, not a quiet reimplementation.

## 1. Purpose

A conversational loop for prototyping small 3D-printable parts. The user describes a part in
plain language; Claude writes a short parametric **recipe**; a command turns the recipe into
a mesh; a browser page shows the mesh and a printability report; the user reacts and the loop
runs again. The user is a product manager who does not read code and owns a Creality
Ender-3 V3 KE.

The design's load-bearing claim: **an STL is a bad artifact and a good build product.** It is
an unindexed list of triangles with no parameters, no units and no intent. It cannot be
diffed, cannot be edited by changing one number, and an LLM writing one directly produces
garbage. A recipe — a page of parametric source with the dimensions named at the top — is
legible, diffable, editable, and reviewable by a non-programmer. So the recipe is what the
repository stores, and the mesh is regenerated on demand into a gitignored cache.

### Success criteria

- From a plain-English request to a mesh on screen in one conversational turn, with no manual
  file handling by the user.
- Six months later, opening `models/{slug}/model.*` tells a non-programmer what the part is,
  what its key dimensions are, and which way up it prints.
- Every generated mesh is automatically checked for: watertightness, fit inside 220×220×240,
  agreement with its own declared bounding box, and overhang faces — and the result is
  readable by someone who has never used a slicer.
- Two variants can be built, viewed at an identical camera and scale, and one promoted, in
  three commands.
- `npm test` passes with zero installed runtime dependencies.

### Stance

- **The recipe is the artifact. The mesh is cache.** Nothing under `models/` is binary.
- **Report, never block.** The user is prototyping. Every check produces information; no check
  refuses to hand over a mesh. (User decision, 2026-08-26.)
- **Supports are acceptable.** The design's job is to say *which faces need them and how
  steeply they hang*, not to contort geometry to avoid them. (User decision, 2026-08-26.)
- **This project never touches the printer.** No slicing, no G-code, no network job
  submission. See §8.
- **Millimetres, always, everywhere.** Enforced by a required `@units mm` directive rather
  than by convention, because unit confusion is the single most expensive silent error in
  this domain and it is free to make impossible.

---

## 2. Behaviour specification

### 2.1 The model library

```
models/
  cable-clip/
    NOTES.md            what the part is for; what changed and why; human prose
    model.scad          THE recipe — one per model, overwritten in place
    options/            scratch, exists only during an explicit comparison
      a.scad
      b.scad
.build/                 gitignored mesh cache, safe to delete at any time
  cable-clip/
    model.stl
    model.report.json
```

One recipe per model, overwritten as it evolves; history lives in git commits. *(User
decision, 2026-08-26: they chose "one file, overwritten" over numbered versions, accepting
that rollback means asking Claude to dig through history.)*

**A model slug matches `^[a-z0-9]+(-[a-z0-9]+)*$`, 2–48 chars.** This is not cosmetic: `model
pick` deletes a directory, and the only thing standing between that and a path-traversal
delete is slug validation. The validator is a pure function in `core/paths.js` and is tested
against `..`, `/`, absolute paths, empty strings, unicode and leading dashes.

**`.build/` mirrors `models/` by slug and is never read as a source of truth.** Deleting it
must lose nothing. A session that finds itself needing a file from `.build/` that cannot be
regenerated has found a bug.

### 2.2 The recipe header

Every recipe begins with a machine-readable comment block. It is the mechanism behind "how do
we know Claude used the right measurements": the model states its own intended size, and the
checker measures the produced mesh and compares. A wrong number cannot stay hidden, because
it either contradicts the declaration or the declaration itself is visibly wrong to a reader.

```
// @model       cable-clip
// @units       mm
// @description Clip for a 6 mm round cable, screws to an 18 mm desk edge
// @orientation As modelled; largest flat face on the bed
// @material    pla
// @expect      bbox 40 x 20 x 8 +/- 0.5
```

| Directive | Required | Meaning |
|---|---|---|
| `@model` | yes | Must equal the containing folder name. Catches copy-paste between models. |
| `@units` | yes | Must be literally `mm`. Guards the inch/mm error. |
| `@description` | yes | One line, plain English. It is what the user reads in `model list`. |
| `@orientation` | yes | Free text: which way up this is meant to be printed. Free text because the useful answer is often a sentence, and a machine-checkable enum would be a lie. |
| `@material` | no, default `pla` | `pla` or `petg`. Selects advisory thresholds only. |
| `@expect bbox W x D x H [+/- TOL]` | yes | Declared overall size. Default tolerance 0.5 mm. |

The parser reads only the leading run of comment lines and stops at the first line that is
neither a comment nor blank. It accepts both `//` and `#` comment markers so the format
survives a change of recipe language. Unknown `@directives` are a warning, not an error — a
future directive should not break an old recipe.

### 2.3 Building

`model build {slug}` runs the recipe through the CAD toolchain and writes
`.build/{slug}/model.stl`. It is content-addressed: if the recipe's hash matches the hash
recorded beside the last successful build, the build is skipped. This matters because the
preview watcher triggers a build on every file event and an unconditional rebuild would make
the live-reload loop stutter on every keystroke.

**A CAD toolchain invocation is the most dangerous thing in this project** — it is an external
binary, driven by generated source, that can recurse, allocate without bound, or spin. See
§5.2 for the seatbelt. On failure the compiler's own stderr is surfaced verbatim, truncated to
the first 40 lines: the implementing session must resist the urge to "helpfully" reword it,
because the raw message is what Claude needs to fix its own recipe.

### 2.4 The printability report

`model check {slug}` builds if needed and produces a report. The report is a **pure function
of the mesh, the declared header and the machine profile** — this is the design's decision
function (§3.3). Same inputs, same report, no clock, no filesystem.

It answers, in this order:

1. **Is it a solid?** Watertight (every edge shared by exactly two triangles), no degenerate
   triangles, consistent winding, positive signed volume. A mesh that fails this is not
   printable by any slicer and everything below it is meaningless — so it is reported first
   and marked `error`.
2. **Does it fit?** Bounding box against the *usable* volume, which is 220 × 220 × 240 mm
   less a 5 mm margin at **both ends of X and Y** and at **the top of Z only** — giving
   **210 × 210 × 235 mm**. X and Y lose both ends because the bed clips and the purge line eat
   the edges; Z loses only the top because the first layer genuinely starts at zero. If it does
   not fit as modelled, report which axis-aligned rotations would make it fit.
3. **Does it measure what it claimed?** Measured bounding box vs `@expect bbox`, within
   tolerance, with the per-axis deltas signed.
4. **Where will it need support?** §2.5.
5. **How much filament?** Mesh volume → length of 1.75 mm filament → grams at the material's
   density. Advisory only; it ignores infill and walls, so it is a floor, not an estimate, and
   the report says so in those words.

**Every finding carries a severity and a stable code** (`NOT_WATERTIGHT`, `DOES_NOT_FIT`,
`BBOX_MISMATCH`, `SEVERE_OVERHANG`, `UNSUPPORTED_CEILING`, `TINY_FEATURE`, …). Codes are stable
so the viewer can style them and so `FINDINGS.md` can cite them; the message text is free to
improve.

**No finding is ever fatal to the build.** `model check` exits 0 even with errors present; the
severity is information. *(User decision, 2026-08-26.)*

### 2.5 Overhang analysis

For each triangle, with outward unit normal `n` and the build direction fixed at `+Z`:

```
downwardness d = -n.z                       (d = 1 → faces straight down)
overhang angle a = asin(clamp(d, -1, 1))    in degrees; a <= 0 → no overhang
```

`a` is measured **from vertical**, matching every slicer's convention: a wall tilting outward
by 45° reports 45°, a flat ceiling reports 90°. Using the slicer's convention is not a detail —
the whole point of the number is that the user can type it into their slicer's support
threshold.

| Band | Range | Meaning reported to the user |
|---|---|---|
| `none` | a ≤ 30° | Prints clean. |
| `mild` | 30° < a ≤ 45° | Fine on this printer. |
| `steep` | 45° < a ≤ 60° | Will show sag on the underside. Supports optional. |
| `severe` | 60° < a < 85° | Needs supports. |
| `ceiling` | a ≥ 85° | Flat unsupported underside. Bridges if it spans between two walls; otherwise supports are mandatory. The mesh alone cannot distinguish the two cases, and the report must say so rather than guess. |

Also reported: total area per band, **bed contact area** (downward-facing triangles whose
vertices all sit within 0.05 mm of the minimum Z — the first-layer footprint, which is what
predicts whether a part stays stuck), and **the best of the 24 axis-aligned orientations** by
total `steep`+`severe`+`ceiling` area. The orientation suggestion is advice, not an
instruction: it is blind to cosmetic faces, layer-line strength and bed adhesion, and the
report says so.

The 45° threshold and its neighbours are tuned for a direct-drive Ender-3 V3 KE and are
**thresholds in one table in one module**, not scattered constants, so retuning them after a
real print is a one-line change.

### 2.6 The preview

A local static server on `127.0.0.1` serves a page that loads the built STL with three.js.
The page provides: orbit/pan/zoom, a 10 mm grid with a 100 mm major division, a live bounding
box readout in mm, and shading of overhang triangles by band using the same colours in the
report legend.

**The 10 mm grid is a requirement, not decoration.** The single most common LLM modelling
error is an order-of-magnitude mistake, and a part sitting on a known-size grid makes a
10× error obvious in under a second, before any number is read.

The server watches `models/` and `.build/` and pushes a reload over a websocket, preserving
camera state across reloads (the camera lives in the page, the mesh is re-fetched). *(User
decision, 2026-08-26: they chose a self-refreshing page over manual reopening, accepting a
background process.)*

**The server binds to loopback only, on a fixed port, and exits with its terminal.** It serves
only from the repository root and refuses any resolved path outside it. It is not an
authenticated service and must never be reachable from the network.

### 2.7 Options and picking

Comparison is deliberate, not automatic. *(User decision, 2026-08-26.)*

```
model options {slug}       creates models/{slug}/options/{a,b}.scad, seeded from model.*
model compare {slug}       builds both, opens the side-by-side view
model pick {slug} a        options/a.* becomes model.*, options/ is deleted
```

`model pick` is the only destructive command in the project. Its seatbelt: it refuses unless
the resolved target is exactly `models/{validated-slug}/options`, it refuses if `options/`
contains anything it did not create, and it prints what it is about to delete. The reason is
blunt — a delete driven by a slug that came out of a conversation is a delete driven by
untrusted input.

### 2.8 Comparison view

Two meshes, one shared camera, one shared scale (both framed to the larger bounding box, so
a size difference is visible rather than normalised away — normalising to fit is the obvious
implementation and it is wrong, because it hides exactly the difference the user is looking
for). Alongside: the per-axis size delta, volume delta, overhang-area delta, and a
line-oriented diff of the two recipes.

### 2.9 The modelling rules

`MODELLING.md` at the repository root holds the rules Claude follows when writing a recipe,
with a pointer to it from `CLAUDE.md`. It covers: the required header, parameters named and
grouped at the top of every recipe with a unit comment, standard clearances (M3 clearance
hole 3.4 mm, M3 tap 2.5 mm, press-fit vs slip-fit gaps), what PLA forgives that PETG does not
(bridging, stringing, layer adhesion, thermal creep), minimum printable feature sizes for a
0.4 mm nozzle (wall ≥ 0.86 mm for two perimeters; ≥ 1.2 mm preferred for load-bearing), and the
loop the assistant follows: `model new` → write recipe → `model check` → read the report to
the user → show the preview.

It is a document, not code, and it is the one place in this project where the rules for the
*assistant* live. Rules for the *program* live in `DESIGN.md`.

### 2.10 The unhappy paths

| Situation | Behaviour | Why |
|---|---|---|
| Recipe has a syntax error | Build fails, exit non-zero, CAD stderr surfaced verbatim (first 40 lines) | The raw message is the thing that lets Claude fix it. Rewording it destroys the only useful signal. |
| CAD process exceeds its time limit | Killed, `BUILD_TIMEOUT`, partial output discarded | A runaway CSG operation will otherwise consume the machine. §5.2. |
| CAD emits an oversized STL | Killed at the size cap, `BUILD_TOO_LARGE`, partial output discarded | Same reason; also protects the browser, which will hang on a 500 MB mesh. |
| Produced mesh is not watertight | Reported as `error`, mesh still written and still previewable | The user asked for report-not-block, and seeing a broken mesh is how you diagnose it. |
| Mesh has zero triangles | `EMPTY_MESH` error; all downstream measurements reported as unavailable rather than as zero | Reporting a volume of 0 mm³ for an empty mesh reads as a measurement. It is an absence. |
| Header missing or malformed | Warning per missing directive; the checks that depend on it are reported unavailable, the rest still run | A partial report beats no report. Blocking on a missing comment would be absurd. |
| `@model` disagrees with the folder name | `SLUG_MISMATCH` warning | Almost always a copy-paste between models, and it produces confusing reports downstream. |
| Build cache is stale or corrupt | Detected by hash mismatch or parse failure; rebuild silently | The cache is defined as disposable; recovering from it silently is the whole point. |
| `.build/` deleted mid-session | Next command rebuilds | Same. |
| Two `model` commands run at once on the same slug | Build writes to a temp file in `.build/{slug}/` and renames into place | Rename is atomic on the same filesystem, so a concurrent reader sees either the old complete file or the new one, never a half-written mesh. |
| Preview port already in use | Exit with the port number and the suggestion to kill the other server; do **not** silently pick another port | A second server on a random port means the page the user is looking at is stale and they have no way to know. |
| Browser open, model deleted | Page shows "model no longer exists", keeps the last camera | Silently blanking looks like a crash. |
| `model pick` when `options/` does not exist | Error, nothing deleted | |
| STL that claims to be ASCII but is binary | Detected by structure, not by the `solid` prefix | Many binary STL writers put `solid` in the 80-byte header. Sniffing the prefix is the classic bug; the reliable test is whether `80 + 4 + 50 × triangleCount` equals the file length. |

---

## 3. Architecture

### 3.1 The boundary

```
core/    Pure. Takes buffers, numbers and plain objects as parameters; returns plain objects.
         No fs, no path, no http, no net, no child_process, no os, no process, no Date,
         no Math.random. Everything here is exhaustively testable in milliseconds.

shell/   Everything platform-shaped: spawning the CAD binary, reading and writing files,
         watching the filesystem, serving HTTP and websockets, parsing argv.

preview/ Browser code. Vendored three.js and the viewer pages.
```

**What enforces it:** `test/boundary.test.js` reads every file under `core/` as text and fails
on any `import`/`require` of a Node builtin, and on any occurrence of `Date.now`, `new Date`,
`Math.random` or `process.`. It fails the build, not a lint report.

**If that test fails, the fix is to move the code into `shell/`. Never relax the test.** The
rule survives exactly as long as nobody is allowed to make an exception for a convenient case,
and there is always a convenient case.

The reason, kept in one line: every rule that leaks across this boundary becomes a rule only a
person can verify, and this project's person is slow, occasionally away, and does not read
code.

### 3.2 Modules

| Module | Side | Owns | Depends on |
|---|---|---|---|
| `core/stl.js` | pure | Binary + ASCII STL parsing into a flat `Float32Array`; binary STL writing | — |
| `core/mesh.js` | pure | Bounding box, signed volume, surface area, centroid, recomputed per-triangle normals | `stl` |
| `core/solidity.js` | pure | Edge pairing, watertightness, boundary edges, degenerate triangles, winding consistency | `mesh` |
| `core/overhangs.js` | pure | Overhang angle per triangle, banding, bed contact area, best axis-aligned orientation | `mesh` |
| `core/fit.js` | pure | Build-volume fit, rotations that would fit | `mesh` |
| `core/header.js` | pure | Recipe header parsing and validation | — |
| `core/dimensions.js` | pure | Declared vs measured comparison | `header`, `mesh` |
| `core/machine.js` | pure | The Ender-3 V3 KE profile and material constants — one table, no logic | — |
| `core/report.js` | pure | Assembles the report object; renders it as plain text | all of the above |
| `core/paths.js` | pure | Slug validation, folder layout as string functions, path-escape detection | — |
| `shell/cad.js` | shell | Spawns the CAD binary with its seatbelt; surfaces stderr | — |
| `shell/build.js` | shell | Content-hash cache, atomic write into `.build/` | `cad`, `core/paths` |
| `shell/library.js` | shell | `new`, `list`, `options`, `pick` on `models/` | `core/paths`, `core/header` |
| `shell/server.js` | shell | Loopback static server, file watcher, websocket reload | `build` |
| `shell/cli.js` | shell | argv → command dispatch | all shell modules |

### 3.3 The decision function

```js
// core/report.js — a function of its arguments and nothing else.
buildReport({
  slug,            // string
  recipeText,      // string  — for the header
  stlBuffer,       // ArrayBuffer | Uint8Array
  machine,         // the profile object from core/machine.js
}) -> Report        // see the shape in tasks/T07
```

Everything the user is told about a part comes out of this one call. It reads no clock and
opens no file, so a day of prototyping behaviour is testable in milliseconds, and a
regression in the advice is caught by a golden-text test rather than by a failed print.

### 3.4 Data flow

```
conversation
   └─> Claude writes  models/{slug}/model.scad
         └─> shell/build.js  ──spawn──> CAD binary ──> .build/{slug}/model.stl
               └─> core/report.js ──> .build/{slug}/model.report.json
                     ├─> plain text, read aloud in the conversation
                     └─> shell/server.js ──ws──> preview page ──> the user's eyes
```

### 3.5 Storage

- **`models/`** — plain UTF-8 text, git-tracked, the only durable state. Written by Claude
  through ordinary file writes; a crash mid-write loses at most the one recipe being edited,
  and git holds the previous version.
- **`.build/`** — gitignored, disposable, content-addressed. Each build writes to
  `model.stl.tmp` and renames into place, so a crash mid-write leaves either the previous
  complete mesh or nothing, never a truncated one. The hash of the recipe that produced a
  mesh is stored in `.build/{slug}/model.hash`; a missing or mismatched hash forces a rebuild.
- **No database, no lockfile, no daemon state.** The only long-running process is the preview
  server, and it holds nothing that is not recoverable by restarting it.

---

## 4. Testing

| Layer | Proves | Cannot prove |
|---|---|---|
| `core/` unit tests | Every measurement, every threshold, every band boundary, every parse edge case, against hand-computed fixtures (unit cube, regular tetrahedron, 45° wedge, open box, inverted triangle) | That the mesh coming out of the CAD tool is the shape the user asked for |
| `test/boundary.test.js` | The purity rule holds | — |
| `shell/` tests | Timeouts fire, non-zero exits surface stderr, the cache skips and busts correctly, atomic rename holds, path escapes are refused | That the CAD binary is installed and correct on someone else's machine |
| Golden-text report tests | The plain-text report the user reads does not silently change | That the report is *useful* |
| **Nothing** | | That the viewer renders, that the shading is legible, that a part actually prints |

The last row is the point of §5.1.

---

## 5. Environment — read this before running anything

| | |
|---|---|
| OS | macOS, Darwin 25.5.0, arm64 |
| Runtime | Node v24.2.0 (`/opt/homebrew/bin/node`), npm available |
| Package managers | Homebrew 6.0.19, uv 0.11.11 |
| System Python | 3.9.6 (`/usr/bin/python3`) — old; anything Python-shaped must go through `uv`, never the system interpreter |
| **CAD toolchain** | **OpenSCAD 2026.06.12** — chosen by T00 on measurement, confirmed by the user 2026-08-27. See §5.3. |
| **Deliberately absent** | **No Blender, no FreeCAD, no MeshLab, no admesh, no f3d. No slicer of any kind — no PrusaSlicer, no OrcaSlicer, no Cura, no Bambu Studio.** Do not propose a workflow that assumes any of these. OpenSCAD is the *only* external binary this project may use. |

**The test command.**

```
npm test
```

Node 24's built-in test runner, verified working on this machine with zero dependencies
installed. **It is the only evidence a session may produce on its own.**

**Dependencies.** Runtime dependencies: **none**, and that is a rule, not an accident — a
project whose test command needs no `npm install` cannot rot. Dev dependencies: **three.js
only**, and it is `npm install`ed once, its needed files copied into `preview/vendor/`, and
the copies committed. The preview must work with no network. Adding any other dependency is a
decision for the user, not for an implementing session.

**External binaries:** exactly one, `openscad`. Its absence must produce a clear message
naming the install command from §5.3, not a stack trace.

### 5.1 What the test command cannot reach

| Cannot be tested automatically | Why it needs a person |
|---|---|
| OpenSCAD installs at all | Installs software system-wide; the user runs installers, not the assistant. **Verified by hand 2026-08-27** — see FINDINGS.md |
| Whether a recipe produces the shape that was asked for | Requires looking at it |
| The viewer renders, orbits, and does not stutter | Requires a screen and a browser |
| Overhang shading is legible and the bands are distinguishable | Requires eyes and a colour judgement |
| The 10 mm grid reads at a glance as a scale reference | Requires eyes |
| Live reload feels live and preserves the camera | Requires a browser and a hand on the mouse |
| The side-by-side view makes the difference obvious | Requires eyes |
| Whether a part actually prints on the Ender-3 V3 KE | Requires the physical printer and hours |
| Whether the overhang thresholds match this printer's real behaviour | Requires a printed test part |
| Filament estimates against reality | Requires a scale and a printed part |

### 5.2 Seatbelts

| Mechanism | Default | Effect |
|---|---|---|
| CAD wall-clock timeout | 30 s | Kills the process group; `BUILD_TIMEOUT`; partial output discarded. A recursive or unbounded CSG operation will otherwise eat the machine. **The message must also name a first-run permission dialog as a cause** — a fresh OpenSCAD install blocks on a Gatekeeper modal and looks exactly like a broken pipeline; see §5.3. |
| CAD output size cap | 200 MB | Kills the build; `BUILD_TOO_LARGE`. Also protects the browser from a mesh it cannot load. |
| CAD working directory | `.build/{slug}/` | The tool is given a scratch directory and its output path; it is never pointed at `models/`. |
| Preview server bind | `127.0.0.1` only, fixed port | Never reachable off the machine. A fixed port and a hard failure on collision, because a silently-relocated server means a silently stale page. |
| Preview server document root | repository root, resolved-path checked | No traversal above the repo. |
| `model pick` delete | Refuses unless the resolved path is exactly `models/{validated-slug}/options` | The only destructive operation; the slug comes from a conversation and is therefore untrusted. Prints what it will delete first. |
| Slug validation | `^[a-z0-9]+(-[a-z0-9]+)*$`, 2–48 chars | Applied before any path is constructed anywhere. |
| Installs | Never run by the assistant | The user runs them, one named command at a time. |

**Never ask the user to run the unbounded version of anything to find something out, and never
run it yourself.** In particular: no CAD invocation without its timeout, ever, including
during a spike.

### 5.3 The CAD toolchain — OpenSCAD

**Decided by T00 by building the same parts both ways on this machine, and confirmed by the
user on 2026-08-27.** The alternative measured was build123d 0.11.1; the reasoning and the
numbers are in `FINDINGS.md`, and the short version is 7–30× faster builds, one runtime
instead of two, 149 MB instead of 462 MB, and a recipe a non-programmer can read.

```
brew install --cask openscad@snapshot
```

**`openscad@snapshot`, never `openscad`.** The plain cask is 2021.01, deprecated, and disabled
from 2026-09-01. The snapshot is also the build with the Manifold backend, which is what makes
watertight output and sub-second builds possible.

| | |
|---|---|
| Version | 2026.06.12 |
| Binary | `/opt/homebrew/bin/openscad` → `/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD` |
| Size | 149 MB |
| Recipe extension | `.scad` |

**Export must name the format explicitly:**

```
openscad --export-format binstl -o out.stl model.scad
```

**OpenSCAD's STL default is ASCII**, which is roughly 2× the size and is not what T02's reader
expects. `.step` is rejected outright and `step` is not a known format — there is **no STEP
export**, which is the one capability knowingly given up here. Available: stl, off, wrl, amf,
3mf, csg, dxf, svg, pdf, png.

**It renders to PNG headlessly, and that is load-bearing rather than a nicety:**

```
openscad -o view.png --viewall --autocenter --camera=0,0,0,58,0,35,0 view.scad
```

where `view.scad` is `import("model.stl");`. About 0.3 s. This is how a session satisfies the
user's standing rule — build it, render it, *look at it*, iterate until right, and only then
present it. Exact bounding box and a watertight mesh do not establish that a part is correct:
a mirrored marking passes both. See `FINDINGS.md`, 2026-08-27.

**A first run that hangs is a dialog, not a crash.** Every CLI invocation blocked indefinitely
until the user dismissed a Gatekeeper "downloaded from the internet" prompt, while `spctl`
reported the app notarized and accepted throughout. §5.2's timeout message must name this
possibility, or the first person to hit it will believe the build pipeline is broken.

---

## 6. Recovery

**The preview server will not stop / the port is taken.**
```
lsof -ti :7373 | xargs kill
```
Nothing is lost. The server holds no state.

**Everything looks wrong / builds are stale.**
```
rm -rf .build
```
This is always safe. `.build/` is defined as disposable; every command rebuilds what it needs.

**A recipe was overwritten and the old one was better.** It is in git. Ask Claude for the
previous version of `models/{slug}/model.scad`; do not try to reconstruct it.

**`model pick` deleted the wrong option.** The options were scratch and are gone. The winning
recipe is now `model.*` and the previous `model.*` is in git history. This is the accepted
cost of the one-file-overwritten choice.

**The CAD toolchain is missing or broken.** Every command that needs it fails with the exact
reinstall line. Nothing else in the project depends on it — `npm test` still passes, because
the core is pure and its fixtures are checked in.

---

## 7. Decisions and rationale

| Decision | Alternative | Why it won |
|---|---|---|
| **Store recipes, not meshes** (2026-08-26, user) | Store STLs; store both | An STL cannot be diffed, edited by one number, or read by a human. The user chose "recipe only, rebuild on demand" explicitly. |
| **OpenSCAD as the recipe language** (2026-08-27, user, on T00's measurements) | build123d 0.11.1 | Both built the same parts exactly and watertight, so correctness did not separate them. OpenSCAD won on speed (0.06–0.39 s vs 1.7–3.9 s), one runtime instead of two, 149 MB vs 462 MB, a cleaner mesh, and source legible to a non-programmer. Two of the prior's predictions were **disproved**: rounding was one line with no BOSL2, and guaranteed-manifold output was matched by build123d. STEP export is the one real loss and was accepted. The honest counter-argument, recorded because it nearly won: build123d **refused** an impossible R3 fillet and named the 2.67 mm limit, where OpenSCAD silently approximated and passed every check this design plans to have. It was outweighed because the user's render-and-check rule, not the toolchain, is the real safety net — and OpenSCAD renders those previews itself. |
| **Node for everything else** | Python | Node 24 is installed and current; the system Python is 3.9.6. The preview is unavoidably browser JavaScript, so choosing Node means one language across the whole project instead of two. |
| **Zero runtime dependencies** | Use a mesh library | STL parsing and the measurements here are a few hundred lines of arithmetic. A dependency-free test command cannot rot, and this project will sit untouched for months at a time. |
| **Report, never block** (2026-08-26, user) | Refuse unprintable geometry | The user is prototyping and will deliberately produce impossible things. Blocking would be wrong at exactly the moments it fired. |
| **Supports permitted; report where** (2026-08-26, user) | Design support-free by default | The user prints with supports happily and would rather have design freedom than support-free geometry. |
| **One file per model, overwritten** (2026-08-26, user) | Numbered versions in the folder | The user preferred a clean folder and accepted that rollback goes through git. |
| **Comparison is explicit, in `options/`** (2026-08-26, user) | Automatic before/after on every change | Follows from one-file-overwritten: there is no previous version in the folder to compare against. Comparison becomes a deliberate act with a scratch area and a winner. |
| **Overhang angle measured from vertical** | From horizontal | Matches every slicer's support-threshold setting, so the number the report prints is the number the user types into their slicer. |
| **Shared scale in the comparison view** | Normalise each to fit its viewport | Normalising hides size differences, which is frequently the entire thing being compared. |
| **Fixed preview port, hard fail on collision** | Auto-select a free port | A relocated server leaves the user's open tab pointing at a dead or stale one, with no signal. Failing loudly is kinder. |
| **`@units mm` required and checked** | Assume mm | Unit confusion is the most expensive silent error in this domain and costs one line to make impossible. |

---

## 8. Explicitly out of scope

| Not built | Reason |
|---|---|
| **Slicing / G-code generation** | User decision, 2026-08-26: the project stops at the mesh. Slicing means installing and configuring a slicer, and its settings are a bottomless pit that belongs to the user's own slicer profile. |
| **Sending jobs to the printer** | User decision, 2026-08-26. It would mean this project could start a machine that gets to 300 °C and runs unattended for hours. Out, and stated as a rule so it is refused rather than rediscovered. |
| **A print log** | User decision, 2026-08-26. `NOTES.md` per model is the escape hatch if it is missed. |
| **Proper thin-wall detection** | Genuinely requires a slicer's toolpath generation, which is out of scope. The report catches the crude case (a feature smaller than the nozzle) and **must state the limitation in its own output** rather than let silence imply coverage. |
| **Multi-part assemblies, mating checks, interference detection** | Not asked for. A real need, but a much larger design. |
| **Mesh repair** | Reporting a broken mesh is in scope; fixing it is not. The right fix is almost always in the recipe, and repairing the mesh would hide the actual bug. |
| **Non-STL formats (3MF, STEP, OBJ)** | Not asked for. **STEP is now impossible** — OpenSCAD cannot write it, and that was accepted when the language was chosen. 3MF *is* available and would be nearly free if ever wanted, but is a decision for the user, not a silent addition. |
| **Numbered version history in the model folder** | User chose one-file-overwritten. History is git's job. |
| **Any network access at runtime** | The preview must work offline; there is nothing to fetch. Vendored three.js, loopback-only server. |
