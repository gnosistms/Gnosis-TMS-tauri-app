# Sentry issue review — 2026-09-22

## Plan

1. Inventory unresolved issues, inspect recent resolved/archived issues for
   regressions, and examine event details and affected releases.
2. Trace reports through backend/frontend code and compare with published fixes.
3. Apply justified Sentry dispositions, read back the resulting state, and record
   evidence and remaining work.

Scope: `gnosis-tms/javascript`. Existing unrelated working-tree changes were
preserved. No credentials or raw event payloads are stored in the repository.

## Findings and applied dispositions

The unresolved inventory returned four groups, with no additional pages, including
an explicit January 1–September 23 query. The recent all-status inventory contained
25 groups. Detailed investigation covered the four unresolved groups plus the
recent store warning and already-resolved updater issue. Older dispositions were
cross-checked with the September 13 review; they were not all reinvestigated.
GitHub confirms v0.8.119 was published September 21 at 10:38:55 UTC.

| Issue | Disposition | Evidence and next action |
|---|---|---|
| [37](https://gnosis-tms.sentry.io/issues/7734748982/) | Keep open, high priority | All 63 events inspected: 54 on 0.8.110 and 9 on 0.8.115, two production installations. These are blocked row saves. The access gate maps multiple distinct failures to one message; the original cause is absent. Investigate safe error categories and access-refresh behavior. |
| [38](https://gnosis-tms.sentry.io/issues/7734762516/) | Keep open, high priority | One text-style save failure on 0.8.110; same access gate as 37. Keep both command fingerprints. |
| [39](https://gnosis-tms.sentry.io/issues/7737244832/) | Keep open, medium priority | One rejected initial push on 0.8.114. A matching failure path was reproduced using isolated Git repositories. Reconcile verified remote state and cover glossary/QA parity before resolving. |
| [3A](https://gnosis-tms.sentry.io/issues/7739116364/) | Archive until one additional event | One request transport failure on 0.8.116. The exact cause is unavailable. This is not a proven fix, nor evidence of quota/authentication/model errors. Reopen on recurrence and collect a scrubbed transport category. |
| [1Q](https://gnosis-tms.sentry.io/issues/7614666149/) | Retain archive at 10 events / 24 hours | Latest warning is a failed reload attempt, not merely a failed set. Nine recovery tests pass, including later-write retry; no evidence confirms loss or successful recovery for that particular session. |
| [3B](https://gnosis-tms.sentry.io/issues/7745553309/) | Retain existing resolved status | Fix `f4750c0e` / PR #334 shipped in 0.8.119. Last event at September 21 09:43:48 UTC predates release. Platform availability gating and compatible-version selection match the failure. |

None of the four initially unresolved groups has a verified shipped fix. No new
issue is being represented as fixed. The updater was already resolved before this
review; this review validates that decision.

## Code evidence

### Editor write access: 37 / 38

`src-tauri/src/installation_access.rs` refreshes a 60-second access snapshot before
content writes. Non-auth broker failures, missing session/access state, snapshot
persistence errors, and unverified membership can produce the same user-facing
message. `AUTH_REQUIRED:` is preserved for the frontend reauthentication path.
This code is byte-identical in the working checkout and v0.8.119. The recent
project-readiness fixes do not fix this gate. Do not suppress these reports as
ordinary permission denials or bypass authorization to make saves succeed.

### Glossary/QA sync: 39

`src-tauri/src/repo_resource_sync.rs::sync_editor_repo` passes the input's
`default_branch_head_oid` into `sync_repo`. `enforce_remote_app_version` fetches
remote state, but an empty input head still chooses `push -u origin main` without
rebase. Local commits can diverge from an existing remote even after the fetch.
The relevant code is unchanged in v0.8.119 and shared by glossaries and QA lists.

An isolated bare remote and two clones reproduced the rejected push after fetch.
Explicit pull/rebase then push preserved both disjoint local and remote changes.
This verifies a matching code path, not the original event's exact repository
history. A fix must handle verified empty remotes, stale descriptors, concurrent
remote advances, and conflicts without resets or force-pushes.

### AI transport: 3A

`src-tauri/src/ai/providers/openai.rs::normalize_transport_error` emits the exact
message from a failed reqwest send outside the timeout/connect-specific branches.
No HTTP error response or original transport category is included. The OpenAI API
Troubleshooting skill was used to classify the event; no provider credentials or
new OpenAI requests were needed.

## Verification

- Persistent-store tests: 9 passed, including failed reload retry and write/delete
  replay. These validate existing recovery behavior, not the reported session.
- Updater-flow tests: 38 passed against the existing working-tree changes. Shipped
  fix provenance was checked separately against `f4750c0e` and `v0.8.119`.
- Isolated Git reproduction: rejected push after fetch, then successful rebase/push
  with both sides' disjoint changes intact. Temporary repositories were removed.
- No application code was changed, committed, pushed, or released for this review.

## Live verification

All six issue notes were accepted with comment IDs, and all requested updates
succeeded. A fresh project inventory verified every status and priority, including
3A's one-additional-event condition and 1Q's existing 10-events/24-hour condition.
Exactly three issues remain unresolved: 37, 38, and 39. The first detailed
verification request timed out; the retried inventory read succeeded.

Temporary credentials and raw Sentry payloads were removed after verification.
Only this review document was added to the repository.
