import { expect, test } from "@playwright/test";

async function mountKeyboardFixture(page, markup) {
  await page.locator("#app").evaluate((app, html) => {
    app.innerHTML = html;
    globalThis.__modalKeyboardCounts = {
      cancel: 0,
      default: 0,
      local: 0,
      option: 0,
    };
    app.querySelector("[data-test-cancel]")?.addEventListener("click", () => {
      globalThis.__modalKeyboardCounts.cancel += 1;
    });
    app.querySelector("[data-test-default]")?.addEventListener("click", () => {
      globalThis.__modalKeyboardCounts.default += 1;
    });
    app.querySelector("[data-action='fixture-local-action']")?.addEventListener("click", () => {
      globalThis.__modalKeyboardCounts.local += 1;
    });
    app.querySelector("[data-test-option='two']")?.addEventListener("click", () => {
      globalThis.__modalKeyboardCounts.option += 1;
    });
  }, markup);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {}

    globalThis.__TAURI__ = {
      store: {
        load: async () => ({
          entries: async () => [],
          set: async () => {},
          delete: async () => {},
        }),
      },
      core: {
        invoke: async (command) => {
          if (command === "load_broker_auth_session") {
            return null;
          }
          if (command === "check_internet_connection") {
            return true;
          }
          if (command === "check_for_app_update") {
            return {
              available: false,
              currentVersion: "0.0.0-test",
              version: null,
              body: null,
            };
          }
          return null;
        },
      },
      event: {
        listen: async () => () => {},
      },
      opener: {
        openUrl() {},
      },
    };
  });

  await page.goto("/");
  await page.evaluate(async () => {
    await window.__gnosisDebug.waitForBootstrap();
  });
});

test("modal keyboard controller respects control-local Enter behavior", async ({ page }) => {
  await mountKeyboardFixture(page, `
    <section role="dialog" aria-modal="true" aria-labelledby="fixture-title" data-modal-dialog="fixture" tabindex="-1">
      <h2 id="fixture-title">Fixture</h2>
      <input data-test-input />
      <textarea data-test-textarea></textarea>
      <input data-test-search data-modal-enter-action="fixture-local-action" />
      <button data-action="fixture-local-action">Search</button>
      <button data-test-cancel data-modal-cancel>Cancel</button>
      <button data-test-default data-modal-default>Continue</button>
    </section>
  `);

  const input = page.locator("[data-test-input]");
  await input.focus();
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.default)).toBe(1);

  const textarea = page.locator("[data-test-textarea]");
  await textarea.focus();
  await textarea.press("Enter");
  await expect(textarea).toHaveValue("\n");
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.default)).toBe(1);

  const search = page.locator("[data-test-search]");
  await search.focus();
  await search.press("Enter");
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.local)).toBe(1);
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.default)).toBe(1);

  const cancel = page.locator("[data-test-cancel]");
  await cancel.focus();
  await cancel.press("Enter");
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.cancel)).toBe(1);

  await textarea.focus();
  await textarea.press("Escape");
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.cancel)).toBe(2);
});

test("modal keyboard controller traps focus and leaves disabled defaults inert", async ({ page }) => {
  await mountKeyboardFixture(page, `
    <button data-test-background>Background</button>
    <section role="dialog" aria-modal="true" aria-labelledby="fixture-title" data-modal-dialog="fixture" tabindex="-1">
      <h2 id="fixture-title">Fixture</h2>
      <button data-test-cancel data-modal-cancel>Cancel</button>
      <input data-test-input />
      <button data-test-default data-modal-default disabled>Continue</button>
    </section>
  `);

  const input = page.locator("[data-test-input]");
  await input.focus();
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.default)).toBe(0);

  await input.press("Tab");
  await expect(page.locator("[data-test-cancel]")).toBeFocused();
  await page.locator("[data-test-cancel]").press("Shift+Tab");
  await expect(input).toBeFocused();

  await page.locator("[data-test-background]").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-test-cancel]")).toBeFocused();
});

test("roving choices use arrows locally and activate only on Enter", async ({ page }) => {
  await mountKeyboardFixture(page, `
    <section role="dialog" aria-modal="true" aria-labelledby="fixture-title" data-modal-dialog="fixture" tabindex="-1">
      <h2 id="fixture-title">Fixture</h2>
      <div role="listbox" data-roving-choice-group data-roving-choice-axis="vertical">
        <button role="option" data-roving-choice-option data-test-option="one" tabindex="0">One</button>
        <button role="option" data-roving-choice-option data-test-option="two" tabindex="-1">Two</button>
        <button role="option" data-roving-choice-option data-test-option="three" tabindex="-1">Three</button>
      </div>
      <button data-test-default data-modal-default>Continue</button>
    </section>
  `);

  await page.locator("[data-test-option='one']").focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-test-option='two']")).toBeFocused();
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.option)).toBe(0);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.option)).toBe(1);
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.default)).toBe(0);
});

test("roving choices remain keyboard reachable before a selection exists", async ({ page }) => {
  await mountKeyboardFixture(page, `
    <section role="dialog" aria-modal="true" aria-labelledby="fixture-title" data-modal-dialog="fixture" tabindex="-1">
      <h2 id="fixture-title">Fixture</h2>
      <div role="listbox" data-roving-choice-group data-roving-choice-axis="vertical">
        <button role="option" data-roving-choice-option data-test-option="one" tabindex="-1">One</button>
        <button role="option" data-roving-choice-option data-test-option="two" tabindex="-1">Two</button>
      </div>
      <button data-test-cancel data-modal-cancel>Cancel</button>
      <button data-test-default data-modal-default disabled>Continue</button>
    </section>
  `);

  const cancel = page.locator("[data-test-cancel]");
  await cancel.focus();
  await cancel.press("Shift+Tab");
  await expect(page.locator("[data-test-option='one']")).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-test-option='two']")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.option)).toBe(1);
});

test("radiogroup arrow navigation selects the newly focused choice", async ({ page }) => {
  await mountKeyboardFixture(page, `
    <section role="dialog" aria-modal="true" aria-labelledby="fixture-title" data-modal-dialog="fixture" tabindex="-1">
      <h2 id="fixture-title">Fixture</h2>
      <div
        role="radiogroup"
        data-roving-choice-group
        data-roving-choice-axis="horizontal"
        data-roving-choice-selection-follows-focus="true"
      >
        <button role="radio" aria-checked="true" data-roving-choice-option data-test-option="one" tabindex="0">One</button>
        <button role="radio" aria-checked="false" data-roving-choice-option data-test-option="two" tabindex="-1">Two</button>
      </div>
    </section>
  `);

  await page.locator("[data-test-option='one']").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-test-option='two']")).toBeFocused();
  await expect.poll(() => page.evaluate(() => globalThis.__modalKeyboardCounts.option)).toBe(1);
});

test("page-level shortcuts do not move focus behind an active modal", async ({ page }) => {
  await mountKeyboardFixture(page, `
    <input data-project-search-input data-test-background-search />
    <section role="dialog" aria-modal="true" aria-labelledby="fixture-title" data-modal-dialog="fixture" tabindex="-1">
      <h2 id="fixture-title">Fixture</h2>
      <button data-test-cancel data-modal-cancel>Cancel</button>
    </section>
  `);

  const cancel = page.locator("[data-test-cancel]");
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    await cancel.focus();
    await cancel.evaluate((button, init) => {
      button.dispatchEvent(new KeyboardEvent("keydown", {
        key: "f",
        bubbles: true,
        cancelable: true,
        ...init,
      }));
    }, modifiers);
    await expect(cancel).toBeFocused();
  }
  await expect(page.locator("[data-test-background-search]")).not.toBeFocused();
});

test("modal render lifecycle initializes, preserves, and restores focus", async ({ page }) => {
  await page.evaluate(async () => {
    await window.__gnosisDebug.mountProjectsFixture({
      projectCount: 1,
      filesPerProject: 0,
    });
  });

  const telemetrySave = page
    .locator(".modal-backdrop")
    .getByRole("button", { name: "Save" });
  if (await telemetrySave.count()) {
    await telemetrySave.click();
  }

  const opener = page.locator('[data-action="open-new-project"]');
  await opener.focus();
  await opener.click();

  const input = page.locator("[data-project-name-input]");
  await expect(input).toBeFocused();
  await input.fill("abcdef");
  await input.evaluate((element) => {
    element.setSelectionRange(2, 4);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(input).toBeFocused();
  expect(await input.evaluate((element) => [
    element.selectionStart,
    element.selectionEnd,
  ])).toEqual([2, 4]);

  await input.press("Escape");
  await expect(page.locator("[data-modal-dialog='project-creation']")).toHaveCount(0);
  await expect(opener).toBeFocused();
});
