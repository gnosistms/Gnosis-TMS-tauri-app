# Security Update — Batch 1 Post-Review Adjustments

## Context

PR #3 (Batch 1 Rust review fixes) introduced OS keychain integration for two
storage concerns:

1. **Stronghold encryption key** (`ai_secret_storage.rs`) — moved from a
   deterministic SHA-256 key to a randomly-generated key stored in the OS
   credential store (Keychain/Secret Service/Credential Manager).
2. **Broker session token** (`broker_auth_storage.rs`) — moved from plain JSON
   to a split layout: display fields in JSON, bearer token in the OS keychain.

After testing, Hans decided not to keep the OS keychain integration. His reasoning:

> "I'm not really concerned about that attack vector [user extracting their own
> stored API key from their own machine]. The keys we're storing are the
> OpenAI/Anthropic API keys. Strong encryption is needed when the keys are IN
> MOTION (sent from the team owner to other members via Stronghold). But we
> don't need to be so strict about encryption once the API key is stored on each
> team member's local computer. I'm not willing to complicate the design in
> order to harden that part of the security."

## Decision: Option A — Revert to deterministic key, no OS keychain dependency

`a0966c53` ("Keep auth secrets in internal app storage") already implements this
for both concerns:

- **Stronghold key**: reverted to `stronghold_password()` (SHA-256 of a
  hardcoded string + file path). `try_set_encrypt_work_factor(0)` restored for
  compatibility with existing snapshots. Documented as an accepted tradeoff.
- **Broker session token**: `save_broker_auth_session` writes the full session
  (including token) back to plain JSON. `load_broker_auth_session` returns the
  full `BrokerSession` directly as a Tauri command.
- **`keyring` crate**: removed from `Cargo.toml` and `Cargo.lock`.

## Remaining work in this branch

Several post-review fixes from `batch_1_rust_review` were pushed after PR #3
merged and are not yet in `rust_review_cycle`. They need to be carried forward:

| Finding | File | Fix |
|---------|------|-----|
| M2 | `broker_auth_storage.rs` | Pre-remove before `fs::rename` in `atomic_write` (Windows fix) |
| M3 | `installation_access.rs` | Pre-remove before `fs::rename` in `write_installation_access_snapshot` (Windows fix) |
| M1 | `ai-settings-flow.js` | Route empty `apiKey` to `clear_ai_provider_secret` |
| m1 | `repo-write-queue.js` | Gate `logRepoWriteDiagnostic` behind `DEBUG_REPO_WRITE = false` |
| m2 | `editor-queued-write.js` | Gate editor write logging behind `DEBUG_EDITOR_WRITE = false` |

S1 (session pre-check before installation access cache hit) and S2 (Stronghold
snapshot backup-on-error) are moot: S1's risk is partially mitigated by the
downstream commit check, and S2's migration path was removed with `a0966c53`.

## Out of scope

The at-rest confidentiality of AI API keys and the broker session token against
a local attacker is an **accepted known limitation** per Hans's threat model.
It should be documented in `src-tauri/AGENTS.md` and the storage architecture
table, not re-hardened in this branch.
