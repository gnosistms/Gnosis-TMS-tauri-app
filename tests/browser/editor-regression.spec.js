import { expect, test } from "@playwright/test";

async function installMockTauri(page) {
  await page.addInitScript(() => {
    const clone = (value) => globalThis.structuredClone(value);
    const historyKey = (chapterId, rowId, languageCode) => `${chapterId}::${rowId}::${languageCode}`;
    let commitCounter = 0;
    const fixtureByChapterId = new Map();
    const rowFieldsByChapterId = new Map();
    const rowFootnotesByChapterId = new Map();
    const rowTextStylesByChapterId = new Map();
    const fieldStatesByChapterId = new Map();
    const rowCommentsByChapterId = new Map();
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

    function pushHistoryEntriesWithCommit(
      chapterId,
      rowId,
      fields,
      footnotes,
      fieldStates,
      commitInfo = {},
    ) {
      const commitSha = commitInfo?.commitSha ?? nextCommitSha();
      const committedAt = commitInfo?.committedAt ?? nextCommittedAt();
      const textStyle = findRowTextStyle(chapterId, rowId);
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
          aiModel: commitInfo?.aiModel ?? null,
          plainText: typeof plainText === "string" ? plainText : String(plainText ?? ""),
          footnote:
            typeof footnotes?.[languageCode] === "string"
              ? footnotes[languageCode]
              : String(footnotes?.[languageCode] ?? ""),
          textStyle,
          reviewed: state.reviewed === true,
          pleaseCheck: state.pleaseCheck === true,
        });
      }
      rowLatestCommitByChapterId.get(chapterId)?.set(rowId, commitSha);
      return commitSha;
    }

    function pushHistoryEntries(chapterId, rowId, fields, footnotes, fieldStates, operationType, message) {
      return pushHistoryEntriesWithCommit(chapterId, rowId, fields, footnotes, fieldStates, {
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
      rowFootnotesByChapterId.set(
        chapterId,
        new Map(rows.map((row) => [row.rowId, clone(row.footnotes ?? {})])),
      );
      rowTextStylesByChapterId.set(
        chapterId,
        new Map(rows.map((row) => [row.rowId, String(row.textStyle ?? "paragraph")])),
      );
      fieldStatesByChapterId.set(
        chapterId,
        new Map(rows.map((row) => [row.rowId, clone(row.fieldStates ?? {})])),
      );
      rowCommentsByChapterId.set(
        chapterId,
        new Map(rows.map((row) => [row.rowId, {
          commentsRevision: Number.isInteger(row.commentsRevision) ? row.commentsRevision : 0,
          comments: clone(row.editorComments ?? []),
        }])),
      );
      rowLatestCommitByChapterId.set(chapterId, new Map());

      for (const row of rows) {
        for (const languageCode of Object.keys(row.fields ?? {})) {
          historyEntriesByKey.set(historyKey(chapterId, row.rowId, languageCode), []);
        }
        pushHistoryEntries(
          chapterId,
          row.rowId,
          row.fields ?? {},
          row.footnotes ?? {},
          row.fieldStates ?? {},
          "import",
          "Import row",
        );
      }
    }

    function findRowFields(chapterId, rowId) {
      return rowFieldsByChapterId.get(chapterId)?.get(rowId) ?? null;
    }

    function findFieldStates(chapterId, rowId) {
      return fieldStatesByChapterId.get(chapterId)?.get(rowId) ?? null;
    }

    function findRowFootnotes(chapterId, rowId) {
      return rowFootnotesByChapterId.get(chapterId)?.get(rowId) ?? null;
    }

    function findRowTextStyle(chapterId, rowId) {
      return rowTextStylesByChapterId.get(chapterId)?.get(rowId) ?? "paragraph";
    }

    function findRowComments(chapterId, rowId) {
      return rowCommentsByChapterId.get(chapterId)?.get(rowId) ?? null;
    }

    function buildRowPayload(chapterId, rowId) {
      const fixture = fixtureByChapterId.get(chapterId);
      const fixtureRow = Array.isArray(fixture?.rows)
        ? fixture.rows.find((row) => row?.rowId === rowId) ?? null
        : null;
      const fields = findRowFields(chapterId, rowId);
      const footnotes = findRowFootnotes(chapterId, rowId);
      const fieldStates = findFieldStates(chapterId, rowId);
      const comments = findRowComments(chapterId, rowId);
      if (!fixtureRow || !fields || !footnotes || !fieldStates) {
        return null;
      }

      return {
        rowId,
        orderKey: typeof fixtureRow.orderKey === "string" ? fixtureRow.orderKey : "",
        lifecycleState: fixtureRow.lifecycleState === "deleted" ? "deleted" : "active",
        commentCount: Array.isArray(comments?.comments) ? comments.comments.length : 0,
        commentsRevision: Number.isInteger(comments?.commentsRevision) ? comments.commentsRevision : 0,
        textStyle: findRowTextStyle(chapterId, rowId),
        fields: clone(fields),
        footnotes: clone(footnotes),
        fieldStates: clone(fieldStates),
      };
    }

    async function invoke(command, payload = {}) {
      invocationLog.push({
        command,
        payload: clone(payload),
      });

      const overrideHandler = globalThis.__gnosisMockTauriHandlers?.[command];
      if (typeof overrideHandler === "function") {
        return await overrideHandler(clone(payload));
      }

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

      if (command === "load_gtms_editor_row_comments") {
        const input = payload?.input ?? {};
        const storedComments = findRowComments(input.chapterId, input.rowId);
        if (!storedComments) {
          throw new Error(`Unknown editor row comments target: ${input.rowId}`);
        }

        return {
          rowId: input.rowId,
          commentsRevision: storedComments.commentsRevision,
          commentCount: storedComments.comments.length,
          comments: clone(storedComments.comments),
        };
      }

      if (command === "save_gtms_editor_row_comment") {
        const input = payload?.input ?? {};
        const storedComments = findRowComments(input.chapterId, input.rowId);
        if (!storedComments) {
          throw new Error(`Unknown editor row comments target: ${input.rowId}`);
        }

        storedComments.commentsRevision += 1;
        storedComments.comments.unshift({
          commentId: `mock-comment-${String(storedComments.commentsRevision).padStart(4, "0")}`,
          authorLogin: "fixture-user",
          authorName: "Fixture User",
          body: String(input.body ?? "").trim(),
          createdAt: nextCommittedAt(),
        });

        return {
          rowId: input.rowId,
          commentsRevision: storedComments.commentsRevision,
          commentCount: storedComments.comments.length,
          comments: clone(storedComments.comments),
        };
      }

      if (command === "delete_gtms_editor_row_comment") {
        const input = payload?.input ?? {};
        const storedComments = findRowComments(input.chapterId, input.rowId);
        if (!storedComments) {
          throw new Error(`Unknown editor row comments target: ${input.rowId}`);
        }

        const commentIndex = storedComments.comments.findIndex((comment) => comment.commentId === input.commentId);
        if (commentIndex < 0) {
          throw new Error("Requested comment not found.");
        }
        if (String(storedComments.comments[commentIndex]?.authorLogin ?? "").toLowerCase() !== "fixture-user") {
          throw new Error("Only the comment author can delete this comment.");
        }

        storedComments.comments.splice(commentIndex, 1);
        storedComments.commentsRevision += 1;
        return {
          rowId: input.rowId,
          commentsRevision: storedComments.commentsRevision,
          commentCount: storedComments.comments.length,
          comments: clone(storedComments.comments),
        };
      }

      if (command === "update_gtms_editor_row_fields") {
        const input = payload?.input ?? {};
        const nextFields = clone(input.fields ?? {});
        const storedFields = findRowFields(input.chapterId, input.rowId);
        const storedFootnotes = findRowFootnotes(input.chapterId, input.rowId);
        const storedFieldStates = findFieldStates(input.chapterId, input.rowId);
        if (!storedFields || !storedFootnotes || !storedFieldStates) {
          throw new Error(`Unknown editor row: ${input.rowId}`);
        }
        const nextFootnotes = clone(input.footnotes ?? storedFootnotes);

        rowFieldsByChapterId.get(input.chapterId).set(input.rowId, nextFields);
        rowFootnotesByChapterId.get(input.chapterId).set(input.rowId, nextFootnotes);
        pushHistoryEntriesWithCommit(input.chapterId, input.rowId, nextFields, nextFootnotes, storedFieldStates, {
          operationType: input.operation ?? "editor-update",
          message: "Update row",
          aiModel: input.aiModel ?? null,
        });
        return {
          row: buildRowPayload(input.chapterId, input.rowId),
          sourceWordCounts: {},
        };
      }

      if (command === "update_gtms_editor_row_text_style") {
        const input = payload?.input ?? {};
        const chapterTextStyles = rowTextStylesByChapterId.get(input.chapterId);
        const storedFields = findRowFields(input.chapterId, input.rowId);
        const storedFootnotes = findRowFootnotes(input.chapterId, input.rowId);
        const storedFieldStates = findFieldStates(input.chapterId, input.rowId);
        if (!chapterTextStyles || !storedFields || !storedFootnotes || !storedFieldStates) {
          throw new Error(`Unknown editor row style target: ${input.rowId}`);
        }

        const nextTextStyle = String(input.textStyle ?? "paragraph");
        chapterTextStyles.set(input.rowId, nextTextStyle);
        pushHistoryEntries(
          input.chapterId,
          input.rowId,
          storedFields,
          storedFootnotes,
          storedFieldStates,
          "text-style",
          "Update row text style",
        );
        return {
          rowId: input.rowId,
          textStyle: nextTextStyle,
        };
      }

      if (command === "update_gtms_editor_row_fields_batch") {
        const input = payload?.input ?? {};
        const chapterRows = rowFieldsByChapterId.get(input.chapterId);
        const chapterFootnotes = rowFootnotesByChapterId.get(input.chapterId);
        const chapterFieldStates = fieldStatesByChapterId.get(input.chapterId);
        const rows = Array.isArray(input.rows) ? clone(input.rows) : [];
        if (!chapterRows || !chapterFootnotes || !chapterFieldStates) {
          throw new Error(`Unknown editor chapter: ${input.chapterId}`);
        }

        const commitSha = nextCommitSha();
        const committedAt = nextCommittedAt();
        const snapshotRows = [];

        for (const rowUpdate of rows) {
          const storedFields = chapterRows.get(rowUpdate.rowId);
          const storedFootnotes = chapterFootnotes.get(rowUpdate.rowId);
          const storedFieldStates = chapterFieldStates.get(rowUpdate.rowId);
          if (!storedFields || !storedFootnotes || !storedFieldStates) {
            throw new Error(`Unknown editor row in batch: ${rowUpdate.rowId}`);
          }

          snapshotRows.push({
            rowId: rowUpdate.rowId,
            fields: clone(storedFields),
            footnotes: clone(storedFootnotes),
            fieldStates: clone(storedFieldStates),
          });

          const nextFields = clone(rowUpdate.fields ?? {});
          const nextFootnotes = clone(rowUpdate.footnotes ?? storedFootnotes);
          chapterRows.set(rowUpdate.rowId, nextFields);
          chapterFootnotes.set(rowUpdate.rowId, nextFootnotes);
          pushHistoryEntriesWithCommit(input.chapterId, rowUpdate.rowId, nextFields, nextFootnotes, storedFieldStates, {
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
        const storedFootnotes = findRowFootnotes(input.chapterId, input.rowId);
        const storedFieldStates = findFieldStates(input.chapterId, input.rowId);
        const previousState = storedFieldStates?.[input.languageCode] ?? null;
        if (!storedFields || !storedFootnotes || !storedFieldStates || !previousState) {
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
          storedFootnotes,
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
        const chapterFootnotes = rowFootnotesByChapterId.get(input.chapterId);
        const chapterFieldStates = fieldStatesByChapterId.get(input.chapterId);
        const latestRowCommits = rowLatestCommitByChapterId.get(input.chapterId);
        if (
          !snapshot
          || snapshot.chapterId !== input.chapterId
          || !chapterRows
          || !chapterFootnotes
          || !chapterFieldStates
          || !latestRowCommits
        ) {
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
          const currentFootnotes = chapterFootnotes.get(rowSnapshot.rowId);
          const currentFieldStates = chapterFieldStates.get(rowSnapshot.rowId);
          if (!currentFields || !currentFootnotes || !currentFieldStates) {
            skippedRowIds.push(rowSnapshot.rowId);
            continue;
          }

          undoSnapshotRows.push({
            rowId: rowSnapshot.rowId,
            fields: clone(currentFields),
            footnotes: clone(currentFootnotes),
            fieldStates: clone(currentFieldStates),
          });

          const restoredFields = clone(rowSnapshot.fields);
          const restoredFootnotes = clone(rowSnapshot.footnotes ?? {});
          const restoredFieldStates = clone(rowSnapshot.fieldStates);
          chapterRows.set(rowSnapshot.rowId, restoredFields);
          chapterFootnotes.set(rowSnapshot.rowId, restoredFootnotes);
          chapterFieldStates.set(rowSnapshot.rowId, restoredFieldStates);
          updatedRows.push({
            rowId: rowSnapshot.rowId,
            fields: restoredFields,
            footnotes: restoredFootnotes,
          });
          pushHistoryEntriesWithCommit(input.chapterId, rowSnapshot.rowId, restoredFields, restoredFootnotes, restoredFieldStates, {
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
        const storedFootnotes = findRowFootnotes(input.chapterId, input.rowId);
        const storedFieldStates = findFieldStates(input.chapterId, input.rowId);
        const entries = historyEntriesByKey.get(historyKey(input.chapterId, input.rowId, input.languageCode)) ?? [];
        const entry = entries.find((candidate) => candidate.commitSha === input.commitSha) ?? null;
        if (!storedFields || !storedFootnotes || !storedFieldStates || !entry) {
          throw new Error("Requested history entry not found.");
        }

        storedFields[input.languageCode] = entry.plainText;
        storedFootnotes[input.languageCode] = String(entry.footnote ?? "");
        storedFieldStates[input.languageCode] = {
          reviewed: entry.reviewed === true,
          pleaseCheck: entry.pleaseCheck === true,
        };
        rowTextStylesByChapterId.get(input.chapterId)?.set(input.rowId, String(entry.textStyle ?? "paragraph"));
        pushHistoryEntries(
          input.chapterId,
          input.rowId,
          storedFields,
          storedFootnotes,
          storedFieldStates,
          "restore",
          "Restore row from history",
        );
        return {
          plainText: entry.plainText,
          footnote: String(entry.footnote ?? ""),
          textStyle: String(entry.textStyle ?? "paragraph"),
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
          textStyles: Object.fromEntries(
            [...rowTextStylesByChapterId.entries()].map(([chapterId, stylesByRowId]) => [
              chapterId,
              Object.fromEntries(stylesByRowId.entries()),
            ]),
          ),
          footnotes: Object.fromEntries(
            [...rowFootnotesByChapterId.entries()].map(([chapterId, footnotesByRowId]) => [
              chapterId,
              Object.fromEntries(footnotesByRowId.entries()),
            ]),
          ),
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

  await page.goto(setup.path ?? "/");
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

async function readEditorFieldMetrics(page, rowId, languageCode, contentKind = "field") {
  return await page.evaluate(({ rowId: targetRowId, languageCode: targetLanguageCode, contentKind: targetContentKind }) => {
    const field = document.querySelector(
      `[data-editor-row-field][data-row-id="${targetRowId}"][data-language-code="${targetLanguageCode}"]${targetContentKind === "footnote" ? '[data-content-kind="footnote"]' : ":not([data-content-kind])"}`,
    );
    if (!(field instanceof HTMLTextAreaElement)) {
      return null;
    }

    const styles = getComputedStyle(field);
    return {
      fontSizePx: Number.parseFloat(styles.fontSize),
      fontWeight: styles.fontWeight,
      fontStyle: styles.fontStyle,
      paddingLeftPx: Number.parseFloat(styles.paddingLeft),
    };
  }, { rowId, languageCode, contentKind });
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

async function readTranslateScrollTop(page) {
  return await page.evaluate(() => {
    const container = document.querySelector(".translate-main-scroll");
    return container instanceof HTMLElement ? container.scrollTop : 0;
  });
}

async function readTranslateScrollMetrics(page) {
  return await page.evaluate(() => {
    const container = document.querySelector(".translate-main-scroll");
    if (!(container instanceof HTMLElement)) {
      return {
        top: 0,
        maxTop: 0,
        bottomGap: 0,
      };
    }

    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    return {
      top: container.scrollTop,
      maxTop,
      bottomGap: maxTop - container.scrollTop,
    };
  });
}

async function countGlossaryMarksForRow(page, rowId) {
  return await page.locator(
    `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-glossary-mark]`,
  ).count();
}

async function setTranslateScrollTop(page, top) {
  await page.evaluate((nextTop) => {
    const container = document.querySelector(".translate-main-scroll");
    if (container instanceof HTMLElement) {
      container.scrollTop = nextTop;
      container.dispatchEvent(new Event("scroll"));
    }
  }, top);
}

async function openPlatformEditorFixture(page, platform) {
  await page.addInitScript(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {
      // Ignore local-storage access restrictions in the browser harness.
    }
  });
  await page.goto(`/?platform=${platform}&fixture=editor&rows=200`);
  await expect(page.locator("[data-editor-search-input]")).toBeVisible();
}

test.describe("editor regressions", () => {
  test("mounting the editor fixture renders one translate action in unified AI settings mode", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 6 });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    await expect(page.locator(".translate-ai-action-button")).toHaveCount(1);
    await expect(page.locator(".translate-ai-action-button__model")).toHaveCount(1);
    await expect(page.locator(".translate-ai-action-button__model")).not.toHaveText("");
    await expect(page.locator(".translate-ai-action-button")).not.toContainText("Translate 1");
    await expect(page.locator(".translate-ai-action-button")).not.toContainText("Translate 2");
  });

  test("translate action shows a spinner while translation is running", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 6,
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
      aiTranslate: {
        translate1: {
          status: "loading",
          rowId: "fixture-row-0001",
          sourceLanguageCode: "es",
          targetLanguageCode: "vi",
          requestKey: "req-translate-1",
          sourceText: "alpha 0001 source text",
        },
      },
    });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    const loadingButton = page.locator('[data-action="run-editor-ai-translate:translate1"]');
    await expect(loadingButton).toHaveAttribute("aria-busy", "true");
    await expect(loadingButton.locator(".translate-ai-action-button__spinner")).toBeVisible();
    await expect(
      page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]'),
    ).toHaveValue("Translating...");
  });

  test("translate action marks an alternate target language field while it is running", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
        { code: "fr", name: "French" },
      ],
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
      aiTranslate: {
        translate1: {
          status: "loading",
          rowId: "fixture-row-0001",
          sourceLanguageCode: "es",
          targetLanguageCode: "fr",
          requestKey: "req-translate-2",
          sourceText: "alpha 0001 source text",
        },
      },
    });

    await expect(
      page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]'),
    ).toHaveValue("alpha 0001 target text");
    await expect(
      page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="fr"]'),
    ).toHaveValue("Translating...");
  });

  test("clicking translate shows translating placeholder in the target field until the result returns", async ({ page }) => {
    await page.addInitScript(() => {
      let releaseTranslation = () => {};
      const translationGate = new Promise((resolve) => {
        releaseTranslation = resolve;
      });

      globalThis.__releaseMockTranslation = releaseTranslation;
      globalThis.__gnosisMockTauriHandlers = {
        load_ai_provider_secret() {
          return "openai-key";
        },
        async run_ai_translation() {
          await translationGate;
          return {
            translatedText: "Da xong",
          };
        },
      };
    });

    await mountEditorFixture(page, {
      rowCount: 6,
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
    }, { mockTauri: true });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    await page.locator('[data-action="run-editor-ai-translate:translate1"]').click();

    const translateButton = page.locator('[data-action="run-editor-ai-translate:translate1"]');
    await expect(translateButton).toHaveAttribute("aria-busy", "true");

    const targetField = page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]');
    await expect(targetField).toHaveValue("Translating...");

    await page.evaluate(() => {
      window.__releaseMockTranslation?.();
    });

    await expect(targetField).toHaveValue("Da xong");
  });

  test("mounting the editor fixture renders two translate actions in detailed AI settings mode", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 6,
      aiActionConfig: {
        detailedConfiguration: true,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
        actions: {
          translate1: {
            providerId: "openai",
            modelId: "gpt-5.4",
          },
          translate2: {
            providerId: "gemini",
            modelId: "gemini-2.5-flash",
          },
        },
      },
    });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    const buttons = page.locator(".translate-ai-action-button");
    await expect(buttons).toHaveCount(2);
    await expect(page.locator(".translate-ai-action-button__model").nth(0)).toHaveText("gpt-5.4");
    await expect(page.locator(".translate-ai-action-button__model").nth(1)).toHaveText("gemini-2.5-flash");
    await expect(buttons.nth(0)).toHaveAttribute(
      "data-tooltip",
      "Translate Spanish to Vietnamese using gpt-5.4",
    );
    await expect(buttons.nth(1)).toHaveAttribute(
      "data-tooltip",
      "Translate Spanish to Vietnamese using gemini-2.5-flash",
    );

    const buttonHeights = await buttons.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().height))
    );
    expect(buttonHeights[0]).toBe(buttonHeights[1]);
    expect(buttonHeights[0]).toBeLessThan(90);
  });

  test("translate tab disables actions when the source language is selected", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 1 });

    await page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="es"]').click();
    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();

    const translateButton = page.locator('[data-action="run-editor-ai-translate:translate1"]');
    await expect(translateButton).toBeDisabled();
    await expect(page.locator(".translate-ai-tools .message-box")).toContainText(
      "Choose a language other than the source language before translating.",
    );
  });

  test("translate tab shows an alternate target label and tooltip for the active language", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
        { code: "fr", name: "French" },
      ],
      aiActionConfig: {
        detailedConfiguration: true,
        actions: {
          translate1: {
            providerId: "openai",
            modelId: "gpt-5.4",
          },
          translate2: {
            providerId: "gemini",
            modelId: "gemini-2.5-flash",
          },
        },
      },
    });

    await page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="fr"]').click();
    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();

    await expect(page.locator(".translate-ai-tools__language-flow")).toContainText("Spanish");
    await expect(page.locator(".translate-ai-tools__language-flow")).toContainText("French");
    await expect(page.locator(".translate-ai-tools__language-arrow")).toHaveCount(1);
    await expect(page.locator(".translate-ai-action-button").nth(0)).toHaveAttribute(
      "data-tooltip",
      "Translate Spanish to French using gpt-5.4",
    );
    await expect(page.locator(".translate-ai-action-button").nth(1)).toHaveAttribute(
      "data-tooltip",
      "Translate Spanish to French using gemini-2.5-flash",
    );
  });

  test("opening the upload image editor at the bottom keeps the last row pinned to the bottom", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 80 });

    await page.evaluate(() => {
      const container = document.querySelector(".translate-main-scroll");
      if (container instanceof HTMLElement) {
        container.scrollTop = container.scrollHeight;
        container.dispatchEvent(new Event("scroll"));
      }
    });

    const lastField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0080"][data-language-code="vi"]',
    );
    await expect(lastField).toBeVisible();
    await lastField.click();

    const beforeMetrics = await readTranslateScrollMetrics(page);
    expect(beforeMetrics.bottomGap).toBeLessThan(80);

    const uploadButton = page.locator(
      '[data-action="open-editor-image-upload"][data-row-id="fixture-row-0080"][data-language-code="vi"]',
    );
    await expect(uploadButton).toBeVisible();
    await uploadButton.click();

    const uploadDropzone = page.locator(
      '[data-editor-image-upload-dropzone][data-row-id="fixture-row-0080"][data-language-code="vi"]',
    );
    await expect(uploadDropzone).toBeVisible();

    const afterMetrics = await readTranslateScrollMetrics(page);
    expect(afterMetrics.bottomGap).toBeLessThanOrEqual(beforeMetrics.bottomGap + 4);
    expect(afterMetrics.top).toBeGreaterThanOrEqual(beforeMetrics.top - 4);
  });

  test("opening the upload image editor at the bottom does not jump to an earlier inserted image", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 80,
      imagesByRowId: {
        "fixture-row-0048": {
          vi: {
            kind: "url",
            url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
          },
        },
      },
    });

    await page.evaluate(() => {
      const container = document.querySelector(".translate-main-scroll");
      if (container instanceof HTMLElement) {
        container.scrollTop = container.scrollHeight;
        container.dispatchEvent(new Event("scroll"));
      }
    });

    const lastField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0080"][data-language-code="vi"]',
    );
    await expect(lastField).toBeVisible();
    await lastField.click();

    const beforeMetrics = await readTranslateScrollMetrics(page);
    expect(beforeMetrics.bottomGap).toBeLessThan(80);

    await page.locator(
      '[data-action="open-editor-image-upload"][data-row-id="fixture-row-0080"][data-language-code="vi"]',
    ).click();
    await page.waitForTimeout(800);

    const earlierImagePreview = page.locator(
      '[data-editor-row-card][data-row-id="fixture-row-0048"] [data-editor-language-image-preview-img]',
    );

    const afterMetrics = await readTranslateScrollMetrics(page);
    expect(afterMetrics.bottomGap).toBeLessThanOrEqual(beforeMetrics.bottomGap + 12);
    expect(afterMetrics.top).toBeGreaterThanOrEqual(beforeMetrics.top - 12);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0080"]')).toBeVisible();
    await expect(earlierImagePreview).not.toBeVisible();
  });

  test("clicking outside the upload image dropzone closes it and restores the row", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 20 });

    const field = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0020"][data-language-code="vi"]',
    );
    await expect(field).toBeVisible();
    await field.click();

    const uploadButton = page.locator(
      '[data-action="open-editor-image-upload"][data-row-id="fixture-row-0020"][data-language-code="vi"]',
    );
    await expect(uploadButton).toBeVisible();
    await uploadButton.click();

    const uploadDropzone = page.locator(
      '[data-editor-image-upload-dropzone][data-row-id="fixture-row-0020"][data-language-code="vi"]',
    );
    await expect(uploadDropzone).toBeVisible();

    await field.click();

    await expect(uploadDropzone).toBeHidden();
    await expect(field).toBeFocused();
  });

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
      "Showing 1 matching row",
    );
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(1);

    await searchInput.fill("zzz-not-found");
    await expect(page.locator(".translation-results-banner")).toHaveCount(0);
    await expect(page.locator(".card--translation .card__body")).toContainText(
      "No rows match the current filters.",
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

  test("fixture row actions work without a backend for insert, restore, and permanent delete", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 12 });

    await page.locator('[data-action="open-insert-editor-row:fixture-row-0004"]').click();
    await expect(page.locator('[data-action="confirm-insert-editor-row-after"]')).toBeVisible();
    await page.locator('[data-action="confirm-insert-editor-row-after"]').click();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0013"]')).toBeVisible();

    await page.locator('[data-action="soft-delete-editor-row:fixture-row-0004"]').click();
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(1);

    await page.locator(".translation-deleted-group .section-separator").click();
    await expect(page.locator('[data-action="restore-editor-row:fixture-row-0004"]')).toBeVisible();
    await page.locator('[data-action="restore-editor-row:fixture-row-0004"]').click();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0004"]')).toBeVisible();

    await page.locator('[data-action="soft-delete-editor-row:fixture-row-0004"]').click();
    await page.locator(".translation-deleted-group .section-separator").click();
    await page.locator('[data-action="open-editor-row-permanent-delete:fixture-row-0004"]').click();
    await expect(page.locator('[data-action="confirm-editor-row-permanent-delete"]')).toBeVisible();
    await page.locator('[data-action="confirm-editor-row-permanent-delete"]').click();

    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0004"]')).toHaveCount(0);
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(0);
  });

  test("Windows fixture glossary highlights render and survive a long scroll", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 80, glossary: true }, { path: "/?platform=windows" });

    await expect.poll(async () => {
      return await countGlossaryMarksForRow(page, "fixture-row-0001");
    }).toBe(2);

    await setTranslateScrollTop(page, 9000);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0030"]')).toBeVisible();

    await expect.poll(async () => {
      return await countGlossaryMarksForRow(page, "fixture-row-0030");
    }).toBe(2);
  });

  test("Windows fixture glossary highlights survive delete show hide and restore", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 80, glossary: true }, { path: "/?platform=windows" });

    const rowId = "fixture-row-0030";
    const rowCard = page.locator(`[data-editor-row-card][data-row-id="${rowId}"]`);
    const deletedGroupToggle = page.locator(".translation-deleted-group .section-separator");

    await setTranslateScrollTop(page, 9000);
    await expect(rowCard).toBeVisible();

    await expect.poll(async () => {
      return await countGlossaryMarksForRow(page, rowId);
    }).toBe(2);

    await page.locator(`[data-action="soft-delete-editor-row:${rowId}"]`).click();
    await expect(rowCard).toHaveCount(0);

    await deletedGroupToggle.click();
    await expect(rowCard).toBeVisible();
    await expect.poll(async () => {
      return await countGlossaryMarksForRow(page, rowId);
    }).toBe(2);

    await deletedGroupToggle.click();
    await expect(rowCard).toHaveCount(0);

    await deletedGroupToggle.click();
    await page.locator(`[data-action="restore-editor-row:${rowId}"]`).click();
    await expect(rowCard).toBeVisible();
    await expect.poll(async () => {
      return await countGlossaryMarksForRow(page, rowId);
    }).toBe(2);
  });

  test("selecting a replace row under virtualization keeps the selected row visible", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 80 });

    const searchInput = page.locator("[data-editor-search-input]");
    await searchInput.fill("alpha");
    await page.evaluate(() => window.__gnosisDebug.setEditorReplaceEnabled(true));

    await setTranslateScrollTop(page, 9000);
    const rowSelect = page.locator('[data-editor-replace-row-select][data-row-id="fixture-row-0030"]');
    const rowCard = page.locator('[data-editor-row-card][data-row-id="fixture-row-0030"]');
    await expect(rowSelect).toBeVisible();
    await page.waitForTimeout(500);

    await rowSelect.click();

    await expect(rowSelect).toBeChecked();
    await expect(rowCard).toBeVisible();
  });

  test("the first soft-delete after scrolling keeps the deleted section in view", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });

    await setTranslateScrollTop(page, 9000);
    const row = page.locator('[data-editor-row-card][data-row-id="fixture-row-0030"]');
    await expect(row).toBeVisible();

    const beforeScrollTop = await readTranslateScrollTop(page);
    await row.getByRole("button", { name: "Delete" }).click();

    const deletedGroup = page.locator("[data-editor-deleted-group]").first();
    await expect(deletedGroup).toBeVisible();
    const afterScrollTop = await readTranslateScrollTop(page);
    expect(Math.abs(afterScrollTop - beforeScrollTop)).toBeLessThan(120);
  });

  test("fast scrolling after a structural edit still renders rows", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 120 }, { mockTauri: true });

    await setTranslateScrollTop(page, 9000);
    const deleteButton = page.locator('[data-action="soft-delete-editor-row:fixture-row-0030"]');
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    await setTranslateScrollTop(page, 26000);
    await expect(page.locator("[data-editor-row-card]").first()).toBeVisible();
    await expect.poll(async () => {
      return await page.evaluate(() => {
        return document.querySelectorAll("[data-editor-row-card]").length;
      });
    }).toBeGreaterThan(0);
  });

  for (const { label, platform } of [
    { label: "Windows", platform: "windows" },
    { label: "Mac", platform: "mac" },
  ]) {
    test(`scrolling in ${label} mode does not continue running away after wheel input stops`, async ({ page }) => {
      await openPlatformEditorFixture(page, platform);

      await setTranslateScrollTop(page, 34000);

      await expect.poll(async () => {
        return await readTranslateScrollTop(page);
      }).toBeGreaterThan(33000);

      await page.waitForTimeout(150);
      const afterScrollInput = await readTranslateScrollTop(page);

      await page.waitForTimeout(400);
      const laterScrollTop = await readTranslateScrollTop(page);

      expect(laterScrollTop - afterScrollInput).toBeLessThan(400);
      expect(laterScrollTop).toBeLessThan(40000);
    });

    test(`a shallow ${label}-mode scroll does not jump backward after deferred layout`, async ({ page }) => {
      await openPlatformEditorFixture(page, platform);

      await setTranslateScrollTop(page, 850);

      await expect.poll(async () => {
        return await readTranslateScrollTop(page);
      }).toBeGreaterThan(700);

      await page.waitForTimeout(150);
      const afterScrollInput = await readTranslateScrollTop(page);

      await page.waitForTimeout(450);
      const laterScrollTop = await readTranslateScrollTop(page);

      expect(Math.abs(laterScrollTop - afterScrollInput)).toBeLessThan(80);
    });

    test(`a second shallow ${label}-mode scroll does not reuse a stale deferred anchor`, async ({ page }) => {
      await openPlatformEditorFixture(page, platform);

      await setTranslateScrollTop(page, 850);
      await expect.poll(async () => {
        return await readTranslateScrollTop(page);
      }).toBeGreaterThan(700);
      await page.waitForTimeout(500);

      await setTranslateScrollTop(page, 2920);
      await expect.poll(async () => {
        return await readTranslateScrollTop(page);
      }).toBeGreaterThan(2800);

      await page.waitForTimeout(150);
      const afterSecondScrollInput = await readTranslateScrollTop(page);

      await page.waitForTimeout(450);
      const laterScrollTop = await readTranslateScrollTop(page);

      expect(Math.abs(laterScrollTop - afterSecondScrollInput)).toBeLessThan(80);
    });

    test(`a longer ${label}-mode scroll does not jump backward after deferred layout`, async ({ page }) => {
      await openPlatformEditorFixture(page, platform);

      await setTranslateScrollTop(page, 6730);

      await expect.poll(async () => {
        return await readTranslateScrollTop(page);
      }).toBeGreaterThan(6500);

      await page.waitForTimeout(150);
      const afterScrollInput = await readTranslateScrollTop(page);

      await page.waitForTimeout(450);
      const laterScrollTop = await readTranslateScrollTop(page);

      expect(Math.abs(laterScrollTop - afterScrollInput)).toBeLessThan(120);
    });
  }

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

  test("row text style buttons show on focus, update the whole row, and hide on blur", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const targetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const headingButton = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading1"]',
    );
    const searchInput = page.locator("[data-editor-search-input]");

    await expect(headingButton).toBeHidden();
    await targetField.click();
    await expect(headingButton).toBeVisible();

    const fieldBox = await targetField.boundingBox();
    const buttonBox = await headingButton.boundingBox();
    expect(fieldBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(buttonBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);

    await headingButton.click();

    await expect.poll(async () => {
      return await page.locator(
        '[data-editor-glossary-field-stack][data-row-id="fixture-row-0001"][data-language-code="vi"]',
      ).getAttribute("data-row-text-style");
    }).toBe("heading1");

    await expect.poll(async () => {
      return await page.locator(
        '[data-editor-glossary-field-stack][data-row-id="fixture-row-0001"][data-language-code="es"]',
      ).getAttribute("data-row-text-style");
    }).toBe("heading1");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.textStyles?.["fixture-chapter"]?.["fixture-row-0001"] ?? null;
    }).toBe("heading1");

    await searchInput.click();
    await expect(headingButton).toBeHidden();
  });

  test("changing row text style auto-saves pending text edits first", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const targetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const heading2Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading2"]',
    );

    await targetField.click();
    await targetField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");

    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().dirtyRowIds);
    }).toEqual(["fixture-row-0001"]);

    await heading2Button.click();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.plainText ?? null;
    }).toBe("alpha 0001 target text saved");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.textStyles?.["fixture-chapter"]?.["fixture-row-0001"] ?? null;
    }).toBe("heading2");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      const relevantCommands = (mockState?.invocations ?? [])
        .filter((entry) => (
          entry.command === "update_gtms_editor_row_fields"
          || entry.command === "update_gtms_editor_row_text_style"
        ) && entry.payload?.input?.rowId === "fixture-row-0001")
        .map((entry) => entry.command);
      return relevantCommands;
    }).toEqual([
      "update_gtms_editor_row_fields",
      "update_gtms_editor_row_text_style",
    ]);

    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().dirtyRowIds);
    }).toEqual([]);
  });

  test("row text style changes appear in history and the review last update note", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const targetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const heading1Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading1"]',
    );
    const reviewLastUpdateGroup = page.locator(".history-group").first();

    await targetField.click();
    await heading1Button.click();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.textStyle ?? null;
    }).toBe("heading1");

    const reviewStyleNote = reviewLastUpdateGroup.locator(".history-item__style-note");
    await expect(reviewStyleNote).toContainText("Style change");
    await expect(reviewStyleNote.locator(".history-diff__delete")).toHaveText("P");
    await expect(reviewStyleNote.locator(".history-diff__insert")).toHaveText("H1");

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".history-tabs__item--active")).toHaveText("History");

    const historyStyleNote = page.locator(".history-item__style-note").first();
    await expect(historyStyleNote).toContainText("Style change");
    await expect(historyStyleNote.locator(".history-diff__delete")).toHaveText("P");
    await expect(historyStyleNote.locator(".history-diff__insert")).toHaveText("H1");
  });

  test("review last update shows both style and footnote notes for the latest grouped change", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const targetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])',
    );
    const nextRowField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0002"][data-language-code="vi"]:not([data-content-kind])',
    );
    const heading1Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading1"]',
    );
    const footnoteButton = page.locator(
      '[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );

    await targetField.click();
    await heading1Button.click();
    await footnoteButton.evaluate((button) => button.click());

    const footnoteField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"][data-content-kind="footnote"]',
    );
    await expect(footnoteField).toBeVisible();
    await page.keyboard.type("Grouped footnote");
    await nextRowField.click();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.footnote ?? null;
    }).toBe("Grouped footnote");

    await targetField.click();

    const reviewLastUpdateGroup = page.locator(".history-group").first();
    const reviewStyleNote = reviewLastUpdateGroup.locator(".history-item__style-note");
    const reviewFootnoteContent = reviewLastUpdateGroup.locator(".history-item__content--footnote");

    await expect(reviewStyleNote).toContainText("Style change");
    await expect(reviewStyleNote.locator(".history-diff__delete")).toHaveText("P");
    await expect(reviewStyleNote.locator(".history-diff__insert")).toHaveText("H1");
    await expect(reviewFootnoteContent).toContainText("Grouped footnote");
    await expect(reviewFootnoteContent).toHaveCSS("font-style", "italic");

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".history-tabs__item--active")).toHaveText("History");

    const historyStyleNote = page.locator(".history-item__style-note").first();
    const historyFootnoteContent = page.locator(".history-item__content--footnote").first();
    await expect(historyStyleNote).toContainText("Style change");
    await expect(historyStyleNote.locator(".history-diff__delete")).toHaveText("P");
    await expect(historyStyleNote.locator(".history-diff__insert")).toHaveText("H1");
    await expect(historyFootnoteContent).toContainText("Grouped footnote");
    await expect(historyFootnoteContent).toHaveCSS("font-style", "italic");
  });

  test("row text styles update editor typography and return to paragraph styling", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const targetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const paragraphButton = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="paragraph"]',
    );
    const heading1Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading1"]',
    );
    const heading2Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading2"]',
    );
    const quoteButton = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="quote"]',
    );
    const indentedButton = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="indented"]',
    );

    await targetField.click();

    const paragraphMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(paragraphMetrics).not.toBeNull();

    await heading2Button.click();
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontSizePx ?? 0;
    }).toBeGreaterThan(paragraphMetrics.fontSizePx);
    const heading2Metrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(Number.parseInt(heading2Metrics.fontWeight, 10)).toBeGreaterThanOrEqual(700);

    await heading1Button.click();
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontSizePx ?? 0;
    }).toBeGreaterThan(heading2Metrics.fontSizePx);
    const heading1Metrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(Number.parseInt(heading1Metrics.fontWeight, 10)).toBeGreaterThanOrEqual(700);

    await quoteButton.click();
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontStyle ?? "";
    }).toBe("italic");
    const quoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(quoteMetrics.paddingLeftPx).toBeGreaterThan(paragraphMetrics.paddingLeftPx);

    await indentedButton.click();
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontStyle ?? "";
    }).toBe("normal");
    const indentedMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(indentedMetrics.paddingLeftPx).toBe(quoteMetrics.paddingLeftPx);

    await paragraphButton.click();
    await expect.poll(async () => {
      return await page.locator(
        '[data-editor-glossary-field-stack][data-row-id="fixture-row-0001"][data-language-code="vi"]',
      ).getAttribute("data-row-text-style");
    }).toBe("paragraph");
    const resetMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(resetMetrics.fontStyle).toBe(paragraphMetrics.fontStyle);
    expect(resetMetrics.paddingLeftPx).toBeCloseTo(paragraphMetrics.paddingLeftPx, 3);
    expect(resetMetrics.fontSizePx).toBeCloseTo(paragraphMetrics.fontSizePx, 3);
  });

  test("footnotes keep fixed styling while row text styles change, and the add button matches the style buttons", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const targetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])',
    );
    const footnoteButton = page.locator(
      '[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const heading1Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading1"]',
    );
    const quoteButton = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="quote"]',
    );

    await targetField.click();
    await expect(footnoteButton).toBeVisible();
    await expect(footnoteButton).toHaveClass(/translation-row-text-style-button--footnote/);

    const paragraphMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(paragraphMetrics).not.toBeNull();

    await footnoteButton.evaluate((button) => button.click());
    const footnoteField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"][data-content-kind="footnote"]',
    );
    await expect(footnoteField).toBeVisible();
    await page.keyboard.type("Fixed footnote");

    const baselineFootnoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi", "footnote");
    expect(baselineFootnoteMetrics).not.toBeNull();
    expect(baselineFootnoteMetrics.fontStyle).toBe("italic");

    await heading1Button.click();
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontSizePx ?? 0;
    }).toBeGreaterThan(paragraphMetrics.fontSizePx);

    const headingFootnoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi", "footnote");
    expect(headingFootnoteMetrics.fontStyle).toBe("italic");
    expect(headingFootnoteMetrics.fontSizePx).toBeCloseTo(baselineFootnoteMetrics.fontSizePx, 3);
    expect(headingFootnoteMetrics.paddingLeftPx).toBeCloseTo(baselineFootnoteMetrics.paddingLeftPx, 3);

    await quoteButton.click();
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.paddingLeftPx ?? 0;
    }).toBeGreaterThan(paragraphMetrics.paddingLeftPx);

    const quoteFootnoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi", "footnote");
    expect(quoteFootnoteMetrics.fontStyle).toBe("italic");
    expect(quoteFootnoteMetrics.fontSizePx).toBeCloseTo(baselineFootnoteMetrics.fontSizePx, 3);
    expect(quoteFootnoteMetrics.paddingLeftPx).toBeCloseTo(baselineFootnoteMetrics.paddingLeftPx, 3);
  });

  test("row text style buttons behave like radios and survive later text saves", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const targetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const paragraphButton = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="paragraph"]',
    );
    const heading2Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading2"]',
    );
    const searchInput = page.locator("[data-editor-search-input]");

    await targetField.click();
    await expect(paragraphButton).toHaveAttribute("aria-checked", "true");
    await expect(heading2Button).toHaveAttribute("aria-checked", "false");

    await heading2Button.click();
    await expect(heading2Button).toHaveAttribute("aria-checked", "true");
    await expect(paragraphButton).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][aria-checked="true"]',
    )).toHaveCount(1);

    await heading2Button.click();
    await expect(heading2Button).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.invocations?.filter((entry) =>
        entry.command === "update_gtms_editor_row_text_style"
        && entry.payload?.input?.rowId === "fixture-row-0001"
      ).length ?? 0;
    }).toBe(1);

    await targetField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");
    await searchInput.click();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.plainText ?? null;
    }).toBe("alpha 0001 target text saved");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.textStyles?.["fixture-chapter"]?.["fixture-row-0001"] ?? null;
    }).toBe("heading2");

    await expect.poll(async () => {
      return await page.locator(
        '[data-editor-glossary-field-stack][data-row-id="fixture-row-0001"][data-language-code="vi"]',
      ).getAttribute("data-row-text-style");
    }).toBe("heading2");
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

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".history-tabs__item--active")).toHaveText("History");

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
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".history-tabs__item--active")).toHaveText("History");
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

  test("footnotes open from the action row, save through row persistence, and stay visible in history", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const activeTargetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])',
    );
    const inactiveSourcePanel = page.locator(
      '[data-editor-language-panel][data-row-id="fixture-row-0001"][data-language-code="es"]',
    );
    const activeTargetPanel = page.locator(
      '[data-editor-language-panel][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const footnoteButton = page.locator(
      '[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );

    await activeTargetField.click();
    await expect(footnoteButton).toBeVisible();
    await expect(
      activeTargetPanel.locator('.translation-row-text-style-actions__separator'),
    ).toBeVisible();
    await expect(inactiveSourcePanel.locator('[data-editor-footnote-button]')).toBeHidden();
    await expect(
      inactiveSourcePanel.locator('[data-editor-row-field][data-content-kind="footnote"]'),
    ).toHaveCount(0);

    await footnoteButton.evaluate((button) => button.click());
    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().footnoteEditor);
    }).toEqual({
      rowId: "fixture-row-0001",
      languageCode: "vi",
    });

    const footnoteField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"][data-content-kind="footnote"]',
    );
    await expect(footnoteField).toBeVisible();
    await expect(footnoteField).toBeFocused();
    await expect(footnoteButton).toHaveCount(0);
    await expect(footnoteField).toHaveCSS("font-style", "italic");

    await page.keyboard.type("Saved footnote text");
    await expect.poll(async () => {
      const editorState = await page.evaluate(() => window.__gnosisDebug.readEditorState());
      return {
        dirtyRowIds: editorState?.dirtyRowIds ?? [],
        footnote: editorState?.rowFootnotes?.["fixture-row-0001"]?.vi ?? null,
      };
    }).toEqual({
      dirtyRowIds: ["fixture-row-0001"],
      footnote: "Saved footnote text",
    });
    await page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0002"][data-language-code="vi"]',
    ).click();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.footnotes?.["fixture-chapter"]?.["fixture-row-0001"]?.vi ?? null;
    }).toBe("Saved footnote text");
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.footnote ?? null;
    }).toBe("Saved footnote text");

    await expect(footnoteField).toBeVisible();
    await expect(footnoteField).toHaveValue("Saved footnote text");

    await activeTargetField.click();
    const reviewFootnoteContent = page.locator(".history-item__content--footnote").first();
    await expect(reviewFootnoteContent).toContainText("Saved footnote text");
    await expect(reviewFootnoteContent).toHaveCSS("font-style", "italic");

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".history-tabs__item--active")).toHaveText("History");
    const historyFootnoteContent = page.locator(".history-item__content--footnote").first();
    await expect(historyFootnoteContent).toContainText("Saved footnote text");
    await expect(historyFootnoteContent).toHaveCSS("font-style", "italic");
  });

  test("footnote controls hide on blur even if row activation finishes later", async ({ page }) => {
    await page.addInitScript(() => {
      let releaseRowLoad = () => {};
      const rowLoadGate = new Promise((resolve) => {
        releaseRowLoad = resolve;
      });

      globalThis.__releaseMockRowLoad = releaseRowLoad;
      globalThis.__gnosisMockTauriHandlers = {
        async load_gtms_editor_row(payload) {
          await rowLoadGate;
          const input = payload?.input ?? {};
          return {
            row: {
              rowId: input.rowId,
              orderKey: "00001",
              lifecycleState: "active",
              commentCount: 0,
              commentsRevision: 0,
              textStyle: "paragraph",
              fields: {
                es: "alpha 0001 source text",
                vi: "alpha 0001 target text",
              },
              footnotes: {
                es: "",
                vi: "",
              },
              fieldStates: {
                es: { reviewed: false, pleaseCheck: false },
                vi: { reviewed: false, pleaseCheck: false },
              },
            },
          };
        },
      };
    });

    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });
    await page.evaluate(() => {
      window.__gnosisDebug.setEditorRowSyncState("fixture-row-0001", {
        freshness: "stale",
      });
    });

    const targetField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])',
    );
    const searchInput = page.locator("[data-editor-search-input]");
    const footnoteButton = page.locator(
      '[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );

    await targetField.click();
    await expect(footnoteButton).toBeVisible();

    await searchInput.click();
    await expect(footnoteButton).toBeHidden();

    await page.evaluate(() => {
      window.__releaseMockRowLoad?.();
    });

    await expect(footnoteButton).toBeHidden();
  });

  test("comments marker appears only on the target-language panel", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 6 }, { mockTauri: true });

    const sourcePanel = page.locator('[data-editor-language-panel][data-row-id="fixture-row-0001"][data-language-code="es"]');
    const targetPanel = page.locator('[data-editor-language-panel][data-row-id="fixture-row-0001"][data-language-code="vi"]');

    await expect(sourcePanel.locator('[data-action="open-editor-comments"]')).toHaveCount(0);
    await expect(targetPanel.locator('[data-action="open-editor-comments"]')).toHaveCount(1);
  });

  test("opening comments switches the sidebar and marks that row as read", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 6,
      commentsByRowId: {
        "fixture-row-0001": {
          commentsRevision: 2,
          comments: [
            {
              commentId: "comment-1",
              authorLogin: "other-user",
              authorName: "Other User",
              body: "Please verify this wording.",
              createdAt: "2026-04-13T09:12:33Z",
            },
          ],
        },
      },
    }, { mockTauri: true });

    const commentsButton = page.locator(
      '[data-action="open-editor-comments"][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    await expect(commentsButton).toHaveClass(/is-unread/);

    await commentsButton.click();

    await expect(page.locator(".history-tabs__item--active")).toHaveText("Comments");
    await expect(page.locator(".history-item__content")).toContainText("Please verify this wording.");
    await expect(commentsButton).not.toHaveClass(/is-unread/);
    await expect.poll(async () => {
      return await page.evaluate(() => window.__gnosisDebug.readEditorState().commentSeenRevisions);
    }).toEqual({ "fixture-row-0001": 2 });

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row_comments")).toBe(true);
  });

  test("saving and deleting a comment keeps the comments tab in sync", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 6 }, { mockTauri: true });

    await page.locator(
      '[data-action="open-editor-comments"][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    ).click();
    await expect(page.locator(".history-empty")).toContainText("No comments yet for this row.");
    await page.locator("[data-editor-comment-draft]").fill("Check the final clause.");
    await page.getByRole("button", { name: "Save comment" }).click();

    await expect(page.locator(".history-item__content")).toContainText("Check the final clause.");
    const deleteCommentButton = page.locator('[data-action^="delete-editor-comment:"]');
    await expect(deleteCommentButton).toBeVisible();

    await deleteCommentButton.click();
    await expect(page.locator(".history-empty")).toContainText("No comments yet for this row.");
    await expect(page.locator(
      '[data-action="open-editor-comments"][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    )).not.toHaveClass(/is-active/);
  });
});
