# Sentry Unresolved-Issue Cleanup — 2026-07-08

**Org / project:** `gnosis-tms` / `javascript` (id 4511502532149248) — only project in the org.
**Scope:** all 27 unresolved issues as of 2026-07-08. Drive each to one of: *resolve
(already fixed)*, *resolve (stale/expected)*, *investigate*, *fix*, or *mute (dev noise)*.
**Related:** [[sentry-project-reference]], [`sentry-triage-plan.md`](sentry-triage-plan.md)
(June batch, W-series noise rules), [`sentry-sensitive-issues-1C-1F-plan.md`](sentry-sensitive-issues-1C-1F-plan.md)
(1C–1F, fixed in PR #168).

> **Signal caveat (applies throughout):** every issue shows `users=0` because
> `sentry.setUser(install_id)` is not wired yet. User counts are meaningless — use the
> `install_id` **tag** to tell production from dev. `b70c912b…` = Hans's dev machine
> (dev noise). `68b66082…`, `76a10247…` = real production installs.

---

## Access / mechanics

Token already in `~/.sentry-token` (chmod 600, revoke after). REST base `https://sentry.io/api/0/`.

- **Resolve one issue:** `PUT /issues/{id}/` body `{"status":"resolved"}`. To resolve *in
  the next release* (so it reopens only if seen again after the fix ships):
  `{"status":"resolved","statusDetails":{"inNextRelease":true}}` — or `inRelease:"gnosis-tms@X"`.
- **Ignore/mute (dev noise):** `PUT /issues/{id}/` body `{"status":"ignored"}`.
- **Bulk:** `PUT /projects/gnosis-tms/javascript/issues/?id=..&id=..` with the same body,
  or `?query=...` to match a set. **Confirm the matched set first with a GET** before any bulk PUT.
- Short ID → group id: `GET /organizations/gnosis-tms/shortids/JAVASCRIPT-XX/` → `groupId`.
  (Shell note: don't name the variable `GID`/`UID` in zsh — they're read-only specials.)

---

## Disposition table (all 27)

| Short ID | Title (abbrev) | Env / release / install | Cnt | Action |
|----------|----------------|-------------------------|-----|--------|
| **1C** | DOCX zip-bomb DoS | nightly-bug-hunter | 2 | **Resolve in release** once PR #168 ships |
| **1D** | TXT no row cap DoS | nightly-bug-hunter | 1 | **Resolve in release** once PR #168 ships |
| **1E** | backup strands HEAD (history overwrite) | nightly-bug-hunter | 1 | **Resolve in release** once PR #168 ships |
| **1F** | AI-secret clear/save race | nightly-bug-hunter | 1 | **Resolve in release** once PR #168 ships |
| **14** | git log filename too long (Win os err 206) | prod / 0.8.52 / 68b66082 | 4 | **Resolve** — fixed in v0.8.53 (large-chapter argv fix) |
| **15** | git log filename too long | prod / 0.8.52 | 1 | **Resolve** — fixed in v0.8.53 |
| **16** | git log filename too long | prod / 0.8.52 | 1 | **Resolve** — fixed in v0.8.53 |
| **5** | `repo_write_overdue: repoMaintenance` | **prod / 0.8.59 / 68b66082** | **84** | **INVESTIGATE (top)** — live, current release, high volume |
| **17** | `repo_write_overdue: remoteSync` | prod? | 1 | Investigate with #5 (same family) |
| **Z** | `repo_write_overdue: localEditorWrite` | prod? | 1 | Investigate with #5 (same family) |
| **1B** | chapter linked glossaries not a JSON object | **dev / 0.8.54 / b70c912b** | 5 | Investigate (low) → maybe defensive parse guard; **mute dev** meanwhile |
| **1A** | search index: database is locked | **dev / 0.8.52 / b70c912b** | 2 | Mute dev; note as SQLite-lock watch item |
| **A** | conflicted chapter metadata: unsupported local-only changes | dev (June memory) | 1 | Investigate (low) — known chapter-conflict edge (W6.1) |
| **Y** | **fatal**: resource id 2907636421 invalid | prod / 0.8.38 / 68b66082 | 1 | Investigate briefly (only fatal) → then resolve if stale |
| **R** | git push: write access not granted | prod / 0.8.30 / 76a10247 | 9 | **Resolve stale** — already downgraded to warning by classifier (permission-denied); events predate the rule |
| **12** | AUTH_REQUIRED: session expired | old | 1 | **Resolve stale** — classifier now skips `auth_required:` |
| **18** | git pull: SSL_ERROR_SYSCALL | old | 1 | **Resolve stale** — classifier skips `connection_unavailable` |
| **19** | git fetch: HTTP2 framing layer | old | 1 | **Resolve stale** — classifier skips `connection_unavailable` |
| **10** | glossary git pull --rebase failed | old | 1 | **Resolve stale** — transient/network |
| **W** | team-metadata git pull --ff-only failed | old | 1 | **Resolve stale** — transient/network |
| **11** | glossary sync: local repo has uncommitted changes | ? | 1 | Investigate (low) — could be a real state bug; else resolve |
| **X** | `team-metadata.sync: best_effort_pull_failed` | ? | 1 | **Fix reporting** — "best_effort" by name shouldn't report as issue; then resolve |
| **13** | run_ai_assistant_turn: no source text yet | ? | 1 | **Fix reporting** — validation/expected; add skip rule; resolve |
| **Q** | preflight: OpenAI API key rejected | ? | 1 | **Fix reporting** — expected (bad key); add skip rule; resolve |
| **T** | read_local_dropped_file: not a file | ? | 1 | **Fix reporting** — user dropped a folder; validation; skip rule; resolve |
| **S** | upload image: not a valid supported image | ? | 1 | **Fix reporting** — validation; skip rule; resolve |

> Env/install for the `?`-marked rows is unconfirmed — **verify each with
> `events/latest/` during execution** before resolving, in case one is live on 0.8.59.

---

## Phase A — Resolve the already-fixed (fast, no code)

1. **Windows long-path (14, 15, 16):** confirm no event on ≥0.8.53, then
   `PUT status=resolved` (plain resolve; the fix already shipped). If any event is ≥0.8.53,
   reopen the large-chapter investigation instead.
2. **1C–1F:** resolve **in the fixing release** (`inRelease: gnosis-tms@<next>`) once the
   PR #168 release is cut — not before, so they reopen if the fix regresses. Tracked in the
   1C–1F plan; this plan just notes the dependency.

## Phase B — Resolve the stale / already-classified noise

For each of **R, 12, 18, 19, 10, W** (and any `?`-row confirmed as old-release + expected):
1. Verify latest event is from a release **older** than the current one AND that the
   `resolveCommandFailureReport` classifier already skips/downgrades that message (it does
   for `auth_required:`, `connection_unavailable`, and "write access … not granted").
2. `PUT status=resolved`. They reopen only if seen again on a current release — which the
   classifier should now prevent (Phase D adds the gaps).

## Phase C — Investigate

1. **`repo_write_overdue` family (5, 17, Z) — priority.** Emitted from
   [`repo-write-queue.js:363`](../src-ui/app/repo-write-queue.js) as an operational signal
   (not a command failure), warning level. 84 events on a real prod install on the current
   release means a queued repo write is repeatedly exceeding its "overdue" threshold.
   - Read the overdue detection in `repo-write-queue.js` + `write-intent-coordinator.js`:
     what threshold marks a write overdue, and is the write eventually completing or truly stuck?
   - Pull several `5` events (`GET /issues/{gid}/events/`) and compare `extra`/`contexts`
     (which repo, queue depth, wait time, whether it later succeeded).
   - Decide: (a) real stuck write → **fix** the queue/sync path; or (b) threshold too tight
     / expected on slow networks → tune the threshold and/or downgrade-not-report, or report
     once per session under a stable fingerprint instead of per occurrence.
2. **JAVASCRIPT-Y (fatal, invalid resource id):** only fatal in the list, but old (0.8.38),
   single event. Grep the "resource id … is invalid" string, judge if still reachable on
   current code; if not, resolve as stale.
3. **JAVASCRIPT-A / 11 / 1B (low):** A = known chapter-conflict edge (see June W6.1); 11 =
   glossary "uncommitted changes" state; 1B = malformed glossary-links JSON (dev). For each,
   decide fix-vs-resolve after a quick read. 1B/1A are dev-install — mute now, fix only if
   the parse/lock path is genuinely fragile.

## Phase D — Fix reporting gaps (code) + resolve

Extend the pure classifier `resolveCommandFailureReport` in
[`runtime.js`](../src-ui/app/runtime.js) so expected/validation failures are skipped or
downgraded, with unit tests (the function is deliberately pure and unit-tested):
- **Skip** clear validation / expected-input failures: no source text yet (13), dropped
  item not a file (T), unsupported image (S). These are user-input problems the UI already
  surfaces — not defects.
- **Downgrade or skip** bad-credential (Q, "API key rejected") — expected when a user's key
  is wrong; downgrade to warning under a stable fingerprint, or skip.
- **`best_effort_pull_failed` (X):** stop reporting a best-effort pull as an issue — handle
  at the `team-metadata-flow.js` emit site (don't route to telemetry, or report as warning
  once).
- **`repo_write_overdue` (5):** apply the Phase C decision (tune threshold / fingerprint /
  downgrade) here.
- After each rule lands and the release ships, `PUT status=resolved` on the matching issues.

Follow the project telemetry rule: report a stable operation name + scrubbed message; never
report expected control flow (cancellation, offline, auth expiry, permission denial,
validation, conflict). Parity: if a rule applies to project sync, check glossary/QA sync too.

## Phase E — Mute dev-machine noise

For **1B, 1A** (and any other confirmed `environment: development` / install `b70c912b`):
`PUT status=ignored`. They are Hans's own dev events, not product signal. (Do the underlying
fix only if Phase C flags the code path as genuinely fragile.)

## Phase F — Prevention

1. **Wire `sentry.setUser({ id: install_id })`** in `telemetry.js` so `userCount` becomes
   meaningful and per-install alerting is possible (deferred in June as W6.3). Small, high
   leverage — turns "84 events / 0 users" into "84 events / 1 install".
2. **Confirm server-side data-scrubbing** is on (defence in depth; 1F's body was already
   `[Filtered]`, so scrubbing appears active — verify the settings).
3. **Tests** for every new skip/downgrade branch in `resolveCommandFailureReport`.
4. Consider an **environment filter** so `development` events don't count against the
   unresolved stream at all (inbound filter or an ignore-by-tag saved search).

---

## Execution order

1. **Phase A + B** (mark resolved: 14/15/16 + R/12/18/19/10/W) — pure API, immediate,
   biggest cleanup for least effort. ~11 issues cleared.
2. **Phase E** (mute 1B/1A dev noise) — API, immediate.
3. **Phase C** (investigate `repo_write_overdue` family, Y, A/11) — the real product work.
4. **Phase D** (classifier fixes + tests, one PR) → ship → resolve 13/T/S/Q/X + any #5 fix.
5. **1C–1F** resolve-in-release when PR #168 ships (owned by the other plan).
6. **Phase F** (setUser + scrubbing + env filter) — one small PR; do alongside D.

**Definition of done:** unresolved stream contains only genuinely-open, current-release,
production issues; every resolved item either shipped a fix or is provably stale/expected;
dev noise muted; classifier closes the reporting gaps so the resolved ones don't reopen.

## Open questions for Hans

1. `repo_write_overdue` on your prod install (68b66082) — is that your other machine or a
   real teammate? Changes how urgent #5 is.
2. OK to `setUser(install_id)` (Phase F1)? It attaches the install UUID to events — you
   declined per-install alerting in June; this is the prerequisite if you've changed your mind.
3. Resolve stale items outright, or `ignore` them (so a recurrence is silent rather than
   reopening the issue)? Plan assumes **resolve** so regressions resurface.

---

## Execution status (2026-07-08)

**Code work — DONE, shipped in PR #170 (`chore/sentry-telemetry-noise-cleanup`):**
- Phase C: investigated. JAVASCRIPT-5 `repo_write_overdue` is operational noise (one issue
  accreting events, not a crash) → **fixed** by reporting once per operation type per
  session. JAVASCRIPT-Y (`resource id invalid`) is already handled by `isStaleResourceError`
  → stale.
- Phase D: classifier now skips expected validation failures (no-source-text / non-file /
  unsupported-image / rejected-API-key) and the best-effort team-metadata pull no longer
  reports. Tests added (1654 pass).
- Phase F1: `sentry.setUser({ id: install_id })` wired so user counts become meaningful.

**API status changes (Phase A/B/E) — BLOCKED on token scope.**
The pasted token is **read-only**: `PUT /issues/{id}/` returns `403 You do not have
permission`. Resolving/ignoring requires the `event:write` scope. Hans confirmed the
disposition (resolve 11 / ignore 9) — execute once a write-scoped token is available, or
do it in the Sentry UI. Confirmed dispositions:
- **Resolve:** 14, 15, 16, 19, 18, 10, 11, R, S, Q, Y
- **Ignore (dev install b70c912b):** 1B, 1A, 13, 12, X, W, V, T, A
- **Resolve after PR #170 ships (in-release):** 5, 17, Z (repo_write_overdue family)
- **Resolve after PR #168 ships (in-release):** 1C, 1D, 1E, 1F

**Still open (Phase F, optional):** confirm server-side data-scrubbing settings; consider an
inbound filter for `environment:development` so dev events never hit the stream.

---

## COMPLETE (2026-07-08)

Write-scoped token provided; all 27 issues dispositioned via API. **Unresolved stream = 0.**
- Resolved in `gnosis-tms@0.8.61`: 1C, 1D, 1E, 1F, 5, 17, Z (reopen only if seen on ≥0.8.61).
- Resolved (stale/fixed): 14, 15, 16, 19, 18, 10, 11, R, S, Q, Y.
- Ignored (dev machine b70c912b): 1B, 1A, 13, 12, X, W, V, T, A.

Code shipped in PRs #168 + #170, both merged; release 0.8.61 tagged and building. Optional
Phase F leftovers (verify server-side scrubbing settings; inbound `development` env filter)
remain nice-to-have. Token to be revoked.
