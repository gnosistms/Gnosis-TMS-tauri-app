# Sentry issue resolution — 2026-09-13

## Scope

Resolve the eight unresolved groups found in the 90-day review, plus the three
recent archived groups checked during that review. Preserve unrelated work.
User authorized both code fixes and live Sentry dispositions. Credentials stay
out of files, commits, reports, and Sentry comments.

## Plan

1. Refresh event evidence and verify release provenance for existing fixes.
2. Reproduce search-index contention in the Rust persistence layer and add a
   bounded recovery strategy without blocking reads or losing indexing work.
3. Investigate the Git multiple-branch rebase failure with isolated repositories;
   fix a demonstrated defect or retain a documented investigation disposition.
4. Prevent browser fixtures from reporting synthetic errors, and classify exact
   expected validation failures without hiding unknown failures.
5. Verify glossary fixes, persistent-store recovery, and AI batch fallbacks with
   focused regression tests; run broader checks for changed code.
6. Apply issue-specific Sentry comments and statuses: existing verified fixes are
   resolved; new product fixes use next-release resolution if Sentry can represent
   it accurately, otherwise stay open pending release; expected/recovered conditions
   are archived with an appropriate escalation policy. Read back all statuses and
   record evidence and any remaining release gates here.

## Inventory

| Group | Issue ID | Initial assessment |
|---|---|---|
| 1A | 7595074731 | Archived production search-index lock failure; investigate/fix |
| 30 | 7711573103 | Production Git rebase failure; investigate |
| 36 | 7729075690 | Browser fixture telemetry; fix test isolation |
| 33 | 7720854888 | Missing glossary repository identity; verify #311/#312 |
| 34 | 7720871230 | Glossary deletion context; verify #311 |
| 35 | 7720874359 | Expected duplicate validation; feedback fixed in #311 |
| 1Q | 7614666149 | Recovered persistent-store handle warning |
| 32 | 7714994004 | Translation batch missing rows; retry/fallback |
| 2Z | 7704108770 | Review batch missing rows; fallback |
| 2G | 7681585058 | Archived expected team-access rejection |
| 31 | 7713179194 | Archived invalid import header validation |

The previous chat summary linked 1A to an incorrect ID. The ID above is verified
from Sentry's API and is the one used for all actions.

## Code results

Branch: `codex/sentry-resolution-2026-09-13`, based on the existing local 0.8.110
release preparation. The latest published release verified through GitHub is
0.8.109; these fixes have not been pushed, merged, or released.

- `9e59009b` — Search refreshes reserve the SQLite writer before reading indexed
  state, coordinate across connections/processes, use per-repo savepoints, and
  commit stale removals and the completion marker atomically. Lock waiting is
  bounded at 30 seconds. WAL readers retain access to the committed index.
  An isolated old-policy reproduction fails after five seconds; a real Rust
  contention test now succeeds after a competing writer holds its lock for six
  seconds. Failure/rollback and subsequent retry, plus full/incremental nested
  refreshes, are covered. Holds exceeding 30 seconds still return a real error;
  this does not suppress indexing failures or claim indefinite recovery.
- `b8cbdd7e` — Classify exact expected glossary validation and XLSX language-header
  rejection at the existing command telemetry boundary. QA empty-term validation
  has parity. The UI still receives the original errors; missing records,
  malformed stored data, and unexpected import failures still report.
- `19b24c2e` — All ten browser suites share a context fixture that fulfills Sentry
  requests locally before page startup. This works even with a reused Vite server
  containing the real DSN and tests that accept telemetry disclosure. Production
  telemetry is unchanged. The exact synthetic read-failure test passes and adds
  no Sentry events.

## Sentry dispositions

An explanatory note was added to every reviewed group. API results were read back;
the issue-specific conditions, not merely HTTP success, were inspected.

| Group | Disposition | Evidence / follow-up |
|---|---|---|
| [1A](https://gnosis-tms.sentry.io/issues/7595074731/) | **Open, high priority; fix committed, release pending** | `9e59009b` must be merged and shipped, then resolve in that actual release. Sentry returned `inRelease: gnosis-tms@0.8.109` for both next-release request forms, including after clearing previous state. Reopened to avoid falsely marking 0.8.109 fixed; corrected its note. |
| [33](https://gnosis-tms.sentry.io/issues/7720854888/) | Resolved in 0.8.108 | #311/#312 preserve complete repository identity; current regression tests pass; all 14 reports predate this release. |
| [34](https://gnosis-tms.sentry.io/issues/7720871230/) | Resolved in 0.8.108 | #311 fixes deletion context/filtered state; relevant tests pass. The single event does not identify the exact subcase; a recurrence remains reportable. |
| [36](https://gnosis-tms.sentry.io/issues/7729075690/) | Resolved | Test transport fix `19b24c2e`; no app release required for the browser harness. |
| [35](https://gnosis-tms.sentry.io/issues/7720874359/) | Archived until escalating | Expected duplicate validation; feedback fixed in #311, telemetry classification in `b8cbdd7e`. |
| [1Q](https://gnosis-tms.sentry.io/issues/7614666149/) | Archived until 10 events / 24 hours | Already-recovered store-handle warning; replay, retry, deletion and late-rejection tests pass. No proof of settings loss. |
| [32](https://gnosis-tms.sentry.io/issues/7714994004/) | Archived until 10 events / 24 hours | Provider omits batch rows; current retry and single-row fallback tests pass. Terminal errors remain reportable. |
| [2Z](https://gnosis-tms.sentry.io/issues/7704108770/) | Archived until 10 events / 24 hours | Missing review rows use a tested single-row fallback; warning alone does not establish failed review. |
| [30](https://gnosis-tms.sentry.io/issues/7711573103/) | Archived until **one additional event** | Root cause unproven; explicitly not marked fixed. See Git investigation below. |
| [2G](https://gnosis-tms.sentry.io/issues/7681585058/) | Archived until 5 events / 24 hours | Expected access-verification rejection. Owning background reconciliation catches rejections; current AI tests pass. Bare event lacks originating caller, so no claim of a complete unhandled-rejection fix. |
| [31](https://gnosis-tms.sentry.io/issues/7713179194/) | Archived until escalating | Expected invalid XLSX header; narrow telemetry rule in `b8cbdd7e`, with input validation unchanged. |

## Git investigation

The single September 4 event on 0.8.99 contains `Cannot rebase onto multiple
branches`. An isolated repository with two configured upstream merge refs
reproduces this message using implicit `git pull --rebase`. The current app's
explicit `git pull --rebase origin main` succeeds against the same fixture.
Both app sync entry points already hold the same per-repo, in-process mutex.
The event does not prove a competing-process/FETCH_HEAD race or repository
configuration cause. No speculative Git recovery/reset was introduced.

One more event reopens this group. On recurrence inspect scrubbed branch/ref
counts and concurrent app processes. Preserve local work; do not reset/delete
the repository to hide the symptom.

## Verification

- 240 focused frontend tests passed, including existing glossary, store, AI
  fallback/provider tests and the new telemetry rules.
- Full frontend suite: 2,170 passed; workflow suite: 23 passed.
- Full Rust suite: 679 passed, 5 intentionally ignored. The focused search suite
  passed 24 tests with one ignored local-corpus calibration test.
- Strict Clippy, changed-file ESLint, Rust formatting, whitespace checks, and
  Vite production build passed.
- Unused-code audit unchanged: 3 unused files, 5 existing unresolved fixture
  imports, 1 unused export.
- The targeted browser failed-refresh/retry regression passed in installed Chrome.
  The Playwright browser cache was incomplete, so a temporary config selected
  Chrome without changing the checked-in browser configuration.
- Full browser suite: 149 passed, 1 skipped, 2 failed. The grouped review-update
  style/footnote test also fails with the original test from `6e6d07a6` and Sentry
  disabled, consistent with the prior August review. A second footnote-formatting
  failure involved a detached row during a click; it passes in isolation with
  both the new fixture and the original test. These editor-test issues were not
  changed as part of this Sentry work. Temporary baseline test files were removed.

Final live read-back found exactly one unresolved group in the 90-day inventory:
1A, deliberately open pending release. All eleven reviewed groups match the
dispositions above (3 resolved, 7 archived, 1 open). The fixture issue still has
12 events and its last-seen time remains 2026-09-13 06:56:59 UTC.

Localhost-dependent workflow/Rust/browser tests were rerun with network sandbox
permission after their initial loopback binding failures. No unrelated product
fixes were made. The pre-existing AI audit plan and a concurrent edit to
`src-tauri/src/project_import/chapter_editor/pdf_export.rs` remain untouched.

## Pull request follow-up

The user subsequently authorized including the existing `pdf_export.rs` change
and opening and merging one combined pull request.

1. Verify the PDF blockquote italics change with the existing PDF export tests and
   formatting/lint checks, and commit it separately.
2. Compare against the current remote default branch so the PR includes only the
   Sentry resolution work, this PDF change, and their audit notes.
3. Open the PR with the completed validation and known browser-test limitations;
   inspect CI/review results, address relevant failures, and merge after checks.
4. Verify the merge. The search Sentry issue remains open until the merged fix is
   actually released; merging alone does not satisfy that release gate.

The user then authorized completing the paused 0.8.110 release after this PR
lands. The earlier release task stopped before creating a tag or publishing;
remote verification confirms 0.8.109 is latest and v0.8.110 does not exist.
Reuse its prepared version metadata in a separate release PR after the fixes
merge, expand the release notes, verify CI, tag the merged release commit, and
verify all platform artifacts before resolving search issue 1A in that release.

PDF verification: all 30 existing PDF export tests passed. Rustfmt normalized
only the changed match arm; actual PDF rendering was not separately verified.
