# Broker webhook-maintained installation manifest

**Status:** active. **Added:** 2026-06-10. Repo: `gnosis-tms-github-app-broker`.
Builds on the combined `/gnosis-resources` listing (broker PR #1, app PR #100).

## Problem

The combined listing still re-enumerates every repo in the installation on each request
(~6s): paginated REST listing, GraphQL head OIDs, org property values. The repo set
changes rarely; GitHub can tell us *when* it changes instead of us re-asking.

## Design

### Manifest (`src/installation-manifest.js`)

Per-installation in-memory cache of the listing prelude context
(`{ repositories, remoteHeadsByRepoKey, orgLogin, orgPropertyMap }` + `rebuiltAt`).

- `getInstallationRepositoryContext(installationId, token)`: serve the manifest when
  present and younger than a **10-minute TTL**; otherwise run the full prelude and
  store it. The TTL bounds staleness from missed webhook deliveries.
- **Feature-gated on `GITHUB_APP_WEBHOOK_SECRET`** (new optional env var): when the
  secret is unset, behavior is exactly today's (full prelude per request). Safe to
  deploy before the GitHub App webhook is configured.
- Only the **combined** listing uses the manifest. The legacy GET listings keep the
  direct path — they are scheduled for removal after 2026-06-17 anyway.

### Webhook route (`src/webhook-routes.js`)

`POST /webhooks/github`, raw body, HMAC SHA-256 verification of
`x-hub-signature-256` (timing-safe compare). 503 when the secret is unconfigured,
401 on bad signature. Event handling:

- `push` to the repo's default branch → update that repo's head OID in the manifest
  in place (one cheap map write; the per-(repo, head) project-identity cache then
  refetches `project.json` only for that repo on the next listing). A default-branch
  deletion drops the manifest.
- `repository`, `installation_repositories`, `installation`,
  `custom_property_values` → drop the installation's manifest (full rebuild on next
  request).
- Anything else → ignored. Always respond quickly.

### Operational constraints

- **Single-instance assumption**: webhooks reach one process; the manifest lives in
  its memory. If the DO app is ever scaled beyond one instance, other instances fall
  back to TTL freshness (still correct, just slower). Documented in AGENTS.md.
- Stateless restarts: first listing after a deploy rebuilds the manifest once.

### Manual configuration (Hans, after deploy)

1. DigitalOcean: set env var `GITHUB_APP_WEBHOOK_SECRET` to a generated secret.
2. GitHub App settings → Webhook: URL
   `https://gnosis-github-app-broker-8bfus.ondigitalocean.app/webhooks/github`,
   the same secret, content type **application/json**, SSL on.
3. GitHub App → Permissions & events → subscribe to **Push**, **Repository**, and
   **Custom property values** events (installation events are delivered to apps by
   default).

Until step 1–3 are done the feature stays dormant (503 on the route, listings take
the full-prelude path).

## Expected effect

Combined listing: ~6s → ~0.1–0.4s when the manifest is warm (worst case: one
project.json fetch for a repo whose head moved). Steady-state projects refresh
becomes dominated by the doubled metadata git pull (~4.8s ×2) — the next target.

## Verification

- Execution-level tests (lesson from the propertyRepositoryKey incident): signature
  verification, event handling (push updates the head, repository events drop the
  manifest, TTL expiry rebuilds, disabled mode bypasses), route registration, server
  boot smoke.
- Live: after Hans configures the webhook, push a commit to any team repo, then call
  the listing — head OID should reflect the push within seconds without a rebuild;
  the app-side profiling log should show the combined listing at sub-second.
