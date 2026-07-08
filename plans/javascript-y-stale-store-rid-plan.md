# Plan — JAVASCRIPT-Y: recover from a stale store resource id, stop mis-reporting it as fatal

Sentry issue: **JAVASCRIPT-Y** · Branch: `JAVASCRIPT-Y-good-rid-dance` · PR: #160 (draft)

## 1. Problem (confirmed root cause)

The Sentry event is `level: fatal`, message-only (no exception, no stack),
`mechanism.handled: false`, browser SDK, no `culprit`. Its message is a bare
string of the exact form **`The resource id N is invalid.`** — the `Display`
of `tauri::Error::BadResourceId`, i.e. a **stale `tauri-plugin-store` resource
id**.

Two independent defects combine to produce it:

1. **Floating store writes** — `src-ui/app/persistent-store.js`.
   `writePersistentValue` / `removePersistentValue` fire the store mutation as
   `void store.set(...)` / `void store.delete(...)` with **no `.catch`**. The JS
   `store` handle wraps a numeric resource id in the Rust resource table. During
   a lifecycle race (app restart / shutdown / webview reload — e.g. the updater's
   `request_restart`) the rid goes stale, the mutation rejects with the bare
   `BadResourceId` string, and — because the promise is floated — it becomes an
   **unhandled promise rejection**.

2. **Fatal-classification inflation** — `src-ui/app/telemetry.js`. The
   `unhandledrejection` handler passes the *string* reason (not an `Error`) to
   `emitCrash`, whose non-`Error` branch hardcodes
   `captureMessage(..., "fatal")`. A benign, recoverable teardown hiccup is thus
   reported at the highest severity Sentry has, outranking genuine `Error`
   crashes. This is why it is the project's only `fatal`.

**Which change fixes the issue:** the store `.catch` + recovery (defect 1) is
what *resolves* JAVASCRIPT-Y. The telemetry `crashLevel` change (defect 2) would
**not** have prevented this event — only relabeled it — so it is defense-in-depth
for *other* non-`Error` rejections, not the fix.

## 2. Scope (verified complete)

- Only `set`/`delete` are floated. `entries()` is `await`ed inside
  `initializePersistentStorage` (`loadStoreSnapshot`), so the read path already
  propagates rejections normally.
- `persistent-store.js` is the **only** holder of the store handle; no other
  call site invokes store methods. No further call sites need changes.
- Per project rules this is a store/telemetry infrastructure change, not a
  glossary/QA resource capability — the Parity rule does not apply.

## 3. Design

### 3a. `persistent-store.js` — catch, recover, report (non-fatal)

New module state: `storeLoaderAvailable` (true in a Tauri env), a concurrency
guard `storeReloadPromise`, and an injected `reportStoreFailure`.

- `setPersistentStoreFailureReporter(reporter)` — dependency injection so the
  leaf store module stays telemetry-free. This **avoids a static import cycle**
  (`persistent-store → telemetry → telemetry-consent → persistent-store`).
- `isStaleResourceError(error)` — matches `/resource id\s+\d+\s+is invalid/i`
  against `error.message` **or** the bare string (the production reason is a
  string, not an `Error`).
- `reloadStoreHandle()` — re-acquires the loader and reloads the store file,
  reconnecting `store` to a fresh rid. It **does not** re-read the snapshot:
  `memoryState` is already authoritative and re-reading could clobber writes
  made during the reload window.
- `ensureStoreReloaded()` — concurrency-guarded wrapper. **Its inner IIFE
  catches** so a reload that itself rejects (most likely in the very teardown
  scenario that caused the stale rid) is routed through the non-fatal reporter
  instead of becoming a *new* unhandled rejection — which would otherwise be
  re-classified as fatal, recreating the bug we are fixing.
- `handleStoreWriteFailure(operation, error)` — on a stale error: set
  `store = null`, trigger `ensureStoreReloaded()`, and report `level: "warning"`
  with a stable fingerprint. On any other write error: report `warning` but keep
  the handle. **No immediate retry** of the failed write (per the chosen
  recovery semantics).
- Wrap the two writes: `void store.set(...).catch((e) => handleStoreWriteFailure("set", e))`
  and the same for `delete`.

**Split-brain guard.** When `store` is null but `storeLoaderAvailable` is true
(Tauri env, handle temporarily gone during reload), writes go **memory-only** —
*not* localStorage. Init reads the store file, not localStorage, so a
localStorage write here would be silently lost on the next restart. localStorage
fallback remains only when there is no loader at all (pure browser mode).

### 3b. `telemetry.js` — do not let a bare string outrank a real Error

Add `crashLevel(item)` returning `"error"` for `item.kind === "unhandledrejection"`
and `"fatal"` otherwise; use it in `emitCrash`'s non-`Error` branch in place of
the hardcoded `"fatal"`. Comment states the invariant so the next reader does not
"restore" fatal.

### 3c. `main.js` — wire the reporter

`setPersistentStoreFailureReporter(reportCommandFailure)` next to
`installTelemetryCrashHandlers()`. `reportCommandFailure` already supports
`level`, `fingerprint`, and merged `tags`, scrubs, and length-caps; it no-ops
until the consent gate opens, so early wiring is safe.

## 4. Accepted trade-offs

- **Dropped write is not retried.** A `set`/`delete` that rejects with a stale
  rid stays in `memoryState` only; it is not re-attempted. It reaches disk again
  the next time that key is written. This is the chosen "recover, no retry"
  behavior — the failure happens at teardown, when durable persistence of that
  one write is not important.
- **Writes during the reload window are memory-only** and, if the app is torn
  down before reload completes, are not persisted. Same rationale.
- **If the reload itself fails**, `store` stays null and subsequent writes are
  memory-only until the next app boot (which re-initializes cleanly). We do not
  loop retrying the reload, to avoid a reload storm during shutdown.
- **Reconnect assumes `load()` re-allocates a live handle.** `tauri-plugin-store`
  2.4.2's `load` command adds a fresh entry to the Rust resource table per call,
  so re-invoking it after a rid goes stale normally yields a new valid rid and the
  next write reconnects. If instead `load()` were to hand back a still-stale handle
  (e.g. mid-teardown), the design degrades gracefully: each subsequent write
  re-catches, re-nulls, and re-reloads, emitting repeated `warning` reports with no
  persistence — but **never a fatal crash**, since every rejection is caught. The
  fatal event (JAVASCRIPT-Y) is fixed regardless; reconnect is the secondary benefit.

## 5. Tests (`persistent-store.test.js`)

- **Recovery + non-fatal report:** a fake Tauri store whose `set` rejects with a
  bare `"The resource id N is invalid."` string → assert the reporter is called
  once with `level: "warning"` and a stable `fingerprint`, exactly one reload
  occurs, and the next write lands on the fresh handle.
- **Failing-reload path (regression guard for the self-inflicted bug):** stale
  `set` **and** a loader that rejects on the second `load()` → assert **exactly two**
  reports (the stale write, then the failed reload), **zero** `unhandledRejection`
  events on `process`, and every report is `warning`.
- **Delete-path recovery:** a fake Tauri store whose `delete` rejects with a bare
  stale-resource-id string → assert the reporter is called once with `level: "warning"`
  and a stable `fingerprint`, exactly one reload occurs, and the next delete lands on the
  fresh handle. Mirrors the `set` recovery test so a dropped `.catch` on `delete` cannot
  regress silently (both writes are floated identically).
- Existing browser-mode round-trip tests must continue to pass (localStorage
  fallback unchanged when no loader exists).

## 6. Verification

- `npm test`
- pre-commit hooks (eslint / clippy / shellcheck) clean
- No unrelated files touched; `graphify-out/` left untracked and uncommitted.
