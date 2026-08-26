# Progress

**Update this file whenever a task changes state.** It is the handoff between sessions.

**What the build taught lives next door, in [FINDINGS.md](FINDINGS.md)** — read the entries
that touch the task you are picking up, and append yours there. It is where "verified by hand
with the user" is written down. **Sixty words to a Notes cell here, forty to a finding there.**

**Status:** Planned, nothing built. 15 tasks across 5 phases; see [PLAN.md](PLAN.md). The
recipe language is deliberately undecided and is settled by T00 on this machine, so T00 blocks
the build pipeline. T01 is independent of T00 and is the fallback if the user is unavailable
to run T00's install.
**Last updated:** 2026-08-26
**Next `pir-work` will:** implement **T00** — the throwaway spike that chooses the recipe
language. It goes first because everything in Phase 2 is designed on top of its answer, and
because it is the one task that needs the user to run an install, so it is the task most worth
starting while they are around.

## Tasks

Legend: ⬜ not started · 🟡 in progress · 🔍 implemented, awaiting review · ✅ reviewed and
done · ⛔ blocked, needs a human.

| # | Task | Depends on | State | Notes |
|---|---|---|---|---|
| T00 | Spike: choose the recipe language | — | ⬜ | Throwaway; code deleted afterwards. Needs the user to run one install command. Ends by reporting a recommendation and waiting for confirmation. |
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

*(Nothing yet — a good state.)*

T00 will put something here the moment it starts: it needs the user to run one install command
on their own machine, and it waits for the answer rather than continuing around it.
