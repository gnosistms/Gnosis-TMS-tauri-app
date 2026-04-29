import test from "node:test";
import assert from "node:assert/strict";

const { createResourcePageState } = await import("../app/resource-page-controller.js");
const { resetSessionState, state } = await import("../app/state.js");
const { saveStoredDefaultGlossaryIdForTeam } = await import("../app/glossary-default-cache.js");
const { setActiveStorageLogin } = await import("../app/team-storage.js");
const { renderGlossariesScreen } = await import("./glossaries.js");
const {
  glossaryTitleIntentKey,
  requestGlossaryWriteIntent,
  resetGlossaryWriteCoordinator,
  teamMetadataWriteScope,
} = await import("../app/glossary-write-coordinator.js");

test.afterEach(() => {
  resetGlossaryWriteCoordinator();
  resetSessionState();
});

function setGlossaryScreenState(overrides = {}) {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    name: "Team",
    installationId: 1,
    canManageProjects: true,
    canDelete: true,
  }];
  state.glossariesPage = createResourcePageState(overrides.glossariesPage);
  state.glossaryDiscovery = { status: "ready", error: "", brokerWarning: "" };
  state.glossaries = overrides.glossaries ?? [{
    id: "glossary-1",
    repoName: "gnosis-es-vi",
    title: "Gnosis ES-VI",
    lifecycleState: "active",
    sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    termCount: 1,
  }];
}

function actionButtonHtml(html, action) {
  const escapedAction = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(`<button[^>]*data-action="${escapedAction}"[^>]*>`))?.[0] ?? "";
}

test("glossary cards render TMX download actions", () => {
  setGlossaryScreenState();

  const html = renderGlossariesScreen(state);

  assert.match(html, /data-action="download-glossary:glossary-1"/);
  assert.doesNotMatch(html, /open-external:[^"]*archive/);
});

test("glossary cards render make default action and default label", () => {
  setGlossaryScreenState({
    glossaries: [
      {
        id: "glossary-1",
        repoName: "gnosis-es-vi",
        title: "Gnosis ES-VI",
        lifecycleState: "active",
        sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "vi", name: "Vietnamese" },
        termCount: 1,
      },
      {
        id: "glossary-2",
        repoName: "other",
        title: "Other",
        lifecycleState: "active",
        sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "en", name: "English" },
        termCount: 1,
      },
    ],
  });
  setActiveStorageLogin("glossaries-default-render-test");
  saveStoredDefaultGlossaryIdForTeam(state.teams[0], "glossary-2");

  const html = renderGlossariesScreen(state);

  assert.match(html, /data-action="make-default-glossary:glossary-1"/);
  assert.doesNotMatch(html, /data-action="make-default-glossary:glossary-2"/);
  assert.match(html, /<span class="text-action-label">Default<\/span>/);
});

test("glossary default modal renders requested copy", () => {
  setGlossaryScreenState();
  state.glossaryDefault = {
    ...state.glossaryDefault,
    isOpen: true,
    glossaryId: "glossary-1",
    glossaryName: "Gnosis ES-VI",
  };

  const html = renderGlossariesScreen(state);

  assert.match(html, /MAKE DEFAULT/);
  assert.match(html, /Make Gnosis ES-VI the default glossary/);
  assert.match(html, /The default glossary is assigned automatically to new files when you upload them\./);
  assert.match(html, /data-action="cancel-glossary-default"/);
  assert.match(html, /data-action="confirm-glossary-default"/);
});

test("glossary refresh keeps read-only and query-backed lifecycle actions enabled", () => {
  setGlossaryScreenState({
    glossariesPage: { isRefreshing: true, writeState: "idle" },
    glossaries: [
      {
        id: "glossary-1",
        repoName: "gnosis-es-vi",
        title: "Gnosis ES-VI",
        lifecycleState: "active",
        sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "vi", name: "Vietnamese" },
        termCount: 1,
      },
      {
        id: "deleted-glossary",
        repoName: "deleted-repo",
        title: "Deleted Glossary",
        lifecycleState: "deleted",
        sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "vi", name: "Vietnamese" },
        termCount: 1,
      },
      {
        id: "repair-glossary",
        repoName: "repair-repo",
        title: "Repair Glossary",
        lifecycleState: "active",
        resolutionState: "repair",
        repairIssueType: "missingLocalRepo",
        repairIssueMessage: "Needs local repo rebuild.",
        sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "vi", name: "Vietnamese" },
        termCount: 1,
      },
    ],
  });
  state.showDeletedGlossaries = true;

  const html = renderGlossariesScreen(state);

  assert.doesNotMatch(actionButtonHtml(html, "open-glossary:glossary-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "download-glossary:glossary-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "toggle-deleted-glossaries"), /disabled/);

  assert.doesNotMatch(actionButtonHtml(html, "rename-glossary:glossary-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-glossary:glossary-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "restore-glossary:deleted-glossary"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-deleted-glossary:deleted-glossary"), /disabled/);
  assert.match(actionButtonHtml(html, "import-glossary"), /disabled/);
  assert.match(actionButtonHtml(html, "open-new-glossary"), /disabled/);
  assert.match(actionButtonHtml(html, "rebuild-glossary-repo:repair-glossary"), /disabled/);
  assert.match(actionButtonHtml(html, "refresh-page"), /\bis-spinning\b/);
  assert.match(actionButtonHtml(html, "refresh-page"), /aria-disabled="true"/);
});

test("glossary write in progress disables lifecycle actions", () => {
  setGlossaryScreenState({
    glossariesPage: { isRefreshing: false, writeState: "submitting" },
    glossaries: [
      {
        id: "glossary-1",
        repoName: "gnosis-es-vi",
        title: "Gnosis ES-VI",
        lifecycleState: "active",
        sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "vi", name: "Vietnamese" },
        termCount: 1,
      },
      {
        id: "deleted-glossary",
        repoName: "deleted-repo",
        title: "Deleted Glossary",
        lifecycleState: "deleted",
        sourceLanguage: { code: "es", name: "Spanish" },
        targetLanguage: { code: "vi", name: "Vietnamese" },
        termCount: 1,
      },
    ],
  });
  state.showDeletedGlossaries = true;

  const html = renderGlossariesScreen(state);

  assert.match(actionButtonHtml(html, "rename-glossary:glossary-1"), /disabled/);
  assert.match(actionButtonHtml(html, "delete-glossary:glossary-1"), /disabled/);
  assert.match(actionButtonHtml(html, "restore-glossary:deleted-glossary"), /disabled/);
});

test("coordinator writes keep lifecycle actions enabled while heavy actions stay disabled", () => {
  setGlossaryScreenState();
  requestGlossaryWriteIntent({
    key: glossaryTitleIntentKey("glossary-1"),
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "Renaming" },
  }, {
    run: async () => new Promise((resolve) => setTimeout(resolve, 10)),
  });

  const html = renderGlossariesScreen(state);

  assert.doesNotMatch(actionButtonHtml(html, "rename-glossary:glossary-1"), /disabled/);
  assert.doesNotMatch(actionButtonHtml(html, "delete-glossary:glossary-1"), /disabled/);
  assert.match(actionButtonHtml(html, "import-glossary"), /disabled/);
  assert.match(actionButtonHtml(html, "open-new-glossary"), /disabled/);
  assert.match(actionButtonHtml(html, "refresh-page"), /\bis-spinning\b/);
  assert.match(actionButtonHtml(html, "refresh-page"), /aria-disabled="true"/);
});
