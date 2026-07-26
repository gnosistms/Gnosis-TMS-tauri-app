# Sentry Sensitive Issues (JAVASCRIPT-1C–1F) — Orchestration Plan

**Org / project:** `gnosis-tms` / `javascript` (id 4511502532149248) — https://gnosis-tms.sentry.io
**Primary codebase:** this repo — `GnosisTMS` Tauri app (`@sentry/browser`, `github.com/gnosistms/Gnosis-TMS-tauri-app`).
**Secondary codebase:** `../gnosis-tms-github-app-broker` (`github.com/gnosistms/gnosis-tms-github-app-broker`) — GitHub-App + WordPress OAuth broker; likely home of the git-push and OAuth-secret paths. NB: its errors may report to a *different* Sentry project than `javascript`.
**Classification:** Confidential — kept off GitHub deliberately (colleague's call). No public issues/PRs with specifics; generic commit messages; no exploit recipe in history.
**Status:** Fixes implemented, tested, and committed 2026-07-08 on branch
`fix/import-sync-secret-hardening` (NOT pushed). Awaiting push → PR/merge → release →
mark 1C–1F resolved in Sentry. See "Fix log" at the bottom.

> Distinct from the June-2026 backlog in [`sentry-triage-plan.md`](sentry-triage-plan.md) and [`sentry-issues-second-opinion.md`](sentry-issues-second-opinion.md) (single-char IDs A/C/1/2…, mostly resolved). These four are a newer batch (1C–1F = #52–55).

---

## The four issues

| Short ID | Group ID | Category | Title | Ingested? |
|----------|----------|----------|-------|-----------|
| JAVASCRIPT-1C | 7598793990 | DoS | DOCX import zip-bomb: unbounded decompression | ✅ |
| JAVASCRIPT-1D | 7598794676 | DoS (2nd variant) | TXT import has no imported-row cap | ✅ |
| JAVASCRIPT-1E | 7598794705 | Remote-history overwrite | `backup_dirty_project_worktree` can strand HEAD on backup branch | ✅ |
| JAVASCRIPT-1F | 7598794726 | Secrets (at-rest persistence) | Sign-out AI-secret clear race leaves cached secrets on disk | ✅ |

Category mapping resolved. The "4th variant" = the **second DoS** (1D), sibling of 1C
(both under disclosure bucket `import-file-dos`).

Provenance: all four are **colleague-authored analysis findings**, not live crashes —
filed via `sentry-cli` (source tag `nightly-bug-hunter`, run `2026-07-05-03`), 0 users,
no release tag, env `nightly-bug-hunter`. All four cite locations **in this repo**
(`src-tauri`/`src-ui`), none in the broker. Cross-ref: `#159 (private-channel note)`.

**No live secret in any payload.** 1F is about secrets *persisting at rest on the
user's own disk* after sign-out (a clear-race), NOT a credential reaching Sentry —
and 1F's `finding`/`node_ids` fields were already `[Filtered]` by Sentry's server-side
scrubbing. Nothing to rotate; no Sentry event scrub needed for a leaked value.

---

## Phase 0 — Ingest the real issue details (blocker)

Established access pattern (from `sentry-project-reference` memory) — **fastest, no new setup:**

- [ ] Hans pastes a **Sentry user auth token** (session-only; save to `~/.sentry-token`, revoke after use — do not store in memory or the repo).
- [ ] For each issue, pull via REST API:
  - `GET https://sentry.io/api/0/organizations/gnosis-tms/issues/?query=JAVASCRIPT-1C` (resolve short ID → issue id)
  - `GET https://sentry.io/api/0/issues/{id}/` (metadata) and `.../issues/{id}/events/latest/` (full stack trace + payload)
- [ ] Alternatives if no token: connect the Sentry MCP (`mcp.sentry.dev/mcp`), or paste each stack trace manually.

**When reading the payloads, watch for the secret itself** — if a live credential is in the event body, it's already in Sentry's store; note it for scrub + rotation in Phase 2, and do not copy it into this plan or any file.

**Exit criteria (per issue):** title, error message, culprit (file:function:line), full stack trace, first/last seen, event count, user count, environment, release, offending install id(s). Remember install `b70c912b…`/`environment: development` is Hans's dev machine — dev noise, not a production signal.

---

## Phase 1 — Triage & prioritize

**Triage table (verified against current source 2026-07-08):**

| ID | Category | Sev (colleague) | Reachability | Blast radius | Verified in code |
|----|----------|-----------------|--------------|--------------|------------------|
| 1C | DoS (zip-bomb) | major, confirmed | **Remote/untrusted** — normal import entry (open/drag `.docx`, or link import resolving to one) with adversarial input | OOM/crash of the app on the victim's machine; compressed input capped at 25 MB but deflate ~1000:1 → decompressed effectively unbounded | ✅ guards at `docx.rs:138-146` all trust `file.size()` (zip central-dir metadata, attacker-settable to 0); `read_docx_xml_part` `read_to_string` at ~171 has no actual-bytes cap |
| 1D | DoS (row flood) | major, confirmed | **Remote/untrusted** — import a dense `.txt` (word list / dict export) | ~12.5 M rows from a 25 MB file → multi-GB heap; if it survives, `write_row_files` git-adds ~12.5 M JSON files | ✅ `txt.rs` loop over `decoded.lines()` pushes `ImportedRow` with no cap; only ceiling is the 25 MB byte guard. DOCX has `DOCX_MAX_IMPORTED_ROWS`; TXT has none |
| 1E | Remote-history overwrite | major, confirmed-conditional | **Conditional/local** — requires `git add -A` or commit to fail *after* the `checkout -b backup` (index.lock race, Windows locks, disk-full, per-repo pre-commit hook) | Integrity/data-loss: HEAD stranded on backup branch → next reconcile misreads it as original → later `push origin main` can overwrite remote main with backup content | ✅ `project_repo_sync.rs:391-403` — `checkout -b`, `add -A`, `commit` each `?`; failure returns before the `checkout <original>` at :403 |
| 1F | Secrets (at-rest) | major, likely | **Local** — sign out while the async clear is in flight | Provider secrets (OpenAI/Anthropic/Gemini keys) linger in the on-disk stronghold snapshot after sign-out until overwritten | ✅ `team-ai-flow.js:233` fires `clear_team_ai_provider_cache` fire-and-forget via `Promise.allSettled`; not awaited against sign-out teardown. `ai_secret_storage.rs` clear paths at :47/:105/:296/:436 |

**First-seen release / regression window:** the Sentry events carry **no release tag**
(synthetic `sentry-cli` reports), so first-seen-release is unavailable from Sentry.
Regression window per issue is TBD via `git blame` from the cited lines in Phase 3.

**Revised priority (highest first):**
1. **1E (history-overwrite)** — the only one that can corrupt *shared remote* state /
   cause data loss for teammates. One-line always-restore fix; low risk, high value.
2. **1C (zip-bomb DoS)** — remotely triggerable app crash from a single crafted file;
   cheapest external trigger of the four.
3. **1D (row-flood DoS)** — same import surface; slightly higher effort to trigger
   (needs a large dense file), and worse tail (mass file creation) if it survives.
4. **1F (secret persistence)** — real but local, needs a sign-out-timing race; lowest
   exploitability. No live leak, so no containment urgency ahead of the code fix.

**Containment note:** none of the four needs emergency containment (no live secret, no
evidence of an actual clobber having happened — all are code-analysis findings, 0 users,
dev/synthetic origin). Fixes can proceed in normal priority order.

---

## Phase 2 — Immediate containment (parallel, before code fixes)

- **Secrets → ROTATE FIRST (Hans performs; I prep the checklist + locate the leak site).** Assume anything that reached Sentry is burned. Rotate the credential, then **scrub it from Sentry** (delete the events / enable data-scrubbing) so it isn't sitting in the store. Likely credentials in play: OpenAI/Anthropic API keys, broker session/bearer token, GitHub-App installation tokens, WordPress OAuth secrets.
- **History-overwrite → freeze & snapshot.** If a force-push/ref-rewrite path is implicated, protect the affected remote (branch protection / disable force-push) and snapshot current refs before touching anything, so a clobber is recoverable.
- **DoS → guard rail.** If trivially triggerable in prod, add a stopgap (input-size cap / timeout / rate limit) while the real fix is built.

---

## Phase 3 — Locate root cause in code

One branch per issue (isolated). For each:
1. Map the Sentry culprit (file:line + release) to current source.
2. `git blame`/`git log` from the first-seen release to find the introducing commit.
3. Write a failing test / minimal repro of the vulnerability.
4. Check whether the fix pattern applies to the sibling issues (the four may share one root habit — e.g. the blanket `invoke()` reporter in `src-ui/app/runtime.js` over-reporting, or a shared git helper).

Known-relevant paths from prior triage: telemetry in `src-ui/app/runtime.js` + `telemetry.js`; git/sync in `src-tauri/src/team_metadata_local*`, `project_repo_sync.rs`, `broker.rs`; secret storage in `src-tauri/src/ai_secret_storage.rs`, `broker_auth_storage.rs`, `installation_access.rs`.

---

## Phase 4 — Fix, review, verify

Per issue:
- [ ] Implement fix (validation / bounds / auth / refspec pinning as appropriate).
- [ ] Regression test that fails pre-fix, passes post-fix.
- [ ] Run `/security-review` on the diff before merge.
- [ ] Reproduce the original trigger against the patched build to confirm.
- [ ] Generic commit message; no exploit detail.

---

## Phase 5 — Disclosure, close-out, prevention

- [ ] Mark 1C–1F resolved in Sentry with the fixing release; confirm no new events post-deploy (respect the release/updater discipline — a version bump needs a published release, per `release-updater-discipline` memory).
- [ ] Private internal write-up (not GitHub): root cause, fix, rotated secrets, affected users.
- [ ] Decide with colleague on any user/data notification (secrets leak or history loss affecting real users may carry obligations).
- [ ] **Prevention:** enable Sentry **data-scrubbing / sensitive-field filtering** so secrets never land in payloads again; extend the `runtime.js`/`telemetry.js` skip rules; add a lint/CI guard if a recurring pattern exists.
- [ ] Update memory + close this plan when all four are resolved.

---

## Open questions for Hans / colleague

1. Phase 0 access: paste a Sentry token (established pattern), connect Sentry MCP, or paste the four stack traces?
2. Which issue is which category — confirm the 4th.
3. Anything in **production right now**, real users affected (esp. secrets / history-overwrite)?
4. Execute fixes from this repo, or hand off? (Broker issues may need the broker repo.)

---

## Fix log (2026-07-08) — branch `fix/import-sync-secret-hardening`

All four fixed in this repo (none needed the broker repo). `cargo build`, `cargo test`
(new + existing suites), and `npm test` (1652) all green. No live secret was present in
any payload, so no rotation / Sentry scrub was required.

| ID | Commit | Fix |
|----|--------|-----|
| 1C | `8b38fbac` | `docx.rs`: read XML parts via `take(limit+1)` + `read_to_end`, reject on cap — stops trusting attacker-controlled `file.size()`. Covers `document.xml` and `footnotes.xml`. |
| 1D | `d18b3560` | `txt.rs`: add `MAX_TXT_IMPORTED_ROWS = 20_000` (matches DOCX), error in the parse loop. Regression test in `mod.rs`. |
| 1E | `e37a6285` | `project_repo_sync.rs`: run backup add/commit in a closure, **always** attempt `checkout <original>` afterwards, then propagate the inner error — HEAD can no longer strand on the backup branch. |
| 1F | `a81b3480` | `ai_secret_storage.rs`: process-global `Mutex` around public write/clear entry points; serializes snapshot open-modify-save cycles (kills the clear/save last-writer-wins) and keeps compound (secret + key-version) ops atomic. |

**Remaining (Phase 5):** push branch → PR/merge → cut release (per `release-updater-discipline`)
→ mark 1C–1F resolved in Sentry with the fixing release → confirm no new events.
