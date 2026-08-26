# T00 — Spike: choose the recipe language

**Phase:** 0 · **Depends on:** — · **Weight:** light

## Goal

Decide, by building the same part twice on this machine today, which language Claude will
write recipes in. This is throwaway code that answers one question and is then deleted. The
question is load-bearing: it decides the recipe file extension, whether a second language
runtime enters the project, whether fillets are cheap or painful, whether STEP export is
available later, and the whole of T08's build pipeline. Guessing it and being wrong is
discovered in T08 at the cost of several tasks; measuring it costs one session.

The prior, stated so the spike can try to disprove it rather than confirm it: **OpenSCAD is
expected to win** on single-runtime simplicity, source legibility to a non-programmer, and
guaranteed-manifold output. It is expected to lose on fillets and on STEP export. The spike's
job is to find out whether those expected losses are tolerable and whether the expected wins
are real.

## Design sections this implements

`DESIGN.md` §5 (the external binary), §7 (the recipe-language row). It **gates** §2.3 and
§2.9.

## Files

Everything under `spike/` — created, used, and **deleted before the task is marked done**.
The only durable outputs are rows in `FINDINGS.md`, an updated `DESIGN.md §5`, and a note in
`PROGRESS.md`.

Do not create `core/`, `shell/`, `package.json` or anything else the real project will use.
T01 owns the skeleton, and a spike that leaves scaffolding behind has stolen a decision from
the task that should have made it.

## The reference part

Both implementations build the same L-bracket. It is chosen to exercise every capability the
decision turns on, and its dimensions are exact so the result can be checked rather than
admired.

```
Base plate      40 (X) x 30 (Y) x 4 (Z) mm
Vertical wall   40 (X) x 4 (Y) x 25 (Z) mm, rising from the y=0 edge of the base
Gusset          a 45 degree triangular web between base and wall, 4 mm thick, 12 mm legs,
                centred at x=20
Holes           two M3 clearance holes, diameter 3.4 mm, through the base (Z),
                centres at (10, 18) and (30, 18)
                one 5.0 mm hole through the wall (Y), centre at x=20, z=14
Rounding        all four vertical outer edges of the base rounded R2
Overall bbox    exactly 40.00 x 30.00 x 25.00 mm
```

## Interface

There is none — nothing here survives. What the spike must produce is a **measured comparison
table**, filled in for both candidates:

```
| Metric                                   | OpenSCAD | build123d/CadQuery |
|------------------------------------------|----------|--------------------|
| Exact install command                    |          |                    |
| Install succeeded (user ran it)          |          |                    |
| Install size on disk                     |          |                    |
| Lines of recipe source                   |          |                    |
| Attempts needed to get it correct        |          |                    |
| Cold export time to STL (s)              |          |                    |
| Warm/re-export time (s)                  |          |                    |
| Triangle count                           |          |                    |
| Mesh watertight                          |          |                    |
| Measured bbox (must be 40 x 30 x 25)     |          |                    |
| Max per-axis error (mm)                  |          |                    |
| R2 rounding: practical or painful        |          |                    |
| Dimensions readable as named constants   |          |                    |
| STEP export available                    |          |                    |
| Second language runtime required         |          |                    |
```

**Candidate A — OpenSCAD.** Install is `brew install --cask openscad@snapshot` (2026.06.12).
**Not** `brew install --cask openscad`: see `FINDINGS.md` — that one is 2021.01, deprecated,
and disabled on 2026-09-01. Export with `openscad -o out.stl in.scad`. Rounding via BOSL2 or
`offset`/`roof`; if BOSL2 is needed, note that as an extra dependency in the table.

**Candidate B — build123d (or CadQuery).** Install into a `uv`-managed environment under
`spike/`, never into the system Python 3.9.6. Export STL; also record whether STEP export
works, since that is its main claimed advantage.

**Measuring the result.** Do not eyeball the STL. Write a throwaway ~40-line script under
`spike/` that reads the produced binary STL and prints triangle count, bounding box, and
whether every edge is shared by exactly two triangles. It is throwaway on purpose: T02 and
T04 build the real, tested versions, and reusing spike code would smuggle untested arithmetic
into the core.

## Seatbelt — mandatory

**Every CAD invocation runs under a hard timeout, including in this spike.** A recursive or
unbounded CSG operation will otherwise take the machine, and `DESIGN.md §5.2` forbids running
the unbounded version to find something out. macOS has no `timeout(1)`; use Node:

```js
import { spawnSync } from 'node:child_process';
const r = spawnSync(cmd, args, { timeout: 60_000, killSignal: 'SIGKILL', encoding: 'utf8' });
```

60 s here rather than the project's 30 s, because a cold first run of an unfamiliar toolchain
is legitimately slow and this measurement is the point.

## Tests

This task produces no tests — it produces a decision. `npm test` does not exist yet; T01
creates it. Do not add a test file to make the session feel finished.

- [ ] Both candidates produce an STL, or the failure is recorded as the finding it is
- [ ] The bounding box of each STL is measured, not assumed, and compared against 40 x 30 x 25
- [ ] Watertightness of each STL is checked by edge pairing, not assumed
- [ ] Every row of the comparison table is filled in or explicitly marked "could not determine"

## Done when

- [ ] The comparison table is complete and both numbers in the bbox row were measured on this machine
- [ ] A recommendation with its reasoning has been given to the user **and the user has answered**
- [ ] `spike/` is deleted, `FINDINGS.md` has the table's conclusions, and `DESIGN.md §5` names the chosen binary and its exact install command

## Needs a person

Installing software system-wide is the user's, not the assistant's. Raise this **at the start
of the session** and wait — the whole task is blocked behind it. Ask for one at a time; do not
send both installs in one message and hope.

```
brew install --cask openscad@snapshot
```

Expect: a download of roughly 100–200 MB, then OpenSCAD in `/Applications`. Because it is a
snapshot build, macOS Gatekeeper may refuse it on first launch — if so, it is
System Settings → Privacy & Security → "Open Anyway".

Tell me: whether it completed, and what `openscad --version` prints.

Then, separately:

```
uv venv spike/.venv && uv pip install --python spike/.venv/bin/python build123d
```

Expect: a large download (200–400 MB of geometry-kernel wheels), a few minutes.

Tell me: whether it completed, and any error if not — a wheel that has no macOS arm64 build is
itself a decisive finding and would settle the spike on the spot.

**If the user declines the second install**, that is a legitimate and decisive answer: it means
a second runtime is unwelcome, OpenSCAD wins by default, and the finding is recorded as a
decision rather than as missing data.
