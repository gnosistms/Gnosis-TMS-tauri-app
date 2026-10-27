# Update restart guard and check feedback: review follow-up

Branch: `fix/update-restart-guard-and-check-feedback` (off `main`, unpushed).

Context: a stalled "Sync with Server" run blocked "Restart to update" because the
pre-install guard refused on any active repo write. The branch narrowed that
guard, added feedback for skipped manual checks, added an update-check timeout,
and cleared the stale "Checking for updates..." badge when an install supersedes
a check. A code review of `main..HEAD` produced eight findings. This file records
the decision for each and the resulting work.

## Decisions

| # | Finding | Decision |
|---|---|---|
| 1 | Restart guard (`src-ui/main.js`) now checks `hasActiveLocalWrites`, which only counts editor writes. Project imports, creates, renames, deletes, rebuilds and purges default to the `repoMaintenance` bucket and no longer block the restart, so an in-flight import can be killed mid-commit. | **Fix now.** Block on every active repo operation except `remoteSync`. Add a snapshot flag for that and correct the guard comment. Tagging each project call site with an explicit local operation type is the cleaner long-term shape but touches a dozen files; leave it for its own change. |
| 2 | `update.timeout = None` in `src-tauri/src/updater.rs` is dead code. `tauri-plugin-updater` 2.10.0 hardcodes the update's timeout to `None`, so the builder timeout never reached downloads. The comment and commit message say otherwise. | **Fix now, rewrite the commit.** Remove the reset and the false comment. The branch is unpushed, so replace the commit rather than add a correction on top. |
| 3 | The 30 s timeout is per manifest request. The fallback loop can try up to 20 release tags, so a bad network can hold "checking" for ten minutes. | **Fix now, cheaply.** Bound the whole resolve inside `check_for_app_update` at 90 s with `tokio::time::timeout`, which the backend already depends on. Keep the per-request bound underneath. Do not rework the fallback loop here. |
| 4 | `skippedCheckMessage` says "is being installed" for the `preparing` status, where the pill says "Saving...". | **Fix now.** Return "Saving changes before installing" for `preparing`. |
| 5 | `supersedeUpdateCheck` duplicates the text-guarded badge clear in `ai-settings-flow.js`. | **Fix now.** Add `clearNoticeBadgeIfText(text, render)` to `status-feedback.js` and use it from both flows. Touching the AI settings file is slightly outside scope, but the branch introduced the second copy. |
| 6 | `supersedeUpdateCheck` renders the status surface, and all three callers do a full render right after. | **Fix now.** Drop the render argument; callers paint the cleared badge. |
| 7 | `checkingForUpdatesMessage()` is a wrapper returning a constant with one call site. | **Fix now.** Delete it and pass the constant. |
| 8 | The restart guard and the window-close guard disagree on whether a running remote sync is durable work. | **Do not unify now.** The divergence is justified: the close guard has a force-close escape, the restart guard has none. Record that reasoning in a comment on the close guard. Extract a shared predicate only when either guard next changes. |

## Work

Three commits on the branch, plus the rewritten Rust commit:

1. Guard: `hasActiveNonSyncWrites` snapshot flag, restart guard uses it, comment
   on the close guard (findings 1 and 8).
2. Rust: replace the timeout commit with one that drops the inert reset and adds
   the 90 s command-level bound (findings 2 and 3).
3. JS cleanups: shared `clearNoticeBadgeIfText`, no render argument on
   `supersedeUpdateCheck`, wrapper removed, `preparing` wording, tests
   (findings 4 through 7).

## Deferred

- Explicit `operationType` on project-level repo write call sites so the
  `repoMaintenance` catch-all only holds true maintenance.
- A shared "can the app safely terminate" predicate for the close and restart
  guards.
- Smarter fallback endpoint iteration in the update check.
