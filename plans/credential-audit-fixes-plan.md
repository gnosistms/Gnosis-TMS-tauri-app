# Credential audit fixes

Keep the restored credential model: remembered GitHub login, existing AI key
storage, no OS keychain or additional passwords. Fix only the three findings in
`credential-storage-audit.md`.

1. Guard refresh and restoration against sign-out/account changes. Serialize
   native session file operations and condition refresh saves on the previous
   token still being stored. Save before activating refreshed credentials.
2. Propagate login persistence errors, await sign-out deletion, and use existing
   error UI only on actual failures. Serialize login saves/deletions so a pending
   login save cannot run after sign-out deletion.
3. Issue fresh positive, JavaScript-safe numeric revisions for team-key updates
   instead of resetting a counter after deletion. Preserve existing API shapes,
   last-key file deletion, stateless broker operation, and older clients.
4. Add regressions for delayed refresh/account changes, storage failures, and
   clear/re-add (including missing metadata after a broker restart). Run focused
   and relevant broader checks; rebuild the dev app. Commit/push the broker fix
   and verify its deployed health version as required by its AGENTS.md.

Normal startup remains silent. Existing unrelated workspace edits are preserved.

Status: complete (2026-09-05).

## Implementation

- Login intent has a generation guard. Refresh results and startup inspection
  cannot reactivate a signed-out account or overwrite a newer login. Concurrent
  requests share a refresh only within the same login; delayed failures can reuse
  that login's completed refresh.
- Refresh saves specify the expected prior token. Native reads, conditional writes,
  and deletion share a mutex; failed file replacement preserves the old login.
  This coordinates operations in one app process, as with the existing AI store.
- Explicit login saves/deletions are queued and awaited. Save failures stay on the
  sign-in screen with an error; deletion failures leave the account signed in and
  show an error. Successful operations and startup add no warning or storage UI.
- Startup uses the refreshed token, including when the subsequent inspection fails,
  and no longer writes its stale original token back to disk.
- Broker revisions are random positive 53-bit integers. Their collision probability
  is negligible; they cannot equal the currently stored revision. They remain valid
  numeric revisions in released clients, with no new endpoint or persistent broker
  state. Clearing the last provider still deletes the secrets file.

## Verification and delivery

- Final frontend unit suite: 2,071 passed.
- Workflow suite: 17 passed after allowing its local server fixtures outside the
  sandbox; the initial sandboxed run could not bind those fixture ports.
- Native credential storage: 6 tests passed, including concurrent refresh/deletion,
  stale account writes, failed writes preserving the old login, and failed deletion.
- Broker suite: 65 passed, including the real metadata delete/re-add path and
  maximum JavaScript-safe numeric revisions.
- Startup and AI Settings browser checks: 5 passed in Chrome on macOS.
- Changed auth JS files pass ESLint; Rust production targets pass strict Clippy.
  Full all-target Clippy is blocked by an unrelated existing `err().expect()` in
  `src-tauri/src/project_import/chapter_import/xlsx.rs:400`. The unchanged `state.js`
  import of `normalizeEditorMode` also has an existing ESLint warning. Unused-code
  audit findings are confined to unrelated existing files/imports/exports.
- Native dev executable rebuilt at `src-tauri/target/debug/gnosis-tms`. Restart the
  dev app to use it. No native Windows run was available in this macOS workspace.
- Broker commit `470d53f` pushed to `main`; the production `/health` endpoint now
  returns version `0.2.1`, confirming DigitalOcean deployment.
- Desktop fixes are being published from `codex/credential-audit-fixes` in an
  isolated checkout. The user requested a PR and merge after verifying the fixes.
  PR #292 remains closed; no desktop release is part of this change.
- Unrelated-file fingerprints still match the pre-rollback records. No real user
  credential files were read, migrated, or deleted by these tests.

## PR delivery

1. Copy only the credential fixes, their tests and audit records, and the requested
   48-dot key mask into a branch from current `origin/main`.
2. Run the hooks and relevant checks in that isolated checkout, excluding unrelated
   in-progress import and launcher changes. Push and open a focused PR.
3. Confirm all required CI checks, merge the tested head, and verify GitHub reports
   the PR merged. Preserve the user's mixed working checkout throughout.
