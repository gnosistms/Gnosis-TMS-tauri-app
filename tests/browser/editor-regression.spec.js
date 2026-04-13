import { expect, test } from "@playwright/test";

async function installMockTauri(page) {
  await page.addInitScript(() => {
    const clone = (value) => globalThis.structuredClone(value);
    const historyKey = (chapterId, rowId, languageCode) => `${chapterId}::${rowId}::${languageCode}`;
    let commitCounter = 0;
    const fixtureByChapterId = new Map();
    const rowFieldsByChapterId = new Map();
    const fieldStatesByChapterId = new Map();
    const rowLatestCommitByChapterId = new Map();
    const historyEntriesByKey = new Map();
    const batchReplaceSnapshotsByCommitSha = new Map();
    const invocationLog = [];

    function nextCommitSha() {
      commitCounter += 1;
      return `mock-commit-${String(commitCounter).padStart(4, "0")}`;
    }

    function nextCommittedAt() {
      return new Date(Date.UTC(2026, 3, 13, 0, 0, commitCounter)).toISOString();
    }

    function ensureHistoryBucket(chapterId, rowId, languageCode) {
      const key = historyKey(chapterId, rowId, languageCode);
      if (!historyEntriesByKey.has(key)) {
        historyEntriesByKey.set(key, []);
      }
      return historyEntriesByKey.get(key);
    }

    function pushHistoryEntriesWithCommit(chapterId, rowId, fields, fieldStates, commitInfo = {}) {
      const commitSha = commitInfo?.commitSha ?? nextCommitSha();
      const committedAt = commitInfo?.committedAt ?? nextCommittedAt();
      for (const [languageCode, plainText] of Object.entries(fields ?? {})) {
        const entries = ensureHistoryBucket(chapterId, rowId, languageCode);
        const state = fieldStates?.[languageCode] ?? {};
        entries.unshift({
          commitSha,
          authorName: "Mock Backend",
          committedAt,
          message: commitInfo?.message ?? "Update row",
          operationType: commitInfo?.operationType ?? "editor-update",
          statusNote: null,
          plainText: typeof plainText === "string" ? plainText : String(plainText ?? ""),
          reviewed: state.reviewed === true,
          pleaseCheck: state.pleaseCheck === true,
        });
      }
      rowLatestCommitByChapterId.get(chapterId)?.set(rowId, commitSha);
      return commitSha;
    }

    function pushHistoryEntries(chapterId, rowId, fields, fieldStates, operationType, message) {
      return pushHistoryEntriesWithCommit(chapterId, rowId, fields, fieldStates, {
        operationType,
        message,
      });
    }

    function mountEditorFixture(payload) {
      const chapterId = payload?.chapterId;
      const rows = Array.isArray(payload?.rows) ? clone(payload.rows) : [];
      if (!chapterId) {
        return;
      }

      fixtureByChapterId.set(chapterId, clone(payload));
      rowFieldsByChapterId.set(
        chapterId,
        new Map(rows.map((row) => [row.rowId, clone(row.fields ?? {})])),
      );
      fieldStatesByChapterId.set(
        chapterId,
        new Map(rows.map((row) => [row.rowId, clone(row.fieldStates ?? {})])),
      );
      rowLatestCommitByChapterId.set(chapterId, new Map());

      for (const row of rows) {
        for (const languageCode of Object.keys(row.fields ?? {})) {
          historyEntriesByKey.set(historyKey(chapterId, row.rowId, languageCode), []);
        }
        pushHistoryEntries(chapterId, row.rowId, row.fields ?? {}, row.fieldStates ?? {}, "import", "Import row");
      }
    }

    function findRowFields(chapterId, rowId) {
      return rowFieldsByChapterId.get(chapterId)?.get(rowId) ?? null;
    }

    function findFieldStates(chapterId, rowId) {
      return fieldStatesByChapterId.get(chapterId)?.get(rowId) ?? null;
    }

    async function invoke(command, payload = {}) {
      invocationLog.push({
        command,
        payload: clone(payload),
      });

      if (
        command === "load_broker_auth_session"
        || command === "save_broker_auth_session"
        || command === "clear_broker_auth_session"
      ) {
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

      if (command === "get_github_app_test_config") {
        return {
          brokerBaseUrl: "https://example.test",
        };
      }

      if (command === "load_gtms_editor_field_history") {
        const input = payload?.input ?? {};
        return {
          entries: clone(historyEntriesByKey.get(historyKey(input.chapterId, input.rowId, input.languageCode)) ?? []),
        };
      }

      if (command === "update_gtms_editor_row_fields") {
        const input = payload?.input ?? {};
        const nextFields = clone(input.fields ?? {});
        const storedFields = findRowFields(input.chapterId, input.rowId);
        const storedFieldStates = findFieldStates(input.chapterId, input.rowId);
        if (!storedFields || !storedFieldStates) {
          throw new Error(`Unknown editor row: ${input.rowId}`);
        }

        rowFieldsByChapterId.get(input.chapterId).set(input.rowId, nextFields);
        pushHistoryEntries(input.chapterId, input.rowId, nextFields, storedFieldStates, "editor-update", "Update row");
        return {
          sourceWordCounts: {},
        };
      }

      if (command === "update_gtms_editor_row_fields_batch") {
        const input = payload?.input ?? {};
        const chapterRows = rowFieldsByChapterId.get(input.chapterId);
        const chapterFieldStates = fieldStatesByChapterId.get(input.chapterId);
        const rows = Array.isArray(input.rows) ? clone(input.rows) : [];
        if (!chapterRows || !chapterFieldStates) {
          throw new Error(`Unknown editor chapter: ${input.chapterId}`);
        }

        const commitSha = nextCommitSha();
        const committedAt = nextCommittedAt();
        const snapshotRows = [];

        for (const rowUpdate of rows) {
          const storedFields = chapterRows.get(rowUpdate.rowId);
          const storedFieldStates = chapterFieldStates.get(rowUpdate.rowId);
          if (!storedFields || !storedFieldStates) {
            throw new Error(`Unknown editor row in batch: ${rowUpdate.rowId}`);
          }

          snapshotRows.push({
            rowId: rowUpdate.rowId,
            fields: clone(storedFields),
            fieldStates: clone(storedFieldStates),
          });

          const nextFields = clone(rowUpdate.fields ?? {});
          chapterRows.set(rowUpdate.rowId, nextFields);
          pushHistoryEntriesWithCommit(input.chapterId, rowUpdate.rowId, nextFields, storedFieldStates, {
            commitSha,
            committedAt,
            operationType: input.operation ?? "editor-update",
            message: input.commitMessage ?? "Update rows",
          });
        }

        if (input.operation === "editor-replace") {
          batchReplaceSnapshotsByCommitSha.set(commitSha, {
            chapterId: input.chapterId,
            rows: snapshotRows,
          });
        }

        return {
          sourceWordCounts: {},
        };
      }

      if (command === "update_gtms_editor_row_field_flag") {
        const input = payload?.input ?? {};
        const storedFields = findRowFields(input.chapterId, input.rowId);
        const storedFieldStates = findFieldStates(input.chapterId, input.rowId);
        const previousState = storedFieldStates?.[input.languageCode] ?? null;
        if (!storedFields || !storedFieldStates || !previousState) {
          throw new Error(`Unknown editor row field flag target: ${input.rowId}/${input.languageCode}`);
        }

        const nextState = {
          ...previousState,
          ...(input.flag === "reviewed"
            ? { reviewed: input.enabled === true }
            : { pleaseCheck: input.enabled === true }),
        };
        storedFieldStates[input.languageCode] = nextState;
        pushHistoryEntries(
          input.chapterId,
          input.rowId,
          storedFields,
          storedFieldStates,
          "editor-update",
          "Update row marker",
        );
        return {
          reviewed: nextState.reviewed === true,
          pleaseCheck: nextState.pleaseCheck === true,
        };
      }

      if (command === "reverse_gtms_editor_batch_replace_commit") {
        const input = payload?.input ?? {};
        const snapshot = batchReplaceSnapshotsByCommitSha.get(input.commitSha);
        const chapterRows = rowFieldsByChapterId.get(input.chapterId);
        const chapterFieldStates = fieldStatesByChapterId.get(input.chapterId);
        const latestRowCommits = rowLatestCommitByChapterId.get(input.chapterId);
        if (!snapshot || snapshot.chapterId !== input.chapterId || !chapterRows || !chapterFieldStates || !latestRowCommits) {
          throw new Error("The selected batch replace commit does not exist in the mock backend.");
        }

        const commitSha = nextCommitSha();
        const committedAt = nextCommittedAt();
        const updatedRows = [];
        const skippedRowIds = [];
        const undoSnapshotRows = [];

        for (const rowSnapshot of snapshot.rows) {
          const latestCommitSha = latestRowCommits.get(rowSnapshot.rowId) ?? null;
          if (latestCommitSha !== input.commitSha) {
            skippedRowIds.push(rowSnapshot.rowId);
            continue;
          }

          const currentFields = chapterRows.get(rowSnapshot.rowId);
          const currentFieldStates = chapterFieldStates.get(rowSnapshot.rowId);
          if (!currentFields || !currentFieldStates) {
            skippedRowIds.push(rowSnapshot.rowId);
            continue;
          }

          undoSnapshotRows.push({
            rowId: rowSnapshot.rowId,
            fields: clone(currentFields),
            fieldStates: clone(currentFieldStates),
          });

          const restoredFields = clone(rowSnapshot.fields);
          const restoredFieldStates = clone(rowSnapshot.fieldStates);
          chapterRows.set(rowSnapshot.rowId, restoredFields);
          chapterFieldStates.set(rowSnapshot.rowId, restoredFieldStates);
          updatedRows.push({
            rowId: rowSnapshot.rowId,
            fields: restoredFields,
          });
          pushHistoryEntriesWithCommit(input.chapterId, rowSnapshot.rowId, restoredFields, restoredFieldStates, {
            commitSha,
            committedAt,
            operationType: "editor-replace",
            message: "Undo batch replace",
          });
        }

        if (updatedRows.length > 0) {
          batchReplaceSnapshotsByCommitSha.set(commitSha, {
            chapterId: input.chapterId,
            rows: undoSnapshotRows,
          });
        }

        return {
          updatedRows,
          skippedRowIds,
          sourceWordCounts: {},
          commitSha: updatedRows.length > 0 ? commitSha : null,
        };
      }

      if (command === "restore_gtms_editor_field_from_history") {
        const input = payload?.input ?? {};
        const storedFields = findRowFields(input.chapterId, input.rowId);
        const storedFieldStates = findFieldStates(input.chapterId, input.rowId);
        const entries = historyEntriesByKey.get(historyKey(input.chapterId, input.rowId, input.languageCode)) ?? [];
        const entry = entries.find((candidate) => candidate.commitSha === input.commitSha) ?? null;
        if (!storedFields || !storedFieldStates || !entry) {
          throw new Error("Requested history entry not found.");
        }

        storedFields[input.languageCode] = entry.plainText;
        storedFieldStates[input.languageCode] = {
          reviewed: entry.reviewed === true,
          pleaseCheck: entry.pleaseCheck === true,
        };
        pushHistoryEntries(
          input.chapterId,
          input.rowId,
          storedFields,
          storedFieldStates,
          "restore",
          "Restore row from history",
        );
        return {
          plainText: entry.plainText,
          reviewed: entry.reviewed === true,
          pleaseCheck: entry.pleaseCheck === true,
          sourceWordCounts: {},
        };
      }

      if (command === "soft_delete_gtms_editor_row") {
        return {
          lifecycleState: "deleted",
          sourceWordCounts: {},
        };
      }

      if (command === "restore_gtms_editor_row") {
        return {
          lifecycleState: "active",
          sourceWordCounts: {},
        };
      }

      return null;
    }

    globalThis.__gnosisMockTauri = {
      mountEditorFixture,
      inspect() {
        return {
          invocations: clone(invocationLog),
          histories: Object.fromEntries(
            [...historyEntriesByKey.entries()].map(([key, entries]) => [key, clone(entries)]),
          ),
        };
      },
    };

    globalThis.__TAURI__ = {
      core: {
        invoke,
      },
      event: {
        listen: async () => () => {},
      },
      opener: {
        openUrl() {},
      },
    };
  });
}

async function mountEditorFixture(page, options = {}, setup = {}) {
  if (setup.mockTauri === true) {
    await installMockTauri(page);
  }

  await page.addInitScript(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {
      // Ignore local-storage access restrictions in the browser harness.
    }
  });

  await page.goto("/");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountEditorFixture === "function");
  await page.evaluate(async (fixtureOptions) => {
    await window.__gnosisDebug.waitForBootstrap();
    await window.__gnosisDebug.mountEditorFixture(fixtureOptions);
  }, options);
  await expect(page.locator("[data-editor-search-input]")).toBeVisible();
}

async function readMockTauriState(page) {
  return await page.evaluate(() => window.__gnosisMockTauri?.inspect?.() ?? null);
}

async function flushDirtyRows(page) {
  return await page.evaluate(async () => {
    return await window.__gnosisDebug.flushDirtyRows();
  });
}

async function softDeleteFixtureRow(page, rowId) {
  await page.evaluate(async (targetRowId) => {
    return window.__gnosisDebug.softDeleteFixtureRow(targetRowId);
  }, rowId);
}

async function restoreFixtureRow(page, rowId) {
  await page.evaluate(async (targetRowId) => {
    return window.__gnosisDebug.restoreFixtureRow(targetRowId);
  }, rowId);
}

test.describe("editor regressions", () => {
  test("search input keeps focus while typing", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 60 });

    const searchInput = page.locator("[data-editor-search-input]");
    await searchInput.click();

    for (const fragment of ["a", "l", "p", "h", "a"]) {
      await searchInput.type(fragment);
      await expect(searchInput).toBeFocused();
    }

    await expect(searchInput).toHaveValue("alpha");
  });

  test("filtered row typing preserves focus on the edited textarea", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 60,
      searchQuery: "alpha 0001",
    });

    const field = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    await expect(field).toBeVisible();
    await field.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });

    await page.keyboard.type("x");
    await expect(field).toBeFocused();
    const valueAfterFirstType = await field.inputValue();
    expect(valueAfterFirstType.length).toBeGreaterThan("alpha 0001 target text".length);

    await page.keyboard.type("y");
    await expect(field).toBeFocused();
    const valueAfterSecondType = await field.inputValue();
    expect(valueAfterSecondType.length).toBe(valueAfterFirstType.length + 1);
  });

  test("search filtering updates the result banner and empty state", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 });

    const searchInput = page.locator("[data-editor-search-input]");
    await searchInput.fill("0001");
    await expect(page.locator(".translation-results-banner__text")).toHaveText(
      "Search result: 1 matching row",
    );
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(1);

    await searchInput.fill("zzz-not-found");
    await expect(page.locator(".translation-results-banner")).toHaveCount(0);
    await expect(page.locator(".card--translation .card__body")).toContainText(
      "No rows match the current search.",
    );
  });

  test("a new deleted section starts closed even after restoring a previously opened one", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 12 });

    await softDeleteFixtureRow(page, "fixture-row-0003");
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(1);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0003"]')).toHaveCount(0);

    await page.locator(".translation-deleted-group .section-separator").click();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0003"]')).toHaveCount(1);

    await restoreFixtureRow(page, "fixture-row-0003");
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(0);

    await softDeleteFixtureRow(page, "fixture-row-0008");
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(1);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0008"]')).toHaveCount(0);
    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().expandedDeletedRowGroupIds);
    }).toEqual([]);
  });

  test("soft-deleting into an open deleted section keeps that section open", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 12 });

    await softDeleteFixtureRow(page, "fixture-row-0004");
    await page.locator(".translation-deleted-group .section-separator").click();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0004"]')).toHaveCount(1);

    await softDeleteFixtureRow(page, "fixture-row-0005");
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(1);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0004"]')).toHaveCount(1);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0005"]')).toHaveCount(1);
    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().expandedDeletedRowGroupIds);
    }).toEqual(["fixture-row-0004:fixture-row-0005"]);
  });

  test("typing in one row then flushing dirty rows persists the row through the backend", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const firstField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );

    await firstField.click();
    await firstField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");
    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().dirtyRowIds);
    }).toEqual(["fixture-row-0001"]);

    await flushDirtyRows(page);

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.plainText ?? null;
    }).toBe("alpha 0001 target text saved");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.invocations?.some((entry) => entry.command === "update_gtms_editor_row_fields") ?? false;
    }).toBe(true);
  });

  test("typing in one row then focusing another row persists without losing the target field", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const firstField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const secondField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0002"][data-language-code="vi"]',
    );

    await firstField.click();
    await firstField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");

    await expect(secondField).toBeVisible();
    await secondField.click();
    await expect(secondField).toBeFocused();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.plainText ?? null;
    }).toBe("alpha 0001 target text saved");

    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().dirtyRowIds);
    }).toEqual([]);
  });

  test("typing in one row then toggling a marker in another row persists the dirty row", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const firstField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const reviewedButton = page.locator(
      '[data-action="toggle-editor-reviewed"][data-row-id="fixture-row-0002"][data-language-code="vi"]',
    );

    await firstField.click();
    await firstField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");

    await expect(reviewedButton).toBeVisible();
    await reviewedButton.click();
    await expect(reviewedButton).toHaveAttribute("aria-pressed", "true");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.plainText ?? null;
    }).toBe("alpha 0001 target text saved");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0002::vi"]?.[0]?.reviewed ?? null;
    }).toBe(true);

    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().dirtyRowIds);
    }).toEqual([]);
  });

  test("replace selected and undo replace round-trip through history", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const searchInput = page.locator("[data-editor-search-input]");
    await searchInput.fill("0001");

    await page.evaluate(() => window.__gnosisDebug.setEditorReplaceEnabled(true));

    const replaceInput = page.locator("[data-editor-replace-input]");
    await expect(replaceInput).toBeVisible();
    await replaceInput.fill("0001x");

    await page.getByRole("button", { name: "Select all" }).click();
    const replaceSelectedButton = page.getByRole("button", { name: "Replace selected" });
    await expect(replaceSelectedButton).toBeEnabled();
    await replaceSelectedButton.click();

    const firstField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    await expect(firstField).toHaveValue("alpha 0001x target text");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.operationType ?? null;
    }).toBe("editor-replace");

    const undoReplaceButton = page.getByRole("button", { name: "Undo replace" }).first();
    await expect(undoReplaceButton).toBeVisible();
    await undoReplaceButton.click();

    await expect(page.getByText("Undo batch find and replace")).toBeVisible();
    await page.getByRole("button", { name: "Undo replace" }).last().click();

    await expect(firstField).toHaveValue("alpha 0001 target text");
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.plainText ?? null;
    }).toBe("alpha 0001 target text");
  });

  test("history restore updates the active field through the backend flow", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const firstField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );

    await firstField.click();
    await firstField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");
    await flushDirtyRows(page);

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.length ?? 0;
    }).toBeGreaterThan(1);

    await firstField.click();
    const historyGroupToggle = page.locator(".history-group__toggle").first();
    await expect(historyGroupToggle).toBeVisible();
    await historyGroupToggle.click();

    const restoreButton = page.getByRole("button", { name: "Restore" }).first();
    await restoreButton.click();

    await expect(firstField).toHaveValue("alpha 0001 target text");
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.operationType ?? null;
    }).toBe("restore");
  });
});
