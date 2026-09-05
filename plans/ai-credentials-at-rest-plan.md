# Protect local AI credentials at rest

Status: implemented. Automated checks and a native macOS Keychain smoke test pass;
packaged upgrade checks on macOS, Windows, and Linux remain pending.

## Decision and scope

Use provider-independent local encryption while retaining the existing encrypted
team-sharing protocol and direct requests to OpenAI, Gemini, Claude, and DeepSeek.
Defer provider-issued temporary credentials. Do not add an AI proxy or a broker
round trip to each AI action.

The proposed baseline is a random Stronghold vault key protected by the operating
system credential store, with secret handling in Rust. It protects persisted
application data; it does not promise secrecy from a determined machine owner or
malware controlling the unlocked process. Memory clearing is best effort, not a
guarantee against swap, crash dumps, or copies inside HTTP/crypto libraries.

This intentionally revisits F-VIII, which accepted deterministic local encryption
and plaintext broker-session storage. Update the foundational principle,
constitution guardrails, backend storage guidance, and their relevant evidence
references with implementation. Preserve the history of the earlier decision.

## Existing behavior to preserve

- Team metadata contains broker-encrypted provider keys. The broker checks access,
  decrypts a key, and re-encrypts it for a member using RSA-OAEP/SHA-256.
- Personal keys and team keys are separate; team keys have versions and scoped
  member keypairs. Preserve namespaces, invalid-key recovery, and access checks.
- Saved keys are masked and are not revealed or copied from AI Settings. Unsaved
  replacement drafts remain editable and are validated before replacing a key.
- Local settings and cached availability load before background network refreshes.
  Sync never disables unrelated actions or delays local editing.
- Existing snapshot mutation serialization prevents clears from being undone by
  concurrent saves. Preserve this across migration and the new storage service.

Relevant implementation: `src-tauri/src/ai_secret_storage.rs`,
`src-tauri/src/broker_auth_storage.rs`, `src-tauri/src/team_ai.rs`,
`src-tauri/src/lib.rs`, `src-tauri/src/ai/mod.rs`,
`src-ui/app/team-ai-flow.js`, `src-tauri/src/team_ai_crypto.rs`,
`src-ui/app/ai-settings-flow.js`, and `src-ui/app/auth-storage.js`.

Related work: `ai-key-masking-plan.md`, `ai-key-review-fixes-plan.md`, and
`ai-settings-local-first-plan.md`. Several affected files already have uncommitted
changes; integrate with those changes without resetting or replacing them.

## Implementation sequence

1. **Introduce secure storage behind a Rust interface.**
   - Evaluate the maintained Rust keyring ecosystem and select only the necessary
     platform adapters: macOS Keychain, Windows Credential Manager, and Linux
     Secret Service. Pin compatible dependencies and update third-party notices.
     References: <https://docs.rs/keyring/latest/keyring/> and
     <https://v2.tauri.app/plugin/stronghold/>.
   - Generate a cryptographically random 256-bit vault key. Persist that key only
     in the OS credential store and use a new versioned Stronghold snapshot.
     Credential identifiers must be stable across app upgrades and distinguish
     separate installations/data profiles, including development and production.
   - Keep unlocked storage and credentials in a Rust-owned service. Avoid repeated
     OS prompts and disk opens for normal AI requests. Run blocking storage work
     off the async executor and do not hold storage locks across network calls.
   - Distinguish missing, locked, denied, unavailable, and corrupt storage. Never
     create a replacement key when an existing vault cannot be unlocked.
     Use injectable adapters for tests and the existing `zeroize` dependency for
     owned secret buffers where practical.

2. **Migrate provider keys, member keypairs, and broker login together.**
   - Inventory every record in the old snapshot, including all providers, team
     namespaces, key versions, and member keypairs. Audit uses of generic storage
     helpers so migration does not omit existing records.
   - Read the legacy snapshot using its existing derivation and work factor;
     never change legacy decoding parameters in place. Import the broker session
     from `broker-auth-session.json` into protected storage as well.
   - Serialize migration with reads/writes/clears. Write the new snapshot safely,
     reopen it with the OS-protected key, and verify all migrated records before
     committing the transition and removing legacy files and temporary copies.
   - Make interrupted migration resumable. Do not repeatedly import stale legacy
     data after a successful transition or resurrect a deleted key/session.
     Surface cleanup failures; do not report complete protection while recoverable
     legacy credentials remain. File deletion cannot erase historical backups.
   - Missing OS credentials with an existing vault must produce a recovery state,
     not an empty vault. Recovery uses team reauthentication/reissuance or personal
     key re-entry; never destroy an unreadable vault automatically.

3. **Move stored-key reads and team cryptography out of JavaScript.**
   - Replace frontend key reads with presence, key-version, and storage-status
     responses. Remove registered IPC commands that return stored provider keys
     or member private keys after all callers are migrated.
   - Generate/store member keypairs, wrap owner-provided keys, request issuance,
     decrypt member responses, and update the cache in Rust. Preserve the existing
     broker wire format and access enforcement; no broker deployment is expected.
   - Keep candidate-key validation before persistence and preserve the current
     masking, removal, draft, navigation, and background-refresh behavior.
     User-entered drafts necessarily pass through the frontend, then are cleared
     after successful handling. Do not return saved secrets to refill those fields.
   - Preserve account/team/provider guards at the backend commit point as well as
     in the frontend, so delayed issuance cannot restore cleared credentials.
     Provider HTTP clients continue using credentials internally in Rust.
   - This work protects broker-token persistence. Replacing every existing
     frontend broker-session argument with a new authentication architecture is
     outside scope; do not claim the broker token is absent from runtime JS.

4. **Define failure, fallback, and lifecycle behavior.**
   - If secure persistence is unavailable, allow session-only credentials with a
     clear explanation that keys/login will need to be supplied again after exit.
     This fallback uses the same provider and broker APIs on every platform.
     Never fall back to a deterministic password, plaintext file, or ordinary
     browser/local storage for secrets.
   - A locked existing vault must remain intact. Let the user retry/unlock it;
     any session-only continuation must not overwrite or silently replace it.
     During legacy migration, report migration as incomplete until legacy copies
     are handled; fallback alone must not be described as completed migration.
   - Replace auth-storage error swallowing where needed so persistence failures
     are visible and an unsuccessful credential deletion cannot masquerade as a
     completed sign-out. Keep offline/local editing available.
   - Clear applicable in-memory credentials and invalidate pending writes on
     sign-out, account change, removal, or confirmed team-access loss. Retain
     unrelated personal/team data according to existing cleanup semantics.
     Check snapshot deletion/reset paths and OS-entry cleanup together.
   - Never include keys, private PEMs, or tokens in logs, events, errors, telemetry,
     test snapshots, or temporary diagnostic artifacts.

5. **Verify behavior and update the security contract.**
   - Test native storage first using synthetic secrets: restart persistence,
     namespace isolation, missing/locked/denied stores, corrupted snapshots,
     concurrent save/clear, and session-only mode.
   - Test complete and interrupted migration, verification/cleanup failure,
     multiple teams/providers, absent legacy sources, and prevention of stale
     re-import after deletion or sign-out.
   - Test the team exchange with a mock broker using the existing crypto format;
     verify status IPC responses contain no stored keys or private keypairs.
     Mock all four provider paths and verify warm requests do not contact the
     broker or OS credential store for each inference.
   - Run affected native/frontend tests, AI settings browser checks, `npm test`,
     and `npm run audit:unused`; compare existing failures with the baseline.
   - Verify packaged macOS and Windows builds, including app upgrades, OS prompts,
     sign-out/restart, and offline startup. Verify Linux both with Secret Service
     and without it. Do not claim cross-platform completion from mocked tests or
     macOS-only results; record any outstanding platform validation explicitly.
   - Update F-VIII and related guidance to state the new at-rest guarantee and its
     limits. No promise of preventing extraction from a running, unlocked app,
     and no claim that removing local access revokes a copied provider API key.

## Completion criteria

New credentials persist only under an OS-protected random vault key, or remain
session-only. Legacy migration is verified and its cleanup status is explicit.
Stored provider keys and member private keys do not return through frontend IPC.
All providers retain direct access, existing settings/sharing behavior is preserved,
and platform-specific persistence and fallback behavior have recorded verification.


## Implementation record — 2026-09-05

- `credential_vault.rs` owns a cached, Rust-only record store backed by a Stronghold
  snapshot and a random 256-bit key. `keyring` 3.6.3 uses Apple native storage,
  Windows native storage, or Linux synchronous Secret Service with vendored D-Bus.
  `aws-lc-rs` 1.18.1 implements RSA-OAEP/SHA-256, and `fs2` 0.4.3 supplies the
  lifetime exclusive snapshot lock. Dependencies are pinned; third-party notices
  have been regenerated.
- Production snapshot: `credentials-v3.hold`. Debug builds deliberately use
  `credentials-development-v3.hold`, require separate login/key setup, and do not
  migrate the shared legacy production files. Migration takes place in the packaged
  release profile. The OS account identifier hashes the full snapshot path under
  the service `com.gnosis.tms.credentials`, separating data directories and profiles.
- Migration inventories every old Stronghold record, including WordPress
  credentials stored by the existing generic helpers, and imports broker login
  JSON from its original app-data location. It writes, reopens, and compares the
  new snapshot before replacing it and cleaning up old JSON/snapshot files. A
  valid pending snapshot can resume publication; a corrupt pending or final file
  stays intact for recovery. Once published, the new snapshot is authoritative
  and old copies cannot reintroduce deleted credentials.
- Failed unlocks are cached until an explicit retry, avoiding repeated OS prompts.
  Session-only mode does not decrypt or modify vault files and also works when the
  data directory is unwritable. It is explicit for each app run; restarting is
  required to return from that mode to persistent storage.
- `credential-storage-no-prompts-plan.md` supersedes interactive OS access: macOS
  retains a process-lifetime Security framework guard that disables dialogs;
  Linux uses `dbus-secret-service` 4.1.0 directly with a zero prompt timeout and
  the existing keyring attributes. Windows retains generic Credential Manager
  access. Startup, retries, saves, and cleanup all remain non-interactive. No
  existing vault or OS entry is deleted or reset to avoid a prompt.
- Review fixes in `credential-storage-review-fixes-plan.md` use a writable handle
  for Windows snapshot flushing and allow an already-open vault to transition to
  session-only mode after persistence fails. Public GitHub author fields are
  cached separately, bound to the encrypted snapshot hash, so local attribution
  does not require an OS unlock or a broker token. The public cache is updated on
  migration, unlock, account changes, and sign-out; it never grants remote access.
- Stored key/keypair IPC reads have been removed. Presence/version responses and
  opaque, short-lived issuance tickets replace them. Native session and provider
  revisions invalidate delayed writes on account changes, sign-out, key removal,
  and confirmed access loss. Access loss clears the affected team's member pair
  and all provider keys; other teams and personal keys remain intact.
- Broker login writes/deletes are awaited and failures are visible. A late token
  refresh must match the currently stored session before it can commit. Sign-out
  removes the login and team credentials in one vault update. Personal and
  WordPress records remain. The OS entry is retained with the remaining snapshot;
  there is no automatic whole-vault reset that could strand those records.
- Existing direct provider requests and broker wire formats are preserved. The
  original WebCrypto code is now only a test reference in
  `src-ui/test/team-ai-webcrypto.js`. The saved-key field retains its 48-dot mask.

## Verification record

All credentials used by the new tests are synthetic; production credentials were
not read for testing or manually migrated during this work.

- Native library suite: **652 passed, 4 ignored**. Covers encrypted restart,
  migration and cleanup/recovery failures, namespaces, pending-file recovery,
  exclusive locks, blocked-store retries, session-only persistence behavior,
  broker-session races, and team cleanup. Three existing ignored tests remain;
  the fourth is the opt-in OS-store smoke test below.
- Native macOS Keychain smoke: **1 passed**, run explicitly. A unique synthetic
  entry was created, used to reopen an encrypted vault, and removed afterward.
  This validates the adapter on this machine, not packaged signing/upgrade behavior.
- Native/WebCrypto interoperability: native owner wrapping and member decryption
  checked in both directions for all four provider identifiers. Existing mock
  broker tests verify routes, request formats, clear semantics, and access errors.
- `npm test`: **2,051 frontend tests and 17 workflow tests passed**. Local-server
  tests required localhost access outside the restricted sandbox.
- AI Settings Playwright checks: **6 passed** in Chrome, including the long saved
  mask, replacement drafts, cached settings, unavailable-storage controls, and
  offline startup. The warning layout was visually inspected.
- Frontend production build passed. Targeted ESLint and `git diff --check` passed.
  Native `cargo clippy --lib --offline -- -D warnings` passed during verification.
- `npm run audit:unused` reports only unrelated existing checkout issues: two
  benchmark scripts, the development launcher installer, five app-update browser
  imports, and `ensureEditorFootnoteEntry`. No credential-storage finding.
- Third-party notice generation passed using the existing cargo-about allowlist.
  The separate `cargo deny ... check licenses` command could not run because
  cargo-deny is not installed on this host.

### Remaining platform checks before release

1. Packaged/signed macOS upgrade from v2 storage: verify migration, Keychain prompts,
   restart, sign-out, and offline startup with a synthetic fixture profile.
2. Packaged Windows: perform the same upgrade/restart checks, verify Credential
   Manager and atomic snapshot replacement, and exercise denied/missing OS entries.
3. Packaged Linux: verify Secret Service persistence when available and explicit
   session-only behavior when unavailable or locked.

These checks have not been performed here. The implementation does not claim that
mocked native tests or the macOS adapter test establish packaged cross-platform
validation. Restoring a lost OS entry/unreadable snapshot remains an explicit
recovery operation; session-only mode preserves it and allows reauthentication/key
re-entry without silently overwriting it.
