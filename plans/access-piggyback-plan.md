# Access piggyback: capabilities ride the combined listing

**Status:** active. **Added:** 2026-06-10. Two repos.

## Problem

Entering a team's projects page blocks on `refreshSelectedTeamAccess` — the full
installations listing — before `loadTeamProjects` starts. After a fresh app restart
that's a real broker round trip (5–6s cold), during which the page sits idle. Yet the
broker computes the caller's complete access verdict on *every* refresh request (to
authorize it) and throws it away.

## Design

### Broker

1. **Parallelize the verdict chain** in `loadInstallationAccessDetailsUncached`:
   phase 0 fetches the installation and mints the (cached) installation token
   concurrently; phase 1 fires membership, org info, admins-team members, and
   viewer-role metadata concurrently. Wall cost drops from the sum of ~6 round trips
   (~4s) to ~2 (~0.8s). Behavior identical — the existing authorization tests prove
   equivalence. (Minor accepted change: user-type installations now also mint a token;
   it is cached for an hour and harmless.)
2. **Attach the verdict to the combined listing**: `/gnosis-resources` already runs
   `ensureInstallationAccess` — return its result as `access` alongside
   `{ projects, glossaries, qaLists, digest }`. Same shape as the installations
   listing's per-team entries. Additive — old apps ignore it. The digest intentionally
   excludes `access` (capability changes must not look like resource changes).

### App

1. Rust: `GithubInstallationResources.access` as a pass-through `Option<Value>`
   (tolerant of older brokers).
2. JS: when the shared resource listing lands, reconcile the team record from
   `access` (existing `reconcileStoredTeam`) — stored records, teams query data, and
   visible state — guarded by team identity. One spot, inside
   `installation-resources-query.js`.
3. **Drop the access gate from team-entry paths** (open-team and the
   projects/glossaries/QA navigation and refresh paths): discovery starts
   immediately; capabilities update from the listing response. The teams screen and
   sign-in keep the full installations listing — that is where enumerating all teams
   genuinely belongs. The backend continues to enforce every write regardless of
   what the UI shows.

## Effect

Team entry: discovery starts at click (local snapshot ~1s) even on a cold restart —
the 5–6s gate is gone, not just faster. Capabilities are exactly as fresh as the data
on screen. Combined with the manifest + auth caches, a refresh's broker share is one
sub-second call.

## Verification

Broker: existing authorization tests (equivalence under parallelization) + live probe
(`access` field present, listing timing). App: entry-path tests updated (no access
gate), new test that listing `access` patches team capabilities; suite + knip.
Deploy order: broker first, as always.
