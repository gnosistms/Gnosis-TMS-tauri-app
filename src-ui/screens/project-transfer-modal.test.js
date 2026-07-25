import assert from "node:assert/strict";
import test from "node:test";

import { renderProjectTransferModal } from "./project-transfer-modal.js";

test("project transfer modal renders target, name, glossary, and submit controls", () => {
  const html = renderProjectTransferModal({
    selectedTeamId: "team-1",
    teams: [
      { id: "team-1", installationId: 1, membershipRole: "admin", name: "One" },
      { id: "team-2", installationId: 2, membershipRole: "admin", name: "Two" },
    ],
    projects: [{
      id: "project-1",
      chapters: [{ id: "chapter-1", status: "active" }],
    }],
    projectTransfer: {
      isOpen: true,
      projectId: "project-1",
      sourceTitle: "Source",
      targetTeamId: "team-2",
      projectName: "Copy",
      glossaryId: "g-1",
      glossaries: [{ id: "g-1", title: "Main Glossary", repoName: "main-glossary" }],
      targetProjects: [],
      resourcesStatus: "done",
      status: "idle",
      stage: "",
      error: "",
    },
  });

  assert.match(html, /data-project-transfer-team-select/);
  assert.match(html, /data-project-transfer-name-input/);
  assert.match(html, /data-project-transfer-glossary-select/);
  assert.match(html, /Main Glossary/);
  assert.match(html, /data-action="submit-project-transfer"/);
  assert.match(html, /1 file will be copied into Two/);
});
