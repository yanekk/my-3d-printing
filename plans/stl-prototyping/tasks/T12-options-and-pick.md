# T12 — `model options`, `compare`, `pick` — and the delete seatbelt

**Phase:** 4 · **Depends on:** T09 · **Weight:** medium

## Goal

The comparison workflow the user asked for. Because they chose one recipe per model,
overwritten in place, there is normally no second version in the folder to compare against —
so comparison becomes a deliberate act: ask for two takes, look at both, promote one, throw the
other away.

This task contains **the only destructive command in the project**, and the delete is driven by
a slug that came out of a conversation. That makes the slug untrusted input and the seatbelt
the point of the task.

## Design sections this implements

`DESIGN.md` §2.7 in full, §2.1 (the `options/` layout), §5.2 (the `model pick` row).

## Files

```
shell/options.js           NEW
shell/cli.js               MODIFIED — three subcommands
test/options.test.js       NEW
```

## Interface

```
model options <slug> [--from model]
    Creates models/<slug>/options/{a,b}.<ext>, both seeded from the current model.<ext>
    (or from an empty stub if none exists). Refuses if options/ already exists — a
    silent overwrite here would destroy an in-progress comparison.

model compare <slug>
    Builds options/a and options/b into .build/<slug>/options/{a,b}.stl, prints both
    reports side by side with the deltas, and prints the compare URL.

model pick <slug> <a|b>
    Prints exactly what it is about to do, then: copies options/<choice>.<ext> over
    model.<ext>, deletes options/ entirely, and clears .build/<slug>/options/.
```

**The `model pick` seatbelt**, every clause of which is tested:

1. The slug goes through `validateSlug` before any path exists.
2. The directory to be deleted is resolved and must equal `models/{slug}/options` exactly —
   checked with `isInside` **and** by equality, not by string prefix.
3. It refuses if `options/` contains anything other than the files this project created — a
   recognised set of names and extensions. If the user put something in there, it is theirs.
4. It refuses if the chosen option file does not exist.
5. It prints the full list of files it will delete, then deletes.
6. It follows no symlinks. A symlinked `options/` is refused outright, because otherwise the
   delete lands wherever the link points.
7. The copy over `model.<ext>` happens **before** the delete. A crash between them leaves both
   the winner in place and the scratch directory — recoverable. The other order loses the
   winner.

`model compare`'s text output prints the two reports' headline numbers with signed deltas: per
axis size, volume, total support area, bed contact. Signed, because "b is 2 mm taller" is the
answer and "differs by 2 mm" is not.

## Tests

- [ ] `model options x` creates `a` and `b` seeded from `model.<ext>`, byte-identical to it
- [ ] `model options x` with no existing recipe seeds both from the stub
- [ ] `model options x` refuses when `options/` exists, exit 1, nothing modified
- [ ] `model compare x` builds both and prints signed per-axis deltas
- [ ] `model compare x` with only `a` present exits 1 naming the missing file
- [ ] `model pick x a` overwrites `model.<ext>` with `a`, byte-identical
- [ ] `model pick x a` removes `options/` entirely and clears `.build/x/options/`
- [ ] `model pick x c` exits 1 — only `a` or `b`
- [ ] `model pick x a` with no `options/` exits 1, nothing deleted
- [ ] `model pick ../evil a` is rejected by slug validation before any path is constructed
- [ ] `model pick x a` refuses when `options/` contains an unexpected file, exit 1, **nothing deleted**
- [ ] `model pick x a` refuses when `models/x/options` is a symlink, and the link target is untouched
- [ ] `model pick` prints the list of files it will delete before deleting
- [ ] Simulated crash between copy and delete (inject a throw): `model.<ext>` holds the winner and `options/` still exists
- [ ] After `pick`, `model check x` reports on the promoted recipe

## Done when

- [ ] Every refusal path leaves the filesystem untouched, asserted file by file
- [ ] The symlinked-`options/` case is refused and its target proven unmodified
- [ ] `options` → `compare` → `pick` works end to end against the fake toolchain
