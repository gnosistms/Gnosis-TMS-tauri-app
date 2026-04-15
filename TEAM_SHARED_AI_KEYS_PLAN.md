# Team Shared AI Keys Plan

## Goal

Let a team owner or team admin configure shared AI provider API keys for a team so all team members can use the same provider accounts and team-scoped AI settings, while keeping plaintext keys out of git.

The chosen design must preserve direct provider calls from the desktop app:

- `desktop -> provider` for translation, review, and model listing
- `desktop -> broker` only for team key distribution, membership checks, and optional team settings sync helpers

## Non-goals

- Do not make the broker proxy normal AI inference traffic.
- Do not try to prevent trusted teammates from copying a decrypted provider key after they receive it.
- Do not rotate a provider key when a new member joins a team.
- Do not introduce one global AI key shared across multiple teams.

## Agreed trust model

- Team members are trusted colleagues.
- The main security requirement is:
  - no plaintext provider key committed to git
  - encryption in transit
  - broker re-checks current team membership before distributing a team key
- If a member leaves or is removed from the team, rotate the affected provider keys.
- If a new member joins, do not rotate the affected provider keys.

## Current codebase constraints

### Desktop app

- Local provider keys currently live in Stronghold at [src-tauri/src/ai_secret_storage.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/ai_secret_storage.rs).
- AI actions currently load a local provider key and call the provider directly in [src-tauri/src/ai/mod.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/ai/mod.rs).
- AI action/model preferences are currently scoped per signed-in login, not per team, in [src-ui/app/ai-action-preferences.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/ai-action-preferences.js).
- Team identity and installation identity already exist in [src-ui/app/team-storage.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/team-storage.js).

### Broker

- Broker sessions are already authenticated and validated in [src/security.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/security.js).
- Broker installation and team access checks already exist in [src/installation-access.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/installation-access.js).
- Team metadata is already a first-class concept in [src/team-metadata-repo.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/team-metadata-repo.js).
- The broker currently has no public-key registry, no team AI secret routes, and no webhook handling for this feature in [src/server.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/server.js).

## Chosen architecture

### 1. Team-scoped secret storage lives in `team-metadata`

Each team keeps its own encrypted AI secret records in that team's `team-metadata` repo.

Suggested files:

- `ai/settings.json`
- `ai/secrets.json`

`ai/settings.json` stores non-secret team configuration:

- provider/model selection per AI action
- any team-level defaults or enablement flags
- version metadata

`ai/secrets.json` stores encrypted team key material:

- one entry per provider
- canonical broker-recipient ciphertext for the provider key
- optional metadata about issuance and rotation

### 2. The broker owns a long-lived asymmetric keypair

- The broker private key is stored as a DigitalOcean encrypted secret.
- The broker public key is exposed to the desktop app and used for team secret wrapping.
- The broker private key is not committed to git.

This lets the repo hold ciphertext that only the broker can unwrap.

### 3. Each desktop app instance generates its own local recipient keypair

Do not depend on existing GitHub SSH keys for this feature.

Instead:

- generate an app-managed keypair locally on first use
- store the private key in local Stronghold
- keep the public key available for broker requests

This avoids:

- requiring every GitHub org user to already have SSH keys
- depending on `ssh-agent`
- trying to parse arbitrary local SSH private keys

This feature should treat the recipient keypair as app-owned local state, similar to the existing Stronghold-based AI key storage.

### 4. Canonical team secret flow

For each provider in a given team:

1. A team owner or team admin enters or rotates the provider API key.
2. The desktop app encrypts that provider key to the broker public key.
3. The encrypted payload is written into the team's `ai/secrets.json`.
4. The broker can later unwrap that ciphertext if a valid current team member requests access.

The canonical durable team secret is therefore:

- encrypted in the git repo
- decryptable by the broker
- not stored in plaintext in git

### 5. Member acquisition flow

When a team member needs a team provider key and does not already have a local decrypted cache entry:

1. The desktop app sends:
   - team identity
   - provider id
   - the member's app-generated public key
2. The broker authenticates the session.
3. The broker re-checks current team access.
4. The broker loads the canonical broker-recipient ciphertext for that team/provider from the team's `team-metadata` repo.
5. The broker decrypts with its private key.
6. The broker re-encrypts to the member's supplied public key.
7. The broker returns the member-recipient ciphertext.
8. The desktop app decrypts locally with its local private key.
9. The desktop app caches the plaintext provider key in local Stronghold under a team-scoped path.

The desktop app then continues calling the provider directly.

### 6. No broker hop on normal AI traffic

After the initial team key acquisition:

- the desktop app uses the cached team provider key locally
- translation, review, and model probing continue to call the provider directly

This preserves the current low-latency behavior for normal AI use.

## Team scoping rules

Everything in this feature must be scoped per team.

A user may belong to multiple teams, and each team may have different:

- provider keys
- enabled providers
- action-to-provider assignments
- action-to-model assignments

This means:

- no single global shared AI key
- no single global shared AI settings record
- local cache entries must include team identity

Suggested local cache shape:

- `team-ai/<installationId>/<provider>/api-key`
- `team-ai/<installationId>/member-private-key`
- `team-ai/<installationId>/member-public-key`

If a user belongs to three teams, they should end up with three distinct sets of cached team AI data.

## File format proposal

### `ai/settings.json`

Suggested shape:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-04-15T00:00:00.000Z",
  "updatedBy": "alice",
  "providers": {
    "openai": { "enabled": true },
    "gemini": { "enabled": false },
    "claude": { "enabled": false },
    "deepseek": { "enabled": false }
  },
  "actions": {
    "review": { "providerId": "openai", "modelId": "gpt-5.4-mini" },
    "translate": { "providerId": "openai", "modelId": "gpt-5.4-mini" },
    "glossary": { "providerId": "openai", "modelId": "gpt-5.4-mini" }
  }
}
```

### `ai/secrets.json`

Suggested shape:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-04-15T00:00:00.000Z",
  "updatedBy": "alice",
  "providers": {
    "openai": {
      "keyVersion": 3,
      "rotationReason": "manual",
      "brokerWrappedKey": {
        "algorithm": "x25519-sealed-box-v1",
        "ciphertext": "BASE64..."
      }
    },
    "gemini": null,
    "claude": null,
    "deepseek": null
  }
}
```

Notes:

- Keep the canonical durable record small.
- Do not require per-member ciphertext entries in git for the first implementation.
- Member-specific re-wraps can be returned by the broker on demand and cached locally.

This keeps the repo stable when new members join and avoids churn for every member acquisition.

## Join vs leave behavior

### New member joins

Do not rotate the provider key.

Behavior:

1. New member signs in.
2. New member opens team AI functionality.
3. If no local cached team provider key exists, the app requests a wrapped copy from the broker.
4. Broker validates current membership and returns a member-recipient ciphertext.
5. Client decrypts locally and caches it.

This is lazy provisioning on first use.

No repo rewrite is strictly required for the first implementation.

### Member leaves or is removed

Rotate the provider key.

Behavior:

1. Team owner or admin rotates the affected provider key.
2. App overwrites the canonical `brokerWrappedKey` entry in `ai/secrets.json`.
3. Remaining members can re-acquire the new team key through the broker on next use.
4. Old local caches become stale and should be invalidated by version mismatch.

This is the only durable way to prevent a removed member from continuing to use a previously decrypted provider key.

## Versioning and cache invalidation

Each provider entry should include `keyVersion`.

Local cache entries must include:

- provider id
- installation id
- key version

When the broker or repo reports a newer `keyVersion` than the local cache:

- discard the old local cached plaintext
- request a new wrapped copy from the broker
- cache the new plaintext under the new version

This gives a simple invalidation path after rotation.

## Team-scoped settings migration

This feature is not only about provider keys. Team-shared action/model settings must also move from per-login storage to team-scoped storage.

Current state:

- action settings are per login in [src-ui/app/ai-action-preferences.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/ai-action-preferences.js)

Target state:

- `ai/settings.json` becomes the team-shared source of truth
- the desktop app loads and edits settings for the selected team
- any local UI state for the AI settings screen may still exist transiently, but persistence must be team-scoped

Migration behavior:

- if a team has no `ai/settings.json` yet, seed it from the current user's existing settings the first time a team owner/admin saves shared AI settings
- after a team has shared AI settings, use team settings for that team
- personal per-login settings can remain as fallback for teams that have not opted into shared settings yet

## Permission model

Recommended write permissions:

- owners and team admins can edit `ai/settings.json`
- owners and team admins can rotate team provider keys
- normal members can request a wrapped team key for themselves
- normal members cannot change shared team AI settings

This should align with the broker's existing team access rules in [src/installation-access.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/installation-access.js).

## Broker API proposal

Add new broker endpoints for team AI flows.

Suggested routes:

- `GET /api/github-app/installations/:installationId/orgs/:orgLogin/team-ai/settings`
- `PUT /api/github-app/installations/:installationId/orgs/:orgLogin/team-ai/settings`
- `GET /api/github-app/installations/:installationId/orgs/:orgLogin/team-ai/secrets`
  - metadata only, never plaintext
- `PUT /api/github-app/installations/:installationId/orgs/:orgLogin/team-ai/providers/:providerId`
  - update canonical broker-wrapped ciphertext
- `POST /api/github-app/installations/:installationId/orgs/:orgLogin/team-ai/providers/:providerId/issue`
  - request a member-wrapped copy of the team key
- `GET /api/team-ai/broker-public-key`
  - fetch broker public key for wrapping

Important rule:

- the broker should identify the team secret by team identity and load the canonical ciphertext itself
- do not trust arbitrary client-supplied ciphertext as the canonical source of truth

## Desktop app implementation outline

### Stage 1: local crypto material

Add new local secret storage for:

- app-managed member private key
- app-managed member public key
- team-scoped cached plaintext provider keys

Suggested new backend module:

- `src-tauri/src/team_ai_secret_storage.rs`

Suggested responsibilities:

- generate local member keypair
- load/store local member keypair
- load/store team-scoped cached provider keys
- clear stale team-scoped cached provider keys

### Stage 2: team AI metadata models

Add new desktop-side types and helpers for:

- parsing `ai/settings.json`
- parsing `ai/secrets.json`
- resolving current selected team's team AI configuration
- detecting stale local cache by `keyVersion`

Suggested areas to extend:

- `src-ui/app/team-metadata-flow.js`
- new `src-ui/app/team-ai-settings.js`
- new `src-ui/app/team-ai-secrets.js`

### Stage 3: AI settings screen changes

Extend the AI settings page so it can switch between:

- personal AI settings
- team shared AI settings for the selected team

Recommended first implementation:

- when a GitHub App team is selected, show a shared team settings mode
- allow owners/admins to save team provider keys and team action/model assignments
- allow normal members to view which providers/actions are configured, but not edit them

### Stage 4: team key acquisition flow

Before any direct AI provider call:

1. Resolve whether the current team has shared team AI enabled for the relevant provider.
2. If not, fall back to existing personal-key logic.
3. If yes:
   - ensure the member keypair exists locally
   - load the current team secret metadata
   - compare local cached key version
   - if missing or stale, call the broker issue endpoint
   - decrypt the wrapped response locally
   - cache the plaintext provider key locally

Then reuse the current direct provider call path.

### Stage 5: wire translation/review/model loading

Update the existing local key resolution path in [src-tauri/src/ai/mod.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/ai/mod.rs) so it can resolve:

- personal provider key
- or team-shared provider key for the active selected team

The underlying provider call code should remain unchanged.

## Broker implementation outline

### Stage 1: broker keypair support

Add broker config for:

- broker private key secret
- broker public key distribution endpoint

The private key must come from DigitalOcean encrypted environment secrets.

### Stage 2: team AI metadata repo helpers

Add broker helpers for:

- loading `ai/settings.json`
- saving `ai/settings.json`
- loading `ai/secrets.json`
- saving `ai/secrets.json`

This should build on the existing team metadata repo helpers in [src/team-metadata-repo.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/team-metadata-repo.js).

### Stage 3: wrap and unwrap helpers

Add crypto helpers for:

- wrapping plaintext provider keys to broker public key
- unwrapping canonical broker ciphertext with broker private key
- re-wrapping plaintext provider keys to a member public key

### Stage 4: issue endpoint

Add the member issue endpoint:

- validate session
- validate current team membership
- load canonical team ciphertext from repo
- decrypt with broker private key
- encrypt to the caller's public key
- return member-recipient ciphertext plus `keyVersion`

### Stage 5: settings and rotation endpoints

Add routes for:

- saving team settings
- saving or rotating canonical team provider ciphertext

These routes must require owner/admin-level access.

## Data migration plan

### Existing personal keys

Do not delete or auto-migrate personal local provider keys immediately.

Behavior:

- personal keys remain usable for teams that have not opted into team shared AI
- once a team enables shared AI for a provider, the selected team should prefer the shared provider key for that provider

### Existing per-login action preferences

Do not hard-delete the current per-login preference store immediately.

Behavior:

- keep reading old per-login settings as fallback
- team shared AI settings override them for teams that opt in
- later cleanup can remove unused per-login settings after the shared feature is stable

## Failure behavior

### Missing local member keypair

- generate one automatically

### Broker unavailable while local cached team key exists

- continue using the cached team provider key if the local `keyVersion` still matches the last known team metadata

### Broker unavailable and no local cached team key exists

- show a clear error:
  - team AI key could not be issued right now

### Team secret missing for provider

- show a clear error:
  - this team has not configured a shared key for that provider

### User lost access to the team

- broker issue endpoint must reject the request
- desktop app should clear team-scoped cached keys for that team on access-loss recovery

## Security properties of this design

This design provides:

- no plaintext provider keys committed to git
- encrypted transport between desktop, broker, GitHub, and provider
- no provider inference latency through the broker
- current membership check before team key issuance
- straightforward rotation on member removal

This design does not provide:

- protection against a currently trusted member copying the plaintext provider key after local decryption
- retroactive protection without rotation after a member leaves

Those tradeoffs are accepted for this feature.

## Open questions

1. Should team shared AI be opt-in per team or the default for any GitHub App team?
2. Should a team be able to configure some providers as shared and others as personal-only?
3. Should normal members be allowed to see which provider is configured for the team, or only the effective model/action labels?
4. Should the broker issue endpoint return a one-time member ciphertext only, or should it also optionally persist per-member wraps later for faster multi-device onboarding?

Recommended first answer:

- opt-in per team
- shared per provider
- members can view configured provider/model selections
- broker only returns transient member-wrapped ciphertext in v1

## Testing plan

### Desktop app

- unit tests for member keypair generation and local cache storage
- unit tests for team-scoped cache invalidation by `keyVersion`
- tests for shared-team vs personal-key resolution
- tests for settings UI behavior by role

### Broker

- tests for broker keypair load and wrap/unwrap round-trips
- tests for issue endpoint permission checks
- tests for issue endpoint re-wrap behavior
- tests for settings save and rotation flows

### End-to-end

1. Team owner configures shared OpenAI key for Team A.
2. Member A acquires Team A key and runs review/translation.
3. Same user joins Team B with a different provider key and receives a different effective key.
4. New member joins Team A and acquires Team A key without rotation.
5. Member removed from Team A cannot re-acquire.
6. Team owner rotates Team A key and old local cached version is rejected or refreshed.

## Recommended implementation order

1. Add team AI metadata file formats and desktop-side loaders.
2. Add broker public/private key support and wrap helpers.
3. Add local member keypair storage and team-scoped cached provider key storage.
4. Add broker issue endpoint.
5. Add team-shared AI settings screen and save flows.
6. Wire direct AI calls to resolve team-shared provider keys when configured.
7. Add rotation flow and stale-cache invalidation.
8. Add tests across app and broker repos.

## Summary

The implementation should use:

- team-scoped shared AI settings in `team-metadata`
- repo-stored broker-recipient ciphertext as the canonical durable team secret
- a broker private key stored in DigitalOcean secrets
- app-generated local member keypairs for broker re-wrap responses
- direct provider calls from the desktop app after local team key acquisition

This satisfies the agreed requirements:

- no plaintext keys in git
- no inference slowdown from broker mediation
- no rotation on member join
- rotation on member removal
- separate keys and settings for each team
