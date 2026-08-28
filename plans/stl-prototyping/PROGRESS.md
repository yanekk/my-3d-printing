# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding there.**

**Status:** T04 is implemented and awaiting review. `npm test` runs **117** tests green on a
clean checkout with nothing installed. `BAD_COORDINATE` detection (`DESIGN.md §2.10`) is built
and lands in `core/solidity.js` rather than the interface `tasks/T04` specifies. **One question
is open for the user** — see below — and it changes at most one constant. T05 still waits on
its own rule (a triangle within float noise of a band edge — see `FINDINGS.md`).
**Last updated:** 2026-08-28
**Next `pir-work` will:** **review T04**.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spike: choose the recipe language | — | ✅ | **OpenSCAD chosen** (user, 2026-08-27). Review re-ran all six §5.3 commands — all hold. Fixed: §7's speed range excluded a measured 0.39 s; §5.2 never got the Gatekeeper note §5.3 demands. One table row ("named constants") unfillable, `spike/` gone. |
| T01 | Skeleton, `npm test`, purity-boundary test | — | ✅ | Review: sound, all three deviations approved. **Four defects fixed** — the boundary check globbed `*.js` and used `isFile()`, so `.mjs`, `.cjs`, symlinked modules and backtick specifiers in `core/` passed unread. Probed beyond the doc with planted real files: empty `core/`, subdirectories, `../shell` imports. **21 tests.** |
| T02 | STL read and write | T01 | ✅ | Review: sound, both deviations approved, fixtures regenerate byte-identical. **Two defects fixed** — every non-mesh file over 84 bytes earned `TRUNCATED` (`NOT_STL` was dead code); the writer's Infinity guard checked float64 and wrote float32, so `1e40` got written. Probed with recipes, HTML, gzip, `1e999`. **58 tests.** |
| T03 | Mesh measurements | T02 | ✅ | Review: **sound**, both deviations approved under stress. Volume/area/centroid match an independent decomposition on a 320-triangle icosphere to **2.7e-15**; 20 fresh mutations planted, all 20 caught; the centroid guard never misfired. **No defect fixed** — one comment corrected, three findings logged: `triangleAreas` overflows to `Infinity` above 2.6e19 mm (T04), and an exact 45° chamfer can land in the wrong band (T05). |
| T04 | Solidity: watertight, boundary edges, winding | T03 | 🔍 | `core/solidity.js`, **27 tests** (117 total); 16 planted mutations, all caught. Fixtures `flipped-face.stl`, `near-miss.stl` added; the other eight regenerate byte-identical. **Four deviations** — weld is distance-based, not the doc's quantised key; added `badCoordinateCount` and `outOfRangeCoordinateCount`; `degenerate.stl` is *not* watertight, the doc is wrong. |
| T05 | Overhangs, bands, bed contact, best orientation | T03 | ⬜ | Heaviest core task. |
| T06 | Recipe header, build-volume fit, declared vs measured | T03 | ⬜ | |
| T07 | The report object and its plain-text rendering | T04, T05, T06 | ⬜ | The decision function. |
| T08 | Build pipeline: spawn CAD with seatbelt, cache, atomic write | T00, T01 | ⬜ | Carries the timeout and size cap. |
| T09 | CLI: `new` / `list` / `build` / `check` | T07, T08 | ⬜ | |
| T10 | Preview server: loopback, watcher, websocket reload | T09 | ⬜ | Port 7373, hard fail on collision. |
| T11 | The 3D viewer page | T10, T07 | ⬜ | **Needs the user's eyes.** Session stops and waits. |
| T12 | `model options` / `compare` / `pick`, with the delete seatbelt | T09 | ⬜ | Only destructive command in the project. |
| T13 | Side-by-side comparison view | T11, T12 | ⬜ | **Needs the user's eyes.** Session stops and waits. |
| T14 | `MODELLING.md` — the rules Claude works by | T00, T09, T13 | ⬜ | Prose, but cannot be written honestly before the loop has been used. |

**Sixty words to a Notes cell.** What was built or what the review found, the test count, and
one line per deviation from the task doc. The cell is the index; the account is the commit
message.

**Review queue:** **T04**.

## Blocked on the user

**One question, asked 2026-08-28, answer not yet in. It does not block the review of T04.**

T03's review left it and `PROGRESS` assigned it here: **what the report says about a coordinate
that is a real number but absurdly large.** T04 now counts those triangles in
`outOfRangeCoordinateCount`, separately from `BAD_COORDINATE`, with the line drawn where the
weld grid runs out of integers — `weldTolerance * 2^53`, about 900 000 km at the default, and
comfortably below the ~1.3e19 mm where a triangle's area stops fitting in float32 (the hole T03
recorded). The options put to the user were: **(A)** fold it into `BAD_COORDINATE`; **(B)** its
own finding code, which is what is built and what was recommended; **(C)** flag anything over
about ten metres instead. A, B and C differ by one constant and by T07's wording — none of them
invalidates the code or the tests.

Everything else is answered and written down: the OpenSCAD install was verified by hand on
2026-08-27, the language decision came back **OpenSCAD** the same day, and the broken-coordinate
question T02 left open was answered on 2026-08-28 — report it, name the triangle — and is now
`DESIGN.md §2.10`.

**T05 still carries its own open rule**, recorded in `FINDINGS.md`: what a triangle sitting
within float noise of an overhang band edge is called. It does not stop T04's review.
