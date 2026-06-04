import test from "node:test";
import assert from "node:assert/strict";

import { renderTeamResourceMigrationModal } from "./team-resource-migration-modal.js";

test("renders the team resource migration modal with status", () => {
  const html = renderTeamResourceMigrationModal({
    teamResourceMigrationModal: {
      isOpen: true,
      targetVersion: "0.8.10",
      message: "Migrating glossaries: Shared Terms",
    },
  });

  assert.match(html, /Migrating/);
  assert.match(html, /Updating team data/);
  assert.match(html, /Migrating glossaries: Shared Terms/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-busy="true"/);
});

test("does not render when closed", () => {
  assert.equal(
    renderTeamResourceMigrationModal({
      teamResourceMigrationModal: { isOpen: false },
    }),
    "",
  );
});
