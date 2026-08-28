# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding there.**

**Status:** Phase 1 has two tasks left. T05 is built and awaiting review; `npm test` runs
**158** tests green on a clean checkout with nothing installed. Both of T05's open questions came
back from the user on 2026-08-28 and are now rules in `DESIGN.md §2.5`: a face within 0.01° of a
band edge is **snapped to the kind side**, and **bed contact is never support area** — the second
corrects a sentence in §2.5 and a contradiction inside `tasks/T05`. **T07 must add
`COORDINATE_OUT_OF_RANGE` to its findings table**, which still does not list it.
**Last updated:** 2026-08-28
**Next `pir-work` will:** **review T05** — overhangs, bands, bed contact, best orientation.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spike: choose the recipe language | — | ✅ | **OpenSCAD chosen** (user, 2026-08-27). Review re-ran all six §5.3 commands — all hold. Fixed: §7's speed range excluded a measured 0.39 s; §5.2 never got the Gatekeeper note §5.3 demands. One table row ("named constants") unfillable, `spike/` gone. |
| T01 | Skeleton, `npm test`, purity-boundary test | — | ✅ | Review: sound, all three deviations approved. **Four defects fixed** — the boundary check globbed `*.js` and used `isFile()`, so `.mjs`, `.cjs`, symlinked modules and backtick specifiers in `core/` passed unread. Probed beyond the doc with planted real files: empty `core/`, subdirectories, `../shell` imports. **21 tests.** |
| T02 | STL read and write | T01 | ✅ | Review: sound, both deviations approved, fixtures regenerate byte-identical. **Two defects fixed** — every non-mesh file over 84 bytes earned `TRUNCATED` (`NOT_STL` was dead code); the writer's Infinity guard checked float64 and wrote float32, so `1e40` got written. Probed with recipes, HTML, gzip, `1e999`. **58 tests.** |
| T03 | Mesh measurements | T02 | ✅ | Review: **sound**, both deviations approved under stress. Volume/area/centroid match an independent decomposition on a 320-triangle icosphere to **2.7e-15**; 20 fresh mutations planted, all 20 caught; the centroid guard never misfired. **No defect fixed** — one comment corrected, three findings logged: `triangleAreas` overflows to `Infinity` above 2.6e19 mm (T04), and an exact 45° chamfer can land in the wrong band (T05). |
| T04 | Solidity: watertight, boundary edges, winding | T03 | ✅ | Review: **sound**, all four deviations approved — the distance weld especially, which the doc's quantised key would have broken. **One defect fixed**: `COORDINATE_OUT_OF_RANGE` vanished whenever the 1e-3 retry ran, because the threshold moved with the pass; now pinned to the caller's tolerance. 19 fresh mutations, 16 caught, 2 equivalent, 1 gap (the threshold) closed. Probed past the doc: 4M-triangle cost, chained welds, `Float64Array`, a sub-tolerance part. **119 tests.** |
| T05 | Overhangs, bands, bed contact, best orientation | T03 | 🔍 | Bands, bed contact, 24-orientation search, `core/machine.js`. **158 tests.** Four deviations: support area excludes bed contact (user; §2.5 corrected); `bandEdgeToleranceDeg` added to the profile for the 45° snap (user); `applyRotation` exported, or two of the 24 collide unseen; non-finite normals dropped with degenerates. 25 mutations, all caught. |
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

**Review queue:** **T05** — the only task awaiting review, and the next unit of work.

## Blocked on the user

*(Nothing — a good state.)*

Every question this plan has raised is answered and written down. The OpenSCAD install was
verified by hand on 2026-08-27 and the language decision came back **OpenSCAD** the same day.
The broken-coordinate question T02 left open was answered on 2026-08-28 — report it, name the
triangle. T03's absurdly-large-coordinate question was answered the same day: **its own error
code**, `COORDINATE_OUT_OF_RANGE`, chosen over folding it into `BAD_COORDINATE` and over a
ten-metre threshold. Both are rows in `DESIGN.md §2.10`, and T04 implements both.

**T05's two questions were both answered on 2026-08-28** and are recorded in `FINDINGS.md` and
in `DESIGN.md §2.5`: the band-edge snap rounds to the kind side, and bed contact never counts as
support area. Nothing in Phase 1 is now waiting on the user.
