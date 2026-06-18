# Licensing Rollout Plan

## Summary

Move both public repos (Gnosis-TMS-tauri-app, gnosis-tms-github-app-broker) from the
interim all-rights-reserved notice to a fair-source dual-license model: **PolyForm
Noncommercial 1.0.0** as the public license, with **paid commercial licenses sold
directly** (the app is the product). The broker service issues and validates license
tokens for commercial accounts; noncommercial users (including Gnostic society teams)
get free accounts. Enforcement is legal + procurement-driven; broker token checks are
a compliance nudge, not DRM, and must never block the IPC hot path.

Decided 2026-06-11. Background and rationale live in the session notes; dependency
audit results below.

## Current State (2026-06-11)

- Interim LICENSE ("all rights reserved, no license granted") live in both repos.
- Dependency audit clean: all 8 production npm packages MIT; vendored
  `src-ui/lib/vendor/diff-match-patch.js` Apache-2.0 (header intact); ~690 Rust
  crates all permissive or dual-permissive, five MPL-2.0 crates (`cssparser`,
  `cssparser-macros`, `dtoa-short`, `option-ext`, `selectors`), zero GPL/AGPL.
  MPL-2.0 obligations are satisfied by a notices file (crates used unmodified).
- Outside contributions: joshicola, 42 commits (June 2026) touching Rust source
  (`broker_auth.rs`, `github/app_auth.rs`, AI providers, `lib.rs`, import pipeline).
  Email on file disclaims ownership expectations; an explicit relicensing grant is
  still needed (Step 1). One `copilot-swe-agent[bot]` commit — negligible risk.

## Step 1 — Contributor Rights Grant — RESOLVED 2026-06-11

joshicola confirmed by email that he does not want to keep any license to his past
commits. Remaining action: archive that email permanently alongside the 2026-06-10
one (it is the diligence artifact for future commercial customers/acquirers).

Future work by joshicola: unpaid PRs are covered by the CLA like any contributor's.
Any compensated arrangement must keep the copyright consolidated in Hans
(work-for-hire assignment or contribution license); compensation flows by contract
(fee, revenue share), never by co-owning the copyright — a single rights-holder is
what makes commercial licensing sellable.

## Step 2 — CLA Before Any More Outside PRs

1. Draft CLA text (adapt the Apache Individual CLA template; grants Hans the right
   to relicense/sublicense contributions). Host as a GitHub gist.
2. Hans installs [CLA Assistant](https://github.com/cla-assistant/cla-assistant) on
   both repos (GitHub OAuth, links the gist). New PRs then get a failing status
   check until the author click-signs; signatures are recorded permanently.
3. Add `CONTRIBUTING.md` to both repos, honest about the model: free for
   noncommercial use, commercial licenses fund development, contributors sign the
   CLA. A DCO is not sufficient — it does not grant relicensing rights.

## Step 3 — License Swap (one PR per repo)

Files per repo:

- `LICENSE` — PolyForm Noncommercial 1.0.0 verbatim, preceded by the copyright line
  and retaining the existing third-party-components clause (dependencies remain
  under their own licenses).
- `COMMERCIAL-LICENSE.md` — what commercial use requires, how to buy, contact
  address, and the signpost line: "The licensor may grant additional permissions or
  separate license terms to any party — contact [email]."
- Trademark notice reserving the "Gnosis TMS" name (in LICENSE or README).
- README licensing section update.

Do not merge until Steps 1–2 are complete. Decide first whether the broker repo
mirrors PolyForm NC or goes private/proprietary (open decision below).

## Step 4 — CI License Gating + Notices (background task)

Spawned as a separate task (chip): `cargo-deny` with a permissive+MPL-2.0 allowlist,
npm license allowlist check, both wired into CI; build step generating
`THIRD-PARTY-NOTICES` (cargo-about + license-checker + vendored lib) shipped with
release builds.

## Step 5 — Broker License Tokens (separate plan when ready)

Purchase issues a token; broker validates on auth; commercial features
(GitHub App auth, remote repo management) require a valid token or a free
noncommercial account. Keep checks off the IPC call path per existing architecture
rules. Write `plans/broker-license-token-plan.md` before implementing.

## Step 6 — Merchant of Record

Use Paddle or Lemon Squeezy (handles international VAT/sales tax for license sales).
Per-seat annual pricing is the TMS-market norm (reference points: memoQ, Trados).

## Deferred — Gnostic Organizations Grant

Free use is intended for many Gnostic organizations related to the Gnostic Society,
not all known yet. Deliberately deferred: PolyForm NC's noncommercial terms likely
cover most in the interim, and one-off email grants work for any org that asks.
When written, use a **class-based** grant (define the category of organizations, not
a list), perpetual and irrevocable. Hard trigger: must be written **before any
transfer of the copyright** (sale, succession) — informal permissions do not bind a
new owner.

## Open Decisions

- Broker repo license: mirror PolyForm NC, or make the repo private/proprietary.
- Commercial pricing: per-seat vs. per-organization; amount.
- Contact/sales email address for `COMMERCIAL-LICENSE.md`.
- Whether free signed binaries are public for everyone (recommended: yes — the
  commercial boundary is legal + broker accounts, not download access).
