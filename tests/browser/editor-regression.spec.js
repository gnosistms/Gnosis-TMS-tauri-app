import { expect, test } from "@playwright/test";

async function installMockTauri(page) {
  await page.addInitScript(() => {
    const clone = (value) => globalThis.structuredClone(value);
    const historyKey = (chapterId, rowId, languageCode) => `${chapterId}::${rowId}::${languageCode}`;
    let commitCounter = 0;
    const fixtureByChapterId = new Map();
    const rowFieldsByChapterId = new Map();
    const rowFootnotesByChapterId = new Map();
    const rowImageCaptionsByChapterId = new Map();
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
      rowImageCaptionsByChapterId.set(
        chapterId,
        new Map(rows.map((row) => [row.rowId, clone(row.imageCaptions ?? {})])),
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

    function findRowImageCaptions(chapterId, rowId) {
      return rowImageCaptionsByChapterId.get(chapterId)?.get(rowId) ?? null;
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
      const imageCaptions = findRowImageCaptions(chapterId, rowId);
      const fieldStates = findFieldStates(chapterId, rowId);
      const comments = findRowComments(chapterId, rowId);
      if (!fixtureRow || !fields || !footnotes || !imageCaptions || !fieldStates) {
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
        imageCaptions: clone(imageCaptions),
        images: clone(fixtureRow.images ?? {}),
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
        const storedImageCaptions = findRowImageCaptions(input.chapterId, input.rowId);
        const storedFieldStates = findFieldStates(input.chapterId, input.rowId);
        if (!storedFields || !storedFootnotes || !storedImageCaptions || !storedFieldStates) {
          throw new Error(`Unknown editor row: ${input.rowId}`);
        }
        const nextFootnotes = clone(input.footnotes ?? storedFootnotes);
        const nextImageCaptions = clone(input.imageCaptions ?? storedImageCaptions);

        rowFieldsByChapterId.get(input.chapterId).set(input.rowId, nextFields);
        rowFootnotesByChapterId.get(input.chapterId).set(input.rowId, nextFootnotes);
        rowImageCaptionsByChapterId.get(input.chapterId).set(input.rowId, nextImageCaptions);
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

async function runEditorBackgroundSync(page, options = {}) {
  return await page.evaluate(async (syncOptions) => {
    return await window.__gnosisDebug.runEditorBackgroundSync(syncOptions);
  }, options);
}

async function runEditorRefresh(page) {
  return await page.evaluate(async () => {
    return await window.__gnosisDebug.refreshCurrentScreen();
  });
}

async function installBackgroundSyncMock(page, options = {}) {
  const {
    changedRowIds = [],
    deletedRowIds = [],
    insertedRowIds = [],
    rowsById = {},
    newHeadSha = "mock-sync-head",
  } = options;

  await page.evaluate(({
    nextChangedRowIds,
    nextDeletedRowIds,
    nextInsertedRowIds,
    nextRowsById,
    nextHeadSha,
  }) => {
    const existingFixture = globalThis.__gnosisBackgroundSyncFixture ?? {};
    globalThis.__gnosisBackgroundSyncFixture = {
      rowsById: {
        ...(existingFixture.rowsById ?? {}),
        ...nextRowsById,
      },
      changedRowIds: [...nextChangedRowIds],
      deletedRowIds: [...nextDeletedRowIds],
      insertedRowIds: [...nextInsertedRowIds],
      newHeadSha: nextHeadSha,
    };

    function buildMockEditorRow(rowId, rowPatch = {}, headSha) {
      const rowNumberToken = String(rowId ?? "").match(/(\d+)$/)?.[1] ?? "";
      return {
        chapterBaseCommitSha: headSha,
        row: {
          rowId,
          orderKey: rowPatch.orderKey ?? (rowNumberToken ? rowNumberToken.padStart(5, "0") : "00000"),
          lifecycleState: rowPatch.lifecycleState ?? "active",
          commentCount: rowPatch.commentCount ?? 0,
          commentsRevision: rowPatch.commentsRevision ?? 0,
          textStyle: rowPatch.textStyle ?? "paragraph",
          fields: {
            es: rowPatch.sourceText ?? `source ${rowId}`,
            vi: rowPatch.targetText ?? `target ${rowId}`,
          },
          footnotes: {
            es: rowPatch.footnoteSourceText ?? "",
            vi: rowPatch.footnoteTargetText ?? "",
          },
          imageCaptions: {
            es: rowPatch.imageCaptionSourceText ?? "",
            vi: rowPatch.imageCaptionTargetText ?? "",
          },
          images: {
            es: rowPatch.sourceImage ?? null,
            vi: rowPatch.targetImage ?? null,
          },
          fieldStates: rowPatch.fieldStates ?? {
            es: { reviewed: false, pleaseCheck: false },
            vi: { reviewed: false, pleaseCheck: false },
          },
        },
      };
    }

    globalThis.__gnosisMockTauriHandlers = {
      ...(globalThis.__gnosisMockTauriHandlers ?? {}),
      async sync_gtms_project_editor_repo() {
        const fixture = globalThis.__gnosisBackgroundSyncFixture ?? {};
        return {
          changedRowIds: Array.isArray(fixture.changedRowIds) ? [...fixture.changedRowIds] : [],
          deletedRowIds: Array.isArray(fixture.deletedRowIds) ? [...fixture.deletedRowIds] : [],
          insertedRowIds: Array.isArray(fixture.insertedRowIds) ? [...fixture.insertedRowIds] : [],
          newHeadSha:
            typeof fixture.newHeadSha === "string" && fixture.newHeadSha.trim()
              ? fixture.newHeadSha.trim()
              : nextHeadSha,
        };
      },
      async load_gtms_editor_row(payload) {
        const input = payload?.input ?? {};
        const rowId = String(input.rowId ?? "");
        const fixture = globalThis.__gnosisBackgroundSyncFixture ?? {};
        const headSha =
          typeof fixture.newHeadSha === "string" && fixture.newHeadSha.trim()
            ? fixture.newHeadSha.trim()
            : nextHeadSha;
        return buildMockEditorRow(
          rowId,
          fixture.rowsById?.[rowId] ?? {},
          headSha,
        );
      },
    };
  }, {
    nextChangedRowIds: changedRowIds,
    nextDeletedRowIds: deletedRowIds,
    nextInsertedRowIds: insertedRowIds,
    nextRowsById: rowsById,
    nextHeadSha: newHeadSha,
  });
}

async function installLargeBatchBackgroundReloadMock(page, options = {}) {
  const {
    changedRowIds = [],
    rowsById = {},
    newHeadSha = "mock-sync-head-large-batch",
    loadDelayMs = 200,
  } = options;

  await page.evaluate(({
    nextChangedRowIds,
    nextRowsById,
    nextHeadSha,
    nextLoadDelayMs,
  }) => {
    function cloneRowForChapterLoad(row, rowPatch = {}) {
      return {
        rowId: row.rowId,
        orderKey: row.orderKey,
        lifecycleState: row.lifecycleState === "deleted" ? "deleted" : "active",
        commentCount: Number.isInteger(row.commentCount) ? row.commentCount : 0,
        commentsRevision: Number.isInteger(row.commentsRevision) ? row.commentsRevision : 0,
        textStyle: row.textStyle ?? "paragraph",
        fields: {
          ...(row.fields ?? {}),
          ...(typeof rowPatch.sourceText === "string" ? { es: rowPatch.sourceText } : {}),
          ...(typeof rowPatch.targetText === "string" ? { vi: rowPatch.targetText } : {}),
        },
        footnotes: {
          ...(row.footnotes ?? {}),
          ...(typeof rowPatch.footnoteSourceText === "string" ? { es: rowPatch.footnoteSourceText } : {}),
          ...(typeof rowPatch.footnoteTargetText === "string" ? { vi: rowPatch.footnoteTargetText } : {}),
        },
        imageCaptions: {
          ...(row.imageCaptions ?? {}),
          ...(typeof rowPatch.imageCaptionSourceText === "string" ? { es: rowPatch.imageCaptionSourceText } : {}),
          ...(typeof rowPatch.imageCaptionTargetText === "string" ? { vi: rowPatch.imageCaptionTargetText } : {}),
        },
        images: {
          ...(row.images ?? {}),
          ...(typeof rowPatch.sourceImage !== "undefined" ? { es: rowPatch.sourceImage } : {}),
          ...(typeof rowPatch.targetImage !== "undefined" ? { vi: rowPatch.targetImage } : {}),
        },
        fieldStates: rowPatch.fieldStates ?? { ...(row.fieldStates ?? {}) },
      };
    }

    globalThis.__gnosisMockTauriHandlers = {
      ...(globalThis.__gnosisMockTauriHandlers ?? {}),
      async sync_gtms_project_editor_repo() {
        return {
          changedRowIds: [...nextChangedRowIds],
          deletedRowIds: [],
          insertedRowIds: [],
          newHeadSha: nextHeadSha,
        };
      },
      async load_gtms_chapter_editor_data() {
        const editorState = window.__gnosisDebug.readEditorState();
        const rows = Array.isArray(editorState?.rows)
          ? editorState.rows.map((row) => cloneRowForChapterLoad(
            row,
            nextRowsById?.[row.rowId] ?? {},
          ))
          : [];
        if (Number.isFinite(nextLoadDelayMs) && nextLoadDelayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, nextLoadDelayMs));
        }
        return {
          chapterId: editorState.chapterId,
          chapterBaseCommitSha: nextHeadSha,
          fileTitle: editorState.fileTitle ?? "Fixture Chapter",
          languages: Array.isArray(editorState.languages) ? editorState.languages : [],
          sourceWordCounts:
            editorState.sourceWordCounts && typeof editorState.sourceWordCounts === "object"
              ? editorState.sourceWordCounts
              : {},
          rows,
        };
      },
    };
  }, {
    nextChangedRowIds: changedRowIds,
    nextRowsById: rowsById,
    nextHeadSha: newHeadSha,
    nextLoadDelayMs: loadDelayMs,
  });
}

async function installImportedConflictBackgroundReloadMock(page, options = {}) {
  const {
    targetRowId,
    conflictKind = "text-conflict",
    localRowPatch = {},
    remoteRowPatch = {},
    newHeadSha = "mock-sync-head-imported-conflict",
    loadDelayMs = 200,
  } = options;

  await page.evaluate(({
    nextTargetRowId,
    nextConflictKind,
    nextLocalRowPatch,
    nextRemoteRowPatch,
    nextHeadSha,
    nextLoadDelayMs,
  }) => {
    function cloneRowForChapterLoad(row) {
      return {
        rowId: row.rowId,
        orderKey: row.orderKey,
        lifecycleState: row.lifecycleState === "deleted" ? "deleted" : "active",
        commentCount: Number.isInteger(row.commentCount) ? row.commentCount : 0,
        commentsRevision: Number.isInteger(row.commentsRevision) ? row.commentsRevision : 0,
        textStyle: row.textStyle ?? "paragraph",
        fields: { ...(row.fields ?? {}) },
        footnotes: { ...(row.footnotes ?? {}) },
        imageCaptions: { ...(row.imageCaptions ?? {}) },
        images: { ...(row.images ?? {}) },
        fieldStates: { ...(row.fieldStates ?? {}) },
      };
    }

    function applyRowPatch(row, rowPatch = {}) {
      return {
        ...cloneRowForChapterLoad(row),
        fields: {
          ...(row.fields ?? {}),
          ...(typeof rowPatch.sourceText === "string" ? { es: rowPatch.sourceText } : {}),
          ...(typeof rowPatch.targetText === "string" ? { vi: rowPatch.targetText } : {}),
        },
        footnotes: {
          ...(row.footnotes ?? {}),
          ...(typeof rowPatch.footnoteSourceText === "string" ? { es: rowPatch.footnoteSourceText } : {}),
          ...(typeof rowPatch.footnoteTargetText === "string" ? { vi: rowPatch.footnoteTargetText } : {}),
        },
        imageCaptions: {
          ...(row.imageCaptions ?? {}),
          ...(typeof rowPatch.imageCaptionSourceText === "string" ? { es: rowPatch.imageCaptionSourceText } : {}),
          ...(typeof rowPatch.imageCaptionTargetText === "string" ? { vi: rowPatch.imageCaptionTargetText } : {}),
        },
        images: {
          ...(row.images ?? {}),
          ...(typeof rowPatch.sourceImage !== "undefined" ? { es: rowPatch.sourceImage } : {}),
          ...(typeof rowPatch.targetImage !== "undefined" ? { vi: rowPatch.targetImage } : {}),
        },
        fieldStates:
          rowPatch.fieldStates && typeof rowPatch.fieldStates === "object"
            ? rowPatch.fieldStates
            : { ...(row.fieldStates ?? {}) },
      };
    }

    globalThis.__gnosisMockTauriHandlers = {
      ...(globalThis.__gnosisMockTauriHandlers ?? {}),
      async sync_gtms_project_editor_repo() {
        const editorState = window.__gnosisDebug.readEditorState();
        const chapterId =
          typeof editorState?.chapterId === "string" && editorState.chapterId.trim()
            ? editorState.chapterId.trim()
            : "fixture-chapter";
        return {
          repoSyncStatus: "importedEditorConflicts",
          affectedChapterIds: [chapterId],
          importedConflicts: [{
            chapterId,
            rowId: nextTargetRowId,
            rowPath: `chapters/${chapterId}/rows/${nextTargetRowId}.json`,
            conflictKind: nextConflictKind,
          }],
          changedRowIds: [],
          deletedRowIds: [],
          insertedRowIds: [],
          newHeadSha: nextHeadSha,
        };
      },
      async load_gtms_chapter_editor_data() {
        const editorState = window.__gnosisDebug.readEditorState();
        const rows = Array.isArray(editorState?.rows)
          ? editorState.rows.map((row) => {
            const baseRow = cloneRowForChapterLoad(row);
            if (row?.rowId !== nextTargetRowId) {
              return baseRow;
            }

            return {
              ...applyRowPatch(baseRow, nextLocalRowPatch),
              importedConflict: {
                conflictKind: nextConflictKind,
                baseRow,
                remoteRow: applyRowPatch(baseRow, nextRemoteRowPatch),
              },
            };
          })
          : [];
        if (Number.isFinite(nextLoadDelayMs) && nextLoadDelayMs > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, nextLoadDelayMs));
        }
        return {
          chapterId: editorState.chapterId,
          chapterBaseCommitSha: nextHeadSha,
          fileTitle: editorState.fileTitle ?? "Fixture Chapter",
          languages: Array.isArray(editorState.languages) ? editorState.languages : [],
          sourceWordCounts:
            editorState.sourceWordCounts && typeof editorState.sourceWordCounts === "object"
              ? editorState.sourceWordCounts
              : {},
          rows,
        };
      },
    };
  }, {
    nextTargetRowId: targetRowId,
    nextConflictKind: conflictKind,
    nextLocalRowPatch: localRowPatch,
    nextRemoteRowPatch: remoteRowPatch,
    nextHeadSha: newHeadSha,
    nextLoadDelayMs: loadDelayMs,
  });
}

async function readEditorScrollDebugEntries(page) {
  return await page.evaluate(() => window.__gnosisDebug.readEditorScrollDebugEntries());
}

function hasTranslateBodyRerender(debugEntries) {
  return debugEntries.some(
    (entry) => entry.event === "translate-body-rerender" || entry.event === "translate-full-rerender",
  );
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

async function patchFixtureRow(page, rowId, updates = {}) {
  return await page.evaluate(async ({ targetRowId, nextUpdates }) => {
    return await window.__gnosisDebug.patchFixtureRow(targetRowId, nextUpdates);
  }, {
    targetRowId: rowId,
    nextUpdates: updates,
  });
}

async function measureGlossaryAlignment(page, options) {
  return await page.evaluate(async (input) => {
    return await window.__gnosisDebug.measureEditorGlossaryAlignment(input);
  }, options);
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

async function readMountedRowNodeSnapshot(page) {
  return await page.evaluate(() => {
    const itemsContainer = document.querySelector("[data-editor-virtual-items]");
    const rowCards = itemsContainer?.querySelectorAll?.("[data-editor-row-card]") ?? [];
    window.__gnosisPlaywrightRowNodeCounter =
      Number.isInteger(window.__gnosisPlaywrightRowNodeCounter)
        ? window.__gnosisPlaywrightRowNodeCounter
        : 0;

    return [...rowCards].map((rowCard) => {
      if (!(rowCard instanceof HTMLElement)) {
        return null;
      }

      if (!rowCard.dataset.playwrightNodeId) {
        window.__gnosisPlaywrightRowNodeCounter += 1;
        rowCard.dataset.playwrightNodeId = `row-node-${window.__gnosisPlaywrightRowNodeCounter}`;
      }

      return {
        rowId: rowCard.dataset.rowId ?? "",
        nodeId: rowCard.dataset.playwrightNodeId,
      };
    }).filter(Boolean);
  });
}

async function readTopVisibleRowMetrics(page) {
  return await page.evaluate(() => {
    const container = document.querySelector(".translate-main-scroll");
    if (!(container instanceof HTMLElement)) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    const rows = [...document.querySelectorAll("[data-editor-row-card]")]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.bottom > containerRect.top && rect.top < containerRect.bottom)
      .sort((left, right) => left.rect.top - right.rect.top);
    const rowCandidate = rows.find(({ rect }) => rect.bottom > containerRect.top) ?? rows[0] ?? null;
    if (!(rowCandidate?.element instanceof HTMLElement)) {
      return null;
    }

    return {
      rowId: rowCandidate.element.dataset.rowId ?? "",
      rowTop: rowCandidate.rect.top - containerRect.top,
      rowBottom: rowCandidate.rect.bottom - containerRect.top,
    };
  });
}

async function readVisibleRowGapMetrics(page) {
  return await page.evaluate(() => {
    const container = document.querySelector(".translate-main-scroll");
    if (!(container instanceof HTMLElement)) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    const rows = [...document.querySelectorAll("[data-editor-row-card]")]
      .map((rowCard) => {
        if (!(rowCard instanceof HTMLElement)) {
          return null;
        }

        const rect = rowCard.getBoundingClientRect();
        return {
          rowId: rowCard.dataset.rowId ?? "",
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
        };
      })
      .filter((row) => row && row.bottom > containerRect.top && row.top < containerRect.bottom)
      .sort((left, right) => left.top - right.top);
    let maxInteriorGap = 0;
    for (let index = 1; index < rows.length; index += 1) {
      maxInteriorGap = Math.max(maxInteriorGap, rows[index].top - rows[index - 1].bottom);
    }

    const topCoverageGap =
      rows.length > 0
        ? Math.max(0, rows[0].top - containerRect.top)
        : containerRect.height;
    const bottomCoverageGap =
      rows.length > 0
        ? Math.max(0, containerRect.bottom - rows[rows.length - 1].bottom)
        : containerRect.height;
    const topSpacer = document.querySelector('[data-editor-virtual-spacer="top"]');
    const bottomSpacer = document.querySelector('[data-editor-virtual-spacer="bottom"]');

    return {
      rowCount: rows.length,
      maxInteriorGap,
      topCoverageGap,
      bottomCoverageGap,
      maxViewportGap: Math.max(maxInteriorGap, topCoverageGap, bottomCoverageGap),
      topSpacerHeight: topSpacer instanceof HTMLElement ? topSpacer.getBoundingClientRect().height : 0,
      bottomSpacerHeight: bottomSpacer instanceof HTMLElement ? bottomSpacer.getBoundingClientRect().height : 0,
    };
  });
}

async function readRowLayoutMetrics(page, rowId, nextRowId) {
  return await page.evaluate(({ targetRowId, targetNextRowId }) => {
    const container = document.querySelector(".translate-main-scroll");
    const rowCard = document.querySelector(`[data-editor-row-card][data-row-id="${targetRowId}"]`);
    const nextRowCard = document.querySelector(`[data-editor-row-card][data-row-id="${targetNextRowId}"]`);
    const topSpacer = document.querySelector('[data-editor-virtual-spacer="top"]');
    const bottomSpacer = document.querySelector('[data-editor-virtual-spacer="bottom"]');
    if (
      !(container instanceof HTMLElement)
      || !(rowCard instanceof HTMLElement)
      || !(nextRowCard instanceof HTMLElement)
    ) {
      return null;
    }

    const rowRect = rowCard.getBoundingClientRect();
    const nextRowRect = nextRowCard.getBoundingClientRect();
    return {
      targetHeight: rowRect.height,
      targetTop: rowRect.top,
      targetBottom: rowRect.bottom,
      nextTop: nextRowRect.top,
      gapAfterTarget: nextRowRect.top - rowRect.bottom,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      topSpacerHeight: topSpacer instanceof HTMLElement ? topSpacer.getBoundingClientRect().height : 0,
      bottomSpacerHeight: bottomSpacer instanceof HTMLElement ? bottomSpacer.getBoundingClientRect().height : 0,
    };
  }, {
    targetRowId: rowId,
    targetNextRowId: nextRowId,
  });
}

async function readSingleRowLayoutMetrics(page, rowId) {
  return await page.evaluate(({ targetRowId }) => {
    const container = document.querySelector(".translate-main-scroll");
    const rowCard = document.querySelector(`[data-editor-row-card][data-row-id="${targetRowId}"]`);
    const topSpacer = document.querySelector('[data-editor-virtual-spacer="top"]');
    const bottomSpacer = document.querySelector('[data-editor-virtual-spacer="bottom"]');
    if (!(container instanceof HTMLElement) || !(rowCard instanceof HTMLElement)) {
      return null;
    }

    const rowRect = rowCard.getBoundingClientRect();
    return {
      targetHeight: rowRect.height,
      targetTop: rowRect.top,
      targetBottom: rowRect.bottom,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
      topSpacerHeight: topSpacer instanceof HTMLElement ? topSpacer.getBoundingClientRect().height : 0,
      bottomSpacerHeight: bottomSpacer instanceof HTMLElement ? bottomSpacer.getBoundingClientRect().height : 0,
    };
  }, {
    targetRowId: rowId,
  });
}

async function countGlossaryMarksForRow(page, rowId) {
  return await page.locator(
    `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-glossary-mark]`,
  ).count();
}

async function readEditorSelectionStart(page, rowId, languageCode, contentKind = "field") {
  return await page.evaluate(({ rowId: targetRowId, languageCode: targetLanguageCode, contentKind: targetContentKind }) => {
    const contentSelector =
      targetContentKind === "footnote"
        ? '[data-content-kind="footnote"]'
        : targetContentKind === "image-caption"
          ? '[data-content-kind="image-caption"]'
          : ":not([data-content-kind])";
    const field = document.querySelector(
      `[data-editor-row-field][data-row-id="${targetRowId}"][data-language-code="${targetLanguageCode}"]${contentSelector}`,
    );
    return field instanceof HTMLTextAreaElement ? field.selectionStart : null;
  }, { rowId, languageCode, contentKind });
}

async function setEditorSelectionRange(
  page,
  rowId,
  languageCode,
  start,
  end,
  contentKind = "field",
) {
  await page.evaluate(({
    rowId: targetRowId,
    languageCode: targetLanguageCode,
    contentKind: targetContentKind,
    start: targetStart,
    end: targetEnd,
  }) => {
    const contentSelector =
      targetContentKind === "footnote"
        ? '[data-content-kind="footnote"]'
        : targetContentKind === "image-caption"
          ? '[data-content-kind="image-caption"]'
          : ":not([data-content-kind])";
    const field = document.querySelector(
      `[data-editor-row-field][data-row-id="${targetRowId}"][data-language-code="${targetLanguageCode}"]${contentSelector}`,
    );
    if (!(field instanceof HTMLTextAreaElement)) {
      return;
    }

    field.focus();
    field.setSelectionRange(targetStart, targetEnd);
  }, {
    rowId,
    languageCode,
    contentKind,
    start,
    end,
  });
}

async function readEditorFieldValue(page, rowId, languageCode, contentKind = "field") {
  return await page.evaluate(({ rowId: targetRowId, languageCode: targetLanguageCode, contentKind: targetContentKind }) => {
    const contentSelector =
      targetContentKind === "footnote"
        ? '[data-content-kind="footnote"]'
        : targetContentKind === "image-caption"
          ? '[data-content-kind="image-caption"]'
          : ":not([data-content-kind])";
    const field = document.querySelector(
      `[data-editor-row-field][data-row-id="${targetRowId}"][data-language-code="${targetLanguageCode}"]${contentSelector}`,
    );
    return field instanceof HTMLTextAreaElement ? field.value : null;
  }, { rowId, languageCode, contentKind });
}

async function readActiveEditorFieldSnapshot(page) {
  return await page.evaluate(() => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLTextAreaElement) || !activeElement.matches("[data-editor-row-field]")) {
      return null;
    }

    return {
      rowId: activeElement.dataset.rowId ?? "",
      languageCode: activeElement.dataset.languageCode ?? "",
      contentKind: activeElement.dataset.contentKind ?? "",
      value: activeElement.value,
      selectionStart: activeElement.selectionStart,
      selectionEnd: activeElement.selectionEnd,
    };
  });
}

async function activateMainEditorField(page, rowId, languageCode) {
  const textarea = page.locator(
    `[data-editor-row-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]:not([data-content-kind])`,
  );
  if (await textarea.count()) {
    return textarea;
  }

  const displayField = page.locator(
    `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
  );
  await clickLocatorCenter(page, displayField);
  await expect(textarea).toBeVisible();
  return textarea;
}

async function activateImageCaptionEditor(page, rowId, languageCode) {
  const textarea = page.locator(
    `[data-editor-row-field][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-content-kind="image-caption"]`,
  );
  if (await textarea.count()) {
    return textarea;
  }

  const button = page.locator(
    `[data-action="open-editor-image-caption"][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
  );
  await clickLocatorCenter(page, button);
  await expect(textarea).toBeVisible();
  return textarea;
}

async function clickLocatorCenter(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await locator.click({
    position: {
      x: box.width / 2,
      y: box.height / 2,
    },
  });
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

async function scrollTranslateRowNearTop(page, rowId, offset = 120) {
  await page.evaluate(({ targetRowId, targetOffset }) => {
    const container = document.querySelector(".translate-main-scroll");
    const row = document.querySelector(`[data-editor-row-card][data-row-id="${targetRowId}"]`);
    if (!(container instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      return;
    }

    container.scrollTop = Math.max(0, row.offsetTop - targetOffset);
    container.dispatchEvent(new Event("scroll"));
  }, { targetRowId: rowId, targetOffset: offset });
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
    await expect(page.locator(".history-tabs__item")).toContainText(["AI Assistant", "Review", "History", "Comments"]);
    await expect(page.locator(".translate-ai-action-button")).toHaveCount(1);
    await expect(page.locator(".translate-ai-action-button__model")).toHaveCount(1);
    await expect(page.locator(".translate-ai-action-button__model")).not.toHaveText("");
    await expect(page.locator(".translate-ai-action-button")).not.toContainText("Translate 1");
    await expect(page.locator(".translate-ai-action-button")).not.toContainText("Translate 2");
  });

  test("AI Assistant tab renders persisted transcript items and the chat composer", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      assistant: {
        threadsByKey: {
          "fixture-row-0001::vi": {
            rowId: "fixture-row-0001",
            targetLanguageCode: "vi",
            items: [{
              id: "assistant-1",
              type: "assistant-message",
              createdAt: "2026-04-21T12:00:00.000Z",
              text: "The source line is describing an inner transformation.",
              summary: "The source line is describing an inner transformation.",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              details: {
                providerId: "openai",
                modelId: "gpt-5.4",
                sourceText: "alpha 0001 source text",
              },
            }],
          },
        },
      },
    });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    await expect(page.locator(".assistant-item")).toContainText("inner transformation");
    await expect(page.locator("[data-editor-assistant-draft]")).toBeVisible();
    await expect(page.locator('[data-action="run-editor-ai-assistant"]')).toBeVisible();
  });

  test("translate action shows a spinner while translation is running", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 6,
      glossaryTerms: [
        {
          sourceTerms: ["alpha 0001 source text"],
          targetTerms: ["alpha 0001 target text"],
        },
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
      page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-editor-language-cluster][data-row-id="fixture-row-0001"][data-language-code="vi"] [data-editor-display-text]'),
    ).toHaveText("Translating...");
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
      page.locator('[data-editor-language-cluster][data-row-id="fixture-row-0001"][data-language-code="vi"] [data-editor-display-text]'),
    ).toHaveText("alpha 0001 target text");
    await expect(
      page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="fr"]:not([data-content-kind])'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-editor-language-cluster][data-row-id="fixture-row-0001"][data-language-code="fr"] [data-editor-display-text]'),
    ).toHaveText("Translating...");
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
      glossaryTerms: [
        {
          sourceTerms: ["alpha 0001 source text"],
          targetTerms: ["alpha 0001 target text"],
        },
      ],
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

    await expect(
      page.locator('[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-editor-language-cluster][data-row-id="fixture-row-0001"][data-language-code="vi"] [data-editor-display-text]'),
    ).toHaveText("Translating...");

    await page.evaluate(() => {
      window.__releaseMockTranslation?.();
    });

    await expect(
      page.locator('[data-editor-language-cluster][data-row-id="fixture-row-0001"][data-language-code="vi"] [data-editor-display-text]'),
    ).toHaveText("Da xong");
  });

  test("starting ai translation on an existing translated row keeps the scroll position stable", async ({ page }) => {
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
            translatedText: "Updated translation",
          };
        },
      };
    });

    await mountEditorFixture(page, {
      rowCount: 18,
      glossaryTerms: [
        {
          sourceTerms: ["alpha 0010 source text"],
          targetTerms: ["alpha 0010 target text"],
        },
      ],
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
    }, { mockTauri: true });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();

    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    await scrollTranslateRowNearTop(page, rowId);
    const activeField = await activateMainEditorField(page, rowId, languageCode);
    await expect(activeField).toBeVisible();
    await activeField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });

    const beforeScrollTop = await readTranslateScrollTop(page);
    const translateButton = page.locator('[data-action="run-editor-ai-translate:translate1"]');
    await translateButton.click();

    await expect(translateButton).toHaveAttribute("aria-busy", "true");
    await expect(
      page.locator(`[data-editor-row-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]:not([data-content-kind])`),
    ).toHaveCount(0);
    await expect(
      page.locator(`[data-editor-language-cluster][data-row-id="${rowId}"][data-language-code="${languageCode}"] [data-editor-display-text]`),
    ).toHaveText("Translating...");
    await expect.poll(async () => {
      return Math.abs((await readTranslateScrollTop(page)) - beforeScrollTop);
    }).toBeLessThan(4);

    await page.evaluate(() => {
      window.__releaseMockTranslation?.();
    });

    await expect(
      page.locator(`[data-editor-language-cluster][data-row-id="${rowId}"][data-language-code="${languageCode}"] [data-editor-display-text]`),
    ).toHaveText("Updated translation");
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

  test("glossary marks are present in the initial static row render before deferred sync runs", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        globalThis.localStorage?.clear();
      } catch {
        // Ignore local-storage access restrictions in the browser harness.
      }
    });

    await page.goto("/?platform=windows");
    await page.waitForFunction(() => typeof window.__gnosisDebug?.mountEditorFixture === "function");
    const initialGlossaryMarkCount = await page.evaluate(async () => {
      await window.__gnosisDebug.waitForBootstrap();
      await window.__gnosisDebug.mountEditorFixture({
        rowCount: 1,
        glossary: true,
      });
      return document.querySelectorAll(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-glossary-mark]',
      ).length;
    });

    expect(initialGlossaryMarkCount).toBe(2);
    await expect(page.locator("[data-editor-search-input]")).toBeVisible();
  });

  test("editor glossary header action opens the linked glossary and shows editor-first glossary navigation", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__gnosisMockTauriHandlers = {
        async load_gtms_glossary_editor_data() {
          return {
            glossaryId: "fixture-glossary",
            title: "Fixture Glossary",
            sourceLanguage: {
              code: "es",
              name: "Spanish",
            },
            targetLanguage: {
              code: "vi",
              name: "Vietnamese",
            },
            termCount: 1,
            terms: [
              {
                termId: "term-1",
                sourceTerms: ["alpha"],
                targetTerms: ["alpha"],
                notesToTranslators: "",
                footnote: "",
              },
            ],
          };
        },
      };
    });

    await mountEditorFixture(page, { rowCount: 6, glossary: true }, { mockTauri: true });

    const glossaryButton = page.locator('[data-action="open-editor-glossary"]');
    await expect(glossaryButton).toHaveText("Glossary");
    await expect(page.locator('[data-nav-target="glossaries"]')).toHaveCount(0);

    await glossaryButton.click();

    await expect(page.locator("h1.page-header__title")).toHaveText("Fixture Glossary");
    await expect(page.locator('[data-nav-target="translate"]')).toHaveText("Editor Regression Fixture");
    await expect(page.locator('[data-nav-target="glossaries"]')).toHaveCount(0);
    await expect(page.locator('[data-nav-target="projects"]')).toHaveCount(0);
  });

  test("inactive glossary highlights render in the display text while the search overlay stays transparent", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 1, glossary: true }, { path: "/?platform=windows" });

    await expect.poll(async () => {
      return await countGlossaryMarksForRow(page, "fixture-row-0001");
    }).toBe(2);

    const styles = await page.evaluate(() => {
      const field = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="vi"]',
      );
      const searchLayer = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-search-highlight]',
      );
      const mainTextarea = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-row-field][data-language-code="vi"]:not([data-content-kind])',
      );
      if (!(field instanceof HTMLButtonElement) || !(searchLayer instanceof HTMLElement)) {
        return null;
      }

      const fieldStyle = getComputedStyle(field);
      const searchStyle = getComputedStyle(searchLayer);
      return {
        hasMainTextarea: mainTextarea instanceof HTMLTextAreaElement,
        fieldColor: fieldStyle.color,
        fieldTextFillColor: fieldStyle.webkitTextFillColor,
        searchColor: searchStyle.color,
        searchTextFillColor: searchStyle.webkitTextFillColor,
      };
    });

    expect(styles).not.toBeNull();
    const transparentColorPattern =
      /^(?:transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\))$/i;
    expect(styles.hasMainTextarea).toBe(false);
    expect(styles.fieldColor).not.toMatch(transparentColorPattern);
    expect(styles.fieldTextFillColor).not.toMatch(transparentColorPattern);
    expect(styles.searchColor).toMatch(transparentColorPattern);
    expect(styles.searchTextFillColor).toMatch(transparentColorPattern);
  });

  test("inactive glossary marks inherit the display text shaping controls", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 1, glossary: true }, { path: "/?platform=windows" });

    await expect.poll(async () => {
      return await countGlossaryMarksForRow(page, "fixture-row-0001");
    }).toBe(2);

    const styles = await page.evaluate(() => {
      const field = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="vi"]',
      );
      const glossaryMark = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-glossary-mark]',
      );
      if (!(field instanceof HTMLButtonElement) || !(glossaryMark instanceof HTMLElement)) {
        return null;
      }

      const fieldStyle = getComputedStyle(field);
      const markStyle = getComputedStyle(glossaryMark);
      return {
        fieldKerning: fieldStyle.fontKerning,
        markKerning: markStyle.fontKerning,
        fieldLigatures: fieldStyle.fontVariantLigatures,
        markLigatures: markStyle.fontVariantLigatures,
        fieldWhiteSpace: fieldStyle.whiteSpace,
        markWhiteSpace: markStyle.whiteSpace,
        fieldWordBreak: fieldStyle.wordBreak,
        markWordBreak: markStyle.wordBreak,
        fieldOverflowWrap: fieldStyle.overflowWrap,
        markOverflowWrap: markStyle.overflowWrap,
        markVerticalAlign: markStyle.verticalAlign,
        markSkipInk: markStyle.textDecorationSkipInk,
      };
    });

    expect(styles).not.toBeNull();
    expect(styles.fieldKerning).toBe("none");
    expect(styles.markKerning).toBe(styles.fieldKerning);
    expect(styles.fieldLigatures).not.toBe("normal");
    expect(styles.markLigatures).toBe(styles.fieldLigatures);
    expect(styles.markWhiteSpace).toBe(styles.fieldWhiteSpace);
    expect(styles.markWordBreak).toBe(styles.fieldWordBreak);
    expect(styles.markOverflowWrap).toBe(styles.fieldOverflowWrap);
    expect(styles.markVerticalAlign).toBe("baseline");
    expect(styles.markSkipInk).toBe("none");
  });

  test("source glossary mismatch marks render in red in static view and disappear while editing", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      glossaryTerms: [
        {
          sourceTerms: ["meditacion"],
          targetTerms: ["thien dinh"],
        },
      ],
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "Practica de meditacion",
          vi: "Thuc hanh",
        },
      },
    }, { path: "/?platform=windows" });

    const rowId = "fixture-row-0001";
    const languageCode = "es";
    const markSelector =
      `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-display-field][data-language-code="${languageCode}"] .translation-language-panel__glossary-mark.glossary-match-error`;

    await expect.poll(async () => {
      return await page.locator(markSelector).count();
    }).toBe(1);

    const styles = await page.evaluate((selector) => {
      const mark = document.querySelector(selector);
      if (!(mark instanceof HTMLElement)) {
        return null;
      }

      const markStyle = getComputedStyle(mark);
      return {
        color: markStyle.color,
        textFillColor: markStyle.webkitTextFillColor,
        textDecorationColor: markStyle.textDecorationColor,
      };
    }, markSelector);

    expect(styles).toEqual({
      color: "rgba(190, 61, 31, 0.92)",
      textFillColor: "rgba(190, 61, 31, 0.92)",
      textDecorationColor: "rgba(190, 61, 31, 0.78)",
    });

    const sourceField = await activateMainEditorField(page, rowId, languageCode);
    await expect(sourceField).toBeVisible();
    const activeMarkSelector =
      `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-language-cluster][data-language-code="${languageCode}"] [data-editor-glossary-highlight] .translation-language-panel__glossary-mark.glossary-match-error`;
    await expect(page.locator(activeMarkSelector)).toHaveCount(0);

    await page.locator("[data-editor-search-input]").click();
    await expect(page.locator(markSelector)).toHaveCount(1);
  });

  test("static glossary mismatch markup collapses nested underline styling into a single layer", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      glossaryTerms: [
        {
          sourceTerms: ["devoto"],
          targetTerms: ["devotee"],
        },
      ],
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "<u>devoto</u>",
          vi: "",
        },
      },
    }, { path: "/?platform=windows" });

    const styles = await page.evaluate(() => {
      const underline = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="es"] u',
      );
      const mark = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="es"] .translation-language-panel__glossary-mark.glossary-match-error',
      );
      if (!(underline instanceof HTMLElement) || !(mark instanceof HTMLElement)) {
        return null;
      }

      const underlineStyle = getComputedStyle(underline);
      const markStyle = getComputedStyle(mark);
      return {
        underlineLine: underlineStyle.textDecorationLine,
        underlineColor: underlineStyle.textDecorationColor,
        markLine: markStyle.textDecorationLine,
        markColor: markStyle.textDecorationColor,
      };
    });

    expect(styles).not.toBeNull();
    expect(styles.underlineLine).toBe("none");
    expect(styles.markLine).toBe("underline");
    expect(styles.markColor).toBe("rgba(190, 61, 31, 0.78)");
  });

  test("ai translation refreshes target glossary underlines after inserting translation text", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__gnosisMockTauriHandlers = {
        load_ai_provider_secret() {
          return "openai-key";
        },
        async run_ai_translation() {
          return {
            translatedText: "alpha translated by ai",
          };
        },
      };
    });

    await mountEditorFixture(page, {
      rowCount: 1,
      glossary: true,
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "alpha source text",
          vi: "",
        },
      },
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
    }, { path: "/?platform=windows", mockTauri: true });

    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    const targetField = await activateMainEditorField(page, rowId, languageCode);
    await expect(targetField).toBeVisible();

    await page.evaluate(async () => {
      await window.__gnosisDebug.runEditorAiTranslate("translate1");
    });

    const targetDisplayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await expect(targetDisplayField).toHaveText("alpha translated by ai");

    const targetMarkSelector =
      `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-display-field][data-language-code="${languageCode}"] [data-editor-glossary-mark]`;
    await expect.poll(async () => {
      return await page.locator(targetMarkSelector).count();
    }).toBe(1);
    await expect(page.locator(targetMarkSelector)).toHaveText("alpha");
  });

  test("clicking ai translate refreshes target glossary underlines in the real sidebar flow", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__gnosisMockTauriHandlers = {
        load_ai_provider_secret() {
          return "openai-key";
        },
        async run_ai_translation() {
          return {
            translatedText: "alpha translated by ai",
          };
        },
      };
    });

    await mountEditorFixture(page, {
      rowCount: 1,
      glossary: true,
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "alpha source text",
          vi: "",
        },
      },
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
    }, { path: "/?platform=windows", mockTauri: true });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();

    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    const targetField = await activateMainEditorField(page, rowId, languageCode);
    await expect(targetField).toBeVisible();

    await page.locator('[data-action="run-editor-ai-translate:translate1"]').click();

    const targetDisplayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await expect(targetDisplayField).toHaveText("alpha translated by ai");

    const targetMarkSelector =
      `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-display-field][data-language-code="${languageCode}"] [data-editor-glossary-mark]`;
    await expect.poll(async () => {
      return await page.locator(targetMarkSelector).count();
    }).toBe(1);
    await expect(page.locator(targetMarkSelector)).toHaveText("alpha");
  });

  test("history restore refreshes target glossary state and renders underlines after the target field closes", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__gnosisMockTauriHandlers = {
        load_gtms_editor_field_history() {
          return {
            entries: [{
              commitSha: "history-alpha",
              authorName: "Mock Backend",
              committedAt: "2026-04-13T00:00:00.000Z",
              message: "Restore glossary version",
              operationType: "editor-update",
              statusNote: null,
              aiModel: null,
              plainText: "alpha restored from history",
              footnote: "",
              textStyle: "paragraph",
              reviewed: false,
              pleaseCheck: false,
            }],
          };
        },
        restore_gtms_editor_field_from_history() {
          return {
            plainText: "alpha restored from history",
            footnote: "",
            imageCaption: "",
            image: null,
            textStyle: "paragraph",
            reviewed: false,
            pleaseCheck: false,
            sourceWordCounts: {},
          };
        },
      };
    });

    await mountEditorFixture(page, {
      rowCount: 1,
      glossary: true,
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "alpha source text",
          vi: "plain target text",
        },
      },
    }, { path: "/?platform=windows", mockTauri: true });

    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    const targetField = await activateMainEditorField(page, rowId, languageCode);
    await expect(targetField).toHaveValue("plain target text");

    await page.evaluate(async () => {
      await window.__gnosisDebug.restoreEditorFieldHistory("history-alpha");
    });

    await expect(targetField).toHaveValue("alpha restored from history");

    const activeTargetMarkSelector =
      `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-language-cluster][data-language-code="${languageCode}"] [data-editor-glossary-highlight] [data-editor-glossary-mark]`;
    await expect(page.locator(activeTargetMarkSelector)).toHaveCount(0);

    await page.locator("[data-editor-search-input]").click();

    const staticTargetMarkSelector =
      `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-display-field][data-language-code="${languageCode}"] [data-editor-glossary-mark]`;
    await expect.poll(async () => {
      return await page.locator(staticTargetMarkSelector).count();
    }).toBe(1);
    await expect(page.locator(staticTargetMarkSelector)).toHaveText("alpha");
  });

  test("derived glossary highlights and tooltip payloads appear after ai translation prepares a row glossary", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__gnosisMockTauriHandlers = {
        load_ai_provider_secret() {
          return "openai-key";
        },
        prepare_editor_ai_translated_glossary() {
          return {
            glossarySourceText: "La camara interior brilla.",
            entries: [{
              sourceTerm: "inner chamber",
              glossarySourceTerm: "camara interior",
              targetVariants: ["buong noi tam"],
              notes: ["Dung thuat ngu cua glossary"],
            }],
          };
        },
        async run_ai_translation() {
          return {
            translatedText: "Buong noi tam sang len.",
          };
        },
      };
    });

    await mountEditorFixture(page, {
      rowCount: 1,
      languages: [
        { code: "en", name: "English", role: "source" },
        { code: "es", name: "Spanish" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
      glossarySourceLanguageCode: "es",
      glossaryTargetLanguageCode: "vi",
      fieldsByRowId: {
        "fixture-row-0001": {
          en: "The inner chamber glows.",
          es: "La camara interior brilla.",
          vi: "",
        },
      },
      glossaryTerms: [
        {
          sourceTerms: ["camara interior"],
          targetTerms: ["buong noi tam"],
          notesToTranslators: "Dung thuat ngu cua glossary",
        },
      ],
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
    }, { path: "/?platform=windows", mockTauri: true });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    await page.locator('[data-action="run-editor-ai-translate:translate1"]').click();

    const sourceMarkSelector =
      '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="en"] [data-editor-glossary-mark]';

    await expect.poll(async () => {
      return await page.locator(sourceMarkSelector).count();
    }).toBe(1);

    const sourceMark = page.locator(sourceMarkSelector);
    await expect(sourceMark).toHaveText("inner chamber");
    await expect(sourceMark).not.toHaveClass(/glossary-match-error/);

    const tooltipPayload = await sourceMark.getAttribute("data-editor-glossary-tooltip-payload");
    expect(tooltipPayload).not.toBeNull();
    const payload = JSON.parse(
      tooltipPayload
        .replaceAll("&quot;", "\"")
        .replaceAll("&#39;", "'")
        .replaceAll("&amp;", "&"),
    );
    expect(payload).toEqual({
      kind: "source",
      title: "inner chamber",
      variants: ["buong noi tam"],
      translatorNotes: ["Dung thuat ngu cua glossary"],
      footnotes: [],
      originTerms: ["camara interior"],
    });
  });

  test("ai translation writes the prepared pivot text into the glossary-source row field before saving", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__gnosisMockTauriHandlers = {
        load_ai_provider_secret() {
          return "openai-key";
        },
        prepare_editor_ai_translated_glossary() {
          return {
            glossarySourceText: "La camara interior brilla.",
            entries: [{
              sourceTerm: "inner chamber",
              glossarySourceTerm: "camara interior",
              targetVariants: ["buong noi tam"],
              notes: ["Dung thuat ngu cua glossary"],
            }],
          };
        },
        async run_ai_translation() {
          return {
            translatedText: "Buong noi tam sang len.",
          };
        },
      };
    });

    await mountEditorFixture(page, {
      rowCount: 1,
      languages: [
        { code: "en", name: "English", role: "source" },
        { code: "es", name: "Spanish" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
      glossarySourceLanguageCode: "es",
      glossaryTargetLanguageCode: "vi",
      fieldsByRowId: {
        "fixture-row-0001": {
          en: "The inner chamber glows.",
          es: "",
          vi: "",
        },
      },
      glossaryTerms: [
        {
          sourceTerms: ["camara interior"],
          targetTerms: ["buong noi tam"],
          notesToTranslators: "Dung thuat ngu cua glossary",
        },
      ],
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
    }, { path: "/?platform=windows", mockTauri: true });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    await page.locator('[data-action="run-editor-ai-translate:translate1"]').click();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      const rowSaveInvocation = (mockState?.invocations ?? [])
        .find((entry) => entry.command === "update_gtms_editor_row_fields");
      return rowSaveInvocation?.payload?.input?.fields ?? null;
    }).toEqual({
      en: "The inner chamber glows.",
      es: "La camara interior brilla.",
      vi: "Buong noi tam sang len.",
    });

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::es"]?.[0]?.plainText ?? null;
    }).toBe("La camara interior brilla.");
  });

  test("derived glossary source highlights persist after the source text changes until the next ai translation recomputes them", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__gnosisMockTauriHandlers = {
        load_ai_provider_secret() {
          return "openai-key";
        },
        prepare_editor_ai_translated_glossary() {
          return {
            glossarySourceText: "La camara interior brilla.",
            entries: [{
              sourceTerm: "inner chamber",
              glossarySourceTerm: "camara interior",
              targetVariants: ["buong noi tam"],
              notes: ["Dung thuat ngu cua glossary"],
            }],
          };
        },
        async run_ai_translation() {
          return {
            translatedText: "Buong noi tam sang len.",
          };
        },
      };
    });

    await mountEditorFixture(page, {
      rowCount: 1,
      languages: [
        { code: "en", name: "English", role: "source" },
        { code: "es", name: "Spanish" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
      glossarySourceLanguageCode: "es",
      glossaryTargetLanguageCode: "vi",
      fieldsByRowId: {
        "fixture-row-0001": {
          en: "The inner chamber glows.",
          es: "",
          vi: "",
        },
      },
      glossaryTerms: [
        {
          sourceTerms: ["camara interior"],
          targetTerms: ["buong noi tam"],
          notesToTranslators: "Dung thuat ngu cua glossary",
        },
      ],
      aiActionConfig: {
        detailedConfiguration: false,
        unified: {
          providerId: "openai",
          modelId: "gpt-5.4",
        },
      },
    }, { path: "/?platform=windows", mockTauri: true });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    await page.locator('[data-action="run-editor-ai-translate:translate1"]').click();

    const sourceMarkSelector =
      '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="en"] [data-editor-glossary-mark]';

    await expect.poll(async () => {
      return await page.locator(sourceMarkSelector).count();
    }).toBe(1);

    const sourceField = await activateMainEditorField(page, "fixture-row-0001", "en");
    await sourceField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" brightly");

    await page.locator("[data-editor-search-input]").click();

    await expect.poll(async () => {
      return await page.locator(sourceMarkSelector).count();
    }).toBe(1);
    await expect(page.locator(sourceMarkSelector)).toHaveText("inner chamber");
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

  test("clicking a wrapped glossary mark uses the real caret position inside the wrapped line", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      glossaryTerms: [
        {
          sourceTerms: ["Dios Interior de nosotros desarrolla la conciencia espiritual en los sentidos internos"],
          targetTerms: ["Thượng Đế Nội Tâm của chúng ta ban phát triển tâm linh cho các giác quan bên trong"],
        },
      ],
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "Si contemplas al Dios Interior de nosotros desarrolla la conciencia espiritual en los sentidos internos y permaneces atento.",
          vi: "Giữ sự tập trung tự nhiên trong tim, bạn sẽ cầu xin Thượng Đế Nội Tâm của chúng ta ban phát triển tâm linh cho các giác quan bên trong để cảm nhận cái siêu việt của vạn vật.",
        },
      },
    }, { path: "/?platform=windows" });

    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    const markSelector =
      `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-display-field][data-language-code="${languageCode}"] [data-editor-glossary-mark]`;

    await expect.poll(async () => {
      return await page.locator(markSelector).count();
    }).toBe(1);

    const markGeometry = await page.evaluate((selector) => {
      const mark = document.querySelector(selector);
      if (!(mark instanceof HTMLElement)) {
        return null;
      }

      const rects = Array.from(mark.getClientRects()).map((rect) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }));

      return {
        start: Number.parseInt(mark.dataset.textStart ?? "", 10),
        end: Number.parseInt(mark.dataset.textEnd ?? "", 10),
        rects,
      };
    }, markSelector);

    expect(markGeometry).not.toBeNull();
    expect(markGeometry.rects.length).toBeGreaterThan(1);

    const clickPoint = {
      x: markGeometry.rects[1].right - Math.min(12, markGeometry.rects[1].width / 3),
      y: markGeometry.rects[1].top + (markGeometry.rects[1].height / 2),
    };

    const expectedSelectionStart = await page.evaluate(({ selector, x, y }) => {
      const mark = document.querySelector(selector);
      if (!(mark instanceof HTMLElement)) {
        return null;
      }

      const start = Number.parseInt(mark.dataset.textStart ?? "", 10);
      if (!Number.isInteger(start)) {
        return null;
      }

      const offsetFromDomPoint = (node, offset) => {
        if (!(node instanceof Node) || !mark.contains(node)) {
          return null;
        }

        const range = document.createRange();
        range.selectNodeContents(mark);
        try {
          range.setEnd(node, offset);
        } catch {
          return null;
        }

        return range.toString().length;
      };

      if (typeof document.caretPositionFromPoint === "function") {
        const caretPosition = document.caretPositionFromPoint(x, y);
        const offset = offsetFromDomPoint(caretPosition?.offsetNode ?? null, caretPosition?.offset ?? 0);
        if (Number.isInteger(offset)) {
          return start + offset;
        }
      }

      if (typeof document.caretRangeFromPoint === "function") {
        const caretRange = document.caretRangeFromPoint(x, y);
        const offset = offsetFromDomPoint(caretRange?.startContainer ?? null, caretRange?.startOffset ?? 0);
        if (Number.isInteger(offset)) {
          return start + offset;
        }
      }

      return null;
    }, { selector: markSelector, ...clickPoint });

    expect(expectedSelectionStart).not.toBeNull();

    await page.mouse.click(clickPoint.x, clickPoint.y);

    await expect.poll(async () => {
      return await readEditorSelectionStart(page, rowId, languageCode);
    }).toBe(expectedSelectionStart);

    await expect(page.locator(
      `[data-editor-row-card][data-row-id="${rowId}"] [data-editor-display-field][data-language-code="${languageCode}"]`,
    )).toHaveCount(0);

    expect(expectedSelectionStart).toBeLessThan(markGeometry.end);
  });

  test("active editor suppresses glossary underline overlays while preserving textarea language metrics", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      glossaryTerms: [
        { sourceTerms: ["Word"], targetTerms: ["Ngôi Lời"] },
        { sourceTerms: ["mysticism"], targetTerms: ["huyền học"] },
        { sourceTerms: ["Gnosis"], targetTerms: ["Gnosis"] },
        { sourceTerms: ["speech"], targetTerms: ["lời nói"] },
        { sourceTerms: ["mantra"], targetTerms: ["Thần chú"] },
      ],
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "Word mysticism Gnosis speech mantra Word speech.",
          vi: "Có một sự tương quan giữa trung tâm vận động này và Ngôi Lời. Trong huyền học Gnosis, người ta biết rõ rằng những biến dạng thể chất có nguyên nhân ở sự sử dụng sai Ngôi Lời hay lời nói. Ngôi Lời, như tinh hoa của thân thể, có thể chữa lành bạn hoặc giết chết bạn. Lời nói luôn luôn phải tuôn ra từ trái tim. Thần chú:",
        },
      },
    });

    const activeField = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await expect(activeField).toBeVisible();
    await expect(activeField).toBeFocused();
    await expect(page.locator(
      '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-glossary-highlight] [data-editor-glossary-mark]',
    )).toHaveCount(0);

    const layerAttributes = await page.evaluate(() => {
      const field = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-row-field][data-language-code="vi"]:not([data-content-kind])',
      );
      const glossaryLayer = document.querySelector(
        '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-glossary-highlight]',
      );
      if (!(field instanceof HTMLTextAreaElement) || !(glossaryLayer instanceof HTMLElement)) {
        return null;
      }

      const fieldStyle = getComputedStyle(field);
      return {
        fieldLanguage: field.lang,
        layerLanguage: glossaryLayer.lang,
        webkitAppearance: fieldStyle.webkitAppearance,
        appearance: fieldStyle.appearance,
      };
    });

    expect(layerAttributes).toEqual({
      fieldLanguage: "vi",
      layerLanguage: "vi",
      webkitAppearance: "none",
      appearance: "none",
    });
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

  test("patching a visible row updates only that row card", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    await mountEditorFixture(page, { rowCount: 80 });

    await setTranslateScrollTop(page, 9000);
    const targetRowCard = page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`);
    await expect(targetRowCard).toBeVisible();

    const beforeSnapshot = await readMountedRowNodeSnapshot(page);
    const beforeNodeIdByRowId = new Map(beforeSnapshot.map((entry) => [entry.rowId, entry.nodeId]));
    const patchText = "beta 0030 patched target text";

    const patchResult = await patchFixtureRow(page, targetRowId, {
      fields: {
        vi: patchText,
      },
    });

    expect(patchResult?.patchedVisible).toBe(true);
    expect(patchResult?.patchedRowIds).toEqual([targetRowId]);
    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText(patchText);

    const afterSnapshot = await readMountedRowNodeSnapshot(page);
    const afterNodeIdByRowId = new Map(afterSnapshot.map((entry) => [entry.rowId, entry.nodeId]));

    expect(afterNodeIdByRowId.get(targetRowId)).toBeTruthy();
    expect(afterNodeIdByRowId.get(targetRowId)).not.toBe(beforeNodeIdByRowId.get(targetRowId));

    for (const [rowId, nodeId] of beforeNodeIdByRowId.entries()) {
      if (rowId === targetRowId || !afterNodeIdByRowId.has(rowId)) {
        continue;
      }

      expect(afterNodeIdByRowId.get(rowId)).toBe(nodeId);
    }
  });

  test("patching a visible row does not leave blank gaps in the viewport", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const expandedPatchText = Array.from(
      { length: 36 },
      (_, index) => `patched height segment ${index + 1}`,
    ).join(" ");
    await mountEditorFixture(page, { rowCount: 80 });

    await setTranslateScrollTop(page, 9000);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`)).toBeVisible();
    await scrollTranslateRowNearTop(page, targetRowId, 140);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`)).toBeVisible();

    await patchFixtureRow(page, targetRowId, {
      fields: {
        vi: expandedPatchText,
      },
    });

    const gapMetrics = await readVisibleRowGapMetrics(page);
    expect(gapMetrics).not.toBeNull();
    expect(gapMetrics.rowCount).toBeGreaterThan(0);
    expect(gapMetrics.maxViewportGap).toBeLessThanOrEqual(40);
    expect(gapMetrics.topSpacerHeight).toBeGreaterThanOrEqual(0);
    expect(gapMetrics.bottomSpacerHeight).toBeGreaterThanOrEqual(0);
  });

  test("patching a visible row reconciles row height changes", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const nextRowId = "fixture-row-0031";
    const expandedPatchText = Array.from(
      { length: 28 },
      (_, index) => `height reconciliation segment ${index + 1}`,
    ).join(" ");
    await mountEditorFixture(page, { rowCount: 80 });

    await setTranslateScrollTop(page, 9000);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`)).toBeVisible();
    await scrollTranslateRowNearTop(page, targetRowId, 120);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${nextRowId}"]`)).toBeVisible();

    const beforeMetrics = await readRowLayoutMetrics(page, targetRowId, nextRowId);
    expect(beforeMetrics).not.toBeNull();

    await patchFixtureRow(page, targetRowId, {
      fields: {
        vi: expandedPatchText,
      },
    });

    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText("height reconciliation segment 1");

    const afterMetrics = await readRowLayoutMetrics(page, targetRowId, nextRowId);
    expect(afterMetrics).not.toBeNull();

    const targetHeightDelta = afterMetrics.targetHeight - beforeMetrics.targetHeight;
    const nextRowTopDelta = afterMetrics.nextTop - beforeMetrics.nextTop;
    const scrollHeightDelta = afterMetrics.scrollHeight - beforeMetrics.scrollHeight;

    expect(targetHeightDelta).toBeGreaterThan(40);
    expect(Math.abs(nextRowTopDelta - targetHeightDelta)).toBeLessThanOrEqual(24);
    expect(Math.abs(scrollHeightDelta - targetHeightDelta)).toBeLessThanOrEqual(24);
    expect(Math.abs(afterMetrics.gapAfterTarget - beforeMetrics.gapAfterTarget)).toBeLessThanOrEqual(8);
    expect(afterMetrics.bottomSpacerHeight).toBeGreaterThanOrEqual(0);
  });

  test("reloading a stale visible row patches only that mounted row", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const languageCode = "vi";
    const reloadedText = Array.from(
      { length: 20 },
      (_, index) => `reload patch segment ${index + 1}`,
    ).join(" ");

    await page.addInitScript(({ targetRowId: expectedRowId, nextText }) => {
      globalThis.__gnosisMockTauriHandlers = {
        ...(globalThis.__gnosisMockTauriHandlers ?? {}),
        async load_gtms_editor_row(payload) {
          const input = payload?.input ?? {};
          const rowId = String(input.rowId ?? "");
          const rowNumberToken = rowId.match(/(\d+)$/)?.[1] ?? "";
          return {
            chapterBaseCommitSha: "mock-reload-commit-0030",
            row: {
              rowId,
              orderKey: rowNumberToken ? rowNumberToken.padStart(5, "0") : "00000",
              lifecycleState: "active",
              commentCount: 0,
              commentsRevision: 0,
              textStyle: "paragraph",
              fields: {
                es: rowId === expectedRowId ? "alpha 0030 source text" : `source ${rowId}`,
                vi: rowId === expectedRowId ? nextText : `target ${rowId}`,
              },
              footnotes: {
                es: "",
                vi: "",
              },
              imageCaptions: {
                es: "",
                vi: "",
              },
              images: {
                es: null,
                vi: null,
              },
              fieldStates: {
                es: { reviewed: false, pleaseCheck: false },
                vi: { reviewed: false, pleaseCheck: false },
              },
            },
          };
        },
      };
    }, {
      targetRowId,
      nextText: reloadedText,
    });

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 120);

    const targetDisplayField = page.locator(
      `[data-editor-display-field][data-row-id="${targetRowId}"][data-language-code="${languageCode}"]`,
    );
    const targetField = page.locator(
      `[data-editor-row-field][data-row-id="${targetRowId}"][data-language-code="${languageCode}"]:not([data-content-kind])`,
    );

    await expect(targetDisplayField).toBeVisible();
    await targetDisplayField.click();
    await expect(targetField).toBeVisible();
    await expect(targetField).toBeFocused();

    const beforeSnapshot = await readMountedRowNodeSnapshot(page);
    const beforeNodeIdByRowId = new Map(beforeSnapshot.map((entry) => [entry.rowId, entry.nodeId]));

    await page.evaluate((rowId) => {
      window.__gnosisDebug.setEditorRowSyncState(rowId, {
        freshness: "stale",
      });
    }, targetRowId);

    await targetField.evaluate((element) => {
      element.dispatchEvent(new FocusEvent("focusin", {
        bubbles: true,
      }));
    });
    await expect(targetField).toBeFocused();
    await expect(targetField).toHaveValue(reloadedText);

    const afterSnapshot = await readMountedRowNodeSnapshot(page);
    const afterNodeIdByRowId = new Map(afterSnapshot.map((entry) => [entry.rowId, entry.nodeId]));

    expect(afterNodeIdByRowId.get(targetRowId)).toBeTruthy();
    expect(afterNodeIdByRowId.get(targetRowId)).not.toBe(beforeNodeIdByRowId.get(targetRowId));

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row")).toBe(true);

    const gapMetrics = await readVisibleRowGapMetrics(page);
    expect(gapMetrics).not.toBeNull();
    expect(gapMetrics.maxViewportGap).toBeLessThanOrEqual(40);
  });

  test("background sync patches a safe visible row without rerendering the translate body", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const updatedText = Array.from(
      { length: 18 },
      (_, index) => `background sync visible patch ${index + 1}`,
    ).join(" ");

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });

    await installBackgroundSyncMock(page, {
      changedRowIds: [targetRowId],
      newHeadSha: "mock-sync-head-visible",
      rowsById: {
        [targetRowId]: {
          sourceText: "alpha 0030 source text",
          targetText: updatedText,
        },
      },
    });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 120);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`)).toBeVisible();

    const beforeSnapshot = await readMountedRowNodeSnapshot(page);
    const beforeNodeIdByRowId = new Map(beforeSnapshot.map((entry) => [entry.rowId, entry.nodeId]));

    await page.evaluate(() => window.__gnosisDebug.clearEditorScrollDebugEntries());
    await runEditorBackgroundSync(page, {
      skipDirtyFlush: true,
      afterLocalCommit: true,
    });

    await expect(
      page.locator(".modal-backdrop--navigation-loading"),
    ).toHaveCount(0);

    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText("background sync visible patch 1");

    const afterSnapshot = await readMountedRowNodeSnapshot(page);
    const afterNodeIdByRowId = new Map(afterSnapshot.map((entry) => [entry.rowId, entry.nodeId]));
    expect(afterNodeIdByRowId.get(targetRowId)).not.toBe(beforeNodeIdByRowId.get(targetRowId));

    const debugEntries = await readEditorScrollDebugEntries(page);
    expect(hasTranslateBodyRerender(debugEntries)).toBe(false);

    const gapMetrics = await readVisibleRowGapMetrics(page);
    expect(gapMetrics).not.toBeNull();
    expect(gapMetrics.maxViewportGap).toBeLessThanOrEqual(40);

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.some((entry) => entry.command === "sync_gtms_project_editor_repo")).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row" && entry.payload?.input?.rowId === targetRowId)).toBe(true);
  });

  test("background sync reconciles row height changes for a safe visible row", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const updatedText = Array.from(
      { length: 30 },
      (_, index) => `background sync height patch ${index + 1}`,
    ).join(" ");

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });
    await installBackgroundSyncMock(page, {
      changedRowIds: [targetRowId],
      newHeadSha: "mock-sync-head-height",
      rowsById: {
        [targetRowId]: {
          targetText: updatedText,
        },
      },
    });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 60);

    const beforeMetrics = await readSingleRowLayoutMetrics(page, targetRowId);
    expect(beforeMetrics).not.toBeNull();

    await page.evaluate(() => window.__gnosisDebug.clearEditorScrollDebugEntries());
    await runEditorBackgroundSync(page, {
      skipDirtyFlush: true,
      afterLocalCommit: true,
    });

    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText("background sync height patch 1");

    const afterMetrics = await readSingleRowLayoutMetrics(page, targetRowId);
    expect(afterMetrics).not.toBeNull();

    const targetHeightDelta = afterMetrics.targetHeight - beforeMetrics.targetHeight;
    const scrollHeightDelta = afterMetrics.scrollHeight - beforeMetrics.scrollHeight;

    expect(targetHeightDelta).toBeGreaterThan(40);
    expect(Math.abs(scrollHeightDelta - targetHeightDelta)).toBeLessThanOrEqual(24);
    expect(afterMetrics.bottomSpacerHeight).toBeGreaterThanOrEqual(0);

    const gapMetrics = await readVisibleRowGapMetrics(page);
    expect(gapMetrics).not.toBeNull();
    expect(gapMetrics.maxViewportGap).toBeLessThanOrEqual(40);

    const debugEntries = await readEditorScrollDebugEntries(page);
    expect(hasTranslateBodyRerender(debugEntries)).toBe(false);
  });

  test("background sync keeps focus on a different active row while patching a safe visible row", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const activeRowId = "fixture-row-0031";
    const updatedText = Array.from(
      { length: 14 },
      (_, index) => `background sync focus patch ${index + 1}`,
    ).join(" ");

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });

    await installBackgroundSyncMock(page, {
      changedRowIds: [targetRowId],
      newHeadSha: "mock-sync-head-focus",
      rowsById: {
        [targetRowId]: {
          sourceText: "alpha 0030 source text",
          targetText: updatedText,
        },
      },
    });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 120);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`)).toBeVisible();
    await expect(page.locator(`[data-editor-row-card][data-row-id="${activeRowId}"]`)).toBeVisible();

    const activeField = await activateMainEditorField(page, activeRowId, "vi");
    await expect(activeField).toBeVisible();
    await activeField.evaluate((element) => {
      element.focus();
      const targetOffset = Math.max(1, Math.floor(element.value.length / 2));
      element.setSelectionRange(targetOffset, targetOffset);
    });
    await expect(activeField).toBeFocused();

    const beforeFocusSnapshot = await readActiveEditorFieldSnapshot(page);
    const beforeRowSnapshot = await readMountedRowNodeSnapshot(page);
    const beforeNodeIdByRowId = new Map(beforeRowSnapshot.map((entry) => [entry.rowId, entry.nodeId]));

    await page.evaluate(() => window.__gnosisDebug.clearEditorScrollDebugEntries());
    await runEditorBackgroundSync(page, {
      skipDirtyFlush: true,
      afterLocalCommit: true,
    });

    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText("background sync focus patch 1");
    await expect(activeField).toBeFocused();

    const afterFocusSnapshot = await readActiveEditorFieldSnapshot(page);
    expect(afterFocusSnapshot).not.toBeNull();
    expect(afterFocusSnapshot?.rowId).toBe(activeRowId);
    expect(afterFocusSnapshot?.languageCode).toBe("vi");
    expect(afterFocusSnapshot?.value).toBe(beforeFocusSnapshot?.value);
    expect(afterFocusSnapshot?.selectionStart).toBe(beforeFocusSnapshot?.selectionStart);
    expect(afterFocusSnapshot?.selectionEnd).toBe(beforeFocusSnapshot?.selectionEnd);

    const editorState = await page.evaluate(() => window.__gnosisDebug.readEditorState());
    expect(editorState.activeRowId).toBe(activeRowId);
    expect(editorState.mainFieldEditor).toEqual({
      rowId: activeRowId,
      languageCode: "vi",
    });

    const afterRowSnapshot = await readMountedRowNodeSnapshot(page);
    const afterNodeIdByRowId = new Map(afterRowSnapshot.map((entry) => [entry.rowId, entry.nodeId]));
    expect(afterNodeIdByRowId.get(targetRowId)).not.toBe(beforeNodeIdByRowId.get(targetRowId));

    const debugEntries = await readEditorScrollDebugEntries(page);
    expect(hasTranslateBodyRerender(debugEntries)).toBe(false);
  });

  test("background sync updates a safe offscreen row in state without rerendering the translate body", async ({ page }) => {
    const targetRowId = "fixture-row-0060";
    const updatedText = Array.from(
      { length: 16 },
      (_, index) => `background sync offscreen patch ${index + 1}`,
    ).join(" ");

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });

    await installBackgroundSyncMock(page, {
      changedRowIds: [targetRowId],
      newHeadSha: "mock-sync-head-offscreen",
      rowsById: {
        [targetRowId]: {
          sourceText: "alpha 0060 source text",
          targetText: updatedText,
        },
      },
    });

    const targetRow = page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`);
    await expect(targetRow).toHaveCount(0);

    const beforeSnapshot = await readMountedRowNodeSnapshot(page);

    await page.evaluate(() => window.__gnosisDebug.clearEditorScrollDebugEntries());
    await runEditorBackgroundSync(page, {
      skipDirtyFlush: true,
      afterLocalCommit: true,
    });

    const afterSnapshot = await readMountedRowNodeSnapshot(page);
    expect(afterSnapshot).toEqual(beforeSnapshot);

    const debugEntries = await readEditorScrollDebugEntries(page);
    expect(hasTranslateBodyRerender(debugEntries)).toBe(false);

    await page.locator("[data-editor-search-input]").fill("0060");
    await expect(targetRow).toBeVisible();
    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText("background sync offscreen patch 1");

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.some((entry) => entry.command === "sync_gtms_project_editor_repo")).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row" && entry.payload?.input?.rowId === targetRowId)).toBe(true);
  });

  test("background sync repeated safe visible row patch cycles keep the viewport gap-free", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const cycleTexts = [
      Array.from({ length: 10 }, (_, index) => `background sync cycle one ${index + 1}`).join(" "),
      Array.from({ length: 30 }, (_, index) => `background sync cycle two ${index + 1}`).join(" "),
      Array.from({ length: 8 }, (_, index) => `background sync cycle three ${index + 1}`).join(" "),
      Array.from({ length: 24 }, (_, index) => `background sync cycle four ${index + 1}`).join(" "),
    ];

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });
    await installBackgroundSyncMock(page, {
      changedRowIds: [targetRowId],
      newHeadSha: "mock-sync-head-cycle-0",
      rowsById: {
        [targetRowId]: {
          targetText: cycleTexts[0],
        },
      },
    });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 120);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`)).toBeVisible();

    let previousNodeIdByRowId = new Map(
      (await readMountedRowNodeSnapshot(page)).map((entry) => [entry.rowId, entry.nodeId]),
    );

    await page.evaluate(() => window.__gnosisDebug.clearEditorScrollDebugEntries());

    for (const [index, nextText] of cycleTexts.entries()) {
      await installBackgroundSyncMock(page, {
        changedRowIds: [targetRowId],
        newHeadSha: `mock-sync-head-cycle-${index + 1}`,
        rowsById: {
          [targetRowId]: {
            targetText: nextText,
          },
        },
      });

      await runEditorBackgroundSync(page, {
        skipDirtyFlush: true,
        afterLocalCommit: true,
      });

      await expect(
        page.locator(
          `[data-editor-row-card][data-row-id="${targetRowId}"] `
          + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
        ),
      ).toContainText(nextText.split(" ").slice(0, 4).join(" "));

      const afterSnapshot = await readMountedRowNodeSnapshot(page);
      const afterNodeIdByRowId = new Map(afterSnapshot.map((entry) => [entry.rowId, entry.nodeId]));
      expect(afterNodeIdByRowId.get(targetRowId)).not.toBe(previousNodeIdByRowId.get(targetRowId));

      const gapMetrics = await readVisibleRowGapMetrics(page);
      expect(gapMetrics).not.toBeNull();
      expect(gapMetrics.rowCount).toBeGreaterThan(0);
      expect(gapMetrics.maxViewportGap).toBeLessThanOrEqual(40);

      previousNodeIdByRowId = afterNodeIdByRowId;
    }

    const debugEntries = await readEditorScrollDebugEntries(page);
    expect(hasTranslateBodyRerender(debugEntries)).toBe(false);

    const mockState = await readMockTauriState(page);
    expect(
      mockState.invocations.filter((entry) => entry.command === "sync_gtms_project_editor_repo").length,
    ).toBeGreaterThanOrEqual(cycleTexts.length);
    expect(
      mockState.invocations.filter(
        (entry) => entry.command === "load_gtms_editor_row" && entry.payload?.input?.rowId === targetRowId,
      ).length,
    ).toBeGreaterThanOrEqual(cycleTexts.length);
  });

  test("refreshing the translate editor syncs a safe visible row without reloading the chapter", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const updatedText = Array.from(
      { length: 12 },
      (_, index) => `refresh visible patch ${index + 1}`,
    ).join(" ");

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });
    await installBackgroundSyncMock(page, {
      changedRowIds: [targetRowId],
      newHeadSha: "mock-refresh-head-visible",
      rowsById: {
        [targetRowId]: {
          sourceText: "alpha 0030 source text",
          targetText: updatedText,
        },
      },
    });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 120);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`)).toBeVisible();

    await runEditorRefresh(page);

    await expect(
      page.locator(".modal-backdrop--navigation-loading"),
    ).toHaveCount(0);

    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText("refresh visible patch 1");

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.some((entry) => entry.command === "sync_gtms_project_editor_repo")).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row" && entry.payload?.input?.rowId === targetRowId)).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_chapter_editor_data")).toBe(false);
  });

  test("background sync shows a blocking modal and fully reloads the chapter for large stale batches", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const changedRowIds = Array.from({ length: 12 }, (_, index) => `fixture-row-${String(index + 25).padStart(4, "0")}`);
    const updatedText = Array.from(
      { length: 20 },
      (_, index) => `background sync blocking reload ${index + 1}`,
    ).join(" ");

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });
    await installLargeBatchBackgroundReloadMock(page, {
      changedRowIds,
      newHeadSha: "mock-sync-head-large-batch",
      rowsById: {
        [targetRowId]: {
          sourceText: "alpha 0030 source text",
          targetText: updatedText,
        },
      },
    });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 120);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`)).toBeVisible();

    const syncPromise = runEditorBackgroundSync(page, {
      skipDirtyFlush: true,
      afterLocalCommit: true,
    });

    await expect(
      page.locator(".modal-backdrop--navigation-loading .navigation-loading-modal__title"),
    ).toHaveText("Synchronizing with GitHub");

    await syncPromise;

    await expect(
      page.locator(".modal-backdrop--navigation-loading"),
    ).toHaveCount(0);
    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText("background sync blocking reload 1");
    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] .translation-row-badge--stale`,
      ),
    ).toHaveCount(0);

    const gapMetrics = await readVisibleRowGapMetrics(page);
    expect(gapMetrics).not.toBeNull();
    expect(gapMetrics.maxViewportGap).toBeLessThanOrEqual(40);

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_chapter_editor_data")).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row")).toBe(false);
  });

  test("background sync reloads imported Git conflicts into the existing conflict UI", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const localTargetText = "local imported conflict draft";
    const remoteTargetText = "remote GitHub conflict version";

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });
    await installImportedConflictBackgroundReloadMock(page, {
      targetRowId,
      conflictKind: "text-conflict",
      localRowPatch: {
        targetText: localTargetText,
      },
      remoteRowPatch: {
        targetText: remoteTargetText,
      },
      newHeadSha: "mock-sync-head-imported-conflict",
    });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 120);
    const targetRow = page.locator(`[data-editor-row-card][data-row-id="${targetRowId}"]`);
    await expect(targetRow).toBeVisible();

    const syncPromise = runEditorBackgroundSync(page, {
      skipDirtyFlush: true,
      afterLocalCommit: true,
    });

    await expect(
      page.locator(".modal-backdrop--navigation-loading .navigation-loading-modal__title"),
    ).toHaveText("Synchronizing with GitHub");

    await syncPromise;

    await expect(
      page.locator(".modal-backdrop--navigation-loading"),
    ).toHaveCount(0);
    await expect(
      targetRow.locator(".translation-row-badge--conflict"),
    ).toHaveText("Conflict");
    await expect(
      targetRow.locator(`[data-action="open-editor-conflict-resolution:${targetRowId}:vi"]`),
    ).toBeVisible();
    await expect(
      targetRow.locator(`[data-action="open-editor-conflict-resolution:${targetRowId}:es"]`),
    ).toHaveCount(0);

    await expect(
      targetRow.locator(
        '[data-language-code="vi"] .translation-language-panel__field-static--conflict',
      ),
    ).toContainText(localTargetText);

    await targetRow.locator(`[data-action="open-editor-conflict-resolution:${targetRowId}:vi"]`).click();

    await expect(
      page.locator(".modal-card--editor-conflict .modal__title"),
    ).toHaveText("Resolve translation conflict");
    await expect(
      page.locator(".editor-conflict-modal__column").nth(0),
    ).toContainText(localTargetText);
    await expect(
      page.locator(".editor-conflict-modal__column").nth(1),
    ).toContainText(remoteTargetText);
    await expect(
      page.locator("[data-editor-conflict-final-input]"),
    ).toHaveValue(remoteTargetText);

    const gapMetrics = await readVisibleRowGapMetrics(page);
    expect(gapMetrics).not.toBeNull();
    expect(gapMetrics.maxViewportGap).toBeLessThanOrEqual(48);

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.some((entry) => entry.command === "sync_gtms_project_editor_repo")).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_chapter_editor_data")).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row")).toBe(false);
  });

  test("refreshing the translate editor shows a blocking reload when sync finds inserted rows", async ({ page }) => {
    const insertedRowId = "fixture-row-0081";
    const insertedText = "refresh structural inserted target text";

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });

    await page.evaluate(({ nextInsertedRowId, nextInsertedText }) => {
      function cloneRowForChapterLoad(row) {
        return {
          rowId: row.rowId,
          orderKey: row.orderKey,
          lifecycleState: row.lifecycleState === "deleted" ? "deleted" : "active",
          commentCount: Number.isInteger(row.commentCount) ? row.commentCount : 0,
          commentsRevision: Number.isInteger(row.commentsRevision) ? row.commentsRevision : 0,
          textStyle: row.textStyle ?? "paragraph",
          fields: { ...(row.fields ?? {}) },
          footnotes: { ...(row.footnotes ?? {}) },
          imageCaptions: { ...(row.imageCaptions ?? {}) },
          images: { ...(row.images ?? {}) },
          fieldStates: { ...(row.fieldStates ?? {}) },
        };
      }

      globalThis.__gnosisMockTauriHandlers = {
        ...(globalThis.__gnosisMockTauriHandlers ?? {}),
        async sync_gtms_project_editor_repo() {
          return {
            changedRowIds: [],
            deletedRowIds: [],
            insertedRowIds: [nextInsertedRowId],
            newHeadSha: "mock-refresh-head-structural",
          };
        },
        async load_gtms_chapter_editor_data() {
          await new Promise((resolve) => window.setTimeout(resolve, 200));
          const editorState = window.__gnosisDebug.readEditorState();
          const rows = Array.isArray(editorState?.rows)
            ? editorState.rows.map(cloneRowForChapterLoad)
            : [];
          rows.push({
            rowId: nextInsertedRowId,
            orderKey: "00081",
            lifecycleState: "active",
            commentCount: 0,
            commentsRevision: 0,
            textStyle: "paragraph",
            fields: {
              es: "source fixture row 0081",
              vi: nextInsertedText,
            },
            footnotes: {
              es: "",
              vi: "",
            },
            imageCaptions: {
              es: "",
              vi: "",
            },
            images: {
              es: null,
              vi: null,
            },
            fieldStates: {
              es: { reviewed: false, pleaseCheck: false },
              vi: { reviewed: false, pleaseCheck: false },
            },
          });

          return {
            chapterId: editorState.chapterId,
            chapterBaseCommitSha: "mock-refresh-head-structural",
            fileTitle: editorState.fileTitle ?? "Fixture Chapter",
            languages: Array.isArray(editorState.languages) ? editorState.languages : [],
            sourceWordCounts:
              editorState.sourceWordCounts && typeof editorState.sourceWordCounts === "object"
                ? editorState.sourceWordCounts
                : {},
            rows,
          };
        },
      };
    }, {
      nextInsertedRowId: insertedRowId,
      nextInsertedText: insertedText,
    });

    const refreshPromise = runEditorRefresh(page);

    await expect(
      page.locator(".modal-backdrop--navigation-loading .navigation-loading-modal__title"),
    ).toHaveText("Synchronizing with GitHub");

    await refreshPromise;

    await expect(
      page.locator(".modal-backdrop--navigation-loading"),
    ).toHaveCount(0);

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.some((entry) => entry.command === "sync_gtms_project_editor_repo")).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_chapter_editor_data")).toBe(true);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row")).toBe(false);
  });

  test("refreshing the translate editor performs only one blocking reload for large stale batches", async ({ page }) => {
    const targetRowId = "fixture-row-0030";
    const changedRowIds = Array.from({ length: 12 }, (_, index) => `fixture-row-${String(index + 25).padStart(4, "0")}`);
    const updatedText = Array.from(
      { length: 16 },
      (_, index) => `refresh blocking reload ${index + 1}`,
    ).join(" ");

    await mountEditorFixture(page, { rowCount: 80 }, { mockTauri: true });
    await installLargeBatchBackgroundReloadMock(page, {
      changedRowIds,
      newHeadSha: "mock-refresh-head-large-batch",
      rowsById: {
        [targetRowId]: {
          sourceText: "alpha 0030 source text",
          targetText: updatedText,
        },
      },
    });

    await setTranslateScrollTop(page, 9000);
    await scrollTranslateRowNearTop(page, targetRowId, 120);

    const refreshPromise = runEditorRefresh(page);

    await expect(
      page.locator(".modal-backdrop--navigation-loading .navigation-loading-modal__title"),
    ).toHaveText("Synchronizing with GitHub");

    await refreshPromise;

    await expect(
      page.locator(".modal-backdrop--navigation-loading"),
    ).toHaveCount(0);
    await expect(
      page.locator(
        `[data-editor-row-card][data-row-id="${targetRowId}"] `
        + '[data-editor-language-cluster][data-language-code="vi"] [data-editor-display-text]',
      ),
    ).toContainText("refresh blocking reload 1");

    const gapMetrics = await readVisibleRowGapMetrics(page);
    expect(gapMetrics).not.toBeNull();
    expect(gapMetrics.maxViewportGap).toBeLessThanOrEqual(40);

    const mockState = await readMockTauriState(page);
    expect(mockState.invocations.filter((entry) => entry.command === "load_gtms_chapter_editor_data")).toHaveLength(1);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row")).toBe(false);
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
      const afterScrollRow = await readTopVisibleRowMetrics(page);

      await page.waitForTimeout(450);
      const laterScrollTop = await readTranslateScrollTop(page);
      const laterRow = await readTopVisibleRowMetrics(page);

      expect(Math.abs(laterScrollTop - afterScrollInput)).toBeLessThan(80);
      expect(afterScrollRow).not.toBeNull();
      expect(laterRow).not.toBeNull();
      expect(laterRow.rowId).toBe(afterScrollRow.rowId);
      expect(Math.abs(laterRow.rowTop - afterScrollRow.rowTop)).toBeLessThanOrEqual(24);
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
      const afterSecondScrollRow = await readTopVisibleRowMetrics(page);

      await page.waitForTimeout(450);
      const laterScrollTop = await readTranslateScrollTop(page);
      const laterRow = await readTopVisibleRowMetrics(page);

      expect(Math.abs(laterScrollTop - afterSecondScrollInput)).toBeLessThan(80);
      expect(afterSecondScrollRow).not.toBeNull();
      expect(laterRow).not.toBeNull();
      expect(laterRow.rowId).toBe(afterSecondScrollRow.rowId);
      expect(Math.abs(laterRow.rowTop - afterSecondScrollRow.rowTop)).toBeLessThanOrEqual(24);
    });

    test(`a longer ${label}-mode scroll does not jump backward after deferred layout`, async ({ page }) => {
      await openPlatformEditorFixture(page, platform);

      await setTranslateScrollTop(page, 6730);

      await expect.poll(async () => {
        return await readTranslateScrollTop(page);
      }).toBeGreaterThan(6500);

      await page.waitForTimeout(150);
      const afterScrollInput = await readTranslateScrollTop(page);
      const afterScrollRow = await readTopVisibleRowMetrics(page);

      await page.waitForTimeout(450);
      const laterScrollTop = await readTranslateScrollTop(page);
      const laterRow = await readTopVisibleRowMetrics(page);

      expect(Math.abs(laterScrollTop - afterScrollInput)).toBeLessThan(120);
      expect(afterScrollRow).not.toBeNull();
      expect(laterRow).not.toBeNull();
      expect(laterRow.rowId).toBe(afterScrollRow.rowId);
      expect(Math.abs(laterRow.rowTop - afterScrollRow.rowTop)).toBeLessThanOrEqual(24);
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
    await activateMainEditorField(page, "fixture-row-0001", "vi");
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

    await clickLocatorCenter(page, heading2Button);

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

    await activateMainEditorField(page, "fixture-row-0001", "vi");
    await targetField.click();
    await clickLocatorCenter(page, heading1Button);

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

    await activateMainEditorField(page, "fixture-row-0001", "vi");

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

    await clickLocatorCenter(page, quoteButton);
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontStyle ?? "";
    }).toBe("italic");
    const quoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(quoteMetrics.paddingLeftPx).toBeGreaterThan(paragraphMetrics.paddingLeftPx);

    await clickLocatorCenter(page, indentedButton);
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontStyle ?? "";
    }).toBe("normal");
    const indentedMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(indentedMetrics.paddingLeftPx).toBe(quoteMetrics.paddingLeftPx);

    await clickLocatorCenter(page, paragraphButton);
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const activeStack = document.querySelector(
          '[data-editor-row-card][data-row-id="fixture-row-0001"] .translation-language-panel__field-stack[data-language-code="vi"]',
        );
        const displayField = document.querySelector(
          '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="vi"]',
        );
        return activeStack?.getAttribute("data-row-text-style") ?? displayField?.getAttribute("data-row-text-style") ?? null;
      });
    }).toBe("paragraph");
    const resetMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(resetMetrics.fontStyle).toBe(paragraphMetrics.fontStyle);
    expect(resetMetrics.paddingLeftPx).toBeCloseTo(paragraphMetrics.paddingLeftPx, 3);
    expect(resetMetrics.fontSizePx).toBeCloseTo(paragraphMetrics.fontSizePx, 3);
  });

  test("footnotes keep fixed styling while row text styles change, and the add button matches the style buttons", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const footnoteButton = page.locator(
      '[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const heading1Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading1"]',
    );
    const quoteButton = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="quote"]',
    );

    await activateMainEditorField(page, "fixture-row-0001", "vi");
    await expect(footnoteButton).toBeVisible();
    await expect(footnoteButton).toHaveClass(/translation-row-text-style-button--footnote/);

    const paragraphMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi");
    expect(paragraphMetrics).not.toBeNull();

    await clickLocatorCenter(page, footnoteButton);
    const footnoteField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"][data-content-kind="footnote"]',
    );
    await expect(footnoteField).toBeVisible();
    await page.keyboard.type("Fixed footnote");

    const baselineFootnoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi", "footnote");
    expect(baselineFootnoteMetrics).not.toBeNull();
    expect(baselineFootnoteMetrics.fontStyle).toBe("italic");

    await clickLocatorCenter(page, heading1Button);
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontSizePx ?? 0;
    }).toBeGreaterThan(paragraphMetrics.fontSizePx);

    const headingFootnoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi", "footnote");
    expect(headingFootnoteMetrics.fontStyle).toBe("italic");
    expect(headingFootnoteMetrics.fontSizePx).toBeCloseTo(baselineFootnoteMetrics.fontSizePx, 3);
    expect(headingFootnoteMetrics.paddingLeftPx).toBeCloseTo(baselineFootnoteMetrics.paddingLeftPx, 3);

    await clickLocatorCenter(page, quoteButton);
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

    const targetField = await activateMainEditorField(page, "fixture-row-0001", "vi");
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

    await clickLocatorCenter(page, heading2Button);
    await expect(heading2Button).toHaveAttribute("aria-checked", "true");
    await expect(paragraphButton).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][aria-checked="true"]',
    )).toHaveCount(1);

    await clickLocatorCenter(page, heading2Button);
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
      return await page.evaluate(() => {
        const activeStack = document.querySelector(
          '[data-editor-row-card][data-row-id="fixture-row-0001"] .translation-language-panel__field-stack[data-language-code="vi"]',
        );
        const displayField = document.querySelector(
          '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="vi"]',
        );
        return activeStack?.getAttribute("data-row-text-style") ?? displayField?.getAttribute("data-row-text-style") ?? null;
      });
    }).toBe("heading2");
  });

  test("inline formatting buttons keep the editor open, target the selected word, and render sanitized markup after blur", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    const targetField = await activateMainEditorField(page, rowId, languageCode);
    const searchInput = page.locator("[data-editor-search-input]");
    const boldButton = page.locator(
      `[data-editor-inline-style-button][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-inline-style="bold"]`,
    );
    const italicButton = page.locator(
      `[data-editor-inline-style-button][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-inline-style="italic"]`,
    );
    const underlineButton = page.locator(
      `[data-editor-inline-style-button][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-inline-style="underline"]`,
    );
    const rubyButton = page.locator(
      `[data-editor-inline-style-button][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-inline-style="ruby"]`,
    );

    await targetField.fill("alpha beta gamma");

    await setEditorSelectionRange(page, rowId, languageCode, "alpha beta gamma".indexOf("beta") + 1, "alpha beta gamma".indexOf("beta") + 1);
    await clickLocatorCenter(page, boldButton);

    await expect(targetField).toBeVisible();
    await expect(targetField).toHaveValue("alpha <strong>beta</strong> gamma");
    await expect(boldButton).toHaveAttribute("aria-pressed", "true");

    await clickLocatorCenter(page, boldButton);
    await expect(targetField).toHaveValue("alpha beta gamma");
    await expect(boldButton).toHaveAttribute("aria-pressed", "false");

    await setEditorSelectionRange(page, rowId, languageCode, 1, 1);
    await clickLocatorCenter(page, underlineButton);
    await expect(targetField).toHaveValue("<u>alpha</u> beta gamma");
    await expect(underlineButton).toHaveAttribute("aria-pressed", "true");

    const gammaIndexAfterUnderline = "<u>alpha</u> beta gamma".indexOf("gamma") + 2;
    await setEditorSelectionRange(page, rowId, languageCode, gammaIndexAfterUnderline, gammaIndexAfterUnderline);
    await clickLocatorCenter(page, italicButton);
    await expect(targetField).toHaveValue("<u>alpha</u> beta <em>gamma</em>");
    await expect(italicButton).toHaveAttribute("aria-pressed", "true");

    const betaIndexAfterItalic = "<u>alpha</u> beta <em>gamma</em>".indexOf("beta") + 1;
    await setEditorSelectionRange(page, rowId, languageCode, betaIndexAfterItalic, betaIndexAfterItalic);
    await clickLocatorCenter(page, rubyButton);
    await expect(targetField).toHaveValue(
      "<u>alpha</u> <ruby>beta<rt>ruby text here</rt></ruby> <em>gamma</em>",
    );
    await expect(rubyButton).toHaveAttribute("aria-pressed", "true");

    await clickLocatorCenter(page, rubyButton);
    await expect(targetField).toHaveValue("<u>alpha</u> beta <em>gamma</em>");
    await expect(rubyButton).toHaveAttribute("aria-pressed", "false");

    await searchInput.click();

    const displayInnerHtml = await page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"] [data-editor-display-text]`,
    ).evaluate((element) => element.innerHTML);
    expect(displayInnerHtml).toContain("<u>alpha</u>");
    expect(displayInnerHtml).toContain("<em>gamma</em>");
    expect(displayInnerHtml).not.toContain("&lt;");
  });

  test("inline formatting buttons apply to the active footnote textarea instead of the main field", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    await activateMainEditorField(page, rowId, languageCode);

    const footnoteButton = page.locator(
      `[data-editor-footnote-button][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await clickLocatorCenter(page, footnoteButton);

    const footnoteField = page.locator(
      `[data-editor-row-field][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-content-kind="footnote"]`,
    );
    const italicButton = page.locator(
      `[data-editor-inline-style-button][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-inline-style="italic"]`,
    );

    await expect(footnoteField).toBeVisible();
    await footnoteField.fill("foot note");
    await setEditorSelectionRange(page, rowId, languageCode, "foot note".indexOf("note") + 1, "foot note".indexOf("note") + 1, "footnote");
    await clickLocatorCenter(page, italicButton);

    await expect(footnoteField).toHaveValue("foot <em>note</em>");
    await expect(italicButton).toHaveAttribute("aria-pressed", "true");
    await expect(await readEditorFieldValue(page, rowId, languageCode)).toBe("alpha 0001 target text");
  });

  test("inline formatting buttons apply to the active image caption textarea instead of the main field", async ({ page }) => {
    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    await mountEditorFixture(page, {
      rowCount: 18,
      imagesByRowId: {
        [rowId]: {
          [languageCode]: {
            kind: "url",
            url: `https://example.com/${rowId}-${languageCode}.png`,
          },
        },
      },
    }, { mockTauri: true });

    await activateMainEditorField(page, rowId, languageCode);
    const captionField = await activateImageCaptionEditor(page, rowId, languageCode);
    const underlineButton = page.locator(
      `[data-editor-inline-style-button][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-inline-style="underline"]`,
    );

    await expect(captionField).toBeVisible();
    await captionField.fill("caption note");
    await setEditorSelectionRange(page, rowId, languageCode, "caption note".indexOf("note") + 1, "caption note".indexOf("note") + 1, "image-caption");
    await clickLocatorCenter(page, underlineButton);

    await expect(captionField).toHaveValue("caption <u>note</u>");
    await expect(underlineButton).toHaveAttribute("aria-pressed", "true");
    await expect(await readEditorFieldValue(page, rowId, languageCode)).toBe(`alpha 0010 target text`);
  });

  test("typing in one row then focusing another row persists without losing the target field", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });

    const firstField = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await firstField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");

    const secondField = await activateMainEditorField(page, "fixture-row-0002", "vi");
    await expect(secondField).toBeVisible();
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

  test("opening the image url editor keeps the scroll position stable", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    const displayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await displayField.scrollIntoViewIfNeeded();

    const activeField = await activateMainEditorField(page, rowId, languageCode);
    await expect(activeField).toBeVisible();

    const beforeScrollTop = await readTranslateScrollTop(page);
    const imageUrlButton = page.locator(
      `[data-action="open-editor-image-url"][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await imageUrlButton.click();

    const imageUrlInput = page.locator(
      `[data-editor-image-url-input][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await expect(imageUrlInput).toBeVisible();
    await expect.poll(async () => {
      return Math.abs((await readTranslateScrollTop(page)) - beforeScrollTop);
    }).toBeLessThan(4);
  });

  test("closing the image url editor clears the draft and restores the pre-open state", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    const displayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await displayField.scrollIntoViewIfNeeded();

    const activeField = await activateMainEditorField(page, rowId, languageCode);
    await expect(activeField).toBeVisible();

    const imageUrlButton = page.locator(
      `[data-action="open-editor-image-url"][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await imageUrlButton.click();

    const imageUrlInput = page.locator(
      `[data-editor-image-url-input][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await expect(imageUrlInput).toBeVisible();
    await imageUrlInput.fill("https://example.com/test.png");

    const closeButton = page.locator(
      `[data-editor-image-url-close-button][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await closeButton.click();

    await expect(imageUrlInput).toHaveCount(0);
    await expect(imageUrlButton).toBeVisible();

    await imageUrlButton.click();
    const reopenedInput = page.locator(
      `[data-editor-image-url-input][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await expect(reopenedInput).toBeVisible();
    await expect(reopenedInput).toHaveValue("");

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.invocations?.some((entry) => entry.command === "save_gtms_editor_language_image_url") ?? false;
    }).toBe(false);
  });

  test("opening the image upload editor keeps the scroll position stable", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    const displayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await displayField.scrollIntoViewIfNeeded();

    const activeField = await activateMainEditorField(page, rowId, languageCode);
    await expect(activeField).toBeVisible();

    const beforeScrollTop = await readTranslateScrollTop(page);
    const imageUploadButton = page.locator(
      `[data-action="open-editor-image-upload"][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await imageUploadButton.click();

    const uploadDropzone = page.locator(
      `[data-editor-image-upload-dropzone][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await expect(uploadDropzone).toBeVisible();
    await expect.poll(async () => {
      return Math.abs((await readTranslateScrollTop(page)) - beforeScrollTop);
    }).toBeLessThan(4);
  });

  test("clicking away from the active main field keeps the scroll position stable", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    const displayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await displayField.scrollIntoViewIfNeeded();

    const activeField = await activateMainEditorField(page, rowId, languageCode);
    await expect(activeField).toBeVisible();
    await activeField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");

    const beforeScrollTop = await readTranslateScrollTop(page);
    await page.locator("[data-editor-search-input]").click();

    await expect(displayField).toBeVisible();
    await expect.poll(async () => {
      return Math.abs((await readTranslateScrollTop(page)) - beforeScrollTop);
    }).toBeLessThan(4);
  });

  test("saving the active main field with shift-enter keeps the scroll position stable", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    const displayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await displayField.scrollIntoViewIfNeeded();

    const activeField = await activateMainEditorField(page, rowId, languageCode);
    await expect(activeField).toBeVisible();
    await activeField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(" saved");

    const beforeScrollTop = await readTranslateScrollTop(page);
    await page.keyboard.press("Shift+Enter");

    await expect(displayField).toBeVisible();
    await expect.poll(async () => {
      return Math.abs((await readTranslateScrollTop(page)) - beforeScrollTop);
    }).toBeLessThan(4);
  });

  test("saving an image caption with shift-enter keeps the scroll position stable", async ({ page }) => {
    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    await mountEditorFixture(page, {
      rowCount: 18,
      imagesByRowId: {
        [rowId]: {
          [languageCode]: {
            kind: "url",
            url: `https://example.com/${rowId}-${languageCode}.png`,
          },
        },
      },
    }, { mockTauri: true });

    const displayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await displayField.scrollIntoViewIfNeeded();

    const captionField = await activateImageCaptionEditor(page, rowId, languageCode);
    await expect(captionField).toBeVisible();
    await captionField.fill("Stable caption");
    await captionField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });

    const beforeScrollTop = await readTranslateScrollTop(page);
    await page.keyboard.press("Shift+Enter");

    await expect(
      page.locator(
        `[data-editor-image-caption-button][data-row-id="${rowId}"][data-language-code="${languageCode}"] .translation-language-panel__image-caption-text`,
      ),
    ).toHaveText("Stable caption");
    await expect.poll(async () => {
      return Math.abs((await readTranslateScrollTop(page)) - beforeScrollTop);
    }).toBeLessThan(4);
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
