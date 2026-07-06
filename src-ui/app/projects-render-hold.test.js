import test from "node:test";
import assert from "node:assert/strict";

class FakeSelectElement {
  constructor(matchesHoldSelector) {
    this.matchesHoldSelector = matchesHoldSelector;
  }

  matches() {
    return this.matchesHoldSelector;
  }
}

globalThis.HTMLSelectElement = FakeSelectElement;
globalThis.document = {
  activeElement: null,
  addEventListener() {},
};

const {
  deferProjectsRenderWhileSelectEngaged,
  flushProjectsHeldRender,
  isProjectsSelectCommitTarget,
  resetProjectsRenderHoldForTests,
  withProjectsSelectCommit,
} = await import("./projects-render-hold.js");

const holdSelect = () => new FakeSelectElement(true);
const otherSelect = () => new FakeSelectElement(false);
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

test("commit target detection matches only chapter selects", () => {
  assert.equal(isProjectsSelectCommitTarget(holdSelect()), true);
  assert.equal(isProjectsSelectCommitTarget(otherSelect()), false);
  assert.equal(isProjectsSelectCommitTarget(null), false);
});
