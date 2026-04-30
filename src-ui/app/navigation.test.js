import test from "node:test";
import assert from "node:assert/strict";

import { resolveNavigationLeaveLoading } from "./navigation-leave-loading.js";

test("resolveNavigationLeaveLoading skips the editor leave modal for projects", () => {
  assert.equal(resolveNavigationLeaveLoading("translate", "projects"), null);
});

test("resolveNavigationLeaveLoading returns the editor leave modal copy for non-project exits", () => {
  assert.deepEqual(
    resolveNavigationLeaveLoading("translate", "glossaries"),
    {
      title: "Saving and syncing...",
      message: "Please wait before leaving the editor.",
    },
  );
});

test("resolveNavigationLeaveLoading returns the glossary leave modal copy", () => {
  assert.deepEqual(
    resolveNavigationLeaveLoading("glossaryEditor", "glossaries", {
      glossaryNeedsExitSync: true,
    }),
    {
      title: "Saving and syncing...",
      message: "Please wait before leaving the glossary.",
    },
  );
});

test("resolveNavigationLeaveLoading stays inactive when not leaving an editing screen", () => {
  assert.equal(resolveNavigationLeaveLoading("glossaryEditor", "glossaryEditor"), null);
  assert.equal(resolveNavigationLeaveLoading("glossaryEditor", "glossaries"), null);
  assert.equal(resolveNavigationLeaveLoading("projects", "glossaries"), null);
});
