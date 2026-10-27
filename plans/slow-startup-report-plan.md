# Slow startup report

## Why

2026-10-20: after updating from 0.8.83 to 0.8.125 on Windows, the Translation Teams
page stayed on its loading state for a long time; a restart fixed it. Nothing recorded
what it was waiting for:

- the app keeps no startup log, and getting files off a Windows machine is awkward;
- the broker logs failures only, without timings;
- Sentry receives failed commands only, and connection failures (the likely shape of a
  timeout) are deliberately not reported (`resolveCommandFailureReport`).

Every network step on that path has a time limit (3 s internet check, 30 s per broker
call), so a long wait means several waits stacked up or something outside those limits
stalled. We need the next occurrence to arrive in Sentry by itself.

## What

From launch until the team list is ready, watch whether the user is still waiting:

- `booting` / `restoring` sign-in ("Please wait while we log you in."), or the internet
  check not finished yet;
- on the teams screen while the list is loading or refreshing.

Leaving that state (team list ready, start/offline screen, opening a team) ends the watch.

Send at most two Sentry warnings per launch, both under one issue
(`fingerprint: ["startup-slow"]`, `source: startup-slow`):

1. **waiting** — still waiting 30 s after launch. Sent while it is happening, so it
   arrives even if the user then quits the app.
2. **finished** — the wait ended after 30 s or more: total time and where it ended.

Each event carries only timings, command names and state labels — no payloads, team
names, paths or error text:

- tags: `phase`, `stage` (storage / app_state / window / loading_saved_login /
  internet_check / checking_login / team_list / team_list_refresh), `platform` (windows / mac / linux / other),
  `after_update` (yes / no / unknown);
- extra: elapsed ms; app version and the version that last ran on this install; screen
  state labels and team count; startup steps with their times (storage ready, app state
  loaded, window ready, saved login loaded); backend calls still waiting and for how long; finished
  calls that took ≥ 250 ms or failed (command, start, duration, error type from
  `classifySyncError`); total call count; the longest gap between watch ticks (a large
  gap means the page itself was frozen).

## How

- `src-ui/app/invoke-activity.js` (new): records backend calls (command, start, end,
  error type) while startup is being watched; stops recording when the watch ends.
  Capped at 300 entries.
- `src-ui/app/runtime.js`: route `rawInvoke` through the recorder, so the sign-in check,
  token refresh, retries and the team listing are all covered.
- `src-ui/app/startup-watch.js` (new): the watch (1 s ticks, 10 min cap), step marks,
  last-launched-version record (written only when it changes), payload builder.
- `src-ui/app/telemetry.js`: `reportSlowStartup()` — consent-gated, scrubbed like every
  other event.
- `src-ui/main.js`: step marks in `bootstrap()` and start the watch after the dev
  fixture check.

Payload keys avoid the scrubber's sensitive substrings (`auth`, `session`, `token`…), and
a test runs the payload through `scrubData` to prove nothing is redacted.

## Tests

`startup-watch.test.js`, `invoke-activity.test.js`: no report under 30 s; waiting report
at 30 s with stage and waiting calls; finished report after a waiting report; offline
screen and opened team end the watch; 10-minute cap; payload survives scrubbing; recorder
stops after the watch; cap respected.
