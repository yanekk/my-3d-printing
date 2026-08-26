# T10 — Preview server: loopback, watcher, live reload

**Phase:** 3 · **Depends on:** T09 · **Weight:** medium

## Goal

The machinery behind the self-refreshing page. A static server on loopback, a watcher over
`models/` and `.build/`, and a websocket that tells the page to re-fetch. The page itself is
T11; this task must be finishable and testable with no browser involved, which is why the two
are split.

The user chose a page that updates itself as they talk, accepting a background process. This
task is where that process gets its bounds.

## Design sections this implements

`DESIGN.md` §2.6, §2.10 (port-collision and model-deleted rows), §5.2 (bind and document-root
seatbelts).

## Files

```
shell/server.js            NEW
shell/watch.js             NEW
test/server.test.js        NEW
test/watch.test.js         NEW
```

## Interface

```
model preview [--port 7373] [--open]
    Starts the server, prints the URL, and blocks until Ctrl-C.
    --open asks the OS to open the browser.
```

```js
// shell/server.js
export async function startServer({ port = 7373, root = repoRoot() })
// -> { url, close(): Promise<void>, port }

// HTTP:
//   GET /                      -> preview/index.html
//   GET /compare               -> preview/compare.html   (T13 fills it in)
//   GET /api/models            -> ModelSummary[]         (from shell/library)
//   GET /api/model/{slug}      -> the Report object      (built if stale)
//   GET /mesh/{slug}.stl       -> the built binary STL, Content-Type model/stl
//   GET /preview/*             -> static files from preview/, including vendor/
//   WS  /live                  -> { type: 'reload', slug } | { type: 'gone', slug }
```

```js
// shell/watch.js
export function watchModels({ onChange }) // -> { close() }
// Watches models/ and .build/ recursively. Debounces 150 ms — editors write in bursts and
// an undebounced watcher fires four times per save, which is four rebuilds.
```

Seatbelt requirements:

- **Binds to `127.0.0.1` only**, never `0.0.0.0`. This serves the repository's contents with no
  authentication; it must not be reachable from the network. The bind address is not an option.
- **Fixed port, hard failure on collision.** If 7373 is taken, print the port, suggest
  `lsof -ti :7373 | xargs kill`, and exit 1. **Do not silently pick another port**
  (`DESIGN.md §2.10`): a relocated server leaves the user's open tab pointing at a stale or
  dead one, with no signal that anything is wrong. Failing loudly is kinder than succeeding
  quietly in the wrong place.
- **Every requested path is resolved and checked against the document root**, and anything
  resolving outside it is a 403 — before any file is opened. `%2e%2e%2f`, absolute paths,
  symlinks and backslashes are all covered by tests, because "we validate the slug" is not a
  defence for a static file server that also serves `preview/`.
- **The server holds no state.** Killing and restarting it must lose nothing. That is what makes
  the recovery instruction in `DESIGN.md §6` a one-liner.
- **It exits with its terminal.** No daemonising, no pid file, no auto-restart. A background
  process the user cannot see is a background process the user cannot stop.

On a change under `models/{slug}/`, the watcher triggers a rebuild for that slug and then
broadcasts `reload`. On a deletion, it broadcasts `gone` — the page then shows "model no longer
exists" and keeps the camera, rather than blanking, which looks like a crash.

## Tests

*(all with a real server on an ephemeral port injected via the `port` option; no browser)*

- [ ] The server starts, `GET /` returns 200 and HTML
- [ ] `GET /api/models` returns JSON matching `listModels()`
- [ ] `GET /api/model/{slug}` returns a `Report` with `reportVersion: 1`
- [ ] `GET /mesh/{slug}.stl` returns the bytes of the built STL with `Content-Type: model/stl`
- [ ] `GET /mesh/{unknown}.stl` returns 404, not 500
- [ ] `GET /api/model/../../etc/passwd` returns 403 or 404 — never file contents
- [ ] `GET /preview/../../CLAUDE.md` returns 403
- [ ] `GET /preview/%2e%2e%2f%2e%2e%2fCLAUDE.md` returns 403 (encoded traversal)
- [ ] A symlink inside `preview/` pointing outside the root is refused
- [ ] Starting a second server on the same port exits 1 with the port in the message, and **does not** bind elsewhere
- [ ] The server binds to `127.0.0.1`; a connection attempt to a non-loopback local address is refused
- [ ] A websocket client receives `reload` with the right slug within 500 ms of a recipe write
- [ ] Four writes in 100 ms produce **one** reload, not four (debounce)
- [ ] Deleting a model folder broadcasts `gone`
- [ ] `close()` releases the port — a second server starts immediately afterwards
- [ ] `close()` disconnects websocket clients cleanly and the process exits with no open handles

## Done when

- [ ] Every traversal test returns 403/404 and never file contents
- [ ] A port collision exits 1 rather than relocating
- [ ] `close()` leaves no open handle — the test process exits on its own
