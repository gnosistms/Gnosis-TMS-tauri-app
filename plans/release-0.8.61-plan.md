# Release 0.8.61

Date: 2026-07-08

## Contents

Security hardening and telemetry-noise cleanup batch.

### Security hardening (PR #168)
- **DOCX import** — bound XML-part decompression by actual bytes read, so a crafted
  archive that under-declares its uncompressed size can no longer expand unbounded on
  read (import-file DoS).
- **TXT import** — cap imported rows at 20,000 (matching DOCX) so a dense text file can't
  allocate an unbounded number of rows.
- **Project repo sync** — always restore the original branch after a worktree backup, even
  if the backup add/commit failed, so HEAD can't strand on the backup branch (which a
  later reconcile could push over remote history).
- **AI-secret storage** — serialize stronghold snapshot writes so a clear racing an
  in-flight save can no longer re-persist a just-cleared secret.

### Telemetry (PR #170)
- Report `repo_write_overdue` at most once per operation type per session (was flooding
  one issue with an event per operation).
- Skip expected user-input/validation failures and the retried best-effort team-metadata
  pull in the command-failure classifier.
- Set the Sentry user id to the install id so issue user-counts are meaningful.

## Steps
- [x] Bump version to 0.8.61 (package.json, Cargo.toml, tauri.conf.json, lockfiles).
- [x] Commit "Release 0.8.61" to main.
- [x] Tag `v0.8.61` and push → triggers `release-tauri.yml` (macOS arm64/x64, Windows).
- [ ] Confirm the release build + updater artifacts publish successfully.
- [ ] After publish: mark the fixed Sentry issues resolved in 0.8.61.
