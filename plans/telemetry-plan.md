# Telemetry & Error Reporting Plan

## Status

Proposed — 2026-06-03. Consent model decided: **opt-out** (see Consent & disclosure).
Remaining open decisions are non-blocking (SaaS-vs-self-host, Tauri bridge plugin).

## Goal

Give the dev team visibility into errors and crashes that clients experience in the
field. Today there is **no dev-visible telemetry**: a non-fatal error or a panic on a
user's machine is invisible to the team, so it can persist indefinitely without anyone
knowing. This drives error-handling decisions toward "fail loud and disruptive" (the only
current signal is a user complaint). Adding error reporting unlocks graceful degradation
*with* visibility (and lets us revisit findings like Batch 2 M1).

## Non-goals

- **Product / usage analytics** (which features get used, funnels, etc.). Out of scope.
  Our users may be under confidentiality obligations; we collect *failures only*, not
  behavior.
- **Collecting any document/translation content, secrets, tokens, or identifying data.**
  See Scrubbing Rules — these are hard constraints.

## Decision: Sentry

Chosen over a DIY broker endpoint because the hard part of error reporting is the
aggregation layer — grouping/dedup, stack traces, release health, alerting — and Sentry
provides it out of the box. The JavaScript SDK (`@sentry/browser`) is mature and
framework-agnostic, which fits our vanilla-ES-modules frontend, and most of our code is
JS. Rust panic capture is a smaller secondary piece.

- **Start on the free tier** (1 developer seat; metered by monthly event volume — *not*
  by number of app users). The realistic limit is the event quota, which the
  sampling/rate-limiting below is designed to respect.
- **Escape hatch if we outgrow it**: self-hosted Sentry (removes seat/quota billing,
  could sit alongside the DigitalOcean broker) or **GlitchTip** (open-source,
  Sentry-API-compatible — same `@sentry/browser` SDK, just a different DSN). No app code
  changes to switch.

## Architecture

### The JS chokepoint (highest value, lowest effort)

Every Tauri command call goes through the single `invoke()` wrapper in
[`src-ui/app/runtime.js`](../src-ui/app/runtime.js) (line ~70). Wrapping that one
function's error path captures **every failing Rust command** from the JS side —
including the Batch 2 M1 cache error, broker failures, git failures — without touching
individual call sites. Combined with `@sentry/browser`'s automatic `window.onerror` and
`unhandledrejection` capture, this is the bulk of our coverage.

```
window.onerror / unhandledrejection ─┐
                                      ├─► @sentry/browser ─► Sentry
runtime.js invoke() error path ──────┘
```

### Rust panics (Phase 2)

The webview SDK cannot see a Rust-side panic. Add the `sentry` crate plus a
`std::panic::set_hook` in `lib.rs` setup so crashes that never reach JS are captured.
A Tauri-specific bridge (community `tauri-plugin-sentry` / `@sentry/tauri`-style) can
route both sides into one project with shared device context — evaluate its maintenance
status before adopting; the two SDKs working independently is an acceptable fallback.

## What we capture / what we NEVER send (Scrubbing Rules)

These are hard constraints, not guidelines — our error strings already contain things we
must not ship.

**Capture:**
- Error category / command name (e.g. `cache_installation_access failed`)
- A scrubbed error message
- App version, OS + arch
- An **anonymous per-install UUID** (generated once, stored locally) — *not* the GitHub
  login, name, or email
- Timestamp
- Explicitly allowlisted breadcrumbs only, such as app lifecycle milestones and scrubbed
  command failure categories. Do **not** enable broad browser/console/network breadcrumbs.

**NEVER send:**
- `session_token`, API keys (OpenAI/Anthropic/etc.), or any Stronghold/broker secret
- Document or translation **content** (row text, glossary terms, QA entries)
- Full filesystem paths containing the OS username — **redact the home-dir prefix** (paths
  like `/Users/<name>/…` → `~/…`)
- GitHub identity (login/name/email/avatar)
- IP address, device name, OS account name, hostname, hardware serials, or any stable
  device identifier other than the anonymous per-install UUID

Implement a central `beforeSend` scrub hook (Sentry supports this) that redacts home-dir
paths and drops known-sensitive keys, plus the same discipline on the Rust side. Configure
Sentry with `sendDefaultPii: false`, never set user context, and disable/scrub server-side
IP address storage where Sentry supports it. Reuse the existing 200-char truncation
discipline from `broker.rs` for any free-text body.

## Sampling, rate-limiting, offline

- **Rate-limit / dedup at the source** so a tight error loop on a few machines can't burn
  the monthly quota in a day (cap events per error-signature per session).
- **Error events**: capture at 100% initially (volume is low; failures are what we want).
  Add sampling only if quota pressure appears.
- **Performance/replay**: disabled (out of scope, quota-hungry, privacy-sensitive).
- **Offline**: the SDK queues and retries; confirm the transport tolerates the Tauri
  webview origin. Reporting is **fire-and-forget** — it must never block or fail a command
  (the very thing M1 warns against).

## Source maps

Vite minifies the bundle, so configure `vite.config.js` to emit source maps and upload
them to Sentry at build/release time (Sentry Vite plugin or CLI in the release script).
Without this, JS stack traces are unreadable.

## Consent & disclosure

Telemetry on potentially NDA-bound users requires explicit handling:
- A **settings toggle** to turn reporting off.
- A first-run disclosure of what is (and isn't) collected.
- A privacy note in the docs.

**Decided: opt-out.** Reporting is ON by default, with a clear first-run disclosure and a
one-click off toggle. Chosen to maximize field visibility while respecting users. The
toggle state is read before `initTelemetry()` runs, and flipping it off must fully disable
the SDK (no events sent) for the rest of the session.

No **routine** event may be sent until disclosure state has been resolved. On first launch
the app shows the disclosure and persists the opt-out default/choice before normal
telemetry transport is enabled. During that pre-disclosure window, routine errors and
breadcrumbs are handled locally only — not queued for upload.

### First-run crash exception (decided 2026-06-03)

To avoid going blind on exactly the highest-value failures — crashes during first launch,
before the disclosure has been shown — a narrow exception applies. It is deliberately
scoped so the privacy compromise stays minimal:

- **Crashes only.** Covers unhandled fatal errors (Rust panics, uncaught JS errors /
  unhandled rejections) — *not* routine command-failure telemetry, performance, or
  breadcrumbs. Those still wait for the gate.
- **Maximal scrubbing.** Pre-disclosure crash events carry only crash type/stack, app
  version, OS + arch, and the anonymous install UUID — no breadcrumbs, no command payloads,
  full `beforeSend` scrubbing applied.
- **Capture early, transmit after disclosure.** Crash handlers install before the gate. A
  crash captured pre-disclosure is buffered and transmitted once the disclosure has been
  *shown* (which, under opt-out, is at first launch — possibly the next launch if the very
  first one crashed before the notice rendered).
- **An explicit opt-out still wins.** If the user turns reporting off, any buffered
  pre-disclosure crash events are discarded, not sent. The relaxed gate governs *capture*,
  never an override of an explicit "no".

In short: we will transmit a first-run crash captured before the user clicked through the
notice — but never against an explicit opt-out, and never anything beyond the crash itself.

## Phasing

| Phase | Scope | Outcome |
|---|---|---|
| **1** | `@sentry/browser` init gated by disclosure state + `runtime.js` invoke-error capture + `beforeSend` scrubbing + consent toggle + Vite source maps | Dev team sees JS errors and every failing command, scrubbed, from the field |
| **2** | `sentry` crate + Rust panic hook (+ optional Tauri bridge) | Rust crashes/panics captured |
| **3** | Revisit graceful-degradation findings (Batch 2 **M1**, and similar) now that "log + continue" is observable | Soften selected hard-fails to degrade-with-visibility |

## Task checklist (Phase 1)

- [ ] Add `@sentry/browser` dependency
- [ ] Create `src-ui/app/telemetry.js`: `initTelemetry()` (DSN, release = app version,
      environment), `beforeSend` scrub (home-dir redaction + sensitive-key drop),
      anonymous install-UUID load/create, `sendDefaultPii: false`, no user context,
      allowlisted breadcrumbs only, consent/disclosure gate
- [ ] Resolve first-run disclosure and persisted telemetry setting before any *routine*
      telemetry transport can send or queue events
- [ ] Install crash handlers early (before the gate) and implement the first-run crash
      exception: buffer pre-disclosure crashes, transmit once the disclosure is shown,
      discard them on an explicit opt-out
- [ ] Call `initTelemetry()` at frontend entry only after the disclosure/setting gate is
      resolved (crash handlers excepted, per above)
- [ ] Wrap the `invoke()` error path in `runtime.js` to report scrubbed command failures
      (capture command name + scrubbed error; never the payload)
- [ ] Add a consent toggle to settings + first-run disclosure; turning the toggle off must
      close/disable the client and prevent queued uploads for the rest of the session
- [ ] Configure Vite source maps + upload step in the release script
- [ ] Unit-test the scrubber and consent gate (home-dir paths redacted; sensitive keys
      dropped; content never included; no *routine* event before disclosure is resolved;
      buffered crash discarded on opt-out)
- [ ] Document the DSN handling (DSN is not a secret, but keep it in config, not hardcoded
      across the tree)

## Implementation notes

- **Allowlist breadcrumbs is active work, not a flag.** Disable the default breadcrumb
  instrumentation (`Sentry.breadcrumbsIntegration({ console: false, dom: false, fetch: false,
  xhr: false, history: false })`) and add only our own via `Sentry.addBreadcrumb`. The
  default integration captures console/network/DOM, which would leak paths, URLs, and content.
- **Persist consent + install UUID through the backend, not the webview.** The webview
  cannot touch the filesystem and `localStorage` is not a durable Tauri store. Read/write
  both via `tauri-plugin-store` (`store.rs`) or a dedicated Tauri command, and resolve them
  before `initTelemetry()`.
- **Fire-and-forget transport.** Reporting must never block or fail a command (the M1
  lesson). Errors inside the reporter itself are swallowed locally.

## Sentry project configuration (not enforceable from the repo)

Some privacy requirements live in Sentry project settings, not our code — track them here:

- [ ] Enable "Prevent Storing of IP Addresses" (server-side complement to SDK
      `sendDefaultPii: false`)
- [ ] Configure server-side data scrubbing / sensitive-field filters as a backstop to
      `beforeSend`
- [ ] Restrict project membership to the dev team; confirm data region / retention
- [ ] Create the project as platform **Browser/JavaScript** and record its DSN in app config

## Open Decisions

1. ~~**Consent model — opt-in or opt-out?**~~ **DECIDED: opt-out** (2026-06-03) — reporting
   on by default, clear first-run disclosure, one-click off. See Consent & disclosure.
2. **Sentry SaaS free tier to start, or self-host from day one?**
   Recommendation: start on SaaS free tier to validate value; revisit self-host/GlitchTip
   if quota or seat limits pinch. Confirm current free-tier event quota at sentry.io/pricing.
3. **Adopt the Tauri bridge plugin, or run the two SDKs independently?** Decide in Phase 2
   based on the plugin's maintenance status.
