# Combined installation resource listing (projects + glossaries + QA lists)

**Status:** active. **Added:** 2026-06-09. Spans two repos: the broker
(`gnosis-tms-github-app-broker`) and this app.

## Problem

Profiling shows the projects refresh pays the broker listing cost twice: the projects
listing (~6–7s) and the glossary listing (~6s, fetched on every projects refresh for the
glossary-link dropdowns). Server-side, each listing independently re-runs the same
expensive prelude — installation token, paginated enumeration of **all** installation
repos, GraphQL head OIDs, org property values — and then filters by repo type. The
prelude code is byte-identical, copy-pasted across `project-repos.js`,
`glossary-repos.js`, and `qa-list-repos.js` (verified by diff).

## Design

### Broker (PR 1)

1. **Extract the shared prelude** into `src/installation-repos.js`:
   `listInstallationRepositoriesRaw`, `loadRepositoryRemoteHeadsMap`,
   `REPOSITORY_REMOTE_HEADS_QUERY`, `chunk`, `normalizeRepositoryKey`,
   `deriveOrgLoginFromRepositories`, `buildOrgPropertyMap`, `authHeaders`, plus a
   `loadInstallationRepositoryContext(installationToken)` returning
   `{ repositories, remoteHeadsByRepoKey, orgLogin, orgPropertyMap }`.
2. **Split each listing** into prelude + exported assembly
   (`assembleGnosisProjects` — keeps the per-repo identity cache —,
   `assembleGnosisGlossaries`, `assembleGnosisQaLists`). Existing endpoints keep their
   exact behavior: same access check, same prelude, same assembly.
3. **New endpoint** `GET /api/github-app/installations/:installationId/gnosis-resources`
   (`src/installation-resources.js` + `src/resource-routes.js`): one access check, one
   token, one prelude, all three assemblies. Response:
   `{ projects, glossaries, qaLists, digest }` where `digest` is a sha256 over the three
   lists sorted by `fullName` — equal digests mean the resource world is unchanged, so
   clients can skip downstream refresh work.
4. Old endpoints stay (older app versions keep working).

### App (PR 2 — merge only after the broker deploys)

1. Rust: `list_gnosis_resources_for_installation` command hitting the new endpoint,
   returning the combined payload.
2. JS: a shared TanStack query (`installation-resources` keyed by installation,
   `staleTime` ~30s). Projects discovery, glossary discovery, and QA discovery read
   their list from it — concurrent readers dedupe to one in-flight fetch, and switching
   to the Glossaries/QA pages within the window is free.
3. The manual refresh button invalidates the listing query first, so explicit refreshes
   always fetch fresh.
4. The migration-scan flow keeps using the legacy commands (it is verdict-skipped in
   steady state and runs rarely).

## Deploy ordering

The broker must be deployed **before** an app release containing PR 2 ships. PR 2 must
not be included in a release until the `gnosis-resources` endpoint is live. (Older app
releases are unaffected either way — the legacy endpoints remain.)

## Expected effect

Steady-state projects refresh: two ~6s broker calls → one (~6s until the webhook-manifest
work lands, then ~0.3s). Glossaries/QA page opens within 30s of a refresh: broker-free.

## Verification

- Broker: digest unit tests (determinism, order-insensitivity, head-change sensitivity);
  existing suite; manual smoke against a real installation before deploy.
- App: discovery tests re-pointed at the combined command; profiling build confirms one
  `list_gnosis_resources_for_installation` per refresh and no separate glossary listing.

## Follow-ups (separate)

- Webhook-maintained manifest on the broker (push/repository/installation_repositories
  events) so the combined listing serves from memory in ~0.3s.
- Dedupe the doubled `sync_local_team_metadata_repo` git pull per refresh.
