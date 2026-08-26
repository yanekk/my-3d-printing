# T13 — The side-by-side comparison view

**Phase:** 4 · **Depends on:** T11, T12 · **Weight:** heavy

## Goal

Two models on screen at once, at the same angle and the same scale, with the numbers that
differ and the line of the recipe that changed. This is the feature the user named in their
first sentence, and its whole value is in one design decision: **shared scale**.

**Needs the user's eyes.** It ends by handing them a command and waiting.

## Design sections this implements

`DESIGN.md` §2.8 in full, §2.7.

## Files

```
preview/compare.html       NEW
preview/compare.js         NEW
preview/diff.js            NEW — line diff, no dependency
core/textdiff.js           NEW — the diff algorithm, pure and tested
test/textdiff.test.js      NEW
shell/server.js            MODIFIED — /api/compare/{slug}
```

The diff algorithm goes in `core/` because it is pure arithmetic on strings and therefore
exhaustively testable; `preview/diff.js` only renders its output. Putting it in the page would
put the only interesting logic in the one place with no test coverage.

## Interface

```
GET /compare?model=slug      the two options for one model
```

```js
// GET /api/compare/{slug} ->
{
  slug,
  a: { report: Report, recipeText: string },
  b: { report: Report, recipeText: string },
  deltas: {
    sizeMm: [number, number, number],       // b - a, signed, per axis
    volumeMm3: number,
    supportAreaMm2: number,
    bedContactAreaMm2: number,
    triangleCount: number
  },
  recipeDiff: DiffLine[]
}

// core/textdiff.js
/** @typedef {{ kind: 'same'|'add'|'remove', a?: number, b?: number, text: string }} DiffLine */
export function diffLines(aText, bText)   // LCS-based; deterministic
```

**Both models are framed to the larger of the two bounding boxes and share one camera.** Moving
one moves the other. Normalising each to fill its own viewport is the obvious implementation
and it is **wrong** (`DESIGN.md §2.8`): it hides size differences, which is frequently the
entire thing being compared. Two objects that differ only in scale must look different here.

Also required:

- The **same 10 mm grid** under both, for the same reason as T11.
- A **synchronised camera toggle**, defaulting to on. Off lets the user inspect one closely
  without losing the other's framing.
- The **deltas panel** with signed numbers and the direction spelled out in words: "b is 2.0 mm
  taller", not "Δz +2.0".
- The **recipe diff** with changed lines highlighted, and a jump from a changed line to nothing
  clever — this is a text panel, not an editor.
- **Pick buttons are not in this page.** Promotion is `model pick`, a command with a seatbelt
  and a printed confirmation (T12). A one-click destructive control in a browser page, next to
  a camera you are dragging, is how the wrong option gets promoted.

## Tests

- [ ] `diffLines` on identical text: all `same`
- [ ] `diffLines` on a one-line change: one `remove`, one `add`, the rest `same`
- [ ] `diffLines` with an inserted line: one `add`, no `remove`
- [ ] `diffLines` with a deleted line: one `remove`, no `add`
- [ ] `diffLines` on empty vs non-empty, and both empty
- [ ] `diffLines` line numbers are correct on both sides across an insertion
- [ ] `diffLines` is deterministic across runs and symmetric in the sense that swapping inputs swaps `add`/`remove`
- [ ] `diffLines` on two 2 000-line inputs completes in well under a second
- [ ] `GET /api/compare/{slug}` returns both reports and signed deltas; a 20 mm cube vs a 40 mm cube gives `sizeMm: [20,20,20]`
- [ ] `GET /api/compare/{slug}` with no `options/` returns 404 with a message, not 500
- [ ] `GET /compare` returns 200 and references only relative paths
- [ ] Every `src`/`href`/`import` in `compare.html` resolves to a file that exists

## Done when

- [ ] `npm test` passes, including the diff tests
- [ ] The user has confirmed both models appear at the same scale and that a size difference is visibly a size difference
- [ ] The user has confirmed the deltas and the recipe diff say what changed without needing explanation

## Needs a person

I cannot see a screen. Raise this as soon as the page loads and wait.

Set up two deliberately different options first, so the shared-scale decision is actually
exercised — one clearly larger than the other, not two near-identical ones:

```
model options demo-part
# edit options/a and options/b so that b is roughly twice the size of a
model compare demo-part
model preview --open
```

Then open `http://127.0.0.1:7373/compare?model=demo-part`.

Expect: both parts side by side on the same grid, at the same scale, so the larger one looks
larger. Dragging one spins both. A panel of numbers saying how they differ, and the recipe
lines that changed.

Tell me:
1. Does the size difference read immediately, without checking the numbers?
2. Does spinning them together help, or would you rather they moved independently by default?
3. Do the difference numbers say what changed in words you would use?
4. Anything missing that you would want before choosing between two real parts.
