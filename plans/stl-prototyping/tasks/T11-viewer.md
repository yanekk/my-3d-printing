# T11 — The 3D viewer page

**Phase:** 3 · **Depends on:** T10, T07 · **Weight:** heavy

## Goal

The page the user actually looks at: the model, spinnable, on a 10 mm grid, with its size in
millimetres and its drooping faces shaded by how badly they droop. Everything it displays has
already been computed and proven in Phase 1 — so if a number on this page is wrong, the bug is
in this page.

**This is the first task in the plan that cannot be finished by tests.** It ends by handing the
user a command and waiting.

## Design sections this implements

`DESIGN.md` §2.6 in full, §2.5 (the band colours must match the report's legend), §5 (three.js
is the only dev dependency, vendored).

## Files

```
preview/index.html          NEW
preview/viewer.js           NEW
preview/style.css           NEW
preview/vendor/             NEW — committed copies of three.module.js, STLLoader.js,
                                  OrbitControls.js. npm-installed once, files copied,
                                  node_modules NOT committed.
package.json                MODIFIED — three as a devDependency
test/vendor.test.js         NEW
```

**Vendoring is not optional** (`DESIGN.md §5`): the preview must work with no network, and a
CDN link would also make the page dependent on a service outliving the project. `npm install
three`, copy the three files, commit the copies, and record the version in a comment at the top
of each. `test/vendor.test.js` asserts the files exist, are non-empty, and that no file under
`preview/` contains an `http://` or `https://` URL in a `src`, `href` or `import` — which is
the check that stops a future session quietly reaching for a CDN.

## Interface

```
GET /              the viewer
GET /?model=slug   opens straight to a model
```

Layout: a full-height 3D canvas, a slim left rail listing models from `/api/models`, and a
collapsible report panel on the right rendering `/api/model/{slug}`.

**Required, in order of how much they matter:**

1. **A 10 mm grid with a heavier line every 100 mm, on the Z=0 plane, always visible.** This
   is a requirement, not decoration (`DESIGN.md §2.6`). The most common LLM modelling error is
   an order-of-magnitude mistake, and a part standing on a known-size grid makes a 10× error
   obvious in about a second, before any number is read. The model sits with its **minimum Z on
   the grid plane**, the way it will sit on the bed.
2. **A live bounding-box readout in mm**, always on screen, one decimal place.
3. **Overhang shading by band**, using per-vertex colours on the loaded geometry. The bands and
   their colours must match the report's legend exactly, and the legend must be on the page —
   a colour with no key is decoration. Colours must be distinguishable by someone with common
   colour blindness: do not use a red/green pair to separate `steep` from `severe`.
4. **Orbit, pan, zoom**, plus a "frame it" key that returns to a known view. A viewer you can
   get lost in is a viewer with a reset.
5. **Live reload over the `/live` websocket**, re-fetching the mesh and the report while
   **preserving the camera**. The camera lives in the page and is never reset by a reload —
   the whole value of the loop is watching one thing change from a fixed viewpoint.
6. **A bed outline** at 220 × 220, so "does it fit" is visible as well as stated.
7. **The `gone` message** when the model is deleted, keeping the last camera rather than
   blanking.

Normals are **recomputed in the page from winding**, exactly as `core/mesh.js` does, and the
STL's stored normals are ignored. Using them would make the shading disagree with the report
for precisely the meshes where it matters.

## Tests

Automated tests here can only cover what is not visual, and they must not be dressed up as
more than that:

- [ ] `test/vendor.test.js`: the three vendored files exist and are non-empty
- [ ] `test/vendor.test.js`: no file under `preview/` references an external URL
- [ ] `GET /` returns 200 and its HTML references only relative paths
- [ ] Every `src`/`href`/`import` in `preview/*.html` and `preview/*.js` resolves to a file that exists
- [ ] The band colour table in `preview/viewer.js` matches `core/machine.js`'s bands one for one (assert by parsing both — this is the drift that silently makes the legend lie)

**Everything that matters about this task is in the section below.** Do not add a test that
asserts a canvas exists and call the task verified.

## Done when

- [ ] `npm test` passes, including the vendor and colour-table checks
- [ ] The user has confirmed the page renders, orbits, and shows the grid and the shading legibly
- [ ] The user has confirmed a rebuild refreshes the model **without moving the camera**

## Needs a person

I cannot see a screen. Raise this **as soon as the page loads at all** and wait for the answer;
do not finish the session with it outstanding.

```
model preview --open
```

Then, in the conversation, ask Claude to change one dimension of the open model and watch.

Expect: a browser tab at `http://127.0.0.1:7373`. A model standing on a grid of 10 mm squares
with a heavier line every 100 mm. Dragging spins it. A size readout in millimetres. Faces that
hang over shaded, with a key naming each colour.

Tell me:
1. Does the grid read instantly as a scale — could you tell a 40 mm part from a 400 mm one at a glance, without reading a number?
2. Are the overhang colours distinguishable from each other, and does the key make sense without explanation?
3. When the model rebuilds, does the view stay exactly where you left it?
4. Anything that looks wrong, cramped, or that you expected to be there and is not.

Stop the server with Ctrl-C. It holds nothing; if it will not die,
`lsof -ti :7373 | xargs kill`.
