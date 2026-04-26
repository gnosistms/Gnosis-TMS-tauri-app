import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  addEventListener() {},
  documentElement: {
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
  },
  __TAURI_INTERNALS__: null,
  addEventListener() {},
  open() {},
  requestAnimationFrame(callback) {
    callback();
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const { resetSessionState, state } = await import("./state.js");
const { downloadGlossaryAsTmx } = await import("./glossary-export-flow.js");

function installExportFixture() {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    installationId: 42,
  }];
  state.glossaries = [{
    id: "glossary-1",
    repoName: "gnosis-es-vi",
    title: "Gnosis ES/VI",
  }];
}

test.afterEach(() => {
  resetSessionState();
});

test("downloadGlossaryAsTmx saves to a selected path and invokes TMX export", async () => {
  installExportFixture();
  const calls = [];

  await downloadGlossaryAsTmx(() => {}, "glossary-1", {
    saveDialog: async (options) => {
      calls.push(["save", options]);
      return "/tmp/Gnosis ES-VI.tmx";
    },
    invoke: async (command, payload) => {
      calls.push(["invoke", command, payload]);
    },
  });

  assert.equal(calls[0][0], "save");
  assert.equal(calls[0][1].defaultPath, "Gnosis ES-VI.tmx");
  assert.deepEqual(calls[0][1].filters, [{ name: "TMX glossary", extensions: ["tmx"] }]);
  assert.equal(calls[1][1], "export_gtms_glossary_to_tmx");
  assert.deepEqual(calls[1][2], {
    input: {
      installationId: 42,
      repoName: "gnosis-es-vi",
      glossaryId: "glossary-1",
      outputPath: "/tmp/Gnosis ES-VI.tmx",
    },
  });
});

test("downloadGlossaryAsTmx does not export when the save dialog is cancelled", async () => {
  installExportFixture();
  let invoked = false;

  await downloadGlossaryAsTmx(() => {}, "glossary-1", {
    saveDialog: async () => null,
    invoke: async () => {
      invoked = true;
    },
  });

  assert.equal(invoked, false);
});

test("downloadGlossaryAsTmx surfaces export failures", async () => {
  installExportFixture();
  let renderCount = 0;

  await downloadGlossaryAsTmx(() => {
    renderCount += 1;
  }, "glossary-1", {
    saveDialog: async () => "/tmp/glossary.tmx",
    invoke: async () => {
      throw new Error("export failed");
    },
  });

  assert.equal(renderCount, 1);
  assert.equal(state.statusBadges.left.visible, true);
  assert.match(state.statusBadges.left.text, /export failed/);
});
