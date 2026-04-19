import test from "node:test";
import assert from "node:assert/strict";

import { consumePendingSingleTeamAutoOpen } from "./team-flow/auto-open.js";

test("consumePendingSingleTeamAutoOpen only auto-opens while still on the teams screen", () => {
  const authState = {
    pendingAutoOpenSingleTeam: true,
  };

  assert.equal(consumePendingSingleTeamAutoOpen(authState, "translate"), false);
  assert.equal(authState.pendingAutoOpenSingleTeam, false);
});

test("consumePendingSingleTeamAutoOpen preserves single-team auto-open on the teams screen", () => {
  const authState = {
    pendingAutoOpenSingleTeam: true,
  };

  assert.equal(consumePendingSingleTeamAutoOpen(authState, "teams"), true);
  assert.equal(authState.pendingAutoOpenSingleTeam, false);
});
