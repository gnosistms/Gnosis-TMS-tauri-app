# Stage 3 Review: Teams, Members, Invites, and Org/Member Management

## Findings

### P1. Deleted-team recovery actions are gated on `membershipRole === "admin"` instead of the actual owner capability flag

- The deleted-team card only shows `Restore` and permanent `Delete` when both `team.membershipRole === "admin"` and `team.canDelete === true`; see [team-list.js:102](/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/team-list.js#L102) through [team-list.js:107](/Users/hans/Desktop/GnosisTMS/src-ui/screens/teams/team-list.js#L107).
- But the canonical capability flag for destructive team management is `canDelete`, which is populated independently from the installation payload in [team-records.js:9](/Users/hans/Desktop/GnosisTMS/src-ui/app/team-flow/team-records.js#L9) through [team-records.js:20](/Users/hans/Desktop/GnosisTMS/src-ui/app/team-flow/team-records.js#L20).

Impact:
- If the broker/installation record reports owner-capable teams with `canDelete === true` but a `membershipRole` other than the exact string `"admin"` (for example `"owner"` or another normalized value), the deleted team becomes impossible to restore or permanently delete from the UI.

Recommendation:
- Gate those actions on `canDelete` alone, or on a single shared “can manage deleted team” capability helper instead of mixing capability flags with raw role strings.

### P2. Members loading treats any `/members` 404 as a successful empty-ish roster and caches that fallback result

- In [team-members-flow.js:318](/Users/hans/Desktop/GnosisTMS/src-ui/app/team-members-flow.js#L318) through [team-members-flow.js:326](/Users/hans/Desktop/GnosisTMS/src-ui/app/team-members-flow.js#L326), any error whose message contains both `"/members"` and `"404"` is converted into:
  - `state.users = buildFallbackUsers()`
  - `state.userDiscovery = { status: "ready", error: "" }`
  - a cached member list for the team

Impact:
- A real server/API defect, route mismatch, or org lookup problem can be presented as if the team simply has no members beyond the signed-in user.
- Because that fallback is cached, the misleading result can persist across reloads and obscure the true failure mode.

Recommendation:
- Only apply that fallback for a narrowly classified, explicitly supported “members listing unavailable” case from the backend.
- Otherwise surface the error or keep the prior cached roster instead of replacing it with a synthesized one-user result.

## Residual Risk

- Access-control invariants are enforced partly in the UI and partly in action/flow code. That is workable, but it will stay fragile until team/member mutation actions consistently revalidate both the acting user’s capability and the target member’s role at the action layer, not just at render time.
