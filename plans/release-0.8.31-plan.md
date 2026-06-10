# Release 0.8.31 Plan

## Goal

Publish the next patch release after `v0.8.30` — the projects-page performance series
and the auth-resilience fixes.

## Highlights

- Combined installation resource listing (one broker call per refresh; #100, #104),
  served by the broker's webhook-maintained manifest and auth caches (broker #2/#3/#5,
  already deployed).
- Word-count cache with temporary bulk backfill (#94, #98 — backfill removal scheduled
  ~2026-06-23), metadata-listing repo scan fix (#96), migration-scan verdict (#97),
  shared metadata pull (#103).
- Instant team entry: capabilities ride the listing response, no blocking access check
  (#104); badge feedback from the moment of the click (#99).
- Member-removal access notice + 30-minute read verdict tier (#102, broker #4).
- Auth invariant enforced: silent credential refresh, login page on rejection, auth
  failures never swallowed by local-first tolerance (#105, #106).

Measured: team entry → visible list 0.8s, full refresh 4.5s (was ~46s with ~10s before
any feedback).

## Steps

1. Bump release metadata from `0.8.30` to `0.8.31` in the npm, Tauri, and Cargo manifests.
2. Run the local verification commands that are practical before a tag release.
3. Commit the version bump, create tag `v0.8.31`, and push `main` plus the tag so the
   release workflow publishes the Tauri builds.

## Verification

- `npm test`
- `npm run audit:unused`
- `cargo test`
- Broker deploy already confirmed live (combined listing 485ms in production).
