import { expect, test } from "./test.js";

// The close wait must finish by quitting through the backend, never by
// destroying the window: on macOS that destroy could freeze the app with the
// wait dialog on screen. See plans/editor-close-wait-direct-exit-plan.md.

// A stand-in for the native side: row saves wait until the test releases
// them, and the window records its close-request listener and destroy calls.
async function mountEditorWithHeldSave(page) {
  await page.addInitScript(() => {
    window.invokedCommands = [];
    window.destroyCalls = 0;
    let releaseSave;
    const saveReleased = new Promise((resolve) => { releaseSave = resolve; });
    window.releaseSave = () => releaseSave();
    window.__TAURI__ = {
      event: { listen: async () => () => {} },
      window: {
        getCurrentWindow: () => ({
          onCloseRequested: async (handler) => {
            window.requestWindowClose = () => {
              let prevented = false;
              handler({ preventDefault: () => { prevented = true; } });
              return prevented;
            };
            return () => {};
          },
          destroy: async () => { window.destroyCalls += 1; },
        }),
      },
      core: { invoke: async (command, args = {}) => {
        window.invokedCommands.push(command);
        if (command === "plugin:app|version") return "0.8.133";
        if (command === "exit_app_after_close_wait") return await new Promise(() => {});
        if (command === "update_gtms_editor_row_fields") {
          await saveReleased;
          const input = args.input ?? {};
          return { row: {
            rowId: input.rowId, orderKey: "", lifecycleState: "active", textStyle: "paragraph",
            commentCount: 0, commentsRevision: 0, fields: input.fields, footnotes: input.footnotes,
            imageCaptions: input.imageCaptions, attributions: {}, images: {}, fieldStates: {}, timings: {},
          }, sourceWordCounts: {} };
        }
        if (command === "list_accessible_github_app_installations") {
          return [{ installationId: 1, accountLogin: "fixture", accountName: "Fixture Team", accountType: "organization",
            membershipRole: "owner", description: null }];
        }
        if (command === "check_internet_connection") return true;
        if (command.startsWith("list_")) return [];
        return null;
      } },
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountEditorFixture === "function");
  await page.evaluate(async () => {
    await window.__gnosisDebug.waitForBootstrap();
    await window.__gnosisDebug.mountEditorFixture({ rowCount: 3 });
  });
  const disclosureSave = page.locator(".modal-backdrop").getByRole("button", { name: "Save" });
  if (await disclosureSave.count()) await disclosureSave.click();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);

  // Type a change and close right away, as with an accidental Cmd+W.
  await page.locator('[data-editor-display-field][data-row-id="fixture-row-0001"][data-language-code="vi"]').click();
  const field = page.locator('textarea[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])');
  await field.fill("a change still being saved");
  await page.waitForFunction(() => typeof window.requestWindowClose === "function");
  expect(await page.evaluate(() => window.requestWindowClose())).toBe(true);
  await expect(dialog(page)).toBeVisible();
}

const dialog = (page) => page.locator('[data-modal-dialog="editor-close-wait"]');
const exitRequests = (page) => page.evaluate(
  () => window.invokedCommands.filter((command) => command === "exit_app_after_close_wait").length,
);

test("Keep app open dismisses the close wait and keeps the app running", async ({ page }) => {
  await mountEditorWithHeldSave(page);

  await dialog(page).getByRole("button", { name: "Keep app open" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await exitRequests(page)).toBe(0);
  expect(await page.evaluate(() => window.destroyCalls)).toBe(0);
});

test("Close without saving quits through the backend instead of destroying the window", async ({ page }) => {
  await mountEditorWithHeldSave(page);

  await dialog(page).getByRole("button", { name: "Close without saving" }).click();
  await expect.poll(() => exitRequests(page)).toBe(1);
  expect(await page.evaluate(() => window.destroyCalls)).toBe(0);
});

test("the close wait quits through the backend once the save finishes", async ({ page }) => {
  await mountEditorWithHeldSave(page);
  expect(await exitRequests(page)).toBe(0);

  await page.evaluate(() => window.releaseSave());
  await expect.poll(() => exitRequests(page)).toBe(1);
  expect(await page.evaluate(() => window.destroyCalls)).toBe(0);
});
