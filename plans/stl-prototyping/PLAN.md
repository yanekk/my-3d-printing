# Implementation plan

15 tasks in 5 phases. Each has a file in [tasks/](tasks/) with its goal, the files it touches,
the interfaces it defines, and what "done" means.

Track state in [PROGRESS.md](PROGRESS.md). Read [DESIGN.md](DESIGN.md) first.

---

## Shape of the build

- **Everything testable automatically is built and proven before anything draws a pixel.**
  Phases 1 and 2 finish with every measurement, threshold and band boundary implemented and
  covered by tests against hand-computed fixtures. Phase 3 then wires a viewer to logic that
  is already known to be correct — so when the page looks wrong, the bug is in the page.
- **The riskiest unknown goes first, as a throwaway spike.** Which recipe language survives
  contact with this machine decides the build pipeline, the file extension, whether a second
  language runtime enters the project, and whether fillets are cheap or painful. Nothing is
  designed on top of it until it is measured. T00's code is deleted afterwards.
- **The dangerous thing is built small before it is built full size.** The CAD invocation gets
  its timeout and size cap in T08, the first task that ever spawns it outside the spike — not
  bolted on after the first runaway. The one destructive command (`model pick`) is built in
  T12, after `core/paths.js` slug validation exists in T01 and is tested against traversal.
- **The pure core is built bottom-up in dependency order**, each task narrow enough that its
  "Done when" is three checkable lines. Nothing in `core/` may import a Node builtin, and the
  test that enforces that ships in T01, before there is any core code to tempt it.

```
Phase 0  ▸  T00                prove the ground              throwaway, deleted after
Phase 1  ▸  T01 … T07          the pure core                 headless, no UI exists
Phase 2  ▸  T08 … T09          making it run                 a working command line
Phase 3  ▸  T10 … T11          seeing it                     needs the user's eyes
Phase 4  ▸  T12 … T14          comparing, and the rules      needs the user's eyes
```

---

## Phase 0 — Prove the ground

| # | Task | Depends on |
|---|---|---|
| [T00](tasks/T00-choose-recipe-language.md) | Spike: choose the recipe language by building the same part both ways | — |

**T00 gates T08 (the build pipeline), T09's file extensions, T14's modelling rules, and
DESIGN.md §5's external-binary line.** It also decides whether a second language runtime
enters the project at all.

- **If OpenSCAD wins:** one binary, `.scad` recipes, everything else stays Node. Fillets go
  through BOSL2 or `offset`/`roof`; STEP export is not available.
- **If build123d/CadQuery wins:** a `uv`-managed Python environment joins the project,
  `.py` recipes, real fillets and chamfers, and STEP export becomes a near-free future option
  worth raising with the user.
- **If neither installs or produces a watertight mesh:** stop and report. Everything
  downstream is unbuildable and the plan needs rethinking, which is a conversation with the
  user, not a workaround.

**T00 ends by reporting its recommendation to the user and waiting for confirmation.** The
answer is then written into `FINDINGS.md` and `DESIGN.md §5` before any task builds on it.

*At the end of this phase:* the recipe language is settled by measurement on this machine, and
exactly one external binary is named.

## Phase 1 — The pure core

Nothing in this phase touches the filesystem, the network, the clock or a screen. Every task
here is fully provable by `npm test`.

| # | Task | Depends on |
|---|---|---|
| [T01](tasks/T01-skeleton-and-boundary.md) | Project skeleton, `npm test`, and the purity-boundary test | — |
| [T02](tasks/T02-stl-io.md) | STL reading and writing | T01 |
| [T03](tasks/T03-mesh-measurements.md) | Bounding box, volume, area, normals, centroid | T02 |
| [T04](tasks/T04-solidity.md) | Watertightness, boundary edges, degenerate triangles, winding | T03 |
| [T05](tasks/T05-overhangs.md) | Overhang angles, bands, bed contact, best orientation | T03 |
| [T06](tasks/T06-header-fit-dimensions.md) | Recipe header parsing, build-volume fit, declared-vs-measured | T03 |
| [T07](tasks/T07-report.md) | The report object and its plain-text rendering | T04, T05, T06 |

**T01 is independent of T00** and can be built first if the user is not available to run the
install T00 needs. That is the only parallelism in the plan and it is worth knowing about.

*At the end of this phase:* every judgement this project will ever make about a mesh is
implemented and covered. Given an STL and a recipe header, the full report can be produced —
there is simply no way yet to obtain the STL.

## Phase 2 — Making it run

| # | Task | Depends on |
|---|---|---|
| [T08](tasks/T08-build-pipeline.md) | Spawn the CAD toolchain with its seatbelt; content-hash cache; atomic write | T00, T01 |
| [T09](tasks/T09-cli.md) | `model new` / `list` / `build` / `check` | T07, T08 |

*At the end of this phase:* the whole loop works headlessly. Claude can write a recipe, run
`model check`, and read a correct printability report aloud. Nothing is on screen yet, and
everything up to this point is proven by tests rather than by looking.

## Phase 3 — Seeing it

| # | Task | Depends on |
|---|---|---|
| [T10](tasks/T10-preview-server.md) | Loopback static server, file watcher, websocket reload | T09 |
| [T11](tasks/T11-viewer.md) | The 3D viewer page: orbit, 10 mm grid, size readout, overhang shading | T10, T07 |

**T11 needs the user's eyes and will stop and wait for them.** It is the first task in the
plan that cannot be finished by tests alone.

*At the end of this phase:* the user can leave a page open and watch models appear and change
as they talk.

## Phase 4 — Comparing, and the rules

| # | Task | Depends on |
|---|---|---|
| [T12](tasks/T12-options-and-pick.md) | `model options` / `compare` / `pick`, with the delete seatbelt | T09 |
| [T13](tasks/T13-comparison-view.md) | Side-by-side view: shared camera, shared scale, deltas, recipe diff | T11, T12 |
| [T14](tasks/T14-modelling-rules.md) | `MODELLING.md` — the rules Claude works by | T00, T09, T13 |

**T13 needs the user's eyes.** T14 is a document, not code, but it cannot be written honestly
until the loop it describes has been used at least once.

*At the end of this phase:* the product described in DESIGN.md §1 exists.

---

## Critical path

```
T00 ─────────────┐
                 ├─> T08 ─> T09 ─> T10 ─> T11 ─> T13 ─> T14
T01 ─> T02 ─> T03 ─┴─> T04 ─┐
                    ├─> T05 ─┼─> T07 ─┘
                    └─> T06 ─┘
                            T09 ─> T12 ─> T13
```

Ten tasks deep: `T01 → T02 → T03 → T06 → T07 → T09 → T10 → T11 → T13 → T14`.

**Off the critical path, slot in wherever convenient:** T04 and T05 (both hang off T03 and
only rejoin at T07), and T12 (hangs off T09, rejoins at T13). T00 is off the arithmetic
critical path but blocks T08, and it needs the user to run an install — so it is worth
starting first purely because it is the one task that can sit waiting on a human.

## Rough sizing

| Weight | Tasks | Why |
|---|---|---|
| **Heavy** | T05, T11, T13 | T05 is the real geometry: 24 orientations, band boundaries, bed contact, and every one of them needs a hand-computed fixture. T11 and T13 are browser work with no automated safety net — every judgement is the user's eyes. |
| **Medium** | T02, T04, T07, T08, T09, T10, T12, T14 | T02 and T04 are exacting rather than large. T08 carries the seatbelt and the process handling. T14 is long but is prose. |
| **Light** | T00, T01, T03, T06 | T00 is deliberately small — it answers one question and is deleted. |

**Where this will overrun:**

- **T05's best-orientation search.** Twenty-four orientations, each needing the full overhang
  computation, and the fixtures for "which orientation should win" are genuinely fiddly to
  hand-compute. If it turns into a swamp, the honest fallback is to ship the six axis-aligned
  orientations instead of all 24 and log the reduction in `FINDINGS.md` — not to ship an
  untested search.
- **T08's process handling.** Killing a *process group* on timeout rather than a process, and
  discarding partial output, is the kind of thing that looks done and is not. The tests for it
  are more work than the feature.
- **T11's overhang shading.** Getting per-triangle colour onto a loaded STL means rebuilding
  the geometry with vertex colours. Straightforward, but it is the step that usually eats an
  afternoon, and the "is it legible" question can only be answered by the user.
- **T00 waiting on a human.** The install is the user's to run. If they are away, the session
  waits — by design.

## Decisions still open

| Open | What settles it | Blocks |
|---|---|---|
| The recipe language, and therefore the recipe file extension and whether Python joins the project | **T00**, by measurement, then user confirmation | T08, T09, T14 |
| Whether STEP export is worth adding | Only arises if T00 chooses a B-rep kernel; if it does, it is a conversation with the user, not a silent addition | nothing |
| Whether the 45°/60°/85° overhang bands match this printer's real behaviour | A printed test part, by the user, some time after T11 | nothing — the thresholds live in one table in `core/machine.js` and retuning is a one-line change |
| The preview port number | Nothing; it is set to **7373** in T10 and the user can say otherwise | nothing |

**Nothing else is unsettled.** Every behaviour in DESIGN.md §2 has a decided rule.
