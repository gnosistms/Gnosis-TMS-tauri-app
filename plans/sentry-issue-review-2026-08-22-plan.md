# Sentry Issue Review and Action Plan — 2026-08-22

## Status

Implemented locally; release and live Sentry disposition are pending. This document
records a read-only review of every unresolved issue in the
Sentry organization `gnosis-tms`, project `javascript`, using the query
`is:unresolved` on 2026-08-22. No Sentry issue statuses were changed during the
review.

Inventory completeness: 17 unresolved groups returned in one page; Sentry reported
no next page. The set contains 9 `new`, 2 `regressed`, and 6 `ongoing` groups. Sixteen
are errors and one is a warning.

## Implementation status — 2026-08-22

- W1: the editor payload fix was already present on `main` in `af607e42`. The existing
  wire-contract unit coverage and both focused browser regressions pass. It is still
  unreleased because the current package version remains 0.8.90.
- W2: the Rust repository probe now distinguishes a non-repository from a folder that
  contains `.git` but cannot be inspected by Git. Consequential project, glossary, and
  QA-list reader failures are filtered while the root ensure/sync failure remains
  reportable. The shared sync promise also observes rejection immediately, preventing
  the root string from surfacing a second time as a bare unhandled rejection. Rust and
  frontend coverage pass. The existing macOS release bundle contains the
  packaged Git runtime and passes strict code-sign verification; a fresh packaged
  build and the Windows release path remain release gates.
- W3: rate-limit, quota, authentication, and temporary team-access outcomes now have
  explicit handling. Expected user-action control flow is suppressed while unknown
  provider errors remain reportable. The owner-flow rejection catch that prevents
  duplicate access reporting was already shipped in 0.8.89 by `16f7cc79`.
- W4: the missing macOS/network transport strings are classified as transient
  connectivity failures with exact-message tests.
- W5: expected repository-name validation is handled consistently for project,
  glossary, and QA-list creation, while unrelated 422 responses remain reportable.
- W6: no live Sentry status was changed. Release-aware resolution and archive actions
  remain gated on shipping and the post-release query.

Verification completed locally: 61 focused JS tests passed; `npm test` passed with
1,951 frontend tests and 13 workflow tests; all 11 targeted team-metadata Rust tests
passed; the full Rust suite passed with 582 passed and 2 ignored; both focused browser
regressions passed. The full browser suite finished with 125 passed, 1 skipped, and 1
unrelated existing failure in the grouped review-update style/footnote-note test. The
failure reproduces in isolation and is outside the files and behavior changed by this
plan.

## Goal

Turn the current Sentry backlog into a small, trustworthy stream of actionable
product defects. For every issue group:

1. identify the root cause and whether the app or an external system owns it;
2. fix product defects and missing error classification in the correct layer;
3. verify fixes against the exact reported messages and affected releases;
4. apply a deliberate Sentry disposition only after the matching verification gate;
5. avoid deleting local data or hiding failures that still need engineering work.

## Guardrails

- Do not commit, log, paste into a plan, or otherwise persist a Sentry access token.
  Rotate the token supplied for this review after the work is complete because it was
  shared in conversation text.
- Keep document/translation content, GitHub identity, full local paths, and secrets out
  of telemetry. Tests should use synthetic paths and payloads.
- Preserve the local-first contract: provider, broker, GitHub, and network failures
  must not block local reading or editing.
- Do not auto-delete or overwrite a non-empty `team-metadata` directory. Diagnose the
  Git runtime separately from repository corruption; quarantine/reclone is acceptable
  only with an explicit, recoverable design.
- A failed Tauri command is already reported at the `runtime.js` boundary. Do not add
  duplicate capture calls at individual invoke sites.
- Keep glossary and QA-list behavior in parity, including repository-create validation
  and telemetry classification.
- Use stable error categories/codes where practical instead of matching long provider
  or GitHub response bodies.

## Current inventory and proposed disposition

| Cluster | Sentry groups | Evidence | Verdict | Planned disposition |
|---|---|---|---|---|
| Editor replace payload | [JAVASCRIPT-2Q](https://gnosis-tms.sentry.io/issues/7684869563/) | 7 events, local release-build install, `gnosis-tms@0.8.90`; `update_gtms_editor_row_fields_batch` received an array where Rust expected a string | Product bug, already fixed on `main` by `af607e42` after the 0.8.90 tag: replace-selected footnotes are serialized for the wire contract | Verify Replace Selected on rows whose search match is in a footnote, ship the next release, then resolve in the next release |
| Team-metadata bootstrap cascade | [JAVASCRIPT-2N](https://gnosis-tms.sentry.io/issues/7682441578/), [JAVASCRIPT-2M](https://gnosis-tms.sentry.io/issues/7682441574/), [JAVASCRIPT-2P](https://gnosis-tms.sentry.io/issues/7682441651/), [JAVASCRIPT-G](https://gnosis-tms.sentry.io/issues/7541557198/), [JAVASCRIPT-25](https://gnosis-tms.sentry.io/issues/7633527300/) | 12 events in one local install on 0.8.89; primary message says a non-empty folder was not a Git repo, then project/glossary readers emitted “not available yet”; the same local folder is now a valid repo with `.git` and `manifest.json` | One primary bootstrap/runtime failure plus four secondary reports. `repo_has_git_dir` currently collapses every Git execution failure into “not a git repo”, so a missing/broken bundled Git runtime can be misdiagnosed as repository corruption | Keep primary groups open through diagnosis. Improve failure classification and suppress secondary read cascades; resolve cascade groups only after a clean release-build bootstrap test |
| Expected AI/provider/access failures | [JAVASCRIPT-2F](https://gnosis-tms.sentry.io/issues/7680923228/), [JAVASCRIPT-2J](https://gnosis-tms.sentry.io/issues/7682188878/), [JAVASCRIPT-2K](https://gnosis-tms.sentry.io/issues/7682194375/), [JAVASCRIPT-2G](https://gnosis-tms.sentry.io/issues/7681585058/), [JAVASCRIPT-2H](https://gnosis-tms.sentry.io/issues/7681585121/) | Rate limiting, exhausted OpenAI credits, and temporarily unverified team access; 2G and 2H occurred at the same instant and represent the same failure through two capture paths | Expected, user-visible control flow rather than app defects; duplicate capture makes the access failure look like two defects | Add centralized skip/classification rules and eliminate the unhandled/command duplicate. Verify UI feedback remains intact, then archive the five groups |
| GitHub/network transport | [JAVASCRIPT-2B](https://gnosis-tms.sentry.io/issues/7659093790/), [JAVASCRIPT-2C](https://gnosis-tms.sentry.io/issues/7662268306/), [JAVASCRIPT-2D](https://gnosis-tms.sentry.io/issues/7662310028/), [JAVASCRIPT-2E](https://gnosis-tms.sentry.io/issues/7662339936/), [JAVASCRIPT-1G](https://gnosis-tms.sentry.io/issues/7602405874/) | Single-event Git failures: no route to host, cannot assign requested address, HTTP/2 framing failure, plus one GitHub API 503 warning | External/transient. HTTP/2 classification is already fixed by `49b94b68`; the other two OS transport strings are still missing from `CONNECTION_PATTERNS`; the 503 is already reduced to a warning with stable grouping | Add exact transport classifiers/tests, verify no functional error is swallowed, resolve 2E as already fixed, and archive 2B/2C/2D/1G until escalating |
| Repository-create validation | [JAVASCRIPT-2A](https://gnosis-tms.sentry.io/issues/7652580421/) | 3 development events on 0.8.85 from `create_gnosis_glossary_repo`, GitHub API 422 repository-name validation | Expected validation reported because `runtime.js` only skips the equivalent project-create case; glossary and QA parity is missing | Introduce a stable create-conflict category or extend the existing rule to project/glossary/QA commands, test parity, then archive the group |

## Workstreams

### W1 — Verify and release the editor replace fix (highest priority)

1. Confirm that `af607e42` is the only post-0.8.90 change required for
   JAVASCRIPT-2Q. Review both batch calls in `replaceSelectedEditorRows`: the dirty-row
   reset and the replacement write must serialize footnotes from the editor's array
   representation to the Rust command's `BTreeMap<String, String>` representation.
2. Add or retain a focused unit assertion that the payload passed to
   `update_gtms_editor_row_fields_batch` contains strings for every `footnotes` map
   value, including a replacement whose search match is inside a footnote.
3. Exercise the browser flow: edit a footnote, select a search match, run Replace,
   confirm both reset and replacement commits succeed, reload the chapter, and verify
   text/footnotes remain correct.
4. Run the editor write-guard/unit suite and the focused browser regression suite.
5. Ship the next app release. Mark JAVASCRIPT-2Q “resolved in next release” so any
   event from that version or later reopens it.

Acceptance gate: no IPC deserialization error, the replacement is durable after
reload, and Sentry remains quiet for this signature on the new release.

### W2 — Diagnose team-metadata bootstrap without risking local data

1. Establish the primary failure before changing repair behavior:
   - reproduce with a valid `.git` directory while the bundled Git executable is
     unavailable or fails to launch;
   - reproduce with a genuinely non-Git, non-empty destination;
   - reproduce concurrent project/glossary/QA discovery during bootstrap.
2. Refactor the boolean `repo_has_git_dir` probe in
   `src-tauri/src/team_metadata_local/repo.rs` so it distinguishes at least:
   valid repository, valid-looking repository but Git execution unavailable, and
   non-repository directory. Preserve the underlying scrubbed Git-runtime error.
3. Confirm the macOS release guard from `4cb94937` runs on the exact release build
   path and inspect the produced bundle for the required Git runtime, not only the
   source archive. Add an artifact-level smoke check if the current guard can pass
   while packaging still omits or cannot execute Git.
4. Keep a non-empty unknown directory untouched. If recovery is needed, design a
   recoverable quarantine-and-reclone operation with an explicit old-path reference;
   never call `remove_dir_all` on unknown contents.
5. Prevent one failed `ensure`/`sync` from generating separate project, glossary, and
   QA-list “not available yet” command-failure issues. Discovery may degrade to cached
   snapshots, but the original bootstrap failure must remain observable once.
6. Add Rust tests for probe classification and safe directory handling, plus frontend
   discovery tests that assert one root failure does not create per-resource telemetry
   cascades.
7. Validate from a clean install and an upgrade install in a signed macOS release
   build. Also run the relevant Windows path because Git-runtime selection differs.

Acceptance gate: a valid repo is never labeled corrupt merely because Git cannot
launch; unknown non-empty data is preserved; concurrent discovery emits one actionable
root signal; bootstrap succeeds in packaged macOS and Windows builds.

Sentry action after the gate: resolve JAVASCRIPT-2N/2M/2P together as the primary
cluster and JAVASCRIPT-G/25 as consequential duplicates. Reopen on the next release.

### W3 — Classify expected AI failures and remove duplicate capture

1. Add a small AI failure classifier (or reuse `ai-provider-error.js`) with stable
   categories for provider rate limiting, provider quota/credits exhausted, provider
   authentication, and temporarily unverified team access.
2. In `resolveCommandFailureReport`, skip the rate-limit, quota, and unverified-access
   categories because the initiating flows already display actionable UI. Keep unknown
   provider failures reportable.
3. Trace JAVASCRIPT-2G/2H through `load_team_ai_provider_cache`. Ensure a rejection
   reported by the command boundary cannot also be emitted as a bare unhandled message.
   Prefer catching the promise at the owning flow; do not globally suppress unrelated
   unhandled rejections.
4. Verify each UI path still communicates the correct recovery:
   wait/retry for rate limit, add credits for quota exhaustion, refresh team access for
   unverified access, and update the key for authentication failure.
5. Extend `runtime-command-failure-report.test.js` and the AI flow tests with the exact
   Sentry messages. Assert no event is sent and no raw provider response is included.

Acceptance gate: each expected condition produces one useful UI outcome and zero Sentry
issues, while an unknown AI backend failure still reports once.

Sentry action after the gate: archive JAVASCRIPT-2F/2J/2K/2G/2H. Use “until
escalating” only for rate limiting if continued volume is operationally useful.

### W4 — Complete transient network classification

1. Add the exact lower-cased patterns `no route to host` and
   `can't assign requested address` (plus the platform-equivalent apostrophe variant if
   needed) to the centralized sync connection classifier.
2. Cover the full JAVASCRIPT-2B/2C/2D messages in `sync-error.test.js` and assert source
   `github` plus type `connection_unavailable`.
3. Confirm callers continue to surface offline/sync state and retry normally. The
   telemetry skip must not turn a failed push into a reported success or discard a
   queued write.
4. Retain GitHub 5xx warning aggregation for outage counting, but use Sentry’s
   archive-until-escalating state so a lone upstream 503 does not stay in the defect
   backlog.

Acceptance gate: the exact transport messages are classified as connectivity failures,
queued work remains pending/retryable, and genuinely local Git failures still report.

Sentry action: resolve JAVASCRIPT-2E against the already-shipped classifier release;
archive JAVASCRIPT-2B/2C/2D and warning JAVASCRIPT-1G until escalating after the new
patterns ship.

### W5 — Make repository-create validation consistent

1. Prefer converting GitHub's repository-name collision/validation response to a
   stable backend error code that does not depend on a truncated JSON body. If that is
   too broad for this pass, centralize the existing exact message predicate.
2. Apply the same expected-create-conflict rule to
   `create_gnosis_project_repo`, `create_gnosis_glossary_repo`, and
   `create_gnosis_qa_list_repo`.
3. Verify the create flows keep their current retry/recovery behavior and display the
   name-conflict message. Do not suppress unrelated 422 responses such as malformed
   repository payloads or permission/configuration defects.
4. Add parity tests covering all three resource types and a negative test for an
   unexpected 422.

Acceptance gate: name collisions are user-visible but absent from Sentry for all three
resource kinds; unexpected 422 errors still report.

Sentry action after the gate: archive JAVASCRIPT-2A. It is development-only and has not
recurred since 2026-08-05.

### W6 — Apply Sentry dispositions and establish the recurring review loop

1. Before changing statuses, rerun `is:unresolved` and compare first/last seen, event
   count, release, environment, and anonymous-install count with this snapshot.
2. Apply issue state changes only in the workstream batches above. Add a short internal
   note containing the fixing commit/release and the verification result where Sentry
   supports it.
3. For fixed product bugs, use release-aware resolution so a regression reopens. For
   expected external failures, archive until escalating rather than marking them fixed.
4. Query `environment:production` by default. Keep development events searchable, but
   do not let a local release-build test be mistaken for a multi-user production
   regression; use the anonymous install count and release provenance together.
5. Review weekly while the backlog is being cleaned, then monthly:
   - new/regressed fatal or error issues first;
   - more than one anonymous install next;
   - rising event count or recurrence on the latest release next;
   - warnings/external outages last.
6. Reopen engineering work when an archived issue escalates, a fixed signature occurs
   on or after its release gate, or a nominally external failure leaves local work
   non-retryable.

## Verification commands

Run focused checks during each workstream, followed by the full suites before release:

```bash
node --test \
  src-ui/app/runtime-command-failure-report.test.js \
  src-ui/app/sync-error.test.js \
  src-ui/app/editor-write-guards.test.js

npm test
npm run test:browser
cargo test --manifest-path src-tauri/Cargo.toml
```

For release-only failures, also build the signed/package-equivalent app and inspect the
installed bundle's Git runtime before declaring W2 complete.

## Completion checklist

- [ ] W1 editor replace wire contract verified and released; JAVASCRIPT-2Q resolved
      release-aware.
- [ ] W2 team-metadata root cause distinguished from Git-runtime failure; safe recovery
      and cascade behavior verified; five related groups resolved together.
- [ ] W3 expected AI/provider/access failures classified; duplicate capture removed;
      five groups archived.
- [ ] W4 missing network strings classified without losing queued work; four transient
      groups archived and the already-fixed HTTP/2 group resolved.
- [ ] W5 project/glossary/QA create-conflict parity covered; JAVASCRIPT-2A archived.
- [ ] Full JS, browser, and Rust suites pass; packaged macOS Git smoke check passes;
      Windows-relevant Git path is exercised.
- [ ] Sentry token used for the review is revoked/rotated and no token appears in the
      repository or generated artifacts.
- [ ] A follow-up Sentry query shows no unexplained unresolved group from the original
      17-item inventory.

## Expected outcome

The only immediate product regression in the current set (editor replace on rows with
footnotes) ships in the next release. Team-metadata bootstrap failures become accurately
diagnosable without risking user data, expected AI and repository-validation outcomes no
longer create defect issues, transient network failures remain visible in the UI and
retry queues without polluting Sentry, and future regressions reopen against explicit
release gates.
