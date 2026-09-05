import { expect, test } from "@playwright/test";

async function boot(page) {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.waitForBootstrap === "function");
  await page.evaluate(() => window.__gnosisDebug.waitForBootstrap());
}

test("known updates survive an offline reload and appear on the start screen", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const { storeKnownAppUpdate } = await import("/app/app-update-storage.js");
    storeKnownAppUpdate({ available: true, version: "99.0.0", currentVersion: "1.0.0", dismissedVersion: "99.0.0" });
  });
  await page.reload();
  await page.waitForFunction(() => typeof window.__gnosisDebug?.waitForBootstrap === "function");
  await page.evaluate(() => window.__gnosisDebug.waitForBootstrap());
  await expect(page.locator(".app-update-fallback .app-update-pill")).toHaveText("Update");
  await expect(page.locator('[data-modal-dialog^="app-update:"]')).toHaveCount(0);
});

test("all screens have a single pill and progress never replaces focused editor content", async ({ page }) => {
  await boot(page);
  const results = await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    const { renderAppUpdateSurface } = await import("/app/app-update-surface.js");
    const screens = [
      ["start", "renderStartScreen"], ["teams/index", "renderTeamsScreen"],
      ["projects", "renderProjectsScreen"], ["glossaries", "renderGlossariesScreen"],
      ["qa", "renderQaScreen"], ["users", "renderUsersScreen"],
      ["ai-key", "renderAiKeyScreen"], ["translate", "renderTranslateScreen"],
      ["glossary-editor", "renderGlossaryEditorScreen"], ["qa-list-editor", "renderQaListEditorScreen"],
    ];
    state.appUpdate = { available: true, status: "installing", downloadPercent: 12 };
    const root = document.querySelector("#app");
    const results = [];
    for (const [file, name] of screens) {
      const module = await import(`/screens/${file}.js`);
      root.innerHTML = module[name](state);
      renderAppUpdateSurface(root, state.appUpdate);
      const title = root.querySelector(".page-header__title-wrap");
      const input = document.createElement("textarea");
      root.append(input);
      input.value = "unsaved text";
      input.focus();
      input.setSelectionRange(3, 7);
      renderAppUpdateSurface(root, { ...state.appUpdate, downloadPercent: 73 });
      results.push({
        file,
        count: root.querySelectorAll(".app-update-pill").length,
        text: root.querySelector(".app-update-pill").textContent.trim(),
        inHeader: !title || Boolean(title.querySelector(".app-update-pill")),
        preserved: document.activeElement === input && input.value === "unsaved text"
          && input.selectionStart === 3 && input.selectionEnd === 7,
      });
    }
    return results;
  });
  for (const result of results) {
    expect(result, result.file).toMatchObject({ count: 1, text: "73%", inHeader: true, preserved: true });
  }
});

test("pill keeps compact sizing and displays the explicit restart action", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const { state } = await import("/app/state.js");
    const { renderProjectsScreen } = await import("/screens/projects.js");
    const { applyProjectsPageFixture } = await import("/app/projects-page-fixture.js");
    state.appUpdate = { available: true, status: "downloaded", version: "99.0.0" };
    applyProjectsPageFixture(state, { projectCount: 2 });
    document.querySelector("#app").innerHTML = renderProjectsScreen(state);
  });
  const pill = page.locator(".app-update-pill");
  await expect(pill).toHaveText("Restart to update");
  await expect(pill).toHaveAttribute("data-action", "install-app-update");
  const style = await pill.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    radius: getComputedStyle(element).borderRadius,
    iconWidth: element.querySelector("svg").getBoundingClientRect().width,
  }));
  expect(style).toEqual({ height: 25, radius: "999px", iconWidth: 13 });
  await page.locator(".page-header").screenshot({ path: test.info().outputPath("update-pill.png") });
});
