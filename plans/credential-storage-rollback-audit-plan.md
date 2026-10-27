# Credential storage rollback and practical audit

## Decision

Hans requested rolling back the OS-backed credential storage work on 2026-09-05.
The original threat model accepts that a determined local user can recover API
keys. Avoid extra OS passwords, repeated GitHub sign-ins, and added broker/vault
complexity. Keep the independently requested longer saved-key mask.

## Steps

1. Close unmerged PR #292. Restore only this feature's changes in the main
   checkout, preserving concurrent work on imports, exports, and the dev launcher.
   Archive the discarded source in its existing PR branch; do not delete any
   application credential files or OS entries.
2. Check the restored native/frontend paths and rebuild the local dev executable.
   Verify that the original stored-login flow and non-Keychain storage are back.
3. Audit the original app and broker for accidental key exposure, incorrect team
   authorization, stale credentials, unsafe transport, and logging. Distinguish
   actionable defects from accepted local-user extraction and rotation limits.
4. Record evidence and concrete findings. Do not redesign or modify the broker as
   part of this audit. Any fixes should remain small and scoped to actual defects.

## Status

Rollback and audit complete. PR #292 is closed without merging. Source restoration
preserved concurrent edits and left only the longer mask and its assertion from
this feature. The dev executable has been rebuilt; restart the app to load it.

See `credential-storage-audit.md` for the three reproduced lifecycle findings,
positive checks, accepted limits, and test results. All five startup/AI Settings
browser checks passed in Chrome against an isolated Vite server. Changed-file
ESLint and whitespace checks passed. Original unrelated file contents were
fingerprinted before rollback and verified unchanged afterward.
