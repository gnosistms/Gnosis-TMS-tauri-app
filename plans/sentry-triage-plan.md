# Sentry Triage Plan — June 2026 backlog

Status: proposed
Scope: the 22 unresolved issues in `gnosis-tms/javascript` (14-day window, pulled 2026-06-10).

## Snapshot

- 3 production installs are reporting (`7decf01a`, `76a10247`, `68b66082`) plus the
  dev machine (`b70c912b`, `environment: development`).
- The two `fatal` issues are both the window-close ACL block. The fix
  (`9cfcf56c Allow window.destroy so the close button works`) exists **only on local
  `main`** — not pushed, not in any release tag. Production users on ≤0.8.32 will keep
  hitting it until a release ships.
- Over half the event volume is *expected operational failures* (offline, GitHub 5xx,
  update-required, permission denials) reported at `error` level by the blanket
  `invoke()` reporter in `runtime.js`. These need code-side filtering, not Sentry-side
  muting, or they will keep regenerating.

## Triage table

| Issue | Title (root cause) | Events | Verdict |
|---|---|---|---|
| JAVASCRIPT-C, -P | `window.destroy` blocked by ACL (fatal) | 14 | **Fix shipped → release** (W1) |
| JAVASCRIPT-1 | `purge_local_gtms_glossary_repo`: repo "not available yet" | 54 | **Fix in code** — purge of a never-cloned repo should be a no-op success (W3) |
| JAVASCRIPT-D | `APP_UPDATE_REQUIRED` (user on 0.8.26, needs 0.8.30) | 12 | **Silence in code** — expected control flow, handled by `updater-flow.js` (W2) |
| JAVASCRIPT-3 | Broker unreachable (network) | 18 | **Silence in code** — classify via `classifySyncError` → `connection_unavailable`, skip (W2) |
| JAVASCRIPT-7, -8, -6 | GitHub API 502/504 | 5 | **Downgrade** to warning w/ stable fingerprint; archive-until-escalating in Sentry (W2/W5) |
| JAVASCRIPT-4 | `git fetch` connection reset | 1 | **Silence in code** — connectivity (W2) |
| JAVASCRIPT-B, -9 | `CancelledError` (TanStack `cancelQueries` rejection caught by crash capture) | 2 | **Silence in code** — ignore in crash/unhandledrejection capture (W2) |
| JAVASCRIPT-N, -K | `git push`: write access not granted | 2 | **Silence in code** as error; surface as warning tagged `permission-denied` (W2). Check UI gating. |
| JAVASCRIPT-M | QA-list upsert: "account type cannot manage shared resources" | 3 | **Investigate UI gating** — if `permissions.js` capability gating worked, this command would never fire (W4) |
| JAVASCRIPT-H → -J → -G | `git clone` of team-metadata failed → dir left without `manifest.json` → "not available yet" cascade | 4 | **Fix in code** — clean up partial clone state; one root failure, three issues (W4) |
| JAVASCRIPT-F | `git pull --ff-only`: untracked working-tree files would be overwritten | 2 | **Fix in code** — sync must handle untracked files (W4) |
| JAVASCRIPT-2 | `git pull --ff-only` (no ref): "Cannot fast-forward to multiple branches" | 2 | **Fix in code** — always pull explicit `origin <branch>` (W4) |
| JAVASCRIPT-A | Conflicted chapter metadata: unsupported local-only changes | 1 | **Investigate** — real conflict-resolution edge case, dev only so far (W4) |
| JAVASCRIPT-E | `propertyRepositoryKey is not defined` | 3 | **Resolve in Sentry** — already fixed (identifier gone from codebase; events were dev @0.8.29) |
| JAVASCRIPT-5 | `repo_write_overdue` watchdog (warning) | 1 | **Working as intended** — review the flagged repo, then archive |

## Workstreams (priority order)

### W1 — Ship the window-close fix (highest urgency, fatal in production)

1. Push local `main` (contains `9cfcf56c`) to `origin/main`. Note the standing rule:
   broker deploys only happen from pushed main, and unpushed main already bit us once.
2. Land the in-flight `feat/editor-close-guard-feedback` branch (force-close escape
   hatch) and cut release 0.8.33.
3. Before release: retest close latency in a release build (see deferred close-latency
   note — >1s close after the allow-destroy fix; if still slow, scope the close guard
   to the translate screen).
4. In Sentry, mark JAVASCRIPT-C and JAVASCRIPT-P **"Resolved in next release"** so they
   reopen only if a regression appears in ≥0.8.33.

### W2 — Stop reporting expected operational failures (kills ~45 events/2wk)

All changes in `src-ui/app/runtime.js` (`maybeReportCommandFailure`) and
`src-ui/app/telemetry.js`, following the existing `AUTH_REQUIRED:` skip pattern:

1. Skip `APP_UPDATE_REQUIRED:` prefixed errors (already parsed as control flow by
   `sync-error.js` / `updater-flow.js`).
2. Skip errors classified `connection_unavailable` by `classifySyncError` (broker
   unreachable, connection reset, DNS, offline).
3. Downgrade GitHub 5xx (`GitHub API 50x:`) to `level: warning` with a stable
   fingerprint per command (strip the HTML body — it's useless in the message anyway).
4. Downgrade remote permission denials (`Write access to repository not granted`,
   `cannot manage shared resources`) to warning, tagged `reason: permission-denied`.
5. In the crash/unhandledrejection capture path in `telemetry.js`, ignore
   `CancelledError` (TanStack query cancellation is routine, not a crash). Also chase
   the unawaited `cancelQueries(...)` rejection if cheap to find.
6. Tests: extend `runtime`/`telemetry` unit tests for each skip/downgrade rule.

### W3 — Make purge of a missing repo a no-op (kills 54 events/2wk)

- Rust: in the repo-resource purge path (`repo_resource_storage.rs`), treat "local
  repo not available yet" as success for purge commands — purging something that never
  existed achieved its goal.
- **Parity:** apply to both glossary and QA-list purge commands.
- Then resolve JAVASCRIPT-1 in Sentry.

### W4 — Real bugs to investigate (correctness, lower volume)

1. **Partial team-metadata clone cleanup** (JAVASCRIPT-H/J/G, install 76a10247,
   installation 126873770): `ensure_local_team_metadata_repo` must remove the target
   dir on clone failure so retries start clean instead of cascading
   "missing manifest.json" / "not available yet" errors.
2. **Untracked files block `git pull --ff-only`** (JAVASCRIPT-F): decide stash/clean
   policy for the team-metadata sync working tree.
3. **`git pull --ff-only` without explicit ref** (JAVASCRIPT-2): one call site pulls
   without `origin main` and dies with "Cannot fast-forward to multiple branches" —
   find it in `src-tauri` git code and pin the refspec.
4. **UI gating gap** (JAVASCRIPT-M): a viewer-type account reached
   `upsert_local_gnosis_qa_list_metadata_record`. Verify the QA-list edit action is
   capability-gated via `permissions.js` (and check glossary parity).
5. **Chapter conflict edge case** (JAVASCRIPT-A): "unsupported local-only changes
   remain after applying the supported chapter merge" — reproduce from the dev event,
   decide whether the conflict path needs a manual-resolution fallback.

### W5 — Sentry-side actions (after W1–W3 land)

- Resolve: JAVASCRIPT-E (fixed), JAVASCRIPT-1 (after W3), JAVASCRIPT-C/-P
  ("in next release", after W1).
- Archive **until escalating**: JAVASCRIPT-3, -4, -6, -7, -8 (transient network — W2
  prevents new events; archiving handles stragglers from old versions).
- Archive after review: JAVASCRIPT-5 (watchdog did its job once).
- Leave open: JAVASCRIPT-2, -A, -F, -H/-J/-G, -M, -D, -N/-K until their workstream lands.

### W6 — Telemetry quality follow-ups (nice to have)

1. **Truncation cuts off the diagnosis**: `COMMAND_ERROR_MAX_LENGTH` truncates messages
   before the failure reason (e.g. the clone failure reason in JAVASCRIPT-H is lost
   even in Sentry). Keep head + tail of the message instead of head only, or raise the
   cap for `command-failure` events.
2. **Dev noise**: the dev machine reports into the same project. Either set the default
   issue stream/alert filters to `environment:production` in Sentry, or gate dev
   telemetry behind an explicit opt-in env var.
3. **Alerting**: once the noise filters land, add a Sentry alert rule for new `fatal`
   issues and for `command-failure` issues affecting >1 install.

## Expected outcome

W1–W3 remove ~80% of current event volume and both fatals. What remains in the stream
afterward is the genuinely actionable W4 list, and new issues become signal again.
