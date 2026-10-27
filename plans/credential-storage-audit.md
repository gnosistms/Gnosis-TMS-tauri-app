# Original credential model: practical audit

Date: 2026-09-05. Desktop baseline: `0ab3e3c6`; broker: `50ab5dde`.

Follow-up: the three findings below are now fixed in the desktop checkout and
broker `470d53f` (deployed as `0.2.1`). See
[`credential-audit-fixes-plan.md`](credential-audit-fixes-plan.md) for implementation
and verification. The descriptions below preserve the original audit evidence.

## Decision and rollback

Restore the original model. Keep credentials convenient to use, remember the
GitHub login, avoid OS password prompts, and accept recovery by a determined
person controlling the local account. A stronger OS vault, temporary provider
credentials, and broker-assisted startup decryption are outside this change.

PR #292 was closed without merging. The 46 affected feature paths were restored
selectively; overlapping import changes in `lib.rs` and `state.js` were preserved.
The independently requested 48-dot saved-key mask and its browser assertion remain.
No broker code, application credential files, or OS entries were changed.

## Findings worth fixing

### 1. A delayed refresh can restore an account after sign-out — P2

`src-ui/app/runtime.js:412-423` accepts a refreshed session when the current
session is null and saves it unconditionally. If a background request begins a
refresh and the user signs out before it finishes, the completed refresh restores
the old account in memory and on disk. Switching accounts prevents that particular
in-memory assignment but still allows the old account to overwrite the disk login.

Reproduced against the real runtime module with a deferred synthetic refresh:
start as Alice, reset the session while refreshing, complete the request, and
observe Alice restored and a native save invoked.

Small fix: reject stale refresh results using a session generation/current-token
guard, and apply the same guard to the native save so a queued write cannot race
with sign-out. No change to credential encryption is necessary.

### 2. Login save and deletion failures are silently ignored — P2

`src-ui/app/auth-storage.js:25-51` resolves successfully when the native save or
clear command fails. `src-ui/app/navigation.js:227-228` starts deletion without
waiting before resetting the visible session. A disk/permission failure can
therefore cause a login to disappear on restart or a supposedly signed-out login
to return. The refresh path also ignores persistence failure.

Reproduced with rejecting native save/delete handlers: both exported functions
complete without reporting failure to their callers.

Small fix: await deletion and report actual save/delete failures. Normal startup
and successful operations should stay silent; no storage-choice UI is needed.

### 3. Removing and re-adding a team key can leave clients on the old key — P2

`gnosis-tms-github-app-broker/src/team-ai.js:146-156` removes the provider record
on clear, then starts its version at 1 when a new key is added. A member that last
cached version 1 and missed the intermediate cleared state will see a different
key with the same version. The app skips replacement when versions match in
`src-ui/app/team-ai-flow.js:685-689`, and even authentication-error recovery refuses
to fetch a replacement when that version matches (`:793-797`). The old key can
continue being used, or requests can remain broken after it is revoked.

Reproduced with the actual broker save function and an in-memory metadata fixture:
save first key -> version 1; clear; save different key -> version 1 again. Existing
frontend tests also explicitly cover refusing to reissue an unchanged version.

Small fix: keep a monotonic revision across clear/re-add, or use a fresh opaque key
revision understood by clients. Preserve compatibility with released clients.

## What the current model gets right

- Production broker and provider endpoints use HTTPS. Provider keys are sent in
  authentication headers, including Gemini's `x-goog-api-key`, rather than URL
  query parameters.
- Shared keys are RSA-OAEP/SHA-256 wrapped for the broker, stored as wrapped
  ciphertext in team metadata, and rewrapped to the requesting member's public
  key. Broker metadata responses contain availability/version information.
- Broker routes require a valid session. Saving/removing team keys requires owner
  access; issuance checks installation membership and rejects viewers. Existing
  tests cover allowed roles, rejected non-members/viewers, and crypto round trips.
- Saved keys are absent from the Settings input value, with copy/cut/drag blocked.
  Error telemetry omits command arguments and applies secret-pattern scrubbing.
- Local snapshot writes are serialized within one process, and corrupted snapshots
  return errors rather than being silently replaced with an empty store.

No unauthenticated issuance path or routine plaintext provider-key logging was
identified in these reviewed paths. This is a scoped source audit and synthetic
regression check, not a penetration-test guarantee or a live account audit.

## Accepted limits

- The local Stronghold password is a hash of a fixed label and snapshot path. The
  file is encrypted, but its key is reproducible; this is obfuscation against casual
  inspection, not strong secrecy for copied app data. The broker login is stored
  in a normal app-data JSON file. Both are recoverable with local-account access.
- A member can retain a key once received. Removing membership or deleting the
  shared record does not revoke that provider credential. Rotate/revoke at the
  provider when invalidating copies is required.
- Broker membership reads deliberately accept cached authorization for up to
  30 minutes, an already documented product decision. Do not describe removal as
  immediate revocation of future issuance or previously delivered keys.
- The original snapshot mutex coordinates threads, not separate running app
  processes. This audit does not add a new persistence architecture to address it.

## Verification

- Local dev executable rebuilt successfully with the original storage path.
- Frontend unit suite: 2,052 passed.
- Workflow suite: 17 passed. The initial sandboxed run could not start four local
  server fixtures; the permitted rerun passed all of them.
- Filtered native suite: 169 passed, 1 ignored, 470 filtered out.
- Broker suite: 63 passed; no broker edits or live credential use.
- Three synthetic reproductions confirmed the findings above.
- Startup and AI Settings browser checks: 5 passed in Chrome.
- Changed-file ESLint and whitespace checks passed; unrelated-file fingerprints
  matched the pre-rollback contents.

The rollback was completed before the separate follow-up fixes linked above.
