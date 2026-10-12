import test, { mock } from "node:test";
import assert from "node:assert/strict";

class FakeSelectElement {
  constructor(kind) {
    this.kind = kind;
  }

  matches(selector) {
    if (this.kind === "chapter") {
      return selector.includes("[data-chapter-status-select]");
    }
    if (this.kind === "transfer-team") {
      return selector.includes("[data-project-transfer-team-select]");
    }
    if (this.kind === "transfer-glossary") {
      return selector.includes("[data-project-transfer-glossary-select]");
    }
    return false;
  }
}

globalThis.HTMLSelectElement = FakeSelectElement;
const documentListeners = new Map();
globalThis.document = {
  activeElement: null,
  addEventListener(type, listener) {
    if (!documentListeners.has(type)) {
      documentListeners.set(type, []);
    }
    documentListeners.get(type).push(listener);
  },
};

function dispatch(type, event = {}) {
  for (const listener of documentListeners.get(type) ?? []) {
    listener(event);
  }
}

// Event targets answer closest() for the containers the hold looks for.
function fakeTarget({ inProjectsBody = false, editable = false } = {}) {
  return {
    closest(selector) {
      if (selector.includes(".page-body")) {
        return inProjectsBody ? {} : null;
      }
      if (selector.includes("input")) {
        return editable ? {} : null;
      }
      return null;
    },
  };
}

const projectsBody = () => fakeTarget({ inProjectsBody: true });

const {
  deferProjectsRenderWhileScrolling,
  deferProjectsRenderWhileSelectEngaged,
  flushProjectsHeldRender,
  installProjectsRenderHold,
  isProjectsSelectCommitTarget,
  resetProjectsRenderHoldForTests,
  withProjectsSelectCommit,
} = await import("./projects-render-hold.js");

installProjectsRenderHold();

const holdSelect = () => new FakeSelectElement("chapter");
const transferTeamSelect = () => new FakeSelectElement("transfer-team");
const transferGlossarySelect = () => new FakeSelectElement("transfer-glossary");
const otherSelect = () => new FakeSelectElement("other");
const projectsState = { screen: "projects" };

test.beforeEach(() => {
  resetProjectsRenderHoldForTests();
  globalThis.document.activeElement = null;
});

test("renders pass through when no chapter select is engaged", () => {
  let rendered = 0;
  assert.equal(
    deferProjectsRenderWhileSelectEngaged(projectsState, () => { rendered += 1; }),
    false,
  );

  globalThis.document.activeElement = otherSelect();
  assert.equal(
    deferProjectsRenderWhileSelectEngaged(projectsState, () => { rendered += 1; }),
    false,
  );
  assert.equal(rendered, 0);
});

test("renders pass through on other screens even with a select focused", () => {
  globalThis.document.activeElement = holdSelect();
  assert.equal(
    deferProjectsRenderWhileSelectEngaged({ screen: "glossaries" }, () => {}),
    false,
  );
});

test("renders defer while a chapter select is engaged and flush once", () => {
  globalThis.document.activeElement = holdSelect();
  let rendered = 0;
  assert.equal(
    deferProjectsRenderWhileSelectEngaged(projectsState, () => { rendered += 1; }),
    true,
  );
  assert.equal(rendered, 0);

  flushProjectsHeldRender();
  assert.equal(rendered, 1);

  // Flush is one-shot.
  flushProjectsHeldRender();
  assert.equal(rendered, 1);
});

test("renders defer without a safety timeout while a transfer modal select is engaged", () => {
  const originalSetTimeout = globalThis.setTimeout;
  let timeoutCalls = 0;
  globalThis.setTimeout = () => {
    timeoutCalls += 1;
    return 1;
  };
  try {
    globalThis.document.activeElement = transferTeamSelect();
    let rendered = 0;
    assert.equal(
      deferProjectsRenderWhileSelectEngaged(projectsState, () => { rendered += 1; }),
      true,
    );
    assert.equal(timeoutCalls, 0);
    assert.equal(rendered, 0);

    flushProjectsHeldRender();
    assert.equal(rendered, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("the newest deferred render wins", () => {
  globalThis.document.activeElement = holdSelect();
  const performed = [];
  deferProjectsRenderWhileSelectEngaged(projectsState, () => performed.push("first"));
  deferProjectsRenderWhileSelectEngaged(projectsState, () => performed.push("second"));

  flushProjectsHeldRender();
  assert.deepEqual(performed, ["second"]);
});

test("a select commit bypasses the hold and supersedes older held renders", () => {
  globalThis.document.activeElement = holdSelect();
  let backgroundRendered = 0;
  let commitRendered = 0;
  deferProjectsRenderWhileSelectEngaged(projectsState, () => { backgroundRendered += 1; });

  withProjectsSelectCommit(() => {
    assert.equal(
      deferProjectsRenderWhileSelectEngaged(projectsState, () => { commitRendered += 1; }),
      false,
    );
    commitRendered += 1;
  });

  assert.equal(commitRendered, 1);
  // The stale held render was superseded by the commit's fresh render.
  flushProjectsHeldRender();
  assert.equal(backgroundRendered, 0);
});

test("commit target detection matches chapter and transfer modal selects", () => {
  assert.equal(isProjectsSelectCommitTarget(holdSelect()), true);
  assert.equal(isProjectsSelectCommitTarget(transferTeamSelect()), true);
  assert.equal(isProjectsSelectCommitTarget(transferGlossarySelect()), true);
  assert.equal(isProjectsSelectCommitTarget(otherSelect()), false);
  assert.equal(isProjectsSelectCommitTarget(null), false);
});

test.describe("scroll hold", () => {
  test.beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] });
  });

  test.afterEach(() => {
    resetProjectsRenderHoldForTests();
    mock.timers.reset();
  });

  test("full renders pass through when the user is not scrolling", () => {
    assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), false);
  });

  test("wheel scrolling holds the newest full render until scrolling is idle", () => {
    const performed = [];
    dispatch("wheel", { target: projectsBody() });
    assert.equal(
      deferProjectsRenderWhileScrolling(projectsState, {}, () => performed.push("first")),
      true,
    );
    assert.equal(
      deferProjectsRenderWhileScrolling(projectsState, {}, () => performed.push("second")),
      true,
    );

    mock.timers.tick(150);
    dispatch("wheel", { target: projectsBody() });
    mock.timers.tick(150);
    assert.deepEqual(performed, []);

    mock.timers.tick(50);
    assert.deepEqual(performed, ["second"]);

    mock.timers.tick(1000);
    assert.deepEqual(performed, ["second"]);
  });

  test("status-bar and update-badge renders pass through while scrolling", () => {
    dispatch("wheel", { target: projectsBody() });
    assert.equal(
      deferProjectsRenderWhileScrolling(projectsState, { scope: "status-surface" }, () => {}),
      false,
    );
    assert.equal(
      deferProjectsRenderWhileScrolling(projectsState, { scope: "app-update-progress" }, () => {}),
      false,
    );
  });

  test("renders pass through on other screens while scrolling", () => {
    dispatch("wheel", { target: projectsBody() });
    assert.equal(
      deferProjectsRenderWhileScrolling({ screen: "translate" }, {}, () => {}),
      false,
    );
  });

  test("a long scroll still flushes after the maximum hold", () => {
    let rendered = 0;
    dispatch("wheel", { target: projectsBody() });
    deferProjectsRenderWhileScrolling(projectsState, {}, () => { rendered += 1; });

    for (let elapsed = 0; elapsed < 2900; elapsed += 100) {
      mock.timers.tick(100);
      dispatch("wheel", { target: projectsBody() });
    }
    assert.equal(rendered, 0);

    mock.timers.tick(100);
    assert.equal(rendered, 1);
  });

  test("wheel input outside the projects list does not hold renders", () => {
    dispatch("wheel", { target: fakeTarget() });
    assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), false);
  });

  test("scroll events count only while a pointer is down", () => {
    // A render restoring the list position fires a scroll event with no
    // pointer down; that must not hold the next render.
    dispatch("scroll", { target: projectsBody() });
    assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), false);

    dispatch("pointerdown", { target: projectsBody() });
    dispatch("scroll", { target: projectsBody() });
    assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), true);

    dispatch("pointerup", { target: projectsBody() });
    mock.timers.tick(200);
    dispatch("scroll", { target: projectsBody() });
    assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), false);
  });

  test("scroll keys hold renders except while typing in a field", () => {
    dispatch("keydown", { key: "ArrowDown", target: fakeTarget({ editable: true }) });
    assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), false);

    dispatch("keydown", { key: "a", target: fakeTarget() });
    assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), false);

    dispatch("keydown", { key: "PageDown", target: fakeTarget() });
    assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), true);
  });

  test("scroll idle leaves a render held by an engaged select to the select hold", () => {
    let rendered = 0;
    dispatch("wheel", { target: projectsBody() });
    deferProjectsRenderWhileScrolling(projectsState, {}, () => { rendered += 1; });
    globalThis.document.activeElement = transferTeamSelect();

    mock.timers.tick(5000);
    assert.equal(rendered, 0);

    const select = globalThis.document.activeElement;
    globalThis.document.activeElement = null;
    dispatch("focusout", { target: select });
    assert.equal(rendered, 1);
  });

  test("a select commit supersedes a render held for scrolling", () => {
    let backgroundRendered = 0;
    dispatch("wheel", { target: projectsBody() });
    deferProjectsRenderWhileScrolling(projectsState, {}, () => { backgroundRendered += 1; });

    withProjectsSelectCommit(() => {
      assert.equal(deferProjectsRenderWhileScrolling(projectsState, {}, () => {}), false);
    });

    mock.timers.tick(5000);
    assert.equal(backgroundRendered, 0);
  });
});
