import { expect, test } from "@playwright/test";

test("format warning stays readable and its link invokes native sample saving", async ({ page }) => {
  await page.route("**/import-format-fixture", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="app"></div></body></html>',
  }));
  await page.goto("/import-format-fixture");
  await page.evaluate(async () => {
    window.sampleSaveCalls = [];
    window.__TAURI__ = {
      core: { invoke: async (...args) => { window.sampleSaveCalls.push(args); } },
      dialog: { save: async () => "/tmp/Gnosis TMS Import Sample.xlsx" },
    };
    const { state } = await import(`${location.origin}/app/state.js`);
    const { renderProjectImportModal } = await import(`${location.origin}/screens/project-import-modal.js`);
    const { createProjectActions } = await import(`${location.origin}/app/actions/project-actions.js`);
    state.projectImport = {
      ...state.projectImport, isOpen: true, inputMode: "upload", status: "error",
      projectTitle: "Education", error: "PROJECT_IMPORT_INVALID_FORMAT: unsupported language code Key",
    };
    const render = () => { document.querySelector("#app").innerHTML = renderProjectImportModal(state); };
    const handleAction = createProjectActions(render);
    document.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action) void handleAction(action, event);
    });
    render();
  });
  const warning = page.getByRole("alert");
  await expect(warning).toContainText("The file you uploaded is not formatted for import to Gnosis TMS.");
  await expect(warning).not.toContainText("PROJECT_IMPORT_INVALID_FORMAT");
  const link = page.getByRole("button", { name: "Click here to download a sample file" });
  await expect(link).toBeVisible();
  await page.locator('[data-modal-dialog="project-import:input"]').screenshot({ path: test.info().outputPath("format-warning.png") });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.sampleSaveCalls)).toEqual([
    ["save_project_import_sample", { outputPath: "/tmp/Gnosis TMS Import Sample.xlsx" }],
  ]);
  await expect(warning).toBeVisible();
});
