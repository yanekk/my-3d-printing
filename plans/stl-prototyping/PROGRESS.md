# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding there.**

**Status:** T02 is reviewed and done — two defects found and fixed. `npm test` runs **58**
tests green on a clean checkout with nothing installed. Phase 2 continues at T03, whose first
session should read the top three rows of `FINDINGS.md`.
**Last updated:** 2026-08-27
**Next `pir-work` will:** **implement T03** (mesh measurements).

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spike: choose the recipe language | — | ✅ | **OpenSCAD chosen** (user, 2026-08-27). Review re-ran all six §5.3 commands — all hold. Fixed: §7's speed range excluded a measured 0.39 s; §5.2 never got the Gatekeeper note §5.3 demands. One table row ("named constants") unfillable, `spike/` gone. |
| T01 | Skeleton, `npm test`, purity-boundary test | — | ✅ | Review: sound, all three deviations approved. **Four defects fixed** — the boundary check globbed `*.js` and used `isFile()`, so `.mjs`, `.cjs`, symlinked modules and backtick specifiers in `core/` passed unread. Probed beyond the doc with planted real files: empty `core/`, subdirectories, `../shell` imports. **21 tests.** |
| T02 | STL read and write | T01 | ✅ | Review: sound, both deviations approved, fixtures regenerate byte-identical. **Two defects fixed** — every non-mesh file over 84 bytes earned `TRUNCATED` (`NOT_STL` was dead code); the writer's Infinity guard checked float64 and wrote float32, so `1e40` got written. Probed with recipes, HTML, gzip, `1e999`. **58 tests.** |
| T03 | Mesh measurements | T02 | ⬜ | |
| T04 | Solidity: watertight, boundary edges, winding | T03 | ⬜ | |
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

**Review queue:** *(empty — T03 is next to be built.)*

## Blocked on the user

*(Nothing — a good state.)*

T00's two questions are both answered and written down: the OpenSCAD install was run and
verified by hand on 2026-08-27, and the language decision came back **OpenSCAD** the same day.
