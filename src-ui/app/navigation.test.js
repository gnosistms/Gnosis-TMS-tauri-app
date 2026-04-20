import test from "node:test";
import assert from "node:assert/strict";

import { resolveNavigationLeaveLoading } from "./navigation-leave-loading.js";

test("resolveNavigationLeaveLoading returns the editor leave modal copy", () => {
  assert.deepEqual(
    resolveNavigationLeaveLoading("translate", "projects"),
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
