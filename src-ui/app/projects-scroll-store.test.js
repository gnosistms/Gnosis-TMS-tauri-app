import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

globalThis.window = {
  __TAURI__: null,
  __TAURI_INTERNALS__: null,
  addEventListener() {},
  removeEventListener() {},
};

const { setActiveStorageLogin } = await import("./team-storage.js");
const {
  clearStoredProjectsScrollEntry,
  loadStoredProjectsScrollEntry,
  normalizeStoredProjectsScrollEntry,
  projectsScrollEntryIsInvalidated,
  reconcileProjectsScrollOnRender,
  consumeProjectsScrollTopReset,
  resetProjectsScrollStoreForTests,
  saveStoredProjectsScrollEntry,
} = await import("./projects-scroll-store.js");
const {
  readProjectsSessionAnchor,
  resetProjectsScrollSessionForTests,
  updateProjectsSessionAnchor,
} = await import("./projects-scroll-session.js");

setActiveStorageLogin("tester");

function projectsState(overrides = {}) {
  return {
    screen: "projects",
    selectedTeamId: "team-a",
    projects: [{ id: "p1" }, { id: "p2" }],
    ...overrides,
  };
}

test.beforeEach(() => {
  resetProjectsScrollStoreForTests();
  resetProjectsScrollSessionForTests();
  clearStoredProjectsScrollEntry("team-a");
  clearStoredProjectsScrollEntry("team-b");
  consumeProjectsScrollTopReset();
});

test("entries normalize and round-trip per team", () => {
  saveStoredProjectsScrollEntry("team-a", {
    itemKey: "f:p1:c1",
    offsetTop: 42.5,
    scrollTop: 1200,
    projectIds: ["p1", "p2"],
    savedAt: "2026-07-05T00:00:00.000Z",
  });
  saveStoredProjectsScrollEntry("team-b", {
    itemKey: "p:p9",
    offsetTop: 0,
    projectIds: ["p9"],
  });

  const teamA = loadStoredProjectsScrollEntry("team-a");
  assert.equal(teamA.itemKey, "f:p1:c1");
  assert.equal(teamA.offsetTop, 42.5);
  assert.equal(teamA.scrollTop, 1200);
  assert.deepEqual(teamA.projectIds, ["p1", "p2"]);

  const teamB = loadStoredProjectsScrollEntry("team-b");
  assert.equal(teamB.itemKey, "p:p9");

  clearStoredProjectsScrollEntry("team-a");
  assert.equal(loadStoredProjectsScrollEntry("team-a"), null);
  assert.ok(loadStoredProjectsScrollEntry("team-b"));
});

test("invalid stored values are rejected", () => {
  assert.equal(normalizeStoredProjectsScrollEntry(null), null);
  assert.equal(normalizeStoredProjectsScrollEntry("junk"), null);
  assert.equal(normalizeStoredProjectsScrollEntry({ offsetTop: 5 }), null);

  const minimal = normalizeStoredProjectsScrollEntry({ itemKey: "p:p1", offsetTop: "nope" });
  assert.equal(minimal.offsetTop, 0);
  assert.deepEqual(minimal.projectIds, []);
});

test("a new project id invalidates; removals do not", () => {
  const entry = { itemKey: "p:p1", offsetTop: 0, projectIds: ["p1", "p2"] };
  assert.equal(projectsScrollEntryIsInvalidated(entry, ["p1", "p2"]), false);
  assert.equal(projectsScrollEntryIsInvalidated(entry, ["p1"]), false);
  assert.equal(projectsScrollEntryIsInvalidated(entry, ["p1", "p2", "p3"]), true);
  assert.equal(projectsScrollEntryIsInvalidated(entry, ["p3"]), true);
});

test("entry seeds the session anchor from the stored entry", () => {
  saveStoredProjectsScrollEntry("team-a", {
    itemKey: "f:p1:c1",
    offsetTop: 33,
    projectIds: ["p1", "p2"],
  });

  reconcileProjectsScrollOnRender("glossaries", projectsState());
  const anchor = readProjectsSessionAnchor("team-a");
  assert.equal(anchor.itemKey, "f:p1:c1");
  assert.equal(anchor.offsetTop, 33);
  assert.equal(consumeProjectsScrollTopReset(), false);
});

test("an existing session anchor wins over the stored entry on entry", () => {
  saveStoredProjectsScrollEntry("team-a", {
    itemKey: "p:p1",
    offsetTop: 0,
    projectIds: ["p1", "p2"],
  });
  updateProjectsSessionAnchor({ itemKey: "f:p2:c7", offsetTop: 10 }, "team-a");

  reconcileProjectsScrollOnRender("glossaries", projectsState());
  assert.equal(readProjectsSessionAnchor("team-a").itemKey, "f:p2:c7");
});

test("a new project on entry discards both anchors and forces the top", () => {
  saveStoredProjectsScrollEntry("team-a", {
    itemKey: "f:p1:c1",
    offsetTop: 33,
    projectIds: ["p1"],
  });
  updateProjectsSessionAnchor({ itemKey: "f:p1:c1", offsetTop: 33 }, "team-a");

  reconcileProjectsScrollOnRender("glossaries", projectsState({ projects: [{ id: "p1" }, { id: "p2" }] }));
  assert.equal(readProjectsSessionAnchor("team-a"), null);
  assert.equal(loadStoredProjectsScrollEntry("team-a"), null);
  assert.equal(consumeProjectsScrollTopReset(), true);
});

test("mid-session renders never invalidate", () => {
  saveStoredProjectsScrollEntry("team-a", {
    itemKey: "f:p1:c1",
    offsetTop: 33,
    projectIds: ["p1"],
  });

  // Entry with the saved id set intact.
  reconcileProjectsScrollOnRender("glossaries", projectsState({ projects: [{ id: "p1" }] }));
  assert.ok(readProjectsSessionAnchor("team-a"));

  // A project arrives while the user is on the page: same-screen render.
  reconcileProjectsScrollOnRender("projects", projectsState());
  assert.ok(readProjectsSessionAnchor("team-a"), "anchor survives a live addition");
  assert.equal(consumeProjectsScrollTopReset(), false);
});

test("entry restore waits for projects to load, then applies invalidation", () => {
  saveStoredProjectsScrollEntry("team-a", {
    itemKey: "f:p1:c1",
    offsetTop: 33,
    projectIds: ["p1"],
  });

  // Cold entry: projects not loaded yet — nothing happens.
  reconcileProjectsScrollOnRender("start", projectsState({ projects: [] }));
  assert.equal(readProjectsSessionAnchor("team-a"), null);
  assert.ok(loadStoredProjectsScrollEntry("team-a"));

  // Data lands on a same-screen render: invalidation runs against real ids.
  reconcileProjectsScrollOnRender("projects", projectsState());
  assert.equal(loadStoredProjectsScrollEntry("team-a"), null);
  assert.equal(consumeProjectsScrollTopReset(), true);
});

test("team switch on the projects screen is an entry for the new team", () => {
  saveStoredProjectsScrollEntry("team-b", {
    itemKey: "p:p9",
    offsetTop: 5,
    projectIds: ["p9"],
  });

  reconcileProjectsScrollOnRender("glossaries", projectsState());
  updateProjectsSessionAnchor({ itemKey: "p:p1", offsetTop: 0 }, "team-a");

  reconcileProjectsScrollOnRender(
    "projects",
    projectsState({ selectedTeamId: "team-b", projects: [{ id: "p9" }] }),
  );
  const anchor = readProjectsSessionAnchor("team-b");
  assert.equal(anchor.itemKey, "p:p9");
  // Team A's anchor no longer applies.
  assert.equal(readProjectsSessionAnchor("team-a"), null);
});

test("leaving the projects screen resets entry tracking", () => {
  reconcileProjectsScrollOnRender("start", projectsState());
  reconcileProjectsScrollOnRender("projects", { screen: "glossaries" });
  saveStoredProjectsScrollEntry("team-a", {
    itemKey: "p:p1",
    offsetTop: 12,
    projectIds: ["p1", "p2"],
  });

  reconcileProjectsScrollOnRender("glossaries", projectsState());
  assert.equal(readProjectsSessionAnchor("team-a").itemKey, "p:p1");
});
