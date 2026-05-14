import test from "node:test";
import assert from "node:assert/strict";

const { createResourcePageState } = await import("../app/resource-page-controller.js");
const { resetSessionState, state } = await import("../app/state.js");
const { renderQaScreen } = await import("./qa.js");

function actionButtonHtml(html, action) {
  const escapedAction = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<button[^>]*data-action="${escapedAction}"[^>]*>`))?.[0] ?? "";
}

function setQaScreenState(overrides = {}) {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    name: "Team",
    installationId: 1,
    canManageProjects: true,
    canDelete: true,
  }];
  state.qaListsPage = createResourcePageState(overrides.qaListsPage);
  state.qaListDiscovery = overrides.qaListDiscovery ?? {
    status: "ready",
    error: "",
    recoveryMessage: "",
  };
  state.qaLists = overrides.qaLists ?? [{
    id: "qa-list-1",
    title: "Vietnamese QA",
    language: { code: "vi", name: "Vietnamese" },
    lifecycleState: "active",
    termCount: 1,
    terms: [],
  }];
}

test.afterEach(() => {
  resetSessionState();
});

test("QA list refresh spins and disables the refresh button during background refresh", () => {
  setQaScreenState({
    qaListsPage: { isRefreshing: true, refreshStartedAt: 100 },
  });

  const html = renderQaScreen(state);

  assert.match(actionButtonHtml(html, "refresh-page"), /\bis-spinning\b/);
  assert.match(actionButtonHtml(html, "refresh-page"), /aria-disabled="true"/);
});

test("QA list discovery loading also spins the refresh button", () => {
  setQaScreenState({
    qaListsPage: { isRefreshing: false },
    qaListDiscovery: {
      status: "loading",
      error: "",
      recoveryMessage: "",
    },
    qaLists: [],
  });

  const html = renderQaScreen(state);

  assert.match(html, /Loading QA lists\.\.\./);
  assert.match(actionButtonHtml(html, "refresh-page"), /\bis-spinning\b/);
  assert.match(actionButtonHtml(html, "refresh-page"), /aria-disabled="true"/);
});
