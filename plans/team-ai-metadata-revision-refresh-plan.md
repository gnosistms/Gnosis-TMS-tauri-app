# Team AI refresh from team-metadata revisions

**Status:** implemented  
**Scope:** desktop app; no broker response expansion required for the routine refresh path

## Goal

Keep shared team AI settings and cached provider keys current without checking the
broker before every AI action and without adding network work to ordinary page
refreshes.

Use the commit ID already returned by each successful `team-metadata` repository
sync as the change signal. Only inspect the small local AI metadata files when that
commit changes. Only request an issued provider key when its version actually
changed.

The invalid-key recovery path follows the same rule: first fetch metadata and compare
versions; do not request or retry with a team key when the broker still reports the
same version.

## Current behavior and useful existing infrastructure

- `sync_local_team_metadata_repo` already pulls the team's `team-metadata` Git
  repository and returns `currentHeadOid` in `LocalTeamMetadataRepoInfo`.
- Project, glossary, and QA metadata readers share that sync through a TanStack query
  with a 30-second stale window. Actual network syncs are therefore already deduped.
- Team AI settings live at `ai/settings.json` in that repository.
- Team AI secret records live at `ai/secrets.json`. The desktop only needs the
  non-secret summary: configured status, provider ID, wrapping algorithm, and
  `keyVersion`; it must not return the broker-wrapped ciphertext to the JS layer.
- The stored team AI snapshot already persists settings and secret metadata per user,
  installation, and organization.
- The local provider-key cache already stores its corresponding `keyVersion`.
- Invalid provider credentials are now intercepted centrally and retried at most once,
  but the current recovery implementation force-refreshes both AI metadata documents
  and forces key issuance even when the version did not change.

## Design

### 1. Treat the team-metadata HEAD as the inexpensive change signal

At the successful `syncTeamMetadataRepoShared` query function boundary, capture the
returned `currentHeadOid`.

- Put the AI reconciliation trigger inside the query function, after a real sync,
  rather than after every caller receives query data. A 30-second cache hit must not
  start duplicate work.
- Schedule reconciliation without awaiting it from project, glossary, or QA page
  loading. Page refresh completion must remain independent of AI reconciliation.
- Deduplicate reconciliation by `{installationId, currentHeadOid}` so concurrent
  project/glossary/QA readers share one operation.
- Ignore a result if the selected team or signed-in user changed before it is applied.

Persist `lastInspectedTeamMetadataHeadOid` in the team AI snapshot. If the new HEAD is
identical, do nothing: no file read, no provider-cache read, and no broker call.

The HEAD is deliberately a broad signal. A resource or membership metadata commit may
cause one local AI metadata read even though AI did not change. That is acceptable:
the read is local, rare relative to cached refreshes, and avoids adding a new remote
AI-specific check.

### 2. Read the AI snapshot from the already-synced local repository

Add a Rust/Tauri read command, for example `load_local_team_ai_metadata_snapshot`,
scoped by `installationId`.

The command must:

- Resolve the existing local `team-metadata` repository through the established
  installation-scoped path helpers.
- Read `ai/settings.json` and `ai/secrets.json` from the synced HEAD. Prefer reading
  the committed HEAD versions so a partial or unrelated working-tree change cannot be
  mistaken for shared state.
- Normalize missing files to empty/default settings and provider metadata.
- Validate schema and positive key versions consistently with the broker and existing
  JS normalizers.
- Return settings plus only this secret summary for each provider:
  `{ configured, keyVersion, algorithm }`.
- Never return `brokerWrappedKey`, ciphertext, or any plaintext provider key.
- Return the inspected `currentHeadOid` with the snapshot so JS can atomically associate
  data with its revision.

This adds no network request. Parsing two small local JSON files occurs only after the
repository HEAD changes.

### 3. Reconcile settings and provider keys after a changed revision

Add a team-AI reconciliation function that accepts the synced team context and local
snapshot.

For non-secret settings:

- Apply the normalized `actionPreferences` to the team-scoped AI snapshot.
- Persist them with the inspected HEAD.
- If the selected team is still current, update the visible AI action configuration.
- This replaces routine broker reads for settings. AI Settings remains the explicit
  authoritative broker refresh surface.

For each provider:

- Load only the local cached provider record needed for comparison.
- If remote metadata is unconfigured and a team cache exists, clear that team cache.
- If `keyVersion` equals the cached version, leave the key untouched.
- If the provider is configured and `keyVersion` differs or the local cache is absent,
  issue the current provider key in the background, decrypt it, and save it with the
  returned version.
- Do not block the page, show a modal, or replace a still-usable cached key when
  background reconciliation fails. Leave the revision unacknowledged when a retry is
  necessary, or persist a separate `lastMetadataReadHeadOid` and per-provider pending
  version so the next genuine refresh can retry safely.
- Viewers do not issue shared keys; they still receive non-secret settings and metadata.

Key issuance must be single-flight per `{installationId, providerId, keyVersion}`.

### 4. Make ordinary AI actions cache-only

Remove forced team AI metadata loading from the preflight path used by translation,
review, batch operations, derived glossaries, and AI Assistant.

- Resolve action preferences from the persisted/current team snapshot.
- Use the cached team provider key immediately when present.
- Do not call `load_team_ai_settings` or `load_team_ai_secrets_metadata` before an
  ordinary AI request.
- Preserve missing-key behavior when no cached team or local fallback key exists.
- Retain the central invalid-key recovery described below.

Chapter opening may start reconciliation only when it has a newly synced metadata
revision; it must not independently force the two broker AI reads.

### 5. Change invalid-key recovery to compare before issuing

Keep the central authentication-error interception and one-retry limit in `runtime.js`,
but change the recovery operation:

1. Capture the rejected local team cache record and its `keyVersion`.
2. Fetch only the authoritative team AI secrets metadata. Do not fetch settings; they
   cannot fix a rejected credential.
3. Compare the provider's authoritative `keyVersion` with the rejected cached version.
4. If the provider is absent or the version is unchanged, do not call
   `issue_team_ai_provider_secret` and do not retry the AI request. Surface the original
   provider authentication error.
5. If the version changed, issue that provider's key, replace the cache, and retry the
   original AI command exactly once.
6. If the retry fails, surface the retry error. Never recurse into a second refresh.

Concurrent authentication failures for the same team/provider must share the metadata
check and, when needed, the single issuance operation.

This path is intentionally synchronous because it is recovering an operation that has
already failed. It may pay one metadata request, but it avoids the more sensitive and
expensive issue/decrypt/cache sequence when no replacement key exists.

### 6. Keep AI Settings authoritative and explicit

Opening or manually refreshing AI Settings continues to load current settings and
secrets metadata from the broker. Saving settings or a provider key continues through
the broker.

After a successful save:

- Apply the returned settings/secret metadata immediately.
- Save the returned provider version with any locally cached key.
- Do not guess the new repository HEAD. The next team-metadata sync associates the
  local files with the actual commit and records `lastInspectedTeamMetadataHeadOid`.

## Files expected to change

### Desktop backend

- `src-tauri/src/team_metadata_local.rs`
- A focused module under `src-tauri/src/team_metadata_local/` for local AI metadata
  parsing, if keeping it separate improves ownership
- `src-tauri/src/lib.rs` for command registration

### Desktop frontend

- `src-ui/app/team-metadata-flow.js` for the post-sync background trigger
- `src-ui/app/team-ai-flow.js` for revision reconciliation, version comparison, and
  version-aware invalid-key recovery
- `src-ui/app/team-ai-storage.js` for persisted revision/retry state
- `src-ui/app/ai-settings-flow.js` to make ordinary action configuration cache-first
- `src-ui/app/editor-chapter-load-flow.js` to remove the unconditional broker refresh
- `src-ui/app/runtime.js` only if the recovery contract needs a more specific result

Tests should stay beside the affected Rust and JS modules. Update existing AI review,
translation, assistant, team metadata, and runtime recovery fixtures rather than
creating parallel test infrastructure.

## Compatibility and rollout

- No broker deployment is required for routine revision detection because the desktop
  already syncs the repository containing both AI files.
- Existing broker AI endpoints remain unchanged for AI Settings, authoritative
  invalid-key metadata checks, and provider-key issuance.
- Old stored snapshots without `lastInspectedTeamMetadataHeadOid` are treated as
  uninspected. The first successful metadata sync performs one local reconciliation.
- Missing AI files represent no configured settings/keys, matching current broker
  normalization.
- Offline mode can apply settings and compare versions from the last successfully
  synced local repository, but it must not attempt provider-key issuance.

## Verification

### Rust tests

- Reads settings and provider version summaries from committed local AI files.
- Missing files produce defaults.
- Malformed or unsupported records fail safely without exposing ciphertext.
- Working-tree-only edits do not override the committed HEAD snapshot.
- The serialized command result never contains `brokerWrappedKey`, `ciphertext`, or a
  plaintext API key.

### Frontend tests

- Same metadata HEAD: zero AI metadata reads and zero provider issuance calls.
- Changed HEAD with unchanged provider versions: settings update; zero issuance calls.
- Changed HEAD with one newer provider version: exactly one background issuance.
- Concurrent resource readers: one reconciliation and one issuance.
- Removed provider: matching local team cache is cleared.
- Team/user switch during reconciliation: stale result is not applied.
- Reconciliation failure leaves the usable cached key in place and remains retryable.
- Ordinary translation, review, batch, and assistant actions make no broker metadata
  request before the provider command.
- Invalid key plus unchanged version: one secrets-metadata check, zero issuance, zero
  retry.
- Invalid key plus newer version: one metadata check, one issuance, one successful
  retry.
- Invalid key plus newer but still rejected key: exactly one retry, then the final error.
- Concurrent invalid-key failures share the check and issuance.

### Performance acceptance

- Compare manual Projects, Glossaries, and QA refresh traces before and after the
  change. The broker/GitHub request count on the no-change path must be identical.
- Instrument local reconciliation separately. A same-HEAD refresh must do no AI work;
  a changed-HEAD refresh may perform only local reads before the page completes.
- Confirm through command logs that routine AI actions start without
  `load_team_ai_settings`, `load_team_ai_secrets_metadata`, or
  `issue_team_ai_provider_secret` ahead of them.

## Completion criteria

- Page refreshes gain no additional network request for AI state.
- Unchanged key versions never trigger key issuance.
- Changed key versions are refreshed in the background after team-metadata sync.
- Provider authentication failures check the version before issuing and retry at most
  once only when a replacement version exists.
- Non-secret AI action settings update from the already-synced local team metadata.
- AI Settings remains the explicit authoritative refresh and edit surface.

## Implementation notes

- The persisted revision marker fits in the existing team AI snapshot, so
  `team-ai-storage.js` did not need a schema-specific change.
- Provider issuance is single-flight by installation, provider, and key version.
- Focused frontend coverage verifies same-HEAD no-op behavior, matching-version
  no-op behavior, changed-version background issuance, cache-only ordinary actions,
  and both invalid-key version branches.
- Rust coverage verifies missing metadata defaults and that serialized secret
  summaries exclude ciphertext and wrapped-key fields.
- Verification completed with the full JavaScript/workflow suite (1,952 tests),
  Rust compilation, focused Rust tests, Rust formatting, JS lint with no errors,
  and `git diff --check`.

### Post-implementation review fixes

- Ordinary AI preflight must accept an existing cached key even when metadata already
  advertises a newer version; only background reconciliation and invalid-key recovery
  force issuance.
- Access-loss handling from an in-flight issuance must not replace visible AI state
  after the selected team or user changes.
- Reconciled non-secret action preferences must update both persistent storage and the
  active action configuration.
- The local reader must capture one commit ID first and read both AI files from that
  exact revision.

All four review findings are fixed and covered by regression tests.
