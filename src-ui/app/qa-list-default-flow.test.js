import test from "node:test";
import assert from "node:assert/strict";

import { state } from "./state.js";
import {
  activeDefaultQaListIdsForTeam,
  makeQaListDefault,
} from "./qa-list-default-flow.js";

test("QA list defaults are scoped per language", () => {
  const team = {
    id: `qa-default-team-${Date.now()}`,
    githubOrg: `qa-default-org-${Date.now()}`,
  };
  state.teams = [team];
  state.selectedTeamId = team.id;
  state.qaLists = [
    {
      id: "qa-vi-a",
      title: "Vietnamese A",
      language: { code: "vi", name: "Vietnamese" },
      lifecycleState: "active",
      termCount: 1,
      terms: [],
    },
    {
      id: "qa-vi-b",
      title: "Vietnamese B",
      language: { code: "vi", name: "Vietnamese" },
      lifecycleState: "active",
      termCount: 2,
      terms: [],
    },
    {
      id: "qa-ja-a",
      title: "Japanese A",
      language: { code: "ja", name: "Japanese" },
      lifecycleState: "active",
      termCount: 1,
      terms: [],
    },
  ];

  makeQaListDefault(() => {}, "qa-vi-b");

  assert.deepEqual(activeDefaultQaListIdsForTeam(team), {
    vi: "qa-vi-b",
    ja: "qa-ja-a",
  });
});
