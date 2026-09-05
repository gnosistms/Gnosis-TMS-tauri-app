# Non-interactive credential storage

Status: implemented; verified locally on macOS. Packaged Windows/Linux checks remain pending.

## Requirement

Credential storage must never ask for the user's OS password, including startup,
retry, saving keys, and development rebuilds. Preserve encrypted files and OS
entries when access is denied; continue to offer explicit session-only operation.
Keep the existing provider-independent direct API access and sharing protocol.

## Implementation

1. Disable macOS Keychain interaction for the lifetime of this process before any
   credential operation, using the existing Security framework adapter. Retain
   the guard permanently so parallel reads, retries, and errors cannot re-enable
   dialogs. Keep existing service/account identifiers for saved entries.
2. Use Secret Service directly on Linux with its documented zero prompt timeout.
   Refuse locked items/collections, preserve existing keyring attributes, and
   cancel any create-item prompt without displaying it. Keep Windows Credential
   Manager's non-interactive generic credential access.
3. Explain unavailable silent access in the existing recovery UI. Retry remains
   silent; session-only mode never overwrites the old vault or restores a token
   from the public attribution cache.
4. Add regression coverage for prompt suppression and fallback, run native and
   frontend checks, and update the PR branch from the earlier requested PR/merge.
   Validate without reading or modifying production credentials. Record platform
   and packaged-app testing limitations accurately.

## Validation

- Isolated feature branch native suite: **660 passed, 4 ignored**. The macOS
  regression checks the actual Security framework UI policy across concurrent
  entry creation and failed/missing reads. Locked and ambiguous Linux item
  selection is tested without requiring a desktop Secret Service.
- Opt-in native macOS Keychain smoke: **1 passed** with UI disabled throughout.
  Created, read, reopened, and deleted a uniquely named synthetic entry. No
  production credentials or keychain access permissions were changed.
- Targeted credential-storage/session-refresh/offline frontend suite: **27 passed**,
  including session-only GitHub sign-in after silent access is denied.
- Credential settings browser suite: **6 passed** using installed Chrome against
  the isolated feature worktree. The first attempt could not launch because the
  downloaded Playwright browser was absent; using installed Chrome resolved that
  environment issue.
- Rust formatting, targeted ESLint, and third-party notice generation passed.
  The direct platform dependencies were already present transitively; the notice
  content is unchanged. Windows/Linux packaged runtime checks remain pending.
