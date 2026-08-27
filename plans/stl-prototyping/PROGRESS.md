# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding there.**

**Status:** T00 measured in full, both candidates, and **waiting on the user's decision**. The
comparison table is complete; the recommendation is OpenSCAD. Nothing else is built. `spike/`
still exists and is deleted the moment the decision lands.
**Last updated:** 2026-08-27
**Next `pir-work` will:** close **T00** once the user picks — write the choice into `DESIGN.md`
§5, delete `spike/`, mark 🔍. If the decision is already recorded, implement **T01**.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spike: choose the recipe language | — | 🟡 | Both measured. OpenSCAD: 0.06 s, 974 tris, 149 MB, no STEP, one runtime. build123d: 46 s cold / 1.7 s warm, 1858 tris, 462 MB, STEP works, second runtime. Both exact and watertight. **Recommended OpenSCAD; awaiting the user's pick.** |
| T01 | Skeleton, `npm test`, purity-boundary test | — | ⬜ | Independent of T00. |
| T02 | STL read and write | T01 | ⬜ | |
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

**Review queue:** *(empty)*

## Blocked on the user

**T00 — the recipe-language decision.** Install done and verified 2026-08-27; the measuring is
finished and both candidates work. What is left is a choice, and it is the user's:

> **OpenSCAD** — ~700× faster, one runtime, half the install, tidier mesh, source a
> non-programmer can read. Loses STEP export, and true 3D edge fillets stay awkward.
> **build123d** — real CAD kernel, STEP export, fillets anywhere. Costs a second language,
> 462 MB, and a 46 s cold start that breaks DESIGN.md §5.2's 30 s timeout outright.

Recommended: **OpenSCAD**. Nothing further is built until this is answered — the whole of
Phase 2 is designed on top of it.
