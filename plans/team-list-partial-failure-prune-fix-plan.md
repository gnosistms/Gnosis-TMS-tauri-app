# Team list partial-failure prune fix

Date: 2026-07-16

## Incident summary

On 2026-07-14 (minutes after the 0.8.63 self-update, though the update was
coincidental — the vulnerable code predates it), the desktop app dropped
Gnosis VN and Gnosis Japan from the Teams page, keeping only Test team 32.
No data was lost: all three GitHub App installations, org memberships, and
repos were intact throughout. Restarting the app on 2026-07-16 restored all
three teams once a listing fetch succeeded.

## Root cause — two bugs that compose

**Bug 1 (broker, primary): a partial enrichment failure returns a clean 200
with a silently shortened list.**

`gnosis-tms-github-app-broker/src/authorization.js`, `listAccessibleInstallations`:

```js
const results = await Promise.allSettled(
  installations.map((installation) => getInstallationAccessDetails({ ... })),
);
return results
  .filter((result) => result.status === "fulfilled")
  .map((result) => result.value);
```

GitHub's REST API intermittently returns 503s (reproduced live on 2026-07-16:
first request failed, a retry 15 s later succeeded). When the top-level
`/user/installations` call fails, the whole route 400s and the client copes.
But when a **per-installation** `getInstallationAccessDetails` call fails, that
installation is filtered out and the broker responds **200 with the survivors
only**. The client has no way to distinguish "team revoked" from "GitHub
hiccuped on one sub-request".

**Bug 2 (desktop app): the client treats any successful listing as complete
truth and destructively prunes its disk cache.**

`GnosisTMS/src-ui/app/team-query.js`, `createTeamsQueryOptions().queryFn`:

```js
const nextStoredTeams = replaceStoredTeamRecords(reconciledTeams);
```

`replaceStoredTeamRecords` (team-storage.js) overwrites the stored records
wholesale. Any team missing from the response is erased from
`gnosis-tms-team-records:<login>` in app-state.json — which is why the teams
stayed gone across sessions until a fully successful fetch replaced the list.

Also contributing: `githubApi` (broker `src/github-app.js`) has no retry, so a
single transient 503 propagates.

## Fix plan

### 1. Broker: never silently drop an installation (primary fix)

In `listAccessibleInstallations`:

- Keep `Promise.allSettled`, but stop filtering rejected results away.
- For each rejected enrichment, retry once (see step 3); if it still fails,
  either:
  - **(a) fail the whole route** with a 502 and an honest error body, or
  - **(b) return the installation in degraded form** — the summary fields from
    `/user/installations` plus `"accessDetailsError": "<message>"` so the
    client can mark it stale instead of deleting it.
- Recommendation: **(b)**. It keeps the Teams page usable during GitHub
  brownouts and gives the client an explicit "don't trust this fully" signal.
  (a) is acceptable as a smaller first step — the client already handles a
  failed listing gracefully — but makes one flaky sub-request hide all teams.
- Log each enrichment failure with installationId and GitHub status so
  brownouts are visible in broker logs.

### 2. Client: reconcile instead of replace — a team may only be removed by an affirmative signal

In `team-query.js` `queryFn` (and wherever `replaceStoredTeamRecords` is fed
from a listing):

- Diff the fetched list against `existingTeamRecords` (already loaded at the
  top of `queryFn`).
- Teams present in the response: reconcile as today.
- Teams **missing** from the response: keep the stored record, set
  `syncState: "unconfirmed"` (new value alongside `"active"`/`"deleted"`) and
  a `lastSeenAt` timestamp instead of dropping them. The record schema already
  carries `syncState`, `statusLabel`, and `lastSeenAt`, so no migration is
  needed.
- If the broker sent the step-1(b) `accessDetailsError` marker, treat it the
  same way: keep cached capabilities, mark unconfirmed.
- Only hard-remove a stored team when the removal is affirmative:
  - the broker returns the installation with a revoked/uninstalled status, or
  - the user deletes/leaves the team in-app (existing flows), or
  - a team has stayed `unconfirmed` across N consecutive successful listings
    spanning ≥ 7 days (a real uninstall shows up as "absent from a healthy
    response" repeatedly; a brownout does not).
- UI: render unconfirmed teams normally with a subtle "couldn't verify access
  just now" status line (`statusLabel`), rather than hiding them.

### 3. Broker: retry with backoff on GitHub 5xx

In `githubApi`: on 500/502/503/504 (and network errors), retry up to 2 times
with short exponential backoff + jitter (e.g. 500 ms, 2 s), honoring
`Retry-After` if present. Keep total added latency under ~5 s so the desktop
listing call doesn't feel hung. Do not retry 4xx.

This alone would likely have prevented the incident, but steps 1–2 remove the
data-destroying failure mode entirely and are the real fix.

### 4. Tests

Broker (`authorization` tests):
- listing where one enrichment rejects → response still contains all
  installations, degraded entry carries `accessDetailsError` (or route 502s,
  if option (a) was chosen).
- `githubApi` retries on 503 then succeeds; gives up after max retries.

Desktop (`team-query.test.js`, `team-storage.test.js`):
- fetch response missing a previously stored team → record persists with
  `syncState: "unconfirmed"`, still visible in state.
- unconfirmed team reappears in a later response → back to `"active"`, no
  duplicate records.
- affirmative-removal cases still remove (delete flow, leave flow).
- regression: response with all teams behaves exactly as today.

### 5. Verify end-to-end

- Point a dev build at a broker stub that fails one enrichment; confirm the
  team stays visible and marked unconfirmed; confirm recovery on next
  successful fetch; confirm app-state.json team records are never shrunk by
  the failure.

## Rollout

1. Broker first (steps 1 + 3) — deploy to DigitalOcean; old clients already
   benefit because partial lists stop happening.
2. Desktop (step 2) in the next release — protects against any future server
   or network path that shortens the list.

## Non-goals

- The `installations/installation-<id>/` local data directories were never
  touched by the bug (only the team *records* listing was pruned); no repair
  or migration is needed.
- Member-role handling (`members/*.json` metadata vs org-derived roles) was
  investigated during the incident and works as designed; no changes.
