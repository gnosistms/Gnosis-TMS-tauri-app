<!-- vt.idd:pr-review:pass-1 -->
## Code Review — PR #43: JS Review — Batch 1: Auth, Security & Telemetry

> **Claude Code tip**: Ask here for deeper context on any finding before approving —
> e.g. "walk me through S1 option A", "what files does M1 touch?",
> "combine m3+m4 into one fix". The table rationale is a summary; Claude has
> full diff context.
>
> **Copilot review**: Integrated from review submitted 2026-06-04T21:22Z.
> Copilot inline comments mapped: Cp1→D2, Cp2→(skipped — expected draft PR state),
> Cp3→D3, Cp4→D4.
>
> **Review scope**: Naive full-file review of all 8 Batch 1 source files
> (~1,100 lines) plus available test files. Not a diff review.

| Severity | Count | IDs |
|----------|-------|-----|
| Critical (C) | 0 | — |
| Security (S) | 2 | S1, S2 |
| Major (M) | 4 | M1, M2, M3, M4 |
| Minor (m) | 4 | m1, m2, m3, m4 |
| Documentation (D) | 4 | D1, D2, D3, D4 |
| **Total** | **14** | |

---

## Findings

<!-- vt.idd:finding:S1 -->
<!-- vt.idd:recommended:S1:A -->
<details>
<summary><strong>S1 — SECRET_VALUE_PATTERNS misses GitHub fine-grained PATs and case variants of Bearer</strong> <em>(Security · FG-1 · Claude)</em></summary>

**S1 — SECRET_VALUE_PATTERNS misses GitHub fine-grained PATs and case variants of Bearer** *(Security · FG-1)*

**File**: `src-ui/app/telemetry-scrub.js:35–41`

**Description**: `SECRET_VALUE_PATTERNS` matches classic GitHub PATs (`gho_`, `ghp_`, etc.) but not fine-grained PATs, which use the prefix `github_pat_` (current format since 2022). The Bearer pattern (`/\b[Bb]earer\s+.../g`) is case-sensitive and misses `BEARER` variants that may appear in backend error strings. The realistic leak path is `reportCommandFailure` in `telemetry.js`, which feeds `error.message` — a raw backend error string — through `scrubString` before transmitting to Sentry. A GitHub API 401 response that echoes a fine-grained PAT in its message body would survive the scrub pass intact.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Add `/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g` to `SECRET_VALUE_PATTERNS`; change the Bearer pattern to use the `i` flag (e.g. `/bearer\s+[A-Za-z0-9._-]{12,}/gi`) | Extends coverage to the current GitHub token namespace without breaking existing patterns. Two targeted additions, independently auditable. | ✓ |
| B | Add the `github_pat_` pattern and separately add a `BEARER` uppercase variant as a second Bearer entry | Avoids regex `i` flag in case global state concerns arise, but adds more entries than necessary. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:S2 -->
<!-- vt.idd:recommended:S2:A -->
<details>
<summary><strong>S2 — scrubString has no patterns for email addresses or GitHub @-handles</strong> <em>(Security · FG-1 · Claude)</em></summary>

**S2 — scrubString has no patterns for email addresses or GitHub @-handles** *(Security · FG-1)*

**File**: `src-ui/app/telemetry-scrub.js:4–7, 35–41, 63–80`

**Description**: The module header states an explicit constraint: *"never transmit … GitHub identity."* `scrubEvent` correctly deletes the structured `event.user` field, but `scrubString` — applied to free-text message and exception values — has no pattern for email addresses, GitHub login handles (`@username`), or display names. These values appear in auth error messages (`Signed in as @${session.login}` is composed in `auth-flow.js` and can propagate into uncaught exception values) and in backend error bodies. The structural identity deletion in `scrubEvent` is not backed by free-text identity scrubbing, leaving the module's own stated privacy contract partially unfulfilled.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Add an RFC 5321-style email pattern (`/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g`) and a conservative GitHub handle pattern (`/\B@[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,37}[a-zA-Z0-9])?\b/g`) to `SECRET_VALUE_PATTERNS` | Both shapes are distinctive enough for low false-positive risk. Closes the gap directly in `scrubString` so it applies to all free-text paths uniformly. | ✓ |
| B | Prevent identity values from entering error message strings at the source (auth-flow.js, broker error paths) | Defense-in-depth complement, but cannot protect against backend error bodies that echo identity. Best combined with Option A. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:M1 -->
<!-- vt.idd:recommended:M1:A -->
<details>
<summary><strong>M1 — state.projects written directly from Tauri event listener; state.glossaries and state.qaLists not cleared on user switch</strong> <em>(Major · FG-2 · Claude)</em></summary>

**M1 — state.projects written directly from Tauri event listener; state.glossaries and state.qaLists not cleared on user switch** *(Major · FG-2)*

**File**: `src-ui/app/auth-flow.js:183–190`

**Description**: `hydrateStoredDataForActiveUser` writes `state.projects = []` directly, bypassing TanStack Query. This function is called from `applyBrokerAuthResult`, which is invoked directly from the `broker-auth-callback` Tauri event listener registered in `registerBrokerAuthListener`. The CLAUDE.md rule is explicit: *"NEVER write directly to `state.projects`, `state.glossaries`, `state.qaLists` from … a Tauri event listener outside an injected query-layer publisher."* Additionally, `state.glossaries` and `state.qaLists` are not cleared at all in this function — after a GitHub account switch, the previous user's glossaries and QA lists remain visible in state until the query layer delivers fresh data, which is a cross-user data leakage window and a parity gap (Standard IV).

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Replace `state.projects = []` with `queryClient.setQueryData(projectsQueryKey, [])` and add equivalent calls for `state.glossaries` and `state.qaLists` using their respective query keys, imported from `query-client.js` | Routes all three resets through the query cache as required, fixes the parity gap, and makes future shape evolution consistent. | ✓ |
| B | Call `queryClient.invalidateQueries()` for all three resource collections instead of seeding empty arrays | Triggers a fresh fetch rather than optimistically showing empty; more correct for the startup path but may briefly show the previous user's data while the fetch completes. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:M2 -->
<!-- vt.idd:recommended:M2:A -->
<details>
<summary><strong>M2 — github-app-permissions.js permission-gate logic has no test coverage</strong> <em>(Major · FG-3 · Claude)</em></summary>

**M2 — github-app-permissions.js permission-gate logic has no test coverage** *(Major · FG-3)*

**File**: `src-ui/app/github-app-permissions.js:38–61`

**Description**: `listMissingInstallationPermissions` and `deriveInstallationApprovalState` contain the permission-gate logic that determines whether `needsAppApproval` is `true` — a UI-blocking decision shown before any write operation. The `reduce`-based best-level calculation, the multi-key alias path (`custom_properties` / `repository_custom_properties`), and the `normalizeInstallationPermissions` filter are completely untested. An off-by-one in the `PERMISSION_LEVELS` comparison or a key-alias miss silently grants or blocks approval without any failing test.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Add `github-app-permissions.test.js` covering: all permissions granted (expect empty missing list), one permission missing, alias key satisfaction (`repository_custom_properties` satisfying `custom_properties`), insufficient level (`read` when `write` required), and empty/null input | All three functions are pure — the test file requires no mocking. Directly exercises the branchy reduction and alias logic. | ✓ |
| B | Add inline JSDoc examples documenting expected input/output shapes | Reduces misreading risk but provides no runtime regression protection. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:M3 -->
<!-- vt.idd:recommended:M3:A -->
<details>
<summary><strong>M3 — team-ai-crypto.js error paths have no test coverage</strong> <em>(Major · FG-4 · Claude)</em></summary>

**M3 — team-ai-crypto.js error paths have no test coverage** *(Major · FG-4)*

**File**: `src-ui/app/team-ai-crypto.js:121–162`

**Description**: No test file exists for `team-ai-crypto.js`. The error branches in `encryptTeamAiPlaintext` (empty plaintext), `decryptTeamAiWrappedKey` (unsupported algorithm, missing ciphertext, empty decrypted value), and the `cryptoApi` unavailability guard are completely untested. These are the paths most likely to produce confusing silent failures when the broker sends a malformed or version-incremented payload.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Add `team-ai-crypto.test.js` with `assert.rejects` cases: encrypt empty string, decrypt wrong algorithm string, decrypt object with no ciphertext field, decrypt empty ciphertext string | All error paths throw synchronously or via rejected promises — `assert.rejects` is sufficient. No new infrastructure needed. | ✓ |
| B | Leave error paths untested and rely on integration testing with the broker | Integration tests only run when the broker is available; unit coverage is faster and more reliable for pure-logic branches. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:M4 -->
<!-- vt.idd:recommended:M4:A -->
<details>
<summary><strong>M4 — telemetry.js opt-out → re-enable cycle is untested; sentry.init() called twice on re-enable</strong> <em>(Major · FG-5 · Claude)</em></summary>

**M4 — telemetry.js opt-out → re-enable cycle is untested; sentry.init() called twice on re-enable** *(Major · FG-5)*

**File**: `src-ui/app/telemetry.js:184–189`

**Description**: When the user explicitly opts out, `refreshTelemetryState` sets `sentry = null` and `initialized = false` (lines 187–189). If the user subsequently re-enables telemetry, `saveTelemetryDisclosureSettings` calls `initTelemetry()` again, which re-imports `@sentry/browser` via dynamic import and calls `sentry.init()` on the already-imported module. Sentry documents this as undefined behavior. The interaction between module-level SDK state and this reset path is not covered by any test.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Add a `telemetry.test.js` that exercises the opt-out → re-enable path with a mock Sentry object, verifying `init` is called the correct number of times and the gate reopens after re-enable | Pins the current behavior and will catch any regression if Sentry SDK semantics change or the reset logic is modified. | ✓ |
| B | Document the limitation in a JSDoc comment on `refreshTelemetryState` that re-enabling after opt-out re-calls `sentry.init()` on an already-imported module | Makes the behavior explicit without adding tests, but does not catch regressions. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:m1 -->
<!-- vt.idd:recommended:m1:A -->
<details>
<summary><strong>m1 — void loadUserTeams(render) rejection silently discarded in applyBrokerAuthResult</strong> <em>(Minor · FG-2 · Claude)</em></summary>

**m1 — void loadUserTeams(render) rejection silently discarded in applyBrokerAuthResult** *(Minor · FG-2)*

**File**: `src-ui/app/auth-flow.js:48–50`

**Description**: `void loadUserTeams(render)` inside `applyBrokerAuthResult` discards any rejection silently. Unlike `void saveStoredAuthSession(session)` (a legitimately fire-and-forget storage call), a `loadUserTeams` failure means the team list never populates after sign-in — the user sees a signed-in state with an empty team panel and no error feedback.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Add `.catch(error => setAuthState({ status: "error", message: error?.message ?? "Failed to load teams." }, render))` after `loadUserTeams(render)` | Makes the failure visible to the user in the same error-state mechanism used by `startGithubLogin`. The same pattern should be applied to the equivalent `void loadUserTeams(render)` call in `restoreStoredBrokerSession` (line 155). | ✓ |
| B | Add a comment documenting that `loadUserTeams` handles its own errors internally | Only valid if `loadUserTeams` is verified to render its own error state on failure — check before choosing this option. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:m2 -->
<!-- vt.idd:recommended:m2:A -->
<details>
<summary><strong>m2 — Success auth state shape triplicated in restoreStoredBrokerSession</strong> <em>(Minor · FG-2 · Claude)</em></summary>

**m2 — Success auth state shape triplicated in restoreStoredBrokerSession** *(Minor · FG-2)*

**File**: `src-ui/app/auth-flow.js:101–107, 143–150, 161–167`

**Description**: The `{ status: "success", message: \`Signed in as @${login}.\`, session, pendingAutoOpenSingleTeam: !shouldPreserveCurrentScreen(options) }` object shape is constructed identically in the `!invoke` early-return branch, the successful `invoke` branch, and the `catch` branch. If the auth state shape evolves (e.g. a new field is added), all three sites must be updated in sync. A regression from updating only two of the three is plausible.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Extract `function buildSuccessAuthState(session, options)` returning the common shape, and call it from all three branches | Single definition, single update site. Makes the parity of the three branches explicit. | ✓ |
| B | Add a comment noting the three branches must be kept in sync | Leaves the DRY violation in place. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:m3 -->
<!-- vt.idd:recommended:m3:A -->
<details>
<summary><strong>m3 — scrubEvent mutates its argument in-place, contradicting the module's "pure" contract</strong> <em>(Minor · FG-1 · Claude)</em></summary>

**m3 — scrubEvent mutates its argument in-place, contradicting the module's "pure" contract** *(Minor · FG-1)*

**File**: `src-ui/app/telemetry-scrub.js:147–154`

**Description**: `scrubEvent` uses `delete event.user`, `delete event.server_name`, `delete event.request` and assigns directly to `event.message` and `event.exception.values` on the original object. The module comment says *"Pure and dependency-free"* and `scrubData` correctly clones at every level. The inconsistency is a maintenance trap: a future caller that passes a shared object and expects immutability will see silent corruption.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Clone the top-level event at the start of `scrubEvent` (e.g. `const e = { ...event }`) and operate on the clone, consistent with how `scrubData` handles objects; return the clone | Matches the documented contract and the rest of the module's approach. The Sentry `beforeSend` path still works because the clone is returned. | ✓ |
| B | Remove the *"Pure and dependency-free"* claim from the module comment and document that `scrubEvent` mutates its argument | Cheaper but leaves the mutation trap in place for future callers. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:m4 -->
<!-- vt.idd:recommended:m4:B -->
<details>
<summary><strong>m4 — Global-flag regexes in SECRET_VALUE_PATTERNS are fragile for .test()/.exec() reuse</strong> <em>(Minor · FG-1 · Claude)</em></summary>

**m4 — Global-flag regexes in SECRET_VALUE_PATTERNS are fragile for .test()/.exec() reuse** *(Minor · FG-1)*

**File**: `src-ui/app/telemetry-scrub.js:36–41`

**Description**: All entries in `SECRET_VALUE_PATTERNS` use the `/g` flag. Regex literals with `/g` are stateful objects: `lastIndex` persists between calls when used with `.test()` or `.exec()`. The current usage via `String.prototype.replace` resets `lastIndex` implicitly — this is safe — but the pattern is a footgun for future maintainers who might reach for `.test()` for a quick pre-check, causing skipped matches on alternating calls.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Use a factory function or recreate the patterns per call, or switch to non-global regex with `matchAll` for replacement | Eliminates the stateful-regex hazard entirely but requires restructuring the replacement loop. | |
| B | Add a comment above `SECRET_VALUE_PATTERNS` noting these regexes must only be used with `.replace()`, not `.test()` or `.exec()` | Low effort; guards the footgun for future maintainers without restructuring safe current code. | ✓ |

- [ ] A
- [x] B *(recommended)*
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:D1 -->
<!-- vt.idd:recommended:D1:A -->
<details>
<summary><strong>D1 — installTelemetryCrashHandlers call site not referenced in module comment</strong> <em>(Documentation · FG-5 · Claude)</em></summary>

**D1 — installTelemetryCrashHandlers call site not referenced in module comment** *(Documentation · FG-5)*

**File**: `src-ui/app/telemetry.js:3–10, 73`

**Description**: The module comment states *"Crash handlers install early and BUFFER until the send gate opens"* but does not reference where `installTelemetryCrashHandlers` is called from, making the timing guarantee unverifiable. Without knowing the call site, reviewers cannot confirm "early" means before any user-visible code runs.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Add a `@see` or cross-reference comment on `installTelemetryCrashHandlers` pointing to its call site in `main.js` (or wherever bootstrap runs it) so the timing claim is verifiable | Makes the architectural invariant auditable without changing behavior. | ✓ |
| B | Add the call-site reference to the `src-ui/CLAUDE.md` telemetry note instead | Centralizes bootstrap documentation but is not co-located with the code that depends on the ordering. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:D2 -->
<!-- vt.idd:recommended:D2:A -->
<details>
<summary><strong>D2 — JS_Review_Strategy.md naming convention ambiguous about when -batch-N suffix is required</strong> <em>(Documentation · FG-6 · Copilot)</em></summary>

**D2 — JS_Review_Strategy.md naming convention ambiguous about when -batch-N suffix is required** *(Documentation · FG-6)*

**File**: `reviews/JS_Review_Strategy.md:823`

**Description**: The Naming Convention section states review files are saved as `YYYY-MM-DD-review.md` with a `-batch-N` suffix *"for batches run on the same date"* — but this is ambiguous: it could mean any batch gets the suffix, or only the second batch onwards. Existing files show `2026-06-03-review.md` (no suffix for the first batch that day) and `2026-06-03-batch-3-review.md` (with suffix for a later batch). The intent should be made explicit.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Update the naming convention to state: *"The first review session on a given date uses the date-only name (`YYYY-MM-DD-review.md`). Additional sessions on the same date append the batch number to avoid collision (`YYYY-MM-DD-batch-N-review.md`)."* | Matches observed practice and removes ambiguity for future reviewers. | ✓ |
| B | Add a worked example line showing both forms side by side | Clarifies by example but leaves the rule implicit. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:D3 -->
<!-- vt.idd:recommended:D3:A -->
<details>
<summary><strong>D3 — .vt/reviews/pr-3-pass-1.md committed to this branch has mismatched scope</strong> <em>(Documentation · FG-7 · Copilot)</em></summary>

**D3 — .vt/reviews/pr-3-pass-1.md committed to this branch has mismatched scope** *(Documentation · FG-7)*

**File**: `.vt/reviews/pr-3-pass-1.md:1–2`

**Description**: The file heading states *"Code Review — PR #3: Batch 1 Rust review fixes: Auth & Security"* but it was committed to this branch (PR #43: JS Batch 1). The commit message correctly describes both files added in that commit, but the presence of a Rust PR #3 review record on the JS Batch 1 branch is confusing to reviewers and creates the impression that the files are related. The file was committed here as a housekeeping catch-up commit rather than being merged to `main` first.

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Remove `pr-3-pass-1.md` from this branch by reverting that file in a new commit, then commit it to `main` directly (or merge a dedicated branch for it) | Keeps the branch scope clean and moves the historical Rust review record to the appropriate home. Note: if D3 is fixed this way, D4 in this file becomes moot. | ✓ |
| B | Leave the file in place and add a header note explaining it is a historical artifact from the Rust review cycle committed here for catch-up | Lower effort but leaves scope confusion for future git-blame and bisect operations. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

<!-- vt.idd:finding:D4 -->
<!-- vt.idd:recommended:D4:A -->
<details>
<summary><strong>D4 — pr-3-pass-1.md C1 Option A recommends fetching session token from keychain, contradicting F-VIII</strong> <em>(Documentation · FG-7 · Copilot)</em></summary>

**D4 — pr-3-pass-1.md C1 Option A recommends fetching session token from keychain, contradicting F-VIII** *(Documentation · FG-7)*

**File**: `.vt/reviews/pr-3-pass-1.md:39`

**Description**: The C1 finding in `pr-3-pass-1.md` — the recommended Option A — says *"implement it to load the profile JSON and then fetch the session token from keychain."* The constitution's F-VIII anti-rationalization guardrail explicitly prohibits OS credential store (keychain) integration for broker session tokens: *"The session token's at-rest exposure to a local attacker is accepted per F-VIII. Plain JSON storage is the intended design."* If this review record is used as a reference for future work, the keychain recommendation could lead a contributor to introduce a guardrail violation. This finding is moot if D3 is fixed (the file is removed from the branch).

| # | Approach | Rationale | Rec. |
|---|----------|-----------|:----:|
| A | Update the Option A description in C1 to read *"…then load the session token from the broker auth JSON file (plain storage per F-VIII, not the OS keychain)…"* | Corrects the F-VIII violation in the record without changing its historical structure. Moot if D3 removes the file. | ✓ |
| B | Add a top-of-file notice: *"Note: C1 Option A mentions keychain; the actual fix used plain JSON storage per F-VIII."* | Lower surgery on the record but less precise than correcting the recommendation inline. | |

- [x] A *(recommended)*
- [ ] B
- [ ] Alternative: *(describe)*

</details>

---

## Fix Groups

**FG-1** — `src-ui/app/telemetry-scrub.js` · S1, S2, m3, m4 · _Soft boundary (same file, different regions)_

> Fix S1 (add PAT/Bearer patterns) and S2 (add identity patterns) in one pass on `SECRET_VALUE_PATTERNS`. Fix m3 (clone in `scrubEvent`) independently. Fix m4 (add regex usage comment) as a one-liner. All four touch the same file at non-overlapping locations.

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-2** — `src-ui/app/auth-flow.js` · M1, m1, m2 · _Soft boundary (same file, different functions)_

> M1 (state bypass + parity gap) is in `hydrateStoredDataForActiveUser`. m1 (rejection handling) is in `applyBrokerAuthResult` and `restoreStoredBrokerSession`. m2 (shape extraction) is in `restoreStoredBrokerSession`. Fix M1 first — it may require importing from `query-client.js`. M1 fix-A will also need to add `state.glossaries = []` and `state.qaLists = []` equivalents through the query cache.

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-3** — `src-ui/app/github-app-permissions.js` (new `github-app-permissions.test.js`) · M2 · _Hard boundary_

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-4** — `src-ui/app/team-ai-crypto.js` (new `team-ai-crypto.test.js`) · M3 · _Hard boundary_

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-5** — `src-ui/app/telemetry.js` (new `telemetry.test.js`) · M4, D1 · _Soft boundary (test file is new; D1 adds a comment to telemetry.js)_

> M4 creates `telemetry.test.js`. D1 adds a `@see` cross-reference comment in `telemetry.js`. No line-range overlap.

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-6** — `reviews/JS_Review_Strategy.md` · D2 · _Hard boundary_

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

**FG-7** — `.vt/reviews/pr-3-pass-1.md` · D3, D4 · _Soft boundary (same file)_

> If D3 disposition is Fix (remove file), D4 is automatically resolved — no separate fix needed for D4. If D3 is Acknowledged or Deferred, D4 still requires its own fix.

- [ ] Fix
- [ ] Acknowledge
- [ ] Defer

---

<!-- vt.idd:pr-review:approve -->
## Approve and Proceed

All findings reviewed? Check the box to authorize fix execution.

- [ ] **Approve and proceed** — I have reviewed all findings and dispositions above. Execute fixes per the checked dispositions.
<!-- /vt.idd:pr-review:approve -->

<!-- /vt.idd:pr-review:pass-1 -->
