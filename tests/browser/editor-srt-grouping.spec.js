import { test, expect } from "./test.js";

async function mount(page, count = 6, gapMs = 0) {
  await page.addInitScript(() => {
    localStorage.clear();
    window.__srtCalls = [];
    window.__srtStored = [];
    window.__gnosisMockTauri = { mountEditorFixture(payload) { window.__srtStored = structuredClone(payload.rows); } };
    window.__TAURI__ = {
      event: { listen: async () => () => {} },
      core: { invoke: async (command, args) => {
        window.__srtCalls.push({ command, args });
        if (command === "load_ai_provider_secret") return "mock-key-for-tests";
        if (command === "run_ai_translation_batch" || command === "run_ai_review_batch") {
          if (window.__srtAiDelay) await new Promise((resolve) => setTimeout(resolve, window.__srtAiDelay));
          return { rows: window.__srtAiResults, unknownRowIds: [], promptText: "Mock sentence request" };
        }
        if (command === "load_gtms_editor_field_history") {
          const key = `${args.input.rowId}:${args.input.languageCode}`;
          const entries = structuredClone(window.__srtHistory?.[key] ?? []);
          const fail = window.__srtHistoryFail === args.input.rowId;
          if (window.__srtHistoryDelay) await new Promise((resolve) => setTimeout(resolve, window.__srtHistoryDelay));
          if (fail) throw new Error("Simulated fragment history failure");
          return { entries };
        }
        if (command === "load_gtms_editor_row") return { row: structuredClone(window.__srtStored.find((row) => row.rowId === args.input.rowId)) };
        if (command === "update_gtms_editor_row_fields_batch") {
          if (window.__srtDelay) await new Promise((resolve) => setTimeout(resolve, window.__srtDelay));
          if (window.__srtFail) throw new Error("Simulated group save failure");
          if (window.__srtConflict) return { rows: [], rowIds: [], conflicts: [{ rowId: args.input.rows[1].rowId,
            status: "conflict", row: { ...structuredClone(window.__srtStored[1]), fields: { ...window.__srtStored[1].fields, vi: "remote edit" } },
            baseFields: args.input.rows[1].baseFields }] };
          const rows = args.input.rows.map((input) => {
            const row = window.__srtStored.find((item) => item.rowId === input.rowId);
            if (window.__srtRemoteSource && row.rowId === "fixture-row-0002") row.fields.es = "Remote source.";
            row.fields = { ...row.fields, ...input.fields };
            row.footnotes = { ...row.footnotes, ...input.footnotes };
            row.imageCaptions = { ...row.imageCaptions, ...input.imageCaptions };
            for (const [code, flags] of Object.entries(input.fieldFlags ?? {})) {
              row.fieldStates[code] = { ...row.fieldStates[code],
                ...(flags.reviewed !== undefined ? { reviewed: flags.reviewed } : {}),
                ...(flags["please-check"] !== undefined ? { pleaseCheck: flags["please-check"] } : {}),
              };
            }
            if (input.lifecycleState) row.lifecycleState = input.lifecycleState;
            return structuredClone(row);
          });
          return { rows, rowIds: rows.map((row) => row.rowId), conflicts: [], wordCounts: {}, chapterBaseCommitSha: "saved-group" };
        }
        return null;
      } },
    };
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__gnosisDebug?.mountEditorFixture);
  await page.evaluate(async ([rowCount, gap]) => {
    const fieldsByRowId = {};
    const srtTimingByRowId = {};
    for (let i = 1; i <= rowCount; i++) {
      const id = `fixture-row-${String(i).padStart(4, "0")}`;
      fieldsByRowId[id] = { es: i % 3 === 0 ? "sentence." : "fragment", vi: `target${i}` };
      srtTimingByRowId[id] = { startMs: (i - 1) * (1000 + gap), endMs: (i - 1) * (1000 + gap) + 1000 };
    }
    await window.__gnosisDebug.mountEditorFixture({ rowCount, srt: true, chapterStatus: "ready", fieldsByRowId, srtTimingByRowId });
  }, [count, gapMs]);
  const disclosure = page.locator(".modal-backdrop").getByRole("button", { name: "Save", exact: true });
  if (await disclosure.count()) await disclosure.click();
}

const repairedMessage = "There were errors in your use of ⟦n⟧ markers to separate the text. We have fixed them automatically. Please check your text to make sure we fixed them correctly.";
const invalidMessage = "There were errors in your use of ⟦n⟧ markers to separate the text. Please check the text and ensure that you have exactly 2 separators from 1 to 2 and that they appear in order from 1 to 2.";
const markerModal = (page) => page.locator('[data-modal-dialog="editor-srt-marker"]');
const storedTargets = (page) => page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi));
const target = (page) => page.locator('[data-editor-display-field][data-row-id="fixture-row-0001"][data-language-code="vi"]');
const input = (page) => page.locator('textarea[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])');

test("Standard is default; grouping combines cues, hides Merge/timings and changes no data", async ({ page }) => {
  await mount(page);
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(6);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
  await expect(target(page)).toContainText("target1⟦1⟧target2⟦2⟧target3");
  await expect(page.locator("[data-editor-timing-field]")).toHaveCount(0);
  await expect(page.locator('[data-action^="open-merge-editor-rows:"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__srtCalls.filter((call) => call.command.startsWith("update_gtms")))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("srt-groups.png") });
});

test("optional pause splitting appears in grouped view, regroups immediately and preserves view settings", async ({ page }) => {
  await mount(page, 6, 800);
  const toggle = page.getByRole("checkbox", { name: "Split groups at pauses longer than" });
  const threshold = page.getByRole("combobox", { name: "Pause length in seconds" });
  await expect(toggle).toHaveCount(0);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(threshold).toHaveValue("500");
  expect(await threshold.locator("option").allTextContents()).toEqual(["0.5", "0.75", "1", "1.5", "2", "2.5", "3"]);
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
  await threshold.selectOption("2000");
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
  await threshold.selectOption("500");
  await toggle.check();
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(6);
  await threshold.selectOption("1000");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
  await threshold.selectOption("750");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(6);
  const tooltip = page.locator(".translation-srt-pause-control");
  await expect(tooltip).toHaveAttribute("data-tooltip", "Sometimes sentences run on long with no punctuation. In that case, you may want to split groups at pauses.");
  await threshold.hover();
  await expect.poll(() => tooltip.evaluate((element) => getComputedStyle(element, "::before").content)).toContain("Sometimes sentences run on long");
  await page.screenshot({ path: test.info().outputPath("pause-splitting.png") });
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(toggle).toHaveCount(0);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(threshold).toHaveValue("750");
  await toggle.uncheck();
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
  expect(await page.evaluate(() => window.__srtCalls.filter((call) => call.command.startsWith("update_gtms")))).toEqual([]);
});

test("changing pause splitting saves the current grouped draft before regrouping", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("edited⟦1⟧second⟦2⟧third");
  await page.getByRole("checkbox", { name: "Split groups at pauses longer than" }).check();
  await expect.poll(() => page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi))).toEqual(["edited", "second", "third"]);
  await expect(page.getByRole("checkbox", { name: "Split groups at pauses longer than" })).toBeChecked();
});

test("longer pause choices regroup cues and the pause checkbox shares Replace styling", async ({ page }) => {
  await mount(page, 6, 2750);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  const pause = page.getByRole("checkbox", { name: "Split groups at pauses longer than" });
  const threshold = page.getByRole("combobox", { name: "Pause length in seconds" });
  await threshold.selectOption("3000");
  await pause.check();
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
  await threshold.selectOption("2500");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(6);
  await page.getByRole("textbox", { name: "Search visible rows" }).fill("fragment");
  const replace = page.locator("[data-editor-replace-toggle]");
  await expect(replace).toBeVisible();
  await pause.uncheck();
  const style = (locator, pseudo = null) => locator.evaluate((element, selector) => {
    const computed = getComputedStyle(element, selector);
    return Object.fromEntries(["appearance", "width", "height", "border", "borderRadius", "backgroundColor", "boxShadow", "outline", "borderColor"]
      .map((property) => [property, computed[property]]));
  }, pseudo);
  await page.getByRole("textbox", { name: "Search visible rows" }).focus();
  expect(await style(pause)).toEqual(await style(replace));
  await pause.check();
  await replace.check();
  await page.getByRole("textbox", { name: "Search visible rows" }).focus();
  expect(await style(pause)).toEqual(await style(replace));
  expect(await style(pause, "::after")).toEqual(await style(replace, "::after"));
  await page.screenshot({ path: test.info().outputPath("shared-checkboxes.png") });
});

test("invalid grouped drafts block pause setting changes and restore the unchecked control", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("a⟦1⟧b⟦1⟧c");
  // A canceled setting change re-renders the native checkbox back to unchecked.
  await page.getByRole("checkbox", { name: "Split groups at pauses longer than" }).click();
  await expect(page.getByRole("checkbox", { name: "Split groups at pauses longer than" })).not.toBeChecked();
  await expect(page.locator(".translation-srt-error")).toContainText("more than once");
  await expect(input(page)).toHaveValue("a⟦1⟧b⟦1⟧c");
  await page.getByRole("button", { name: "Ok", exact: true }).click();
  await page.getByRole("combobox", { name: "Pause length in seconds" }).selectOption("2000");
  await expect(page.getByRole("combobox", { name: "Pause length in seconds" })).toHaveValue("500");
  expect(await page.evaluate(() => window.__srtStored[0].fields.vi)).toBe("target1");
});

test("deleted markers propose blank later cues and require explicit review before saving", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("one sentence⟦2⟧third");
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(markerModal(page)).toContainText(repairedMessage);
  expect(await storedTargets(page)).toEqual(["target1", "target2", "target3"]);
  await page.getByRole("button", { name: "Ok", exact: true }).click();
  await expect(input(page)).toHaveValue("one sentence⟦1⟧⟦2⟧third");
  await expect(input(page)).toBeFocused();
  await page.evaluate(() => window.__gnosisDebug.flushDirtyRows());
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Group fragments", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await storedTargets(page)).toEqual(["target1", "target2", "target3"]);
  await page.getByRole("button", { name: "Save sentence draft", exact: true }).click();
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(6);
  const saved = await page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi));
  expect(saved).toEqual(["one sentence", "", "third"]);
  expect(await page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.srtTiming))).toEqual([
    { startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 2000 }, { startMs: 2000, endMs: 3000 },
  ]);
});

test("duplicate markers retain the raw draft and block saving/mode switch", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("a⟦1⟧b⟦1⟧c");
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Group fragments", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".translation-srt-error")).toContainText("more than once");
  await expect(input(page)).toHaveValue("a⟦1⟧b⟦1⟧c");
  expect(await page.evaluate(() => window.__srtStored[0].fields.vi)).toBe("target1");
});

test("group review action applies the same state to every member", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  const button = page.locator('[data-action="toggle-editor-reviewed"][data-row-id="fixture-row-0001"][data-language-code="vi"]');
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fieldStates.vi.reviewed))).toEqual([true, true, true]);
});

test("markers can be deleted and undone normally; saving a marker-free draft empties later cues", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).press("ControlOrMeta+A");
  await input(page).press("Backspace");
  await expect(input(page)).toHaveValue("");
  await input(page).press("ControlOrMeta+Z");
  await expect(input(page)).toHaveValue("target1⟦1⟧target2⟦2⟧target3");
  await input(page).fill("Whole sentence");
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(markerModal(page)).toContainText(repairedMessage);
  await page.getByRole("button", { name: "Ok", exact: true }).click();
  await expect(input(page)).toHaveValue("Whole sentence⟦1⟧⟦2⟧");
  await page.getByRole("button", { name: "Save sentence draft", exact: true }).click();
  expect(await storedTargets(page)).toEqual(["Whole sentence", "", ""]);
});

test("reordered markers and save errors preserve drafts and block mode changes", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("a⟦2⟧b⟦1⟧c");
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(page.locator(".translation-srt-error")).toContainText("out of order");
  await page.getByRole("button", { name: "Ok", exact: true }).click();
  await input(page).fill("valid⟦1⟧⟦2⟧");
  await page.evaluate(() => { window.__srtFail = true; });
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(page.getByRole("button", { name: "Group fragments", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__srtStored[0].fields.vi)).toBe("target1");
  expect(await page.evaluate(async () => {
    const { state } = await import(new URL("/app/state.js", location.origin).href);
    return Object.values(state.editorChapter.srtGroupEdits)[0].draft;
  })).toBe("valid⟦1⟧⟦2⟧");
});

test("a conflict isolates its cue and preserves the unsaved sentence draft", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("local⟦1⟧changed⟦2⟧sentence");
  await page.evaluate(() => { window.__srtConflict = true; });
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0002"]')).toBeVisible();
  await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0002"]')).not.toHaveAttribute("data-srt-member-ids");
  await expect(page.getByRole("textbox", { name: "Preserved sentence draft" })).toHaveValue("local⟦1⟧changed⟦2⟧sentence");
  expect(await page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi))).toEqual(["target1", "target2", "target3"]);
});

test("mixed statuses and empty-target filters agree with the group's visible state", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const { state } = await import(new URL("/app/state.js", location.origin).href);
    state.editorChapter.rows = state.editorChapter.rows.map((row, index) => ({ ...row,
      fieldStates: { ...row.fieldStates, vi: { reviewed: index === 0, pleaseCheck: index === 1 } },
      persistedFieldStates: { ...row.fieldStates, vi: { reviewed: index === 0, pleaseCheck: index === 1 } },
    }));
    await window.__gnosisDebug.patchFixtureRow("fixture-row-0001", {});
  });
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await expect(page.locator('[data-action="toggle-editor-reviewed"][data-row-id="fixture-row-0001"][data-language-code="vi"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator('[data-action="toggle-editor-please-check"][data-row-id="fixture-row-0001"][data-language-code="vi"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-editor-filter-select]").selectOption("reviewed");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(0);
  await page.locator("[data-editor-filter-select]").selectOption("not-reviewed");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
  await page.locator("[data-editor-filter-select]").selectOption("target-empty");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(0);
});

test("virtualized grouped files scroll the view control away and map member updates to their card", async ({ page }) => {
  await mount(page, 180);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await expect(page.locator("[data-editor-virtual-list]")).toHaveCount(1);
  await page.locator(".translate-main-scroll").evaluate((element) => { element.scrollTop = 1800; });
  await expect.poll(async () => (await page.locator(".translation-srt-view-control").boundingBox())?.y).toBeLessThan(0);
  let members;
  await expect.poll(async () => {
    members = await page.locator(".translate-main-scroll").evaluate((container) => {
      const bounds = container.getBoundingClientRect();
      const overlap = (element) => { const box = element.getBoundingClientRect(); return Math.max(0, Math.min(box.bottom, bounds.bottom) - Math.max(box.top, bounds.top)); };
      const cards = [...container.querySelectorAll("[data-editor-row-card][data-srt-member-ids]")];
      const card = cards.sort((left, right) => overlap(right) - overlap(left))[0];
      return card && overlap(card) > 0 ? card.dataset.srtMemberIds.split(" ") : null;
    });
    return Boolean(members);
  }).toBe(true);
  await page.evaluate(async (id) => { await window.__gnosisDebug.patchFixtureRow(id, { fields: { vi: "updated second member" } }); }, members[1]);
  await expect(page.locator(`[data-editor-row-card][data-row-id="${members[0]}"]`)).toContainText("updated second member");
});

test("scrolling subtitle rows keeps the viewport covered below the view and pause controls", async ({ page }) => {
  await mount(page, 360);
  const pane = page.locator(".translate-main-scroll");
  const assertViewportCovered = async (scrollTop) => {
    await pane.dispatchEvent("wheel", { deltaY: scrollTop });
    await pane.evaluate((element, top) => { element.scrollTop = top; }, scrollTop);
    await page.evaluate(() => new Promise((resolve) => {
      let frames = 4;
      const next = () => --frames ? requestAnimationFrame(next) : resolve();
      requestAnimationFrame(next);
    }));
    await expect.poll(() => pane.evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll("[data-editor-row-card]")].map((row) => row.getBoundingClientRect());
      return Math.min(...rows.map((row) => row.top)) - viewport.top - element.clientTop;
    }), { message: `No blank band above virtual rows at scrollTop ${scrollTop}` }).toBeLessThanOrEqual(26);
    await expect.poll(() => pane.evaluate((element) => {
      const viewport = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll("[data-editor-row-card]")].map((row) => row.getBoundingClientRect());
      return viewport.top + element.clientTop + element.clientHeight - Math.max(...rows.map((row) => row.bottom));
    }), { message: `No blank band below virtual rows at scrollTop ${scrollTop}` }).toBeLessThanOrEqual(26);
  };
  for (const width of [1280, 1100]) {
    await page.setViewportSize({ width, height: 720 });
    for (const view of ["Standard", "Group fragments"]) {
      await pane.evaluate((element) => { element.scrollTop = 0; });
      await page.getByRole("button", { name: view, exact: true }).click();
      if (view === "Group fragments") await page.getByRole("checkbox", { name: "Split groups at pauses longer than" }).check();
      for (const top of [600, 1000, 1600, 2600, 5000, 2000, 700]) await assertViewportCovered(top);
    }
  }
});

test("an entirely deleted sentence saves blank cues and matches Target empty", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("");
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect(markerModal(page)).toContainText(repairedMessage);
  await page.getByRole("button", { name: "Ok", exact: true }).click();
  await expect(input(page)).toHaveValue("⟦1⟧⟦2⟧");
  await page.getByRole("button", { name: "Save sentence draft", exact: true }).click();
  expect(await storedTargets(page)).toEqual(["", "", ""]);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await expect(target(page)).toContainText("⟦1⟧⟦2⟧");
  await page.locator("[data-editor-filter-select]").selectOption("target-empty");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(1);
});

test("cross-fragment search and replacement retain cue identities", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await page.locator("[data-editor-search-input]").fill("target1 target2");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(1);
  await page.evaluate(() => window.__gnosisDebug.setEditorReplaceEnabled(true));
  await page.locator("[data-editor-replace-input]").fill("combined");
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.getByRole("button", { name: "Replace selected", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi))).toEqual(["combined", "", "target3"]);
});

test("typing during a delayed save stays in the textarea and the next save succeeds", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("first save⟦1⟧second⟦2⟧third");
  await page.evaluate(async () => {
    window.__srtDelay = 500;
    const flow = await import(new URL("/app/translate-flow.js", location.origin).href);
    window.__srtSaving = flow.persistEditorRowOnBlur(() => {}, "fixture-row-0001");
  });
  await expect.poll(() => page.evaluate(() => window.__srtCalls.filter((call) => call.command === "update_gtms_editor_row_fields_batch").length)).toBe(1);
  await input(page).fill("new typing⟦1⟧second⟦2⟧third");
  await page.evaluate(() => window.__srtSaving);
  await expect(input(page)).toHaveValue("new typing⟦1⟧second⟦2⟧third");
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__srtStored[0].fields.vi)).toBe("new typing");
});

test("deleting a group deletes all original cues", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await page.locator('[data-action="soft-delete-editor-row:fixture-row-0001"]').click();
  await expect.poll(() => page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.lifecycleState))).toEqual(["deleted", "deleted", "deleted"]);
});

test("group AI rejects duplicate cue assignments without writing", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await page.evaluate(() => {
    window.__srtAiResults = ["fixture-row-0001", "fixture-row-0001", "fixture-row-0003"].map((rowId) => ({ rowId, translatedText: "bad assignment" }));
  });
  await page.evaluate(() => window.__gnosisDebug.runEditorAiTranslate());
  await expect.poll(() => page.evaluate(() => window.__srtCalls.filter((call) => call.command === "run_ai_translation_batch").length)).toBe(1);
  expect(await page.evaluate(() => window.__srtCalls.filter((call) => call.command.startsWith("update_gtms")))).toEqual([]);
  expect(await page.evaluate(() => window.__srtStored[0].fields.vi)).toBe("target1");
});

test("group grammar review presents every fragment and applies an intentionally blank cue", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await page.evaluate(() => {
    window.__srtAiResults = ["fixture-row-0001", "fixture-row-0002", "fixture-row-0003"].map((rowId, index) => ({ rowId,
      suggestedText: index ? "" : "Corrected complete sentence", suggestedFootnotes: [], suggestedImageCaption: "", reviewed: false }));
  });
  await page.locator('[data-action="review-editor-text-now:grammar"]').click();
  const apply = page.locator('[data-action="apply-editor-ai-review"]');
  await expect(apply).toBeVisible();
  await expect(page.locator("[data-srt-review-suggestion]")).toContainText("Corrected complete sentence");
  await expect(page.locator("[data-srt-review-suggestion] .translation-srt-marker")).toHaveText(["⟦1⟧", "⟦2⟧"]);
  await apply.click();
  await expect.poll(() => page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi))).toEqual(["Corrected complete sentence", "", ""]);
});

for (const blank of [true, false]) test(`group translation preserves cue IDs and blank results (${blank ? "empty target" : "assistant Apply"})`, async ({ page }) => {
  await mount(page);
  if (blank) await page.evaluate(async () => {
    const { state } = await import(new URL("/app/state.js", location.origin).href);
    state.editorChapter.rows = state.editorChapter.rows.map((row, index) => index < 3 ? { ...row,
      fields: { ...row.fields, vi: "" }, persistedFields: { ...row.persistedFields, vi: "" }, baseFields: { ...row.baseFields, vi: "" },
    } : row);
    window.__srtStored.slice(0, 3).forEach((row) => { row.fields.vi = ""; });
    await window.__gnosisDebug.patchFixtureRow("fixture-row-0001", {});
  });
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await page.evaluate(() => {
    window.__srtAiResults = [1, 2, 3].map((number) => ({ rowId: `fixture-row-000${number}`, translatedText: number === 1 ? "Natural sentence." : "" }));
  });
  await page.evaluate(() => window.__gnosisDebug.runEditorAiTranslate());
  if (!blank) await page.locator('[data-action^="apply-editor-assistant-draft:"]').click();
  await expect.poll(() => page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi))).toEqual(["Natural sentence.", "", ""]);
  const request = await page.evaluate(() => window.__srtCalls.find((call) => call.command === "run_ai_translation_batch").args.request);
  expect(request.sentenceGroup).toBe(true);
  expect(request.sentenceSourceText).toBe("fragment fragment sentence.");
  expect(request.rows.map((row) => row.rowId)).toEqual(["fixture-row-0001", "fixture-row-0002", "fixture-row-0003"]);
});

for (const stale of [false, true]) test(`sentence drafts cannot write marker text in Standard view (${stale ? "changed cues" : "retry in grouped view"})`, async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await page.evaluate(() => { window.__srtAiResults = [1, 2, 3].map((number) => ({
    rowId: `fixture-row-000${number}`, translatedText: number === 2 ? "" : `draft${number}`,
  })); });
  await page.evaluate(() => window.__gnosisDebug.runEditorAiTranslate());
  const apply = page.locator('[data-action^="apply-editor-assistant-draft:"]');
  await expect(apply).toBeVisible();
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await apply.click();
  await expect(page.getByText("Switch to Group fragments to apply this sentence draft.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__srtCalls.filter((call) => call.command.startsWith("update_gtms")))).toEqual([]);
  expect(await page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi))).toEqual(["target1", "target2", "target3"]);
  if (stale) await page.evaluate(() => window.__gnosisDebug.patchFixtureRow("fixture-row-0002", { fields: { vi: "newer translation" } }));
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await apply.click();
  if (stale) {
    await expect(page.getByText("The sentence changed since this draft was created. Generate a new draft before applying.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__srtCalls.filter((call) => call.command.startsWith("update_gtms")))).toEqual([]);
  } else {
    await expect.poll(() => page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.vi))).toEqual(["draft1", "", "draft3"]);
    const writes = await page.evaluate(() => window.__srtCalls.filter((call) => call.command.startsWith("update_gtms")));
    expect(writes.every((call) => call.command === "update_gtms_editor_row_fields_batch")).toBe(true);
    expect(JSON.stringify(writes)).not.toContain("⟦");
  }
});

for (const open of [false, true]) test(`clean group sessions refresh canonical text (${open ? "textarea open" : "textarea closed"})`, async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await expect(input(page)).toBeVisible();
  if (!open) {
    await page.getByRole("textbox", { name: "Search visible rows" }).click();
    await expect(input(page)).toHaveCount(0);
  }
  await page.evaluate(async () => {
    await window.__gnosisDebug.patchFixtureRow("fixture-row-0002", { fields: { vi: "new remote text" } });
    const { state } = await import(new URL("/app/state.js", location.origin).href);
    const row = state.editorChapter.rows[1];
    row.baseFields = { ...row.baseFields, vi: "new remote text" };
    window.__srtStored[1].fields.vi = "new remote text";
    // The debug fixture accepts canonical IDs; refresh the containing group
    // card as the production row-scoped renderer does for a member update.
    await window.__gnosisDebug.patchFixtureRow("fixture-row-0001", {});
  });
  if (open) await expect(input(page)).toHaveValue("target1⟦1⟧new remote text⟦2⟧target3");
  else {
    await expect(target(page)).toContainText("target1⟦1⟧new remote text⟦2⟧target3");
    await target(page).click();
  }
  await input(page).fill("edited⟦1⟧new remote text⟦2⟧target3");
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__srtStored[0].fields.vi)).toBe("edited");
  const writes = await page.evaluate(() => window.__srtCalls.filter((call) => call.command === "update_gtms_editor_row_fields_batch"));
  expect(writes.at(-1).args.input.rows.find((row) => row.rowId === "fixture-row-0002").baseFields.vi).toBe("new remote text");
});

test("grammar review accepts source-language sentence groups", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await page.locator('[data-editor-display-field][data-row-id="fixture-row-0001"][data-language-code="es"]').click();
  await page.evaluate(() => { window.__srtAiResults = [1, 2, 3].map((number) => ({
    rowId: `fixture-row-000${number}`, suggestedText: number === 3 ? "sentence." : "fragment", reviewed: true,
    suggestedFootnotes: [], suggestedImageCaption: "",
  })); });
  await page.locator('[data-action="review-editor-text-now:grammar"]').click();
  await expect.poll(() => page.evaluate(() => window.__srtCalls.filter((call) => call.command === "run_ai_review_batch").length)).toBe(1);
  const request = await page.evaluate(() => window.__srtCalls.find((call) => call.command === "run_ai_review_batch").args.request);
  expect(request.reviewMode).toBe("grammar");
  expect(request.targetLanguageCode).toBe("es");
  expect(request.sentenceTargetText).toBe("fragment fragment sentence.");
  expect(request.rows.map((row) => row.rowId)).toEqual(["fixture-row-0001", "fixture-row-0002", "fixture-row-0003"]);
  expect(await page.evaluate(() => window.__srtCalls.filter((call) => call.command === "prepare_editor_ai_translated_glossary"))).toEqual([]);
  await page.locator('[data-action="review-editor-text-now:meaning"]').click();
  await expect(page.getByText("Select a target language to run this action.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__srtCalls.filter((call) => call.command === "run_ai_review_batch").length)).toBe(1);
});

test("saving source punctuation preserves the open textarea's markers until editing finishes", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await page.locator('[data-editor-display-field][data-row-id="fixture-row-0001"][data-language-code="es"]').click();
  const source = page.locator('textarea[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="es"]:not([data-content-kind])');
  await source.fill("First sentence.⟦1⟧Second sentence⟦2⟧continues.");
  await page.evaluate(() => window.__gnosisDebug.flushDirtyRows());
  await expect.poll(() => page.evaluate(() => window.__srtStored[0].fields.es)).toBe("First sentence.");
  await expect(source).toHaveValue("First sentence.⟦1⟧Second sentence⟦2⟧continues.");
  await source.fill("Updated first sentence.⟦1⟧Second sentence⟦2⟧continues.");
  await page.evaluate(() => window.__gnosisDebug.flushDirtyRows());
  await expect.poll(() => page.evaluate(() => window.__srtStored[0].fields.es)).toBe("Updated first sentence.");
  await page.getByRole("textbox", { name: "Search visible rows" }).click();
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(3);
  expect(await page.evaluate(() => window.__srtStored.slice(0, 3).map((row) => row.fields.es))).toEqual(["Updated first sentence.", "Second sentence", "continues."]);
});

test("typing while AI runs makes its response stale without overwriting the draft", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await page.evaluate(() => {
    window.__srtAiDelay = 500;
    window.__srtAiResults = [1, 2, 3].map((number) => ({ rowId: `fixture-row-000${number}`, translatedText: "AI response" }));
    window.__srtAiRunning = window.__gnosisDebug.runEditorAiTranslate();
  });
  await expect.poll(() => page.evaluate(() => window.__srtCalls.filter((call) => call.command === "run_ai_translation_batch").length)).toBe(1);
  await input(page).fill("Human edit⟦1⟧second⟦2⟧third");
  await page.evaluate(() => window.__srtAiRunning);
  await expect(input(page)).toHaveValue("Human edit⟦1⟧second⟦2⟧third");
  expect(await page.evaluate(() => window.__srtStored[0].fields.vi)).toBe("target1");
});

test("a new footnote belongs to the fragment containing the cursor", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).evaluate((element) => { element.setSelectionRange(17, 17); });
  await page.locator('[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]').click();
  await expect(page.locator('textarea[data-editor-row-field][data-content-kind="footnote"][data-row-id="fixture-row-0002"]')).toBeVisible();
  expect(await page.evaluate(async () => {
    const { state } = await import(new URL("/app/state.js", location.origin).href);
    return state.editorChapter.rows[0].fields.vi;
  })).toBe("target1");
});

test("a grouped review saves footnote-only corrections in the same guarded batch", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const { state } = await import(new URL("/app/state.js", location.origin).href);
    const row = state.editorChapter.rows[1];
    row.fields.vi = "target2[1]";
    row.persistedFields.vi = row.fields.vi;
    row.footnotes.vi = "[1] old note";
    row.persistedFootnotes.vi = row.footnotes.vi;
    window.__srtStored[1].fields.vi = row.fields.vi;
    window.__srtStored[1].footnotes.vi = row.footnotes.vi;
    await window.__gnosisDebug.patchFixtureRow(row.rowId, {});
    window.__srtAiResults = state.editorChapter.rows.slice(0, 3).map((member, index) => ({ rowId: member.rowId,
      suggestedText: member.fields.vi, suggestedFootnotes: index === 1 ? [{ marker: 1, text: "fixed note" }] : [],
      suggestedImageCaption: "", reviewed: index !== 1 }));
  });
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await page.locator('[data-action="review-editor-text-now:grammar"]').click();
  await expect(page.locator('[data-action="apply-editor-ai-review"]')).toBeVisible();
  await page.locator('[data-action="apply-editor-ai-review"]').click();
  await expect.poll(() => page.evaluate(() => window.__srtStored[1].footnotes.vi)).toContain("fixed note");
  const calls = await page.evaluate(() => window.__srtCalls.filter((call) => call.command.startsWith("update_gtms")));
  expect(calls.map((call) => call.command)).toEqual(["update_gtms_editor_row_fields_batch"]);
  expect(calls[0].args.input.rows[1].baseFootnotes.vi).toBe("old note");
});

test("a disjoint remote source edit is retained and adopted after the grouped target save", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("Local target⟦1⟧second⟦2⟧third");
  await page.evaluate(() => { window.__srtRemoteSource = true; });
  await page.getByRole("button", { name: "Standard", exact: true }).click();
  expect(await page.evaluate(async () => {
    const { state } = await import(new URL("/app/state.js", location.origin).href);
    return state.editorChapter.rows[1].fields.es;
  })).toBe("Remote source.");
  expect(await page.evaluate(() => window.__srtStored[0].fields.vi)).toBe("Local target");
});

for (const [raw, corrected] of [
  ["first⟦1second2⟧third", "first⟦1⟧second⟦2⟧third"],
  ["⟦word⟧ first⟦1⟧second⟦2⟧third ⟦", "word first⟦1⟧second⟦2⟧third "],
]) test(`separator repair proposes corrections without saving: ${raw}`, async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill(raw);
  await page.evaluate(() => Promise.all([window.__gnosisDebug.flushDirtyRows(), window.__gnosisDebug.flushDirtyRows()]));
  await expect(markerModal(page)).toHaveCount(1);
  await expect(markerModal(page).locator(".modal__supporting")).toHaveText(repairedMessage);
  await expect(markerModal(page).getByRole("button")).toHaveCount(1);
  await expect(markerModal(page).getByRole("button", { name: "Ok", exact: true })).toBeFocused();
  expect(await storedTargets(page)).toEqual(["target1", "target2", "target3"]);
  await page.keyboard.press("Enter");
  await expect(markerModal(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue(corrected);
  await input(page).press("Tab");
  await page.evaluate(() => window.__gnosisDebug.flushDirtyRows());
  expect(await storedTargets(page)).toEqual(["target1", "target2", "target3"]);
  await input(page).fill("checked⟦1⟧second⟦2⟧third");
  await page.getByRole("button", { name: "Save sentence draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save sentence draft", exact: true })).toHaveCount(0);
  expect(await storedTargets(page)).toEqual(["checked", "second", "third"]);
});

for (const raw of ["a⟦99⟧b", "a⟦2⟧b⟦1⟧c", "a⟦1⟧b⟦1⟧c"]) test(`invalid separators need manual correction: ${raw}`, async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill(raw);
  await page.evaluate(() => window.__gnosisDebug.flushDirtyRows());
  await expect(markerModal(page).locator(".modal__supporting")).toHaveText(invalidMessage);
  expect(await storedTargets(page)).toEqual(["target1", "target2", "target3"]);
  await page.keyboard.press("Escape");
  await expect(markerModal(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue(raw.includes("⟦1⟧") ? raw : `${raw}⟦1⟧`);
  await input(page).fill("checked⟦1⟧second⟦2⟧third");
  await page.getByRole("button", { name: "Save sentence draft", exact: true }).click();
  expect(await storedTargets(page)).toEqual(["checked", "second", "third"]);
});

test("save defers separator repair during IME composition", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await input(page).fill("sentence⟦1unfinished");
  await input(page).evaluate((element) => { element.dataset.srtComposing = "true"; });
  await page.evaluate(() => window.__gnosisDebug.flushDirtyRows());
  await expect(markerModal(page)).toHaveCount(0);
  await expect(input(page)).toHaveValue("sentence⟦1unfinished");
  expect(await storedTargets(page)).toEqual(["target1", "target2", "target3"]);
  await input(page).evaluate((element) => { delete element.dataset.srtComposing; });
  await page.evaluate(() => window.__gnosisDebug.flushDirtyRows());
  await expect(markerModal(page)).toContainText(repairedMessage);
});

async function seedGroupHistory(page) {
  await page.evaluate(() => {
    const entry = (plainText, commitSha) => ({ plainText, commitSha, authorName: commitSha,
      committedAt: "2026-10-23T05:00:00Z", operationType: "editor-update" });
    window.__srtHistory = Object.fromEntries([1, 2, 3].map((number) => [
      `fixture-row-000${number}:vi`, [
        ...(number === 2 ? [entry(`target${number}`, "reviewer")] : []),
        entry(`target${number}`, `editor-${number}`), entry(`OLD_${String.fromCharCode(64 + number)}`, "import"),
      ],
    ]));
  });
}

test("Review combines each fragment's last update; only History offers fragment selection", async ({ page }) => {
  await mount(page);
  await seedGroupHistory(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  const combined = page.locator("[data-srt-review-combined]");
  await expect(combined.locator(".history-diff__delete")).toHaveText(["OLD_A", "OLD_B", "OLD_C"]);
  await expect(combined.locator(".history-diff__insert")).toHaveText(["target1", "target2", "target3"]);
  await expect(page.getByRole("group", { name: "Subtitle fragment history" })).toHaveCount(0);
  await expect(page.locator('[data-srt-review-fragment="fixture-row-0002"]')).toContainText("editor-2");
  await expect(page.locator('[data-srt-review-fragment="fixture-row-0002"]')).not.toContainText("reviewer");
  await page.locator('[data-action="switch-editor-sidebar-tab:history"]').click();
  const selector = page.getByRole("group", { name: "Subtitle fragment history" });
  await expect(selector.getByRole("button")).toHaveCount(3);
  await selector.getByRole("button", { name: "Fragment 2", exact: true }).click();
  await expect(selector.getByRole("button", { name: "Fragment 2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-action="switch-editor-sidebar-tab:review"]').click();
  await expect(selector).toHaveCount(0);
  await expect(combined.locator(".history-diff__delete")).toHaveText(["OLD_A", "OLD_B", "OLD_C"]);
  await page.screenshot({ path: test.info().outputPath("combined-review.png") });
});

for (const mode of ["meaning", "grammar"]) test(`AI ${mode} review uses the complete group after selecting an inner fragment`, async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await page.locator('[data-action="switch-editor-sidebar-tab:history"]').click();
  await page.getByRole("button", { name: "Fragment 2", exact: true }).click();
  await page.locator('[data-action="switch-editor-sidebar-tab:review"]').click();
  await page.evaluate(() => {
    window.__srtAiResults = window.__srtStored.slice(0, 3).map((row) => ({ rowId: row.rowId,
      suggestedText: row.fields.vi, suggestedFootnotes: [], suggestedImageCaption: "", reviewed: true }));
  });
  await page.locator(`[data-action="review-editor-text-now:${mode}"]`).click();
  await expect.poll(() => page.evaluate(() => window.__srtCalls.filter((call) => call.command === "run_ai_review_batch").length)).toBe(1);
  const request = await page.evaluate(() => window.__srtCalls.find((call) => call.command === "run_ai_review_batch").args.request);
  expect(request.sentenceGroup).toBe(true);
  expect(request.sentenceSourceText).toBe("fragment fragment sentence.");
  expect(request.sentenceTargetText).toBe("target1 target2 target3");
  expect(request.rows.map((row) => row.rowId)).toEqual(["fixture-row-0001", "fixture-row-0002", "fixture-row-0003"]);
  await expect(page.getByRole("group", { name: "Subtitle fragment history" })).toHaveCount(0);
  await expect(page.locator(".history-group__entries").last()).toContainText(mode === "meaning" ? "Your translation looks good!" : "Spelling and grammar look good!");
});

test("a non-selected fragment's history error is visible in Review and leaves History usable", async ({ page }) => {
  await mount(page);
  await seedGroupHistory(page);
  await page.evaluate(() => { window.__srtHistoryFail = "fixture-row-0002"; });
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await expect(page.locator(".history-group__entries").first()).toContainText("Simulated fragment history failure");
  await expect(page.locator("[data-srt-review-combined]")).toContainText("target2");
  await page.locator('[data-action="switch-editor-sidebar-tab:history"]').click();
  await expect(page.getByRole("group", { name: "Subtitle fragment history" })).toBeVisible();
  await expect(page.locator(".history-stack")).not.toContainText("Simulated fragment history failure");
});

test("regrouping and late history responses cannot show the previous group's diff", async ({ page }) => {
  await mount(page, 6, 800);
  await seedGroupHistory(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await expect(page.locator("[data-srt-review-combined] .history-diff__delete")).toHaveCount(3);
  await page.evaluate(async () => {
    window.__srtHistoryDelay = 500;
    const { loadActiveEditorFieldHistory } = await import(new URL("/app/translate-flow.js", location.origin).href);
    loadActiveEditorFieldHistory(() => {});
  });
  await page.getByRole("checkbox", { name: "Split groups at pauses longer than" }).check();
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(6);
  await page.waitForTimeout(650);
  await expect(page.locator("[data-srt-review-combined]")).toHaveCount(0);
  const history = await page.evaluate(async () => {
    const { state } = await import(new URL("/app/state.js", location.origin).href);
    return state.editorChapter.history;
  });
  expect(history.group ?? null).toBeNull();
  expect(history.entries[0].plainText).toBe("target1");
});

test("saving only a later fragment refreshes the group's combined Last update", async ({ page }) => {
  await mount(page);
  await seedGroupHistory(page);
  await page.getByRole("button", { name: "Group fragments", exact: true }).click();
  await target(page).click();
  await expect(page.locator("[data-srt-review-combined] .history-diff__delete")).toHaveCount(3);
  await input(page).fill("target1⟦1⟧REVISED⟦2⟧target3");
  await page.evaluate(() => {
    window.__srtHistory["fixture-row-0002:vi"].unshift({
      commitSha: "second-saved", plainText: "REVISED", authorName: "latest editor",
      committedAt: "2026-10-23T06:00:00Z", operationType: "editor-update",
    });
    window.__srtCalls = [];
  });
  await page.evaluate(() => window.__gnosisDebug.flushDirtyRows());
  await expect(page.locator('[data-srt-review-fragment="fixture-row-0002"]')).toContainText("latest editor");
  await expect(page.locator("[data-srt-review-combined]")).toContainText("REVISED");
  expect(await page.evaluate(() => window.__srtCalls.filter((call) => call.command === "load_gtms_editor_field_history").map((call) => call.args.input.rowId).sort())).toEqual([
    "fixture-row-0001", "fixture-row-0002", "fixture-row-0003",
  ]);
});
