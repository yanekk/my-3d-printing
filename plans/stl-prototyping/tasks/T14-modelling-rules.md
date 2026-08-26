# T14 — `MODELLING.md`: the rules Claude works by

**Phase:** 4 · **Depends on:** T00, T09, T13 · **Weight:** medium

## Goal

Write down how Claude models a part, so that the recipes it produces are printable on this
user's printer, legible six months later, and consistent between sessions. This is the
project's answer to *"how do I write rules so the generated objects are 3D-printable?"*

It is prose, not code — and it is deliberately last, because a document describing a loop that
nobody has run is a document full of guesses. By now the loop has been used, T00 has settled
the language, and the report's actual wording exists to point at.

**These are rules for the assistant. Rules for the program live in `DESIGN.md`.** Keeping the
two apart is what stops either becoming a dumping ground.

## Design sections this implements

`DESIGN.md` §2.9, §2.2 (the header), §8 (the thin-wall limitation must be restated here, in
the place a modelling session will actually read).

## Files

```
MODELLING.md               NEW — repository root
CLAUDE.md                  MODIFIED — one pointer line, nothing more
```

Touching `CLAUDE.md` is normally out of bounds for an implementing session. The exception is
authorised here and is exactly one line adding the pointer — anything more is a conversation
with the user.

## Contents

Each section carries its reason, the same rule `DESIGN.md` follows, because a modelling rule
with no reason gets abandoned the first time it is inconvenient.

**1. The loop.** `model new` → write the recipe → `model check` → read the report to the user
in plain English → point at the preview. Never hand over a mesh without having read its report.

**2. The header.** All six directives, filled in properly, every time. `@expect bbox` is the
mechanism that catches a wrong dimension, and a recipe without it has silently opted out of the
only automatic check on its measurements.

**3. Parameters at the top, always.** Every dimension a named constant, grouped, with a unit
comment, above the geometry. The user reads these and nothing else — this is the entire reason
recipes are the artifact rather than meshes. A magic number buried in the body is invisible to
them and therefore unreviewable.

**4. Clearances and fits**, as a table with the number and when to use it:

| Fit | Gap | Use |
|---|---|---|
| M3 clearance hole | ⌀3.4 mm | a screw passing through |
| M3 tapped into plastic | ⌀2.5 mm | self-tapping into PLA |
| M3 heat-set insert | ⌀4.0 mm | check the insert's own spec |
| M3 nut trap, across flats | 5.6 mm + 0.2 | captive nut |
| Free / sliding fit | +0.4 mm on the hole | parts that must move |
| Snug / press fit | +0.15 mm | parts that stay put |
| Clearance between printed mating parts | 0.2–0.3 mm | this printer, this nozzle |

Holes print undersize on an FDM machine because of the corner-cutting of the toolpath and
elephant's foot on the first layers — so a nominal hole is always a wrong hole. State that,
because it is the single most common reason a printed part does not fit.

**5. Minimum feature sizes for a 0.4 mm nozzle.** Wall ≥ 0.86 mm for two perimeters; ≥ 1.2 mm
for anything load-bearing; embossed or engraved detail ≥ 0.8 mm wide and ≥ 0.4 mm deep or it
will not resolve. **And immediately after: the report does not check wall thickness** — that
needs a slicer, which is out of scope — so this is the assistant's responsibility and nothing
will catch a breach of it. Say that plainly.

**6. PLA versus PETG on this printer.** PLA: stiffer, sharper detail, bridges cleanly, creeps
in a hot car, snaps rather than bends. PETG: tougher, better layer adhesion, more heat
tolerance, strings, needs more clearance on mating parts, worse on fine detail and overhangs.
The direct-drive hotend handles both, and 300 °C means PETG is comfortable. Choose PLA unless
the part needs toughness or heat, and say which was chosen and why in `NOTES.md`.

**7. Supports and orientation.** The user prints with supports willingly. The job is to say
where they will land, not to avoid them — but say it *before* they print, and state the
intended orientation in `@orientation` every time. Note what the report cannot know: which
faces should look good, which way the layers run relative to the load, and that layer adhesion
is the weak axis, so a part should be oriented with its load across layers rather than along
them.

**8. Bed adhesion.** Bigger footprint sticks better; a tall part on a small base will be
knocked over by the toolhead — this printer is fast. `LOW_BED_CONTACT` in the report is the
warning; a brim is the usual answer and it is the user's slicer setting, not something this
project can add.

**9. `NOTES.md` per model.** What the part is for, what it mates with, what was tried and
rejected. It is the only place intent survives, since the recipe is overwritten in place.

**10. What to do when the report disagrees with you.** Read it aloud, say what you think it
means, and let the user decide. Never quietly change the geometry to make a warning go away —
that is how a part that was right becomes a part that passes.

## Tests

Prose has no unit tests. What can be checked, must be:

- [ ] Every number in the clearance table also appears in `core/machine.js` where one exists there, and the two do not disagree — assert by parsing both
- [ ] `MODELLING.md`'s stated minimum wall matches `machine.minWallMm` and `preferredMinWallMm`
- [ ] `CLAUDE.md` contains exactly one pointer to `MODELLING.md`
- [ ] Every command shown in `MODELLING.md` is a subcommand the CLI actually implements — assert by parsing the CLI's dispatch table

That last one is the check that stops the document rotting: a documented command that does not
exist is worse than no documentation.

## Done when

- [ ] `MODELLING.md` exists with all ten sections, each rule carrying its reason
- [ ] The numbers in it are asserted against `core/machine.js` by a test, not by eye
- [ ] `CLAUDE.md` has exactly one new line pointing at it, and nothing else changed
