import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
const { state } = await import("./state.js");
const { downloadProjectImportSample } = await import("./project-import-sample-flow.js");

test("sample download saves the bundled XLSX to the native dialog selection", async () => {
  let call;
  await downloadProjectImportSample(() => {}, {
    saveDialog: async (options) => {
      assert.equal(options.defaultPath, "Gnosis TMS Import Sample.xlsx");
      assert.deepEqual(options.filters[0].extensions, ["xlsx"]);
      return "/tmp/chosen.xlsx";
    },
    invokeCommand: async (...args) => { call = args; },
  });
  assert.deepEqual(call, ["save_project_import_sample", { outputPath: "/tmp/chosen.xlsx" }]);
  assert.equal(state.statusBadges.left.text, "Import sample saved.");
});

test("cancelling sample download does not write a file", async () => {
  await downloadProjectImportSample(() => {}, {
    saveDialog: async () => null,
    invokeCommand: async () => assert.fail("must not write on cancellation"),
  });
});

test("sample save failure surfaces an actionable error and allows retry", async () => {
  await downloadProjectImportSample(() => {}, {
    saveDialog: async () => "/tmp/chosen.xlsx",
    invokeCommand: async () => { throw new Error("Choose a writable location."); },
  });
  assert.equal(state.statusBadges.left.text, "Choose a writable location.");
  let retried = false;
  await downloadProjectImportSample(() => {}, {
    saveDialog: async () => { retried = true; return null; },
  });
  assert.equal(retried, true);
});
