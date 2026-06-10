# Member-removal access notice + 30-minute read-verdict TTL

**Status:** active. **Added:** 2026-06-10. Two repos.

## Why

The broker now caches access verdicts (broker PR #3, 5-minute TTL). Hans wants the read
TTL raised to 30 minutes for refresh speed (the first refresh after an idle gap pays the
~4s verdict rebuild), accepting that a removed member can *read* team data up to the TTL.
Writes must not inherit the longer window. The staleness becomes a communicated behavior
via a notice modal after removal.

## App (this repo)

After a member removal succeeds (`team-members-flow.js` removal `onSuccess`), open a
one-button notice modal on the users screen:

- `state.memberRemovalAccessNotice` (+ factory/reset in `state.js`), holding `username`.
- `screens/member-removal-access-notice-modal.js`, same structure as
  `team-member-remove-modal.js` (backdrop, compact card, eyebrow/title/supporting), with
  a single primary **Ok** button (`dismiss-member-removal-access-notice`).
- Composed in `screens/users.js` next to the other member modals; dismiss handled in
  `app/user-actions.js`.
- Copy: removal confirmed + "It may take up to 30 minutes before they fully lose the
  ability to read team data."

## Broker

Two-tier verdict freshness in `installation-access.js`:

- Cache entries keep `fetchedAt`; `getInstallationAccessDetails` accepts `maxAgeMs`
  (default **30 minutes** — the read tier).
- `ensureInstallationAccess` requires a **5-minute-fresh** verdict whenever the call is
  write-relevant: `requireAdmin`, `requireOwner`, `requireProjectAdmin`, or an explicit
  `requireFreshAccess` flag.
- `getInstallationGitTransportToken` passes `requireFreshAccess` (it issues
  write-capable git tokens for non-viewers — Hans's "writes could be a problem" case).
- Webhook installation events still clear the cache outright.

## Verification

App: modal render test + flow assertion that removal success opens it. Broker: tests for
the two tiers (30-min entry served to reads, rejected by write-relevant checks after
5 min). Push broker after merge (DigitalOcean deploys from pushed main).
