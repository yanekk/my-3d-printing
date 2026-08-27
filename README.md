# stl-prototyping

A conversational loop for prototyping small 3D-printable parts. You describe a part in plain
language; Claude writes a short parametric **recipe** — a page of readable OpenSCAD source
with the dimensions named at the top; a command turns that recipe into a mesh and checks it
for printability; a browser page shows the result. The recipe is what this repository stores,
because an STL is an unindexed list of triangles with no parameters, no units and no intent —
it is a good build product and a bad artifact. Meshes are regenerated on demand into a
gitignored `.build/` cache that is safe to delete at any time.

Run the tests with `npm test`. There is nothing to install first: the project has **zero
runtime dependencies** and uses Node's built-in test runner, so the suite works on a fresh
checkout with no `npm install`. Two rules are enforced by tests rather than by convention.
`test/boundary.test.js` reads every file under `core/` as text and fails the build if any of
it reaches for the filesystem, the network, a child process, the clock or a random number —
if it fires, the fix is to move the code into `shell/`, never to relax the test. And every
model name is validated before a path is built from it, because promoting an option deletes a
directory and the name came out of a conversation.

The plan lives in `plans/stl-prototyping/`. Start with `DESIGN.md` — it carries the reason
behind every rule here, the printer profile and build volume, the seatbelts on anything that
spawns a process or deletes a file, and what is deliberately out of scope. `PROGRESS.md` is
the task queue and the handoff between working sessions, and `FINDINGS.md` is what the build
has taught so far, including everything that was verified by hand rather than by a test. The
rules Claude follows when writing a recipe will land in `MODELLING.md` at the end of the
build.
