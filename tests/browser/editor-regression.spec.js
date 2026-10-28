import { expect, test } from "./test.js";

async function installMockTauri(page) {
  await page.addInitScript(() => {
    const clone = (value) => globalThis.structuredClone(value);
    const historyKey = (chapterId, rowId, languageCode) => `${chapterId}::${rowId}::${languageCode}`;
    let commitCounter = 0;
    const fixtureByChapterId = new Map();
    const rowFieldsByChapterId = new Map();
    const rowFootnotesByChapterId = new Map();
    const rowImageCaptionsByChapterId = new Map();
    const rowAttributionsByChapterId = new Map();
    const rowTimingsByChapterId = new Map();
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
      rowAttributionsByChapterId.set(chapterId, new Map(rows.map((row) => [row.rowId, clone(row.attributions ?? {})])));
      rowTimingsByChapterId.set(
        chapterId,
        new Map(rows.map((row) => [row.rowId, clone(row.timings ?? {})])),
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
        attributions: clone(rowAttributionsByChapterId.get(chapterId)?.get(rowId) ?? {}),
        images: clone(fixtureRow.images ?? {}),
        fieldStates: clone(fieldStates),
        timings: clone(rowTimingsByChapterId.get(chapterId)?.get(rowId) ?? {}),
        srtTiming: clone(fixtureRow.srtTiming ?? null),
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
        const storedTimings = rowTimingsByChapterId.get(input.chapterId)?.get(input.rowId) ?? {};
        const nextTimings = {
          ...clone(storedTimings),
          ...clone(input.timings ?? {}),
        };

        rowFieldsByChapterId.get(input.chapterId).set(input.rowId, nextFields);
        rowFootnotesByChapterId.get(input.chapterId).set(input.rowId, nextFootnotes);
        rowImageCaptionsByChapterId.get(input.chapterId).set(input.rowId, nextImageCaptions);
        if (input.attributions) rowAttributionsByChapterId.get(input.chapterId).set(input.rowId, clone(input.attributions));
        rowTimingsByChapterId.get(input.chapterId)?.set(input.rowId, nextTimings);
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
        const attributions = rowAttributionsByChapterId.get(input.chapterId)?.get(input.rowId) ?? {};
        if (findRowTextStyle(input.chapterId, input.rowId) === "quote" && nextTextStyle !== "quote") {
          for (const [code, text] of Object.entries(attributions)) {
            if (text) storedFields[code] = storedFields[code] ? `${storedFields[code].trimEnd()}\n\n${text}` : text;
            attributions[code] = "";
          }
        }
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
          fields: clone(storedFields),
          attributions: clone(attributions),
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
        const changedRowIds = [];

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

          const nextFields = {
            ...clone(storedFields),
            ...clone(rowUpdate.fields ?? {}),
          };
          const nextFootnotes = {
            ...clone(storedFootnotes),
            ...clone(rowUpdate.footnotes ?? {}),
          };
          chapterRows.set(rowUpdate.rowId, nextFields);
          chapterFootnotes.set(rowUpdate.rowId, nextFootnotes);
          changedRowIds.push(rowUpdate.rowId);
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
          rowIds: changedRowIds,
          sourceWordCounts: {},
          commitSha,
          chapterBaseCommitSha: commitSha,
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

      if (command === "list_accessible_github_app_installations") {
        // Matches the fixture team (github-app-installation-1) so team-access
        // refreshes reconcile to the same selected team instead of wiping it.
        return [{
          installationId: 1,
          accountLogin: "fixture",
          accountName: "Fixture Team",
          accountType: "organization",
          membershipRole: "owner",
          description: null,
        }];
      }

      if (command === "load_gtms_chapter_editor_data") {
        const chapterId = payload?.input?.chapterId;
        const fixture = fixtureByChapterId.get(chapterId);
        if (!fixture) {
          return null;
        }

        // Reflect post-sync disk state: overlay any pending background-sync
        // row patches so a chapter reload after sync serves the synced text.
        const syncRowsById = globalThis.__gnosisBackgroundSyncFixture?.rowsById ?? {};
        const rows = (Array.isArray(fixture.rows) ? fixture.rows : [])
          .map((row) => buildRowPayload(chapterId, row.rowId))
          .filter(Boolean)
          .map((row) => {
            const syncPatch = syncRowsById[row.rowId];
            if (!syncPatch) {
              return row;
            }

            return {
              ...row,
              fields: {
                ...row.fields,
                ...(typeof syncPatch.sourceText === "string" ? { es: syncPatch.sourceText } : {}),
                ...(typeof syncPatch.targetText === "string" ? { vi: syncPatch.targetText } : {}),
              },
            };
          });

        return {
          chapterId,
          chapterBaseCommitSha: "mock-chapter-base",
          fileTitle: "Editor Regression Fixture",
          languages: clone(fixture.languages ?? []),
          wordCounts: {},
          selectedSourceLanguageCode: fixture.sourceCode,
          selectedTargetLanguageCode: fixture.targetCode,
          sourceFormats: clone(fixture.sourceFormats ?? []),
          rows,
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

// Cold Vite dev-server boots transform the whole editor module graph on demand,
// which on a slow CI runner (Windows especially) can take far longer than
// Playwright's 30s action default. The navigation and the wait for the debug
// harness each get their own generous budget so runner-slowness reads as "still
// booting" rather than a hard failure; both stay under the per-test timeout.
const EDITOR_FIXTURE_BOOTSTRAP_TIMEOUT_MS = 45_000;

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

  await page.goto(setup.path ?? "/", { timeout: EDITOR_FIXTURE_BOOTSTRAP_TIMEOUT_MS });
  await page.waitForFunction(
    () => typeof window.__gnosisDebug?.mountEditorFixture === "function",
    undefined,
    { timeout: EDITOR_FIXTURE_BOOTSTRAP_TIMEOUT_MS },
  );
  await page.evaluate(async (fixtureOptions) => {
    await window.__gnosisDebug.waitForBootstrap();
    await window.__gnosisDebug.mountEditorFixture(fixtureOptions);
  }, options);
  await expect(page.locator("[data-editor-search-input]")).toBeVisible();
  await dismissTelemetryDisclosureModal(page);
}

// The first-run telemetry disclosure opens during bootstrap in the browser
// harness (consent cannot persist there because the browser-mode persistent
// store reads and writes different localStorage keys), so it would intercept
// pointer events in every test. Dismiss it before the test interacts.
async function dismissTelemetryDisclosureModal(page) {
  const disclosureSave = page
    .locator(".modal-backdrop")
    .getByRole("button", { name: "Save" });
  if (await disclosureSave.count()) {
    await disclosureSave.click();
    await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  }
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
      opacity: Number(styles.opacity),
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

function fixtureRowId(index) {
  return `fixture-row-${String(index).padStart(4, "0")}`;
}

function repeatedVirtualizationText(label, count) {
  return Array.from({ length: count }, (_, index) =>
    `Segment ${label}.${index + 1} uses alpha glossary text with enough words to wrap across multiple visual lines in the editor fixture.`
  ).join(" ");
}

function buildLongVirtualizationFieldsByRowId(rowCount) {
  const fieldsByRowId = {};
  for (let index = 1; index <= rowCount; index += 1) {
    const rowId = fixtureRowId(index);
    const repeatCount = index % 5 === 0 ? 18 : index % 3 === 0 ? 13 : 8;
    fieldsByRowId[rowId] = {
      es: repeatedVirtualizationText(`${rowId}-es`, repeatCount),
      vi: repeatedVirtualizationText(`${rowId}-vi`, repeatCount + 2),
    };
  }
  return fieldsByRowId;
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
  // locator.click() targets the element center by default and retries when a
  // row patch replaces the node mid-action; a manual boundingBox read races
  // that replacement and fails on detached elements.
  await locator.click();
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

// Virtualization only mounts rows near the viewport, so scroll toward the
// target row in viewport-sized steps until its card exists, then position it
// precisely near the top of the viewport.
async function bringRowNearTop(page, rowId, offset = 100) {
  await expect.poll(async () => {
    const mounted = await page
      .locator(`[data-editor-row-card][data-row-id="${rowId}"]`)
      .count();
    if (mounted > 0) {
      return true;
    }

    await page.evaluate(() => {
      const container = document.querySelector(".translate-main-scroll");
      if (container instanceof HTMLElement) {
        container.scrollTop += Math.max(200, container.clientHeight * 0.8);
        container.dispatchEvent(new Event("scroll"));
      }
    });
    return false;
  }, { timeout: 20_000, intervals: [100] }).toBe(true);
  await scrollTranslateRowNearTop(page, rowId, offset);
  await expect(page.locator(`[data-editor-row-card][data-row-id="${rowId}"]`)).toBeVisible();
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
  for (const kind of ["paragraph", "heading1", "image", "image-caption", "footnote", "separator", "custom-html"]) {
    test(`preview ${kind} double-click returns to its editor row and language`, async ({ page }) => {
      const rowId = "fixture-row-0020";
      await mountEditorFixture(page, { rowCount: 40, chapterStatus: "ready" }, { mockTauri: true });
      await patchFixtureRow(page, rowId, {
        fields: { es: kind === "custom-html" ? "<div>Custom preview content</div>" : "Preview body [1]<hr>After separator" },
        textStyle: kind === "heading1" ? "heading1" : kind === "custom-html" ? "custom_html" : "paragraph",
      });
      await page.evaluate(async (targetRowId) => {
        const { state } = await import(new URL("/app/state.js", window.location.href).href);
        const row = state.editorChapter.rows.find((row) => row.rowId === targetRowId);
        row.footnotes.es = [{ marker: 1, text: "A preview footnote" }];
        row.images.es = { kind: "url", url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='orange'/%3E%3C/svg%3E" };
        row.imageCaptions.es = "Preview image caption";
      }, rowId);
      await page.locator('[data-action="set-editor-mode:preview"]').click();
      await page.locator("[data-editor-preview-language-select]").selectOption("es");
      const block = page.locator(`[data-editor-preview-document] [data-preview-block="${kind}"][data-row-id="${rowId}"]`).first();
      await expect(block).toHaveAttribute("data-tooltip", "Double-click to edit.");
      await expect(block).toHaveAttribute("lang", "es");
      // A preview jump must reveal its source even when translate-mode filters
      // would otherwise hide that row.
      await page.evaluate(async () => {
        const { state } = await import(new URL("/app/state.js", window.location.href).href);
        state.editorChapter.filters.searchQuery = "no rows match this filter";
        state.editorChapter.filters.rowFilterMode = "needs-review";
      });
      const target = kind === "image" ? block.locator("img") : block;
      await expect(block).not.toHaveAttribute("title");
      await target.hover();
      await expect.poll(() => block.evaluate((element) => getComputedStyle(element, "::before").content)).toBe('"Double-click to edit."');
      await expect.poll(() => block.evaluate((element) => getComputedStyle(element, "::before").opacity)).toBe("1");
      if (kind === "image-caption") {
        const figure = block.locator("..");
        await expect.poll(() => figure.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
      }
      await target.dblclick();
      await expect(page.locator(".translate-layout--preview")).toHaveCount(0);
      await expect(page.locator(`[data-editor-language-panel][data-row-id="${rowId}"][data-language-code="es"]`)).toBeInViewport();
      await expect(page.locator("[data-editor-search-input]")).toHaveValue("");
    });
  }

  for (const platform of ["macos", "windows"]) {
    test(`card whitespace selects through edges and dividers without editing (${platform})`, async ({ page }) => {
      await mountEditorFixture(page, { rowCount: 6, chapterStatus: "ready" }, {
        mockTauri: true, path: `/?platform=${platform}`,
      });
      const first = page.locator('[data-editor-row-card][data-row-id="fixture-row-0001"]');
      const card = first.locator(".card--translation");
      const selected = page.locator("[data-editor-language-panel].is-active");
      await page.locator('[data-action="switch-editor-sidebar-tab:history"]').click();

      for (const [edge, language] of [
        ["top", "es"], ["bottom", "vi"], ["left-upper", "es"], ["right-lower", "vi"],
        ["above-divider", "es"], ["below-divider", "vi"], ["right-upper", "es"], ["left-lower", "vi"],
      ]) {
        const point = await card.evaluate((element, edge) => {
          const bounds = element.getBoundingClientRect();
          const panels = [...element.querySelectorAll("[data-editor-language-panel]")]
            .map((panel) => panel.getBoundingClientRect());
          const divider = panels[1].top;
          const x = edge.startsWith("left") ? bounds.left + 1
            : edge.startsWith("right") ? bounds.right - 1 : (bounds.left + bounds.right) / 2;
          const y = edge === "top" ? bounds.top + 1
            : edge === "bottom" ? bounds.bottom - 1
            : edge === "above-divider" ? divider - 1
            : edge === "below-divider" ? divider + 1
            : edge.endsWith("upper") ? panels[0].top + 5 : panels[1].top + 5;
          return { x, y };
        }, edge);
        await page.mouse.click(point.x, point.y);
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute("data-row-id", "fixture-row-0001");
        await expect(selected).toHaveAttribute("data-language-code", language);
        await expect(first).toHaveClass(/is-connected/);
        await expect(page.locator("[data-editor-row-field]")).toHaveCount(0);
        await expect(page.locator('[data-action="switch-editor-sidebar-tab:history"]')).toHaveAttribute("aria-pressed", "true");
      }

      // Collapsing is still its own action; reordered sections keep full hit areas.
      await first.locator('[data-editor-language-toggle][data-language-code="es"]').click();
      await expect(selected).toHaveAttribute("data-language-code", "vi");
      await expect(first.locator('[data-editor-language-panel][data-language-code="es"]')).toHaveClass(/is-collapsed/);
      const collapsedBounds = await card.boundingBox();
      await page.mouse.click(collapsedBounds.x + collapsedBounds.width / 2, collapsedBounds.y + collapsedBounds.height - 1);
      await expect(selected).toHaveAttribute("data-language-code", "es");
      await expect(page.locator("[data-editor-row-field]")).toHaveCount(0);

      // Text still opens for editing; selecting another card preserves its draft.
      await first.locator('[data-editor-language-toggle][data-language-code="es"]').click();
      const field = await activateMainEditorField(page, "fixture-row-0001", "vi");
      await field.fill("Draft preserved when selecting card whitespace");
      const second = page.locator('[data-editor-row-card][data-row-id="fixture-row-0002"] .card--translation');
      await second.scrollIntoViewIfNeeded();
      const secondBounds = await second.boundingBox();
      await page.mouse.click(secondBounds.x + secondBounds.width / 2, secondBounds.y + 1);
      await expect(selected).toHaveAttribute("data-row-id", "fixture-row-0002");
      await expect(selected).toHaveAttribute("data-language-code", "es");
      await expect(page.locator("[data-editor-row-field]")).toHaveCount(0);
      await expect.poll(async () => (await readMockTauriState(page)).invocations.filter(
        (entry) => entry.command === "update_gtms_editor_row_fields",
      ).length).toBeGreaterThan(0);
      await expect(first.locator('[data-editor-display-field][data-language-code="vi"]'))
        .toHaveText("Draft preserved when selecting card whitespace");
    });
  }

  for (const platform of ["macos", "windows"]) {
    test(`selected language pill follows selection and persists in the sidebar (${platform})`, async ({ page }) => {
      await mountEditorFixture(page, { rowCount: 6, chapterStatus: "ready" }, {
        mockTauri: true, path: `/?platform=${platform}`,
      });
      const selected = page.locator("[data-editor-language-panel].is-active");
      await expect(selected).toHaveCount(1);
      await expect(selected).toHaveAttribute("data-row-id", "fixture-row-0001");
      await expect(selected).toHaveAttribute("data-language-code", "vi");
      await expect(selected.locator(".translation-language-panel__label"))
        .toHaveCSS("background-color", "rgba(243, 156, 24, 0.2)");

      await activateMainEditorField(page, "fixture-row-0001", "es");
      await expect(selected).toHaveCount(1);
      await expect(selected).toHaveAttribute("data-language-code", "es");
      await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
      await page.locator("[data-editor-assistant-draft]").focus();
      await expect(page.locator("[data-editor-assistant-draft]")).toBeFocused();
      await expect(selected).toHaveAttribute("data-language-code", "es");

      await activateMainEditorField(page, "fixture-row-0002", "vi");
      await expect(selected).toHaveCount(1);
      await expect(selected).toHaveAttribute("data-row-id", "fixture-row-0002");
      await expect(selected).toHaveAttribute("data-language-code", "vi");
      await page.locator("[data-editor-search-input]").fill("no matching translation for language pill");
      await expect(selected).toHaveCount(0);
      await page.locator("[data-editor-search-input]").fill("");
      await expect(selected).toHaveCount(0);
    });
  }

  test("sidebar tabs stay clickable and compact without a selected row", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 6, chapterStatus: "ready" }, { mockTauri: true });
    const search = page.locator("[data-editor-search-input]");
    await search.fill("no matching translation for sidebar regression");
    const sidebar = page.locator(".translate-sidebar");
    await expect(sidebar.locator(".history-empty")).toHaveText("Select a translation to view review tools.");
    const reviewHeight = (await sidebar.boundingBox()).height;
    const callsBefore = (await readMockTauriState(page)).invocations.length;

    for (const [tab, message] of [
      ["history", "Select a translation to view History."],
      ["comments", "Select a translation to view Comments."],
      ["translate", "Select a translation to use the AI Assistant."],
      ["review", "Select a translation to view review tools."],
      ["comments", "Select a translation to view Comments."],
      ["history", "Select a translation to view History."],
    ]) {
      const button = sidebar.locator(`[data-action="switch-editor-sidebar-tab:${tab}"]`);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(sidebar.locator(".history-empty")).toHaveText(message);
      await expect(sidebar.locator("textarea, .translate-ai-tools, .history-stack")).toHaveCount(0);
      expect((await sidebar.boundingBox()).height).toBeCloseTo(reviewHeight, 0);
    }
    const newCalls = (await readMockTauriState(page)).invocations.slice(callsBefore);
    expect(newCalls.filter((entry) => [
      "load_gtms_editor_field_history", "load_gtms_editor_row_comments",
    ].includes(entry.command))).toHaveLength(0);

    await search.fill("");
    await activateMainEditorField(page, "fixture-row-0001", "vi");
    await sidebar.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    await expect(sidebar.locator("[data-editor-assistant-draft]")).toBeEnabled();
    await expect(sidebar).toHaveClass(/translate-sidebar--assistant/);
  });

  test("background sync does not commit a focused draft while History is open", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 6 }, { mockTauri: true });
    const field = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await field.fill("unfinished draft that has never been saved");
    await page.locator('[data-action="switch-editor-sidebar-tab:history"]').click();
    await expect(field).toBeFocused();
    const before = await readMockTauriState(page);
    await runEditorBackgroundSync(page);
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("unfinished draft that has never been saved");
    const after = await readMockTauriState(page);
    expect(after.histories).toEqual(before.histories);
    expect(after.invocations.filter((entry) => entry.command === "update_gtms_editor_row_fields")).toHaveLength(0);
    // The normal deliberate save remains available after sync deferred.
    await field.press("Shift+Enter");
    await expect.poll(async () => (await readMockTauriState(page)).invocations.filter(
      (entry) => entry.command === "update_gtms_editor_row_fields",
    ).length).toBe(1);
  });

  for (const trigger of ["background sync", "manual refresh"]) {
    test(`${trigger} defers conflict reload when typing starts during sync`, async ({ page }) => {
      await mountEditorFixture(page, { rowCount: 6 }, { mockTauri: true });
      const field = await activateMainEditorField(page, "fixture-row-0001", "vi");
      await field.focus();
      await installImportedConflictBackgroundReloadMock(page, {
        targetRowId: "fixture-row-0002",
        localRowPatch: { targetText: "conflicted local text" },
        remoteRowPatch: { targetText: "conflicted remote text" },
      });
      await page.evaluate(() => {
        const handlers = globalThis.__gnosisMockTauriHandlers;
        const originalSync = handlers.sync_gtms_project_editor_repo;
        const conflictLoad = handlers.load_gtms_chapter_editor_data;
        delete handlers.load_gtms_chapter_editor_data;
        const pending = new Promise((resolve) => { globalThis.__releaseDraftSync = resolve; });
        handlers.sync_gtms_project_editor_repo = async () => {
          globalThis.__draftSyncStarted = true;
          await pending;
          handlers.load_gtms_chapter_editor_data = conflictLoad;
          return originalSync();
        };
      });
      const syncing = trigger === "manual refresh" ? runEditorRefresh(page) : runEditorBackgroundSync(page);
      await page.waitForFunction(() => globalThis.__draftSyncStarted);
      const loadsBefore = (await readMockTauriState(page)).invocations.filter(
        (entry) => entry.command === "load_gtms_chapter_editor_data",
      ).length;
      await field.fill("unsubmitted text typed while sync was pending");
      await page.evaluate(() => globalThis.__releaseDraftSync());
      await syncing;
      await expect(field).toBeFocused();
      await expect(field).toHaveValue("unsubmitted text typed while sync was pending");
      const calls = (await readMockTauriState(page)).invocations;
      expect(calls.filter((entry) => entry.command === "update_gtms_editor_row_fields")).toHaveLength(0);
      expect(calls.filter((entry) => entry.command === "load_gtms_chapter_editor_data")).toHaveLength(loadsBefore);
      await expect(page.locator(".modal-card--navigation-loading")).toHaveCount(0);
      // A deliberate save releases the deferred conflict reload.
      await field.press("Shift+Enter");
      await expect.poll(async () => (await readMockTauriState(page)).invocations.filter(
        (entry) => entry.command === "update_gtms_editor_row_fields",
      ).length).toBe(1);
      await runEditorBackgroundSync(page);
      await expect(page.locator('[data-action="open-editor-conflict-resolution:fixture-row-0002:vi"]')).toBeVisible();
    });
  }

  test("an earlier save can finish without committing newer focused draft text", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 6 }, { mockTauri: true });
    await page.evaluate(() => {
      const pending = new Promise((resolve) => { globalThis.__finishEarlierSave = resolve; });
      let savedText = null;
      globalThis.__gnosisMockTauriHandlers = {
        async update_gtms_editor_row_fields({ input }) {
          globalThis.__earlierSaveStarted = true;
          await pending;
          savedText = input.fields.vi;
          return { status: "saved", row: {
            rowId: input.rowId, lifecycleState: "active", textStyle: "paragraph",
            fields: input.fields, footnotes: input.footnotes, imageCaptions: input.imageCaptions,
            images: {}, fieldStates: {},
          } };
        },
        load_gtms_editor_field_history() {
          return { entries: savedText === null ? [] : [{
            commitSha: "earlier-save", plainText: savedText,
            authorName: "Mock Backend", operationType: "editor-update",
          }] };
        },
      };
    });
    let field = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await field.fill("earlier deliberate save");
    await field.press("Shift+Enter");
    await page.waitForFunction(() => globalThis.__earlierSaveStarted === true);
    field = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await field.fill("newer unsaved draft");
    await page.locator('[data-action="switch-editor-sidebar-tab:history"]').click();
    await page.evaluate(() => globalThis.__finishEarlierSave());
    await expect(page.locator(".history-item__content").first()).toContainText("earlier deliberate save");
    await expect(field).toHaveValue("newer unsaved draft");
    await expect(field).toBeFocused();
    const saves = (await readMockTauriState(page)).invocations.filter(
      (entry) => entry.command === "update_gtms_editor_row_fields",
    );
    expect(saves).toHaveLength(1);
    expect(saves[0].payload.input.fields.vi).toBe("earlier deliberate save");
  });

  for (const platform of ["mac", "windows"]) {
    test(`refresh preserves an open draft without committing it (${platform})`, async ({ page }) => {
      await mountEditorFixture(page, { rowCount: 6 }, { mockTauri: true, path: `/?platform=${platform}` });
      const field = await activateMainEditorField(page, "fixture-row-0001", "vi");
      await field.fill("draft retained across refresh");
      const before = await readMockTauriState(page);
      await page.locator('[data-action="refresh-page"]').click();
      await expect.poll(async () => (await readMockTauriState(page)).invocations.filter(
        (entry) => entry.command === "load_gtms_chapter_editor_data",
      ).length).toBeGreaterThan(0);
      // Await a complete refresh too, checking repeated reloads and shortcut/API use.
      await runEditorRefresh(page);
      await expect(field).toHaveValue("draft retained across refresh");
      await expect(field).toBeFocused();
      const after = await readMockTauriState(page);
      expect(after.histories).toEqual(before.histories);
      expect(after.invocations.filter((entry) => entry.command === "update_gtms_editor_row_fields")).toHaveLength(0);
    });
  }

  test("failed refresh retains the latest open draft and allows retry", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 6 }, { mockTauri: true });
    const field = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await field.fill("draft survives a read failure");
    await page.evaluate(() => {
      globalThis.__gnosisMockTauriHandlers = {
        load_gtms_chapter_editor_data() { throw new Error("Fixture read failure"); },
      };
    });
    await runEditorRefresh(page);
    await expect(page.getByText("Up to date", { exact: true })).toHaveCount(0);
    expect((await readMockTauriState(page)).invocations.filter(
      (entry) => entry.command === "sync_gtms_project_editor_repo",
    )).toHaveLength(0);

    await expect(field).toHaveValue("draft survives a read failure");
    await expect(field).toBeFocused();
    await field.fill("latest draft after read failure");
    await page.evaluate(() => { delete globalThis.__gnosisMockTauriHandlers.load_gtms_chapter_editor_data; });
    await runEditorRefresh(page);
    await expect(field).toHaveValue("latest draft after read failure");
    await expect(field).toBeFocused();
    expect((await readMockTauriState(page)).invocations.filter(
      (entry) => entry.command === "update_gtms_editor_row_fields",
    )).toHaveLength(0);
  });

  test("mounting the editor fixture renders one translate action in unified AI settings mode", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 6,
      // The translate action buttons only render for an untranslated active
      // row — the assistant pane hides them once target text exists.
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "alpha 0001 source text",
          vi: "",
        },
      },
    });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    await expect(page.locator(".history-tabs__item")).toContainText(["AI Assistant", "Review", "History", "Comments"]);
    await expect(page.locator(".translate-ai-action-button")).toHaveCount(1);
    await expect(page.locator(".translate-ai-action-button__model")).toHaveCount(1);
    await expect(page.locator(".translate-ai-action-button__model")).not.toHaveText("");
    await expect(page.locator(".translate-ai-action-button")).not.toContainText("Translate 1");
    await expect(page.locator(".translate-ai-action-button")).not.toContainText("Translate 2");
  });

  test("clear translations button opens two-step modal and clears selected language text", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 2,
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "Texto fuente 1",
          vi: "Ban dich 1",
          ja: "Nihongo 1",
        },
        "fixture-row-0002": {
          es: "Texto fuente 2",
          vi: "Ban dich 2",
          ja: "Nihongo 2",
        },
      },
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
        { code: "ja", name: "Japanese", role: "target" },
      ],
    }, { mockTauri: true });

    await page.locator('[data-action="open-editor-clear-translations"]').click();
    await expect(page.locator(".modal__title")).toHaveText("Clear all translations for selected languages");
    await expect(page.locator('[data-action="review-editor-clear-translations"]')).toHaveCount(0);
    await expect(page.locator('[data-action="noop"]', { hasText: "Clear selected" })).toBeVisible();

    await page.locator('[data-editor-clear-translations-language][value="vi"]').check();
    await expect(page.locator('[data-action="review-editor-clear-translations"]')).toBeVisible();
    await page.locator('[data-action="review-editor-clear-translations"]').click();

    await expect(page.locator(".modal__title")).toHaveText("Are you sure you want to delete these translations?");
    await expect(page.locator(".modal__list")).toContainText("Vietnamese");
    await expect(page.locator(".modal__list")).not.toContainText("Japanese");
    await page.locator('[data-action="confirm-editor-clear-translations"]').click();

    await expect(page.locator(".modal-backdrop")).toHaveCount(0);
    const snapshot = await page.evaluate(() => window.__gnosisDebug.readEditorState());
    const row1 = snapshot.rows.find((row) => row.rowId === "fixture-row-0001");
    const row2 = snapshot.rows.find((row) => row.rowId === "fixture-row-0002");
    expect(row1.fields).toMatchObject({
      es: "Texto fuente 1",
      vi: "",
      ja: "Nihongo 1",
    });
    expect(row2.fields).toMatchObject({
      es: "Texto fuente 2",
      vi: "",
      ja: "Nihongo 2",
    });
  });

  test("AI Assistant tab renders persisted transcript items and the chat composer", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      assistant: {
        threadsByKey: {
          "fixture-row-0001::es::vi": {
            rowId: "fixture-row-0001",
            sourceLanguageCode: "es",
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
    // The composer sends via Shift+Return; there is no separate send button.
    await expect(page.locator(".assistant-composer__hint")).toContainText("Shift + Return to send");
  });

  test("sending assistant messages clears the composer and preserves the next draft", async ({ page }) => {
    await page.addInitScript(() => {
      const replies = [];
      globalThis.__releaseAssistantReply = () => replies.shift()?.();
      globalThis.__gnosisMockTauriHandlers = {
        load_ai_provider_secret() {
          return "mock-key";
        },
        async run_ai_assistant_turn() {
          await new Promise((resolve) => replies.push(resolve));
          return { assistantText: "Mock assistant reply" };
        },
      };
    });
    await mountEditorFixture(page, {
      rowCount: 1,
      aiActionConfig: {
        detailedConfiguration: false,
        unified: { providerId: "openai", modelId: "gpt-5.4" },
      },
    }, { mockTauri: true });
    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    const composer = page.locator("[data-editor-assistant-draft]");

    for (const message of ["Explain the first sentence.", "Explain the second sentence."]) {
      await composer.fill(message);
      await composer.press("Shift+Enter");
      await expect(page.locator(".assistant-item").filter({ hasText: message })).toHaveCount(1);
      await expect(composer).toHaveValue("");
      await expect(composer).toBeFocused();
      await expect.poll(async () => {
        const mock = await readMockTauriState(page);
        return mock.invocations.filter((entry) => entry.command === "run_ai_assistant_turn").length;
      }).toBe(message.includes("first") ? 1 : 2);

      await composer.fill("Next unsent question");
      await page.evaluate(() => window.__releaseAssistantReply());
      await expect(page.locator(".assistant-item").filter({ hasText: "Mock assistant reply" })).toHaveCount(
        message.includes("first") ? 1 : 2,
      );
      await expect(composer).toHaveValue("Next unsent question");
    }
  });

  for (const position of ["bottom", "middle"]) {
    test(`typing in a full assistant composer preserves transcript scroll at the ${position}`, async ({ page }) => {
      await mountEditorFixture(page, {
        rowCount: 1,
        assistant: {
          activeThreadKey: "fixture-row-0001::es::vi",
          threadsByKey: {
            "fixture-row-0001::es::vi": {
              rowId: "fixture-row-0001",
              sourceLanguageCode: "es",
              targetLanguageCode: "vi",
              items: Array.from({ length: 28 }, (_, index) => ({
                id: `assistant-${index}`,
                type: "assistant-message",
                text: `Conversation entry ${index}. A translation explanation to fill the transcript.`,
                sourceLanguageCode: "es",
                targetLanguageCode: "vi",
              })),
            },
          },
        },
      });
      await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
      const composer = page.locator("[data-editor-assistant-draft]");
      await composer.fill("Short question");
      await expect(composer).toHaveCSS("height", "71px");
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      const growthStart = await page.evaluate((position) => {
        const transcript = document.querySelector(".assistant-transcript");
        transcript.scrollTop = position === "bottom"
          ? transcript.scrollHeight
          : (transcript.scrollHeight - transcript.clientHeight) / 2;
        return transcript.scrollTop;
      }, position);
      const expectGrowthScrollPreserved = async () => {
        const distance = await page.evaluate(({ position, growthStart }) => {
          const transcript = document.querySelector(".assistant-transcript");
          return position === "bottom"
            ? transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop
            : transcript.scrollTop - growthStart;
        }, { position, growthStart });
        expect(Math.abs(distance)).toBeLessThanOrEqual(1);
      };
      await composer.fill("Question\n".repeat(3));
      await expect(composer).toHaveCSS("height", "124px");
      await expectGrowthScrollPreserved();
      await composer.fill("A long question about the translation.\n".repeat(20));
      await expect(composer).toHaveCSS("height", "213px");
      await expectGrowthScrollPreserved();
      await composer.press("ControlOrMeta+End");
      // Let tab-entry scrolling settle before choosing the reader's position.
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      const before = await page.evaluate((position) => {
        const transcript = document.querySelector(".assistant-transcript");
        transcript.scrollTop = position === "bottom"
          ? transcript.scrollHeight
          : (transcript.scrollHeight - transcript.clientHeight) / 2;
        const top = transcript.scrollTop;
        window.__assistantScrollSamples = [];
        window.__assistantHeightSamples = [];
        window.__assistantScrollWrites = [];
        const scrollTopProperty = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
        Object.defineProperty(transcript, "scrollTop", {
          configurable: true,
          get() { return scrollTopProperty.get.call(this); },
          set(value) {
            window.__assistantScrollWrites.push(value);
            scrollTopProperty.set.call(this, value);
          },
        });
        const scrollHeightGetter = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight").get;
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
          configurable: true,
          get() {
            const height = scrollHeightGetter.call(this);
            if (this.matches(".assistant-composer__field")) {
              window.__assistantHeightSamples.push(transcript.clientHeight);
            }
            return height;
          },
        });
        // Sample synchronously after input handlers, before any deferred scroll
        // could mask the temporary jump caused by measuring the live textarea.
        window.addEventListener("input", () => {
          window.__assistantScrollSamples.push(transcript.scrollTop);
        });
        return { top, height: transcript.clientHeight };
      }, position);
      expect(before.top).toBeGreaterThan(0);
      await composer.pressSequentially("Another sentence", { delay: 20 });
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      const after = await page.evaluate(() => ({
        top: document.querySelector(".assistant-transcript").scrollTop,
        samples: window.__assistantScrollSamples,
        heights: window.__assistantHeightSamples,
        writes: window.__assistantScrollWrites,
      }));
      expect(after.samples.length).toBeGreaterThan(0);
      expect(after.writes).toEqual([]);
      for (const top of [...after.samples, after.top]) {
        expect(Math.abs(top - before.top)).toBeLessThanOrEqual(1);
      }
      for (const height of after.heights) {
        expect(height).toBe(before.height);
      }
      await expect(composer).toBeFocused();
      await expect(composer).toHaveCSS("height", "213px");
      await composer.fill("Short question");
      await expect(composer).toHaveCSS("height", "71px");
      await expect(composer).toHaveCSS("overflow-y", "hidden");
      const shrinkDistance = await page.evaluate(({ position, top }) => {
        const transcript = document.querySelector(".assistant-transcript");
        return position === "bottom"
          ? transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop
          : transcript.scrollTop - top;
      }, { position, top: before.top });
      expect(Math.abs(shrinkDistance)).toBeLessThanOrEqual(1);
    });
  }

  test("assistant composer measures fractional wrapping widths without clipping", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 1 });
    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    const composer = page.locator("[data-editor-assistant-draft]");
    await composer.evaluate((element) => {
      // A fractional width just below a wrap boundary: rounding it to 298px
      // makes the measurement fit two lines when the visible field needs three.
      element.parentElement.style.width = "299.703125px";
      element.style.font = "16px / 24px Arial";
    });
    await page.addStyleTag({ content: ".assistant-composer__field::-webkit-scrollbar { width: 16px; }" });
    for (const initiallyOverflowing of [false, true]) {
      if (initiallyOverflowing) {
        await composer.fill("Long question\n".repeat(20));
        await expect(composer).toHaveCSS("height", "213px");
        await expect(composer).toHaveCSS("overflow-y", "auto");
      }
      await composer.fill("w".repeat(46));
      await expect(composer).toHaveCSS("height", "100px");
      const geometry = await composer.evaluate((element) => ({
        height: element.clientHeight,
        contentHeight: element.scrollHeight,
      }));
      expect(geometry.contentHeight).toBeLessThanOrEqual(geometry.height);
      await expect(composer).toHaveCSS("overflow-y", "hidden");
    }
  });

  test("selecting assistant transcript text preserves assistant transcript scroll", async ({ page }) => {
    const assistantItems = Array.from({ length: 28 }, (_, index) => ({
      id: `assistant-${index + 1}`,
      type: "assistant-message",
      createdAt: `2026-04-21T12:${String(index).padStart(2, "0")}:00.000Z`,
      text: `Assistant transcript entry ${index + 1}. This is enough text to make the assistant conversation scroll independently.`,
      summary: `Assistant transcript entry ${index + 1}.`,
      sourceLanguageCode: "es",
      targetLanguageCode: "vi",
      details: {
        providerId: "openai",
        modelId: "gpt-5.4",
        sourceText: "alpha 0001 source text",
      },
    }));
    assistantItems.push({
      id: "assistant-draft-1",
      type: "draft-translation",
      createdAt: "2026-04-21T12:30:00.000Z",
      text: "Draft translation",
      draftTranslationText: "Ban dich moi tu AI Assistant.",
      sourceLanguageCode: "es",
      targetLanguageCode: "vi",
      details: {
        providerId: "openai",
        modelId: "gpt-5.4",
        sourceText: "alpha 0001 source text",
      },
    });

    await mountEditorFixture(page, {
      rowCount: 1,
      assistant: {
        activeThreadKey: "fixture-row-0001::es::vi",
        threadsByKey: {
          "fixture-row-0001::es::vi": {
            rowId: "fixture-row-0001",
            sourceLanguageCode: "es",
            targetLanguageCode: "vi",
            items: assistantItems,
          },
        },
      },
    });

    await page.locator('[data-action="switch-editor-sidebar-tab:translate"]').click();
    const transcript = page.locator(".assistant-transcript");
    await expect(transcript).toBeVisible();
    await page.evaluate(() => {
      const transcriptElement = document.querySelector(".assistant-transcript");
      if (transcriptElement instanceof HTMLElement) {
        transcriptElement.scrollTop = Math.floor(transcriptElement.scrollHeight / 2);
      }
    });
    const beforeScrollTop = await page.evaluate(() => {
      const transcriptElement = document.querySelector(".assistant-transcript");
      return transcriptElement instanceof HTMLElement ? transcriptElement.scrollTop : 0;
    });
    expect(beforeScrollTop).toBeGreaterThan(0);

    const editorField = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await editorField.click();
    await expect.poll(async () => {
      return await page.evaluate(() => {
        const transcriptElement = document.querySelector(".assistant-transcript");
        return transcriptElement instanceof HTMLElement ? transcriptElement.scrollTop : 0;
      });
    }).toBe(beforeScrollTop);
    await page.mouse.move(910, 280);
    await page.mouse.down();
    await page.mouse.move(910, 360, { steps: 4 });
    await page.mouse.up();

    await expect.poll(async () => {
      return await page.evaluate(() => {
        const transcriptElement = document.querySelector(".assistant-transcript");
        return transcriptElement instanceof HTMLElement ? transcriptElement.scrollTop : 0;
      });
    }).toBe(beforeScrollTop);
  });

  test("assistant draft apply writes into the open empty editor field", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      assistant: {
        activeThreadKey: "fixture-row-0001::es::vi",
        threadsByKey: {
          "fixture-row-0001::es::vi": {
            rowId: "fixture-row-0001",
            sourceLanguageCode: "es",
            targetLanguageCode: "vi",
            items: [{
              id: "assistant-draft-apply-1",
              type: "draft-translation",
              createdAt: "2026-04-21T12:30:00.000Z",
              text: "Draft translation",
              draftTranslationText: "Ban dich da duoc ap dung.",
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
    const editorField = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await editorField.fill("");
    await expect(editorField).toBeFocused();

    await page.locator('[data-action="apply-editor-assistant-draft:assistant-draft-apply-1"]').click();

    const appliedEditorField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])',
    );
    await expect(appliedEditorField).toBeVisible();
    await expect(appliedEditorField).toHaveValue("Ban dich da duoc ap dung.");
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
      // The translate action only renders for an untranslated active row.
      fieldsByRowId: {
        "fixture-row-0001": {
          vi: "",
        },
      },
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

  // The sidebar translate action only renders for untranslated rows now, so
  // this pins scroll stability while translating an empty target.
  test("starting ai translation keeps the scroll position stable", async ({ page }) => {
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
      fieldsByRowId: {
        "fixture-row-0010": {
          vi: "",
        },
      },
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
      // The translate action buttons only render for an untranslated active
      // row — the assistant pane hides them once target text exists.
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "alpha 0001 source text",
          vi: "",
        },
      },
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
    // The visible copy names the provider; the model id lives in the tooltip.
    await expect(page.locator(".translate-ai-action-button__model").nth(0)).toHaveText("Translate with OpenAI");
    await expect(page.locator(".translate-ai-action-button__model").nth(1)).toHaveText("Translate with Gemini");
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
    await mountEditorFixture(page, {
      rowCount: 1,
      // The tools block hides entirely once the viewed language has text, so
      // pin the same-language disabled state on an empty row.
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "",
          vi: "",
        },
      },
    });

    await activateMainEditorField(page, "fixture-row-0001", "es");
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
      // The tools block hides once the viewed language has text; the
      // alternate-target flow only renders for an untranslated fr row.
      fieldsByRowId: {
        "fixture-row-0001": {
          fr: "",
        },
      },
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

    await activateMainEditorField(page, "fixture-row-0001", "fr");
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

    const lastField = await activateMainEditorField(page, "fixture-row-0080", "vi");
    await expect(lastField).toBeVisible();

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

    // The bottom-pin scroll compensation runs after waitForNextPaint() (a double
    // rAF), so the dropzone becoming visible does not mean the pin has fired. On
    // a slow runner the measurement can land in between — the focused row has
    // grown but the viewport has not yet been pulled back to the bottom. Poll
    // until the pin settles, then assert the tight tolerance so a genuinely
    // broken pin (e.g. a row-patch regression) still fails instead of being
    // masked by a looser bound.
    await expect
      .poll(async () => (await readTranslateScrollMetrics(page)).bottomGap)
      .toBeLessThanOrEqual(beforeMetrics.bottomGap + 4);

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

    const lastField = await activateMainEditorField(page, "fixture-row-0080", "vi");
    await expect(lastField).toBeVisible();

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

    const field = await activateMainEditorField(page, "fixture-row-0020", "vi");
    await expect(field).toBeVisible();

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

    const field = await activateMainEditorField(page, "fixture-row-0001", "vi");
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

  test("deleted rows filter reveals collapsed rows and combines with search", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 12 });
    await softDeleteFixtureRow(page, "fixture-row-0003");
    await softDeleteFixtureRow(page, "fixture-row-0008");

    const filter = page.locator("[data-editor-filter-select]");
    await filter.selectOption({ label: "Deleted rows" });
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(2);
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(0);
    await expect(page.locator(".translation-results-banner__text")).toHaveText("Showing 2 matching rows");

    const search = page.locator("[data-editor-search-input]");
    await search.fill("0003");
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(1);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0003"]')).toBeVisible();
    await search.fill("");

    await restoreFixtureRow(page, "fixture-row-0003");
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(1);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0008"]')).toBeVisible();

    await filter.selectOption("show-all");
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(1);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0008"]')).toHaveCount(0);
  });

  test("a new deleted section starts closed even after restoring a previously opened one", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 12 });

    await softDeleteFixtureRow(page, "fixture-row-0003");
    await expect(page.locator("[data-editor-deleted-group]")).toHaveCount(1);
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0003"]')).toHaveCount(0);

    await page.locator("[data-editor-deleted-group] .section-separator").click();
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
    await page.locator("[data-editor-deleted-group] .section-separator").click();
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

    await page.locator("[data-editor-deleted-group] .section-separator").click();
    await expect(page.locator('[data-action="restore-editor-row:fixture-row-0004"]')).toBeVisible();
    await page.locator('[data-action="restore-editor-row:fixture-row-0004"]').click();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0004"]')).toBeVisible();

    await page.locator('[data-action="soft-delete-editor-row:fixture-row-0004"]').click();
    await page.locator("[data-editor-deleted-group] .section-separator").click();
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

  test("glossary popovers follow every source and target occurrence with the standard cursor", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "Kabalistas",
          vi: "nhà Kabbalah học, học giả Kabbalah, Kabbalah",
        },
      },
      glossaryTerms: [{
        termId: "term-kabbalists",
        sourceTerms: ["Kabalistas"],
        targetTerms: ["nhà Kabbalah học", "học giả Kabbalah", "Kabbalah"],
        footnote: "Kabbalah glossary footnote",
      }],
    });

    const row = page.locator('[data-editor-row-card][data-row-id="fixture-row-0001"]');
    const sourceMarks = row.locator(
      '[data-editor-display-field][data-language-code="es"] [data-editor-glossary-mark]',
    );
    const targetMarks = row.locator(
      '[data-editor-display-field][data-language-code="vi"] [data-editor-glossary-mark]',
    );
    await expect(sourceMarks).toHaveCount(1);
    await expect(targetMarks).toHaveCount(3);

    const expectedTitles = [
      "Kabalistas",
      "nhà Kabbalah học",
      "học giả Kabbalah",
      "Kabbalah",
    ];
    const marks = [sourceMarks.first(), ...[0, 1, 2].map((index) => targetMarks.nth(index))];
    for (let index = 0; index < marks.length; index += 1) {
      await expect(marks[index]).toHaveCSS("cursor", "default");
      await marks[index].hover();
      await expect(page.locator(".editor-glossary-tooltip")).toBeVisible();
      await expect(page.locator(".editor-glossary-info-card__title")).toHaveText(expectedTitles[index]);
      await expect(page.locator(".editor-glossary-info-card__footnote")).toHaveText("Kabbalah glossary footnote");
      await expect(page.locator(".editor-glossary-info-card__hint--insert")).toHaveCount(index === 0 ? 0 : 1);
    }

  });

  test("target footnote popovers follow formatted glossary terms across rows", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 3,
      fieldsByRowId: {
        "fixture-row-0001": { es: "Kabalistas", vi: "<strong>nhà Kabbalah học</strong>" },
        "fixture-row-0002": { es: "Gnosis", vi: "<em>ngộ đạo</em>" },
        "fixture-row-0003": { es: "Absoluto", vi: "<u>Tuyệt Đối</u>" },
      },
      glossaryTerms: [
        {
          termId: "term-kabbalists",
          sourceTerms: ["Kabalistas"],
          targetTerms: ["nhà Kabbalah học"],
          footnote: "Kabbalah glossary footnote",
        },
        {
          termId: "term-gnosis",
          sourceTerms: ["Gnosis"],
          targetTerms: ["ngộ đạo"],
          footnote: "Gnosis glossary footnote",
        },
        {
          termId: "term-absolute",
          sourceTerms: ["Absoluto"],
          targetTerms: ["Tuyệt Đối"],
          footnote: "Absolute glossary footnote",
        },
      ],
    });

    const expectedTitles = ["nhà Kabbalah học", "ngộ đạo", "Tuyệt Đối"];
    for (let index = 0; index < expectedTitles.length; index += 1) {
      const rowId = `fixture-row-${String(index + 1).padStart(4, "0")}`;
      const mark = page.locator(
        `[data-editor-row-card][data-row-id="${rowId}"] `
        + '[data-editor-display-field][data-language-code="vi"] [data-editor-glossary-mark]',
      );
      await expect(mark).toHaveCount(1);
      await mark.hover();
      await expect(page.locator(".editor-glossary-tooltip")).toBeVisible();
      await expect(page.locator(".editor-glossary-info-card__title")).toHaveText(expectedTitles[index]);
    }
  });

  test("closed target fields keep ordinary glossary popovers for terms without footnotes", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 1,
      fieldsByRowId: {
        "fixture-row-0001": {
          es: "Kabalistas Lilith Nahemah Lilith",
          vi: "Kabbalah Li-lit Na-hê-ma Li-lit",
        },
      },
      glossaryTerms: [
        {
          termId: "term-kabbalists",
          sourceTerms: ["Kabalistas"],
          targetTerms: ["Kabbalah"],
          footnote: "Kabbalah glossary footnote",
        },
        {
          termId: "term-lilith",
          sourceTerms: ["Lilith"],
          targetTerms: ["Li-lit"],
          notesToTranslators: "Translator guidance",
          footnote: "",
        },
        {
          termId: "term-nahemah",
          sourceTerms: ["Nahemah"],
          targetTerms: ["Na-hê-ma"],
          footnote: "",
        },
      ],
    });

    const targetMarks = page.locator(
      '[data-editor-row-card][data-row-id="fixture-row-0001"] '
      + '[data-editor-display-field][data-language-code="vi"] [data-editor-glossary-mark]',
    );
    await expect(targetMarks).toHaveCount(4);

    const expectedTitles = ["Kabbalah", "Li-lit", "Na-hê-ma", "Li-lit"];
    for (let index = 0; index < expectedTitles.length; index += 1) {
      await targetMarks.nth(index).hover();
      await expect(page.locator(".editor-glossary-tooltip")).toBeVisible();
      await expect(page.locator(".editor-glossary-info-card__title")).toHaveText(expectedTitles[index]);
      await expect(page.locator(".editor-glossary-info-card__label")).toHaveText(
        index === 1 || index === 3 ? ["Note to Translators:"] : [],
      );
      await expect(page.locator(".editor-glossary-info-card__hint--insert")).toHaveCount(index === 0 ? 1 : 0);
    }
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

  for (const destination of ["Projects", "glossary header", "glossary term"]) {
    test(`leaving through ${destination} saves the focused row without Shift+Enter`, async ({ page }) => {
      await page.addInitScript(() => {
        globalThis.__gnosisMockTauriHandlers = {
          async load_gtms_glossary_editor_data() {
            return {
              glossaryId: "fixture-glossary", title: "Fixture Glossary",
              sourceLanguage: { code: "es", name: "Spanish" },
              targetLanguage: { code: "vi", name: "Vietnamese" },
              termCount: 1,
              terms: [{ termId: "term-1", sourceTerms: ["alpha"], targetTerms: ["alpha"],
                notesToTranslators: "", footnote: "" }],
            };
          },
        };
      });
      await mountEditorFixture(page, { rowCount: 6, glossary: true }, { mockTauri: true });
      const field = await activateMainEditorField(page, "fixture-row-0001", "vi");
      const draft = `draft saved when leaving through ${destination}`;
      await field.fill(draft);
      await expect(field).toBeFocused();
      expect((await readMockTauriState(page)).invocations.filter(
        (entry) => entry.command === "update_gtms_editor_row_fields",
      )).toHaveLength(0);

      if (destination === "Projects") {
        await page.locator('[data-nav-target="projects"]').click();
      } else if (destination === "glossary header") {
        await page.locator('[data-action="open-editor-glossary"]').click();
      } else {
        const mark = page.locator(
          '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-display-field][data-language-code="es"] [data-editor-glossary-mark]',
        ).first();
        const bounds = await mark.boundingBox();
        expect(bounds).not.toBeNull();
        // The first click replaces the mark with a textarea; click the same
        // coordinates twice to exercise the real pointer-based term shortcut.
        await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      }

      await expect(page.locator("h1.page-header__title")).toHaveText(
        destination === "Projects" ? "Projects" : "Fixture Glossary",
      );
      await expect.poll(async () => (
        await readMockTauriState(page)
      ).histories["fixture-chapter::fixture-row-0001::vi"]?.[0]?.plainText).toBe(draft);
      const saves = (await readMockTauriState(page)).invocations.filter(
        (entry) => entry.command === "update_gtms_editor_row_fields",
      );
      expect(saves).toHaveLength(1);
    });
  }

  test("active search highlights keep the textarea text geometry after resize", async ({ page }) => {
    const targetText = [
      "Một samyama bao gồm ba bước: quán tưởng, thiền và định.[1] Đầu tiên, người yogi chú tâm vào cơ thể vật chất của mình.",
      "Tiếp theo, người ấy thiền và tập trung vào thân thể, khiến nó dần rơi vào trạng thái ngủ.[2] Cuối cùng, trong trạng thái định,",
      "người yogi ngồi dậy, rời khỏi giường với cơ thể vật lý trong trạng thái Jinn. Khi đó, người ấy có thể thâm nhập vào siêu không gian,",
      "thoát khỏi luật hấp dẫn và lơ lửng trong không trung.",
    ].join(" ");
    await page.setViewportSize({ width: 1500, height: 900 });
    await mountEditorFixture(page, {
      rowCount: 1,
      fieldsByRowId: {
        "fixture-row-0001": { vi: targetText },
      },
    });

    await page.locator("[data-editor-search-input]").fill("siêu không gian");
    const textarea = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await expect(page.locator(
      '[data-editor-row-card][data-row-id="fixture-row-0001"] [data-editor-search-highlight]',
    )).toBeVisible();
    await textarea.evaluate((element) => {
      const matchStart = element.value.indexOf("siêu không gian");
      element.focus();
      element.setSelectionRange(matchStart, matchStart);
    });
    await page.setViewportSize({ width: 980, height: 900 });

    await expect.poll(async () => {
      return await textarea.evaluate((element) => element.scrollHeight - element.clientHeight);
    }).toBeLessThanOrEqual(2);
    const geometry = await textarea.evaluate((element) => {
      const stack = element.closest("[data-editor-glossary-field-stack]");
      const overlay = stack?.querySelector("[data-editor-search-highlight]");
      return overlay instanceof HTMLElement
        ? {
            textareaClientWidth: element.clientWidth,
            overlayClientWidth: overlay.clientWidth,
            textareaScrollHeight: element.scrollHeight,
            overlayScrollHeight: overlay.scrollHeight,
            textareaScrollTop: element.scrollTop,
            overlayScrollTop: overlay.scrollTop,
          }
        : null;
    });

    expect(geometry).not.toBeNull();
    expect(geometry.overlayClientWidth).toBe(geometry.textareaClientWidth);
    expect(geometry.overlayScrollHeight).toBe(geometry.textareaScrollHeight);
    expect(geometry.overlayScrollTop).toBe(geometry.textareaScrollTop);
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
      if (!(field instanceof HTMLButtonElement)) {
        return null;
      }

      const fieldStyle = getComputedStyle(field);
      return {
        hasMainTextarea: mainTextarea instanceof HTMLTextAreaElement,
        // The search overlay is an editing-mode layer; display mode bakes
        // highlights into the static text and must not mount an overlay.
        hasSearchOverlay: searchLayer instanceof HTMLElement,
        fieldColor: fieldStyle.color,
        fieldTextFillColor: fieldStyle.webkitTextFillColor,
      };
    });

    expect(styles).not.toBeNull();
    const transparentColorPattern =
      /^(?:transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\))$/i;
    expect(styles.hasMainTextarea).toBe(false);
    expect(styles.hasSearchOverlay).toBe(false);
    expect(styles.fieldColor).not.toMatch(transparentColorPattern);
    expect(styles.fieldTextFillColor).not.toMatch(transparentColorPattern);
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
      targetVariantNote: "",
      variants: [{ text: "buong noi tam", note: "" }],
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

    // The pivot text saves in its own write before the translation lands, so
    // wait for the final save to carry the translated target.
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      const saves = (mockState?.invocations ?? [])
        .filter((entry) => entry.command === "update_gtms_editor_row_fields")
        .map((entry) => entry.payload?.input?.fields ?? null)
        .filter(Boolean);
      return saves.at(-1) ?? null;
    }).toEqual(expect.objectContaining({
      es: "La camara interior brilla.",
      vi: "Buong noi tam sang len.",
    }));

    const mockState = await readMockTauriState(page);
    const firstSaveFields = (mockState?.invocations ?? [])
      .filter((entry) => entry.command === "update_gtms_editor_row_fields")
      .map((entry) => entry.payload?.input?.fields ?? null)
      .filter(Boolean)
      .at(0);
    expect(firstSaveFields?.es).toBe("La camara interior brilla.");

    await expect.poll(async () => {
      const nextMockState = await readMockTauriState(page);
      return nextMockState?.histories?.["fixture-chapter::fixture-row-0001::es"]?.[0]?.plainText ?? null;
    }).toBe("La camara interior brilla.");
  });

  // Since df2d84c0 (persist derived glossaries for stale reuse), derived
  // highlights are only valid for the exact source text they were computed
  // from — editing the source hides them until a translation recomputes.
  test("derived glossary source highlights hide after the source text changes", async ({ page }) => {
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
    }).toBe(0);
  });

  test("Windows fixture glossary highlights survive delete show hide and restore", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 80, glossary: true }, { path: "/?platform=windows" });

    const rowId = "fixture-row-0030";
    const rowCard = page.locator(`[data-editor-row-card][data-row-id="${rowId}"]`);
    const deletedGroupToggle = page.locator("[data-editor-deleted-group] .section-separator");

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

  test("pasting multiline text keeps native undo and redo across virtual range changes", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 80 });
    const field = await activateMainEditorField(page, "fixture-row-0001", "vi");
    const originalText = await field.inputValue();
    await field.evaluate((element) => {
      element.setSelectionRange(0, element.value.length);
      window.__fieldBeforePaste = element;
    });
    const mountedCount = await page.locator("[data-editor-row-card]").count();
    const pastedText = Array.from({ length: 30 }, (_, index) => `Pasted line ${index + 1}`).join("\n");
    // Insert in one native editing transaction, as plain-text paste does. Unlike
    // fill()/assigning .value, this populates the browser's native undo history.
    await page.keyboard.insertText(pastedText);
    await expect(field).toHaveValue(pastedText);
    await expect.poll(() => page.locator("[data-editor-row-card]").count()).toBeLessThan(mountedCount);

    await field.press("ControlOrMeta+z");
    await expect(field).toHaveValue(originalText);
    await expect.poll(() => page.locator("[data-editor-row-card]").count()).toBe(mountedCount);
    await field.press("ControlOrMeta+Shift+z");
    await expect(field).toHaveValue(pastedText);
    expect(await field.evaluate((element) => element === window.__fieldBeforePaste)).toBe(true);
    await expect(field).toBeFocused();
  });

  test("patching the focused row keeps the textarea node and its native undo stack", async ({ page }) => {
    const targetRowId = "fixture-row-0005";
    await mountEditorFixture(page, { rowCount: 12 });

    const field = await activateMainEditorField(page, targetRowId, "vi");
    const originalText = await field.inputValue();
    await field.evaluate((element) => {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
      window.__focusedFieldBeforePatch = element;
    });
    await page.keyboard.type(" edited");
    await expect(field).toHaveValue(`${originalText} edited`);

    // Use an editable row update. A stale row intentionally cancels beforeinput,
    // including native historyUndo in WebKit, so it cannot test undo retention.
    const patchResult = await patchFixtureRow(page, targetRowId, {
      textStyle: "heading2",
    });
    expect(patchResult?.patchedVisible).toBe(true);
    expect(patchResult?.patchedRowIds).toEqual([targetRowId]);
    expect(await field.evaluate((element) =>
      element.closest("[data-row-text-style]")?.dataset.rowTextStyle,
    )).toBe("heading2");

    const preservation = await field.evaluate((element) => ({
      sameNode: element === window.__focusedFieldBeforePatch,
      focused: document.activeElement === element,
    }));
    expect(preservation.sameNode).toBe(true);
    expect(preservation.focused).toBe(true);

    // Typing may span several native undo groups; undoing them all must land
    // back on the original text. A recreated textarea has nothing to undo.
    for (let step = 0; step < 8 && await field.inputValue() !== originalText; step += 1) {
      await field.press("ControlOrMeta+z");
    }
    await expect(field).toHaveValue(originalText);
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
    // Grow the row noticeably but keep the next row inside the zero-overscan
    // virtual window, or its card unmounts and the layout metrics go null.
    const expandedPatchText = Array.from(
      { length: 10 },
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

    await bringRowNearTop(page, targetRowId, 120);

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

    await bringRowNearTop(page, targetRowId, 120);
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

    await bringRowNearTop(page, targetRowId, 60);

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

    await bringRowNearTop(page, targetRowId, 120);
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

    await bringRowNearTop(page, targetRowId, 120);
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

  // The refresh flow reloads the chapter with preserveVisibleRows by design
  // now; what this pins is the synced row text landing and the viewport
  // surviving the refresh.
  test("refreshing the translate editor syncs a safe visible row in place", async ({ page }) => {
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

    await bringRowNearTop(page, targetRowId, 120);
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

    await bringRowNearTop(page, targetRowId, 120);
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

    await bringRowNearTop(page, targetRowId, 120);
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

    await bringRowNearTop(page, targetRowId, 120);

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
    // The refresh flow pre-loads the chapter once, then a large stale batch
    // triggers exactly one additional blocking reload — never per-row loads.
    expect(mockState.invocations.filter((entry) => entry.command === "load_gtms_chapter_editor_data")).toHaveLength(2);
    expect(mockState.invocations.some((entry) => entry.command === "load_gtms_editor_row")).toBe(false);
  });

  test("first-seen long rows keep the visible anchor stable after virtualized measurement", async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 160,
      fieldsByRowId: buildLongVirtualizationFieldsByRowId(160),
    }, { path: "/?platform=windows" });

    await setTranslateScrollTop(page, 950);
    await page.waitForTimeout(80);
    await setTranslateScrollTop(page, 3900);
    await page.waitForTimeout(160);

    const afterCommitRow = await readTopVisibleRowMetrics(page);
    const afterCommitScrollTop = await readTranslateScrollTop(page);
    expect(afterCommitRow).not.toBeNull();

    await setTranslateScrollTop(page, afterCommitScrollTop + 1);
    await page.waitForTimeout(80);

    const afterNudgeRow = await readTopVisibleRowMetrics(page);
    expect(afterNudgeRow).not.toBeNull();
    expect(afterNudgeRow.rowId).toBe(afterCommitRow.rowId);
    expect(Math.abs(afterNudgeRow.rowTop - afterCommitRow.rowTop)).toBeLessThanOrEqual(3);
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

    test(`a shallow ${label}-mode scroll does not jump backward after layout measurement`, async ({ page }) => {
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

    test(`a second shallow ${label}-mode scroll does not reuse a stale layout anchor`, async ({ page }) => {
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

    test(`a longer ${label}-mode scroll does not jump backward after layout measurement`, async ({ page }) => {
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

    const firstField = await activateMainEditorField(page, "fixture-row-0001", "vi");
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

    const heading2Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading2"]',
    );

    const targetField = await activateMainEditorField(page, "fixture-row-0001", "vi");
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

    const heading1Button = page.locator(
      '[data-editor-row-text-style-button][data-row-id="fixture-row-0001"][data-language-code="vi"][data-text-style="heading1"]',
    );
    const footnoteButton = page.locator(
      '[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );

    // Save the footnote first, then the style change: the newest history
    // entry then carries the footnote AND diffs its style against the
    // previous entry, which is what the grouped last-update note shows.
    await activateMainEditorField(page, "fixture-row-0001", "vi");
    await footnoteButton.evaluate((button) => button.click());

    const footnoteField = page.locator(
      '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"][data-content-kind="footnote"]',
    );
    await expect(footnoteField).toBeVisible();
    await page.keyboard.type("Grouped footnote");
    await page.locator("[data-editor-search-input]").click();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.footnote ?? null;
    }).toBe("Grouped footnote");

    await activateMainEditorField(page, "fixture-row-0001", "vi");
    await heading1Button.click();
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.textStyles?.["fixture-chapter"]?.["fixture-row-0001"] ?? null;
    }).toBe("heading1");

    await activateMainEditorField(page, "fixture-row-0001", "vi");
    // The sidebar defaults to the AI Assistant tab; the last-update group
    // renders in the Review pane.
    await page.locator('[data-action="switch-editor-sidebar-tab:review"]').click();

    const reviewLastUpdateGroup = page.locator(".history-group").first();
    const reviewStyleNote = reviewLastUpdateGroup.locator(".history-item__style-note");
    const reviewFootnoteContent = reviewLastUpdateGroup.locator(".history-item__content--footnote");

    await expect(reviewStyleNote).toContainText("Style change");
    await expect(reviewStyleNote.locator(".history-diff__delete")).toHaveText("P");
    await expect(reviewStyleNote.locator(".history-diff__insert")).toHaveText("H1");
    await expect(reviewFootnoteContent).toContainText("Grouped footnote");
    await expect(reviewFootnoteContent).toHaveCSS("font-style", "normal");
    await expect(reviewFootnoteContent).toHaveCSS("opacity", "0.7");

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".history-tabs__item--active")).toHaveText("History");

    const historyStyleNote = page.locator(".history-item__style-note").first();
    const historyFootnoteContent = page.locator(".history-item__content--footnote").first();
    await expect(historyStyleNote).toContainText("Style change");
    await expect(historyStyleNote.locator(".history-diff__delete")).toHaveText("P");
    await expect(historyStyleNote.locator(".history-diff__insert")).toHaveText("H1");
    await expect(historyFootnoteContent).toContainText("Grouped footnote");
    await expect(historyFootnoteContent).toHaveCSS("font-style", "normal");
    await expect(historyFootnoteContent).toHaveCSS("opacity", "0.7");
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
    expect(quoteMetrics.fontSizePx).toBeCloseTo(paragraphMetrics.fontSizePx, 2);

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

  test("custom HTML textarea keeps native undo after the style save settles", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__customHtmlStyleSaveResolved = false;
      globalThis.__gnosisMockTauriHandlers = {
        ...(globalThis.__gnosisMockTauriHandlers ?? {}),
        async update_gtms_editor_row_text_style(payload) {
          await new Promise((resolve) => window.setTimeout(resolve, 140));
          const input = payload?.input ?? {};
          globalThis.__customHtmlStyleSaveResolved = true;
          return {
            rowId: input.rowId,
            textStyle: input.textStyle ?? "paragraph",
          };
        },
      };
    });

    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });
    const telemetrySaveButton = page.getByRole("button", { name: "Save" });
    if (await telemetrySaveButton.count()) {
      await telemetrySaveButton.click();
      await expect(page.locator(".modal-backdrop")).toHaveCount(0);
    }

    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    const originalValue = "alpha 0001 target text";
    const typedHtml = " <strong>draft</strong>";
    const targetField = await activateMainEditorField(page, rowId, languageCode);
    const customHtmlButton = page.locator(
      `[data-editor-row-text-style-button][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-text-style="custom_html"]`,
    );

    await targetField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await clickLocatorCenter(page, customHtmlButton);
    await expect(targetField).toHaveClass(/translation-language-panel__field--custom-html/);

    await targetField.evaluate((element) => {
      element.focus();
      element.selectionStart = element.value.length;
      element.selectionEnd = element.value.length;
    });
    await page.keyboard.type(typedHtml);
    const editedValue = `${originalValue}${typedHtml}`;
    await expect(targetField).toHaveValue(editedValue);

    await page.waitForFunction(() => globalThis.__customHtmlStyleSaveResolved === true);
    await expect(targetField).toBeFocused();

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
    await expect.poll(async () => {
      return (await targetField.inputValue()).length;
    }).toBeLessThan(editedValue.length);
    await expect(targetField).toHaveValue(/alpha 0001 target text/);
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
    expect(baselineFootnoteMetrics.fontStyle).toBe("normal");
    expect(baselineFootnoteMetrics.opacity).toBe(0.7);

    await clickLocatorCenter(page, heading1Button);
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.fontSizePx ?? 0;
    }).toBeGreaterThan(paragraphMetrics.fontSizePx);

    const headingFootnoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi", "footnote");
    expect(headingFootnoteMetrics.fontStyle).toBe("normal");
    expect(headingFootnoteMetrics.opacity).toBe(0.7);
    expect(headingFootnoteMetrics.fontSizePx).toBeCloseTo(baselineFootnoteMetrics.fontSizePx, 3);
    expect(headingFootnoteMetrics.paddingLeftPx).toBeCloseTo(baselineFootnoteMetrics.paddingLeftPx, 3);

    await clickLocatorCenter(page, quoteButton);
    await expect.poll(async () => {
      return (await readEditorFieldMetrics(page, "fixture-row-0001", "vi"))?.paddingLeftPx ?? 0;
    }).toBeGreaterThan(paragraphMetrics.paddingLeftPx);

    const quoteFootnoteMetrics = await readEditorFieldMetrics(page, "fixture-row-0001", "vi", "footnote");
    expect(quoteFootnoteMetrics.fontStyle).toBe("normal");
    expect(quoteFootnoteMetrics.opacity).toBe(0.7);
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

  for (const editBody of [false, true]) {
    test(`body blur converts smart quotes with ${editBody ? "edited" : "unchanged"} wording and preserves other languages`, async ({ page }) => {
      const rowId = "fixture-row-0001";
      const source = 'Dice: "yo vi".';
      const target = 'Nói rằng: "Tôi đã nhìn thấy...".';
      await mountEditorFixture(page, {
        rowCount: 18,
        fieldsByRowId: { [rowId]: { es: source, vi: target } },
      }, { mockTauri: true });
      const field = await activateMainEditorField(page, rowId, "vi");
      await expect(field).toBeFocused();
      if (editBody) await field.fill(`${target} Thêm câu.`);
      await page.locator("[data-editor-search-input]").click();

      const expected = `Nói rằng: “Tôi đã nhìn thấy...”.${editBody ? " Thêm câu." : ""}`;
      await expect.poll(async () => (await readMockTauriState(page))
        ?.histories?.[`fixture-chapter::${rowId}::vi`]?.[0]?.plainText).toBe(expected);
      expect((await readMockTauriState(page))
        ?.histories?.[`fixture-chapter::${rowId}::es`]?.[0]?.plainText).toBe(source);
      expect((await readMockTauriState(page))
        ?.histories?.[`fixture-chapter::${rowId}::vi`]?.[0]?.reviewed).toBe(false);
      await expect(page.locator(
        `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="vi"]`,
      )).toContainText(expected);
      const reopened = await activateMainEditorField(page, rowId, "vi");
      await expect(reopened).toHaveValue(expected);
      const saves = (await readMockTauriState(page)).invocations.filter(
        (entry) => entry.command === "update_gtms_editor_row_fields" && entry.payload.input.rowId === rowId,
      );
      expect(saves).toHaveLength(1);
    });
  }

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

  test("separator button inserts hr markup and renders a horizontal line after blur", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 40 }, { mockTauri: true });
    const telemetrySaveButton = page.getByRole("button", { name: "Save" });
    if (await telemetrySaveButton.count()) {
      await telemetrySaveButton.click();
      await expect(page.locator(".modal-backdrop")).toHaveCount(0);
    }

    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    const targetField = await activateMainEditorField(page, rowId, languageCode);
    const separatorButton = page.locator(
      `[data-editor-separator-button][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );

    await targetField.fill("alpha beta gamma");
    await setEditorSelectionRange(page, rowId, languageCode, "alpha ".length, "alpha beta".length);
    await clickLocatorCenter(page, separatorButton);
    await expect(targetField).toBeVisible();
    await expect(targetField).toHaveValue("alpha <hr> gamma");

    await page.locator("[data-editor-search-input]").click();
    const displayField = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"] [data-editor-display-text]`,
    );
    await expect(displayField.locator(".translation-language-panel__inline-separator")).toHaveCount(1);
    await expect(displayField).toContainText("alpha");
    await expect(displayField).toContainText("gamma");
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
    // Opening a footnote appends its inline marker token to the main field,
    // attached directly to the preceding text with no separator space.
    await expect(await readEditorFieldValue(page, rowId, languageCode)).toBe("alpha 0001 target text[1]");
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

  for (const contentKind of ["image-caption", "field", "footnote"]) {
    test(`inserting a ${contentKind} link supports native undo and redo`, async ({ page }) => {
      const rowId = "fixture-row-0001";
      const languageCode = "vi";
      await mountEditorFixture(page, {
        rowCount: 2,
        chapterStatus: "ready",
        imagesByRowId: { [rowId]: { [languageCode]: { kind: "url", url: "https://example.com/caption.png" } } },
      }, { mockTauri: true });
      const main = await activateMainEditorField(page, rowId, languageCode);
      await page.evaluate(() => history.replaceState(null, "", "?platform=mac"));
      let caption = main;
      if (contentKind === "image-caption") caption = await activateImageCaptionEditor(page, rowId, languageCode);
      if (contentKind === "footnote") {
        await clickLocatorCenter(page, page.locator(`[data-editor-footnote-button][data-row-id="${rowId}"][data-language-code="${languageCode}"]`));
        caption = page.locator(`[data-editor-row-field][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-content-kind="footnote"]`);
      }
      const beforeTyping = await caption.inputValue();
      await caption.fill("A caption with linked text.");
      await caption.press("End");
      await caption.pressSequentially(" More");
      await setEditorSelectionRange(page, rowId, languageCode, 15, 21, contentKind);
      await caption.evaluate((field) => { window.__captionBeforeLink = field; });
      await clickLocatorCenter(page, page.locator(`[data-action="open-editor-insert-link"][data-row-id="${rowId}"][data-language-code="${languageCode}"]`));
      const modal = page.getByRole("dialog", { name: "Paste the link URL", exact: true });
      await modal.locator("[data-editor-insert-link-url-input]").fill("https://example.com/link");
      await modal.getByRole("button", { name: "Ok", exact: true }).click();
      const plain = "A caption with linked text. More";
      const linked = 'A caption with <a href="https://example.com/link">linked</a> text. More';
      await expect(caption).toHaveValue(linked);
      await expect(caption).toBeFocused();
      await caption.press("Meta+z");
      await expect(caption).toHaveValue(plain);
      await expect.poll(() => page.evaluate((kind) => {
        const row = window.__gnosisDebug.readEditorState().rows[0];
        return kind === "field" ? row.fields.vi : kind === "image-caption" ? row.imageCaptions.vi : row.footnotes.vi.find((entry) => entry.marker === 1)?.text;
      }, contentKind)).toBe(plain);
      await caption.press("Meta+Shift+z");
      await expect(caption).toHaveValue(linked);
      expect(await caption.evaluate((field) => field === window.__captionBeforeLink)).toBe(true);
      // Updating an existing href is another single undo step, without nesting.
      const selected = linked.indexOf(">linked") + 1;
      await setEditorSelectionRange(page, rowId, languageCode, selected, selected + 6, contentKind);
      await clickLocatorCenter(page, page.locator(`[data-action="open-editor-insert-link"][data-row-id="${rowId}"][data-language-code="${languageCode}"]`));
      await modal.locator("[data-editor-insert-link-url-input]").fill("https://example.com/updated");
      await modal.getByRole("button", { name: "Ok", exact: true }).click();
      await expect(caption).toHaveValue(linked.replace("/link", "/updated"));
      await caption.press("Meta+z");
      await expect(caption).toHaveValue(linked);
      await caption.press("Meta+z");
      await expect(caption).toHaveValue(plain);
      for (let step = 0; step < 8 && await caption.inputValue() !== beforeTyping; step += 1) {
        await caption.press("Meta+z");
      }
      await expect(caption).toHaveValue(beforeTyping);
    });
  }

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

    const reviewedButton = page.locator(
      '[data-action="toggle-editor-reviewed"][data-row-id="fixture-row-0002"][data-language-code="vi"]',
    );

    const firstField = await activateMainEditorField(page, "fixture-row-0001", "vi");
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

    // Rows render as static display fields until activated.
    const firstDisplayText = page.locator(
      '[data-editor-language-cluster][data-row-id="fixture-row-0001"][data-language-code="vi"] [data-editor-display-text]',
    );
    await expect(firstDisplayText).toHaveText("alpha 0001x target text");

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

    await expect(firstDisplayText).toHaveText("alpha 0001 target text");
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.plainText ?? null;
    }).toBe("alpha 0001 target text");
  });

  test("history restore updates the active field through the backend flow", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const firstField = await activateMainEditorField(page, "fixture-row-0001", "vi");
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

    const activeField = await activateMainEditorField(page, "fixture-row-0001", "vi");
    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".history-tabs__item--active")).toHaveText("History");
    await expect(activeField).toBeFocused();

    const restoreButton = page.getByRole("button", { name: "Restore" }).first();
    await restoreButton.click();

    await expect(activeField).toBeFocused();
    await expect(activeField).toHaveValue("alpha 0001 target text");
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.operationType ?? null;
    }).toBe("restore");
  });

  test("footnotes open from the action row, save through row persistence, and stay visible in history", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    const inactiveSourcePanel = page.locator(
      '[data-editor-language-panel][data-row-id="fixture-row-0001"][data-language-code="es"]',
    );
    const activeTargetPanel = page.locator(
      '[data-editor-language-panel][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const footnoteButton = page.locator(
      '[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );

    await activateMainEditorField(page, "fixture-row-0001", "vi");
    await expect(footnoteButton).toBeVisible();
    await expect(
      activeTargetPanel.locator('.translation-row-text-style-actions__separator').first(),
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
    // Rows support multiple footnotes now, so the add button stays available
    // while a footnote editor is open.
    await expect(footnoteButton).toBeVisible();
    await expect(footnoteField).toHaveCSS("font-style", "normal");
    await expect(footnoteField).toHaveCSS("opacity", "0.7");

    await page.keyboard.type("Saved footnote text");
    await expect.poll(async () => {
      const editorState = await page.evaluate(() => window.__gnosisDebug.readEditorState());
      return {
        dirtyRowIds: editorState?.dirtyRowIds ?? [],
        footnote: editorState?.rowFootnotes?.["fixture-row-0001"]?.vi ?? null,
      };
    }).toEqual({
      dirtyRowIds: ["fixture-row-0001"],
      // Footnotes are stored as marker/text entries now.
      footnote: [{ marker: 1, text: "Saved footnote text" }],
    });
    await page.locator("[data-editor-search-input]").click();

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.footnotes?.["fixture-chapter"]?.["fixture-row-0001"]?.vi ?? null;
    }).toBe("Saved footnote text");
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.histories?.["fixture-chapter::fixture-row-0001::vi"]?.[0]?.footnote ?? null;
    }).toBe("Saved footnote text");

    // Blurring collapses the footnote editor to its static display.
    await expect(
      page.locator('[data-editor-footnote-display][data-row-id="fixture-row-0001"][data-language-code="vi"]'),
    ).toContainText("Saved footnote text");

    await activateMainEditorField(page, "fixture-row-0001", "vi");
    // The sidebar defaults to the AI Assistant tab; footnote content shows in
    // the Review pane.
    await page.locator('[data-action="switch-editor-sidebar-tab:review"]').click();
    const reviewFootnoteContent = page.locator(".history-item__content--footnote").first();
    await expect(reviewFootnoteContent).toContainText("Saved footnote text");
    await expect(reviewFootnoteContent).toHaveCSS("font-style", "normal");
    await expect(reviewFootnoteContent).toHaveCSS("opacity", "0.7");

    await page.getByRole("button", { name: "History" }).click();
    await expect(page.locator(".history-tabs__item--active")).toHaveText("History");
    const historyFootnoteContent = page.locator(".history-item__content--footnote").first();
    await expect(historyFootnoteContent).toContainText("Saved footnote text");
    await expect(historyFootnoteContent).toHaveCSS("font-style", "normal");
    await expect(historyFootnoteContent).toHaveCSS("opacity", "0.7");
  });

  test("glossary-error filtering preserves scroll when a footnote closes into body editing", async ({ page }) => {
    const rowId = "fixture-row-0010";
    const languageCode = "vi";
    await mountEditorFixture(page, {
      rowCount: 18,
      glossary: true,
      fieldsByRowId: Object.fromEntries(Array.from({ length: 18 }, (_, index) => [
        `fixture-row-${String(index + 1).padStart(4, "0")}`,
        { es: "alpha source", vi: "Body text without the glossary translation. ".repeat(12) },
      ])),
    }, { mockTauri: true });
    const body = page.locator(
      `[data-editor-display-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await body.click();
    await page.locator(
      `[data-editor-footnote-button][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    ).click();
    const footnote = page.locator(
      `[data-editor-row-field][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-content-kind="footnote"]`,
    );
    await expect(footnote).toBeFocused();
    await footnote.fill("A footnote to preserve while switching editors.");
    await page.locator("[data-editor-search-input]").click();
    await expect.poll(async () => (await readMockTauriState(page))
      ?.footnotes?.["fixture-chapter"]?.[rowId]?.vi).toBe("A footnote to preserve while switching editors.");
    await page.locator("[data-editor-filter-select]").selectOption("has-glossary-error");
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(18);
    const footnoteDisplay = page.locator(
      `[data-editor-footnote-display][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    );
    await footnoteDisplay.click();
    await expect(footnote).toBeFocused();
    await footnote.fill("Edited footnote to preserve while switching editors.");
    await body.evaluate(async (element) => {
      const container = element.closest(".translate-main-scroll");
      container.scrollTop += element.getBoundingClientRect().top
        - container.getBoundingClientRect().top - 80;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const before = await readTranslateScrollTop(page);
    expect(before).toBeGreaterThan(100);
    const box = await body.boundingBox();
    // Use a physical click so the test cannot scroll a remounted field into view.
    await page.mouse.click(box.x + 50, box.y + 20);
    const mainField = page.locator(
      `[data-editor-row-field][data-row-id="${rowId}"][data-language-code="${languageCode}"]:not([data-content-kind])`,
    );
    await expect(mainField).toBeFocused();
    await expect(footnote).toHaveCount(0);
    await expect(footnoteDisplay).toContainText("Edited footnote");
    await expect.poll(async () => Math.abs((await readTranslateScrollTop(page)) - before)).toBeLessThan(4);
    await page.locator("[data-editor-search-input]").click();
    await expect.poll(async () => (await readMockTauriState(page))
      ?.footnotes?.["fixture-chapter"]?.[rowId]?.vi).toBe("Edited footnote to preserve while switching editors.");
  });

  test("footnote paragraphs format on blur while native typing and stored returns stay unchanged", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 18, chapterStatus: "ready" }, { mockTauri: true });
    const rowId = "fixture-row-0001";
    await activateMainEditorField(page, rowId, "vi");
    await page.locator(`[data-editor-footnote-button][data-row-id="${rowId}"][data-language-code="vi"]`).click();
    const field = page.locator(`textarea[data-editor-row-field][data-row-id="${rowId}"][data-language-code="vi"][data-content-kind="footnote"]`);
    await expect(field).toBeFocused();
    await field.pressSequentially("First paragraph.");
    await field.press("Enter");
    await field.pressSequentially("Second paragraph.");
    await expect(field).toHaveValue("First paragraph.\nSecond paragraph.");
    await page.locator("[data-editor-search-input]").click();
    const display = page.locator(`[data-editor-footnote-display][data-row-id="${rowId}"][data-language-code="vi"]`);
    const paragraphs = display.locator(".footnote-paragraph");
    await expect(paragraphs).toHaveCount(2);
    await expect(paragraphs.nth(0)).toHaveCSS("text-indent", "0px");
    const fontSize = await paragraphs.nth(1).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    await expect(paragraphs.nth(1)).toHaveCSS("text-indent", `${fontSize * 1.5}px`);
    const geometry = await paragraphs.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }));
    expect(Math.abs(geometry[1].top - geometry[0].bottom)).toBeLessThan(1);
    await expect.poll(async () => (await readMockTauriState(page))?.footnotes?.["fixture-chapter"]?.[rowId]?.vi)
      .toBe("First paragraph.\nSecond paragraph.");
    await display.click();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("First paragraph.\nSecond paragraph.");
    await page.locator("[data-editor-search-input]").click();
    await page.locator('[data-action="set-editor-mode:preview"]').click();
    const previewParagraphs = page.locator('.wp-block-footnotes .footnote-paragraph');
    await expect(previewParagraphs).toHaveCount(2);
    await expect(previewParagraphs.nth(0)).toHaveCSS("text-indent", "0px");
    const previewFont = await previewParagraphs.nth(1).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
    await expect(previewParagraphs.nth(1)).toHaveCSS("text-indent", `${previewFont * 1.5}px`);
  });

  test("a referenced empty footnote survives blur, save, and reopen", async ({ page }) => {
    const rowId = "fixture-row-0001";
    const languageCode = "vi";
    await mountEditorFixture(page, { rowCount: 18 }, { mockTauri: true });

    await activateMainEditorField(page, rowId, languageCode);
    await page.locator(
      `[data-editor-footnote-button][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
    ).click();

    const footnoteField = page.locator(
      `[data-editor-row-field][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-content-kind="footnote"][data-footnote-marker="1"]`,
    );
    await expect(footnoteField).toBeFocused();
    await expect(footnoteField).toHaveValue("");

    await page.locator("[data-editor-search-input]").click();
    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return mockState?.footnotes?.["fixture-chapter"]?.[rowId]?.[languageCode] ?? null;
    }).toBe("[1]");

    await setTranslateScrollTop(page, 0);
    await expect(page.locator(`[data-editor-row-card][data-row-id="${rowId}"]`)).toBeVisible();
    await activateMainEditorField(page, rowId, languageCode);

    const closedFootnote = page.locator(
      `[data-editor-footnote-display][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-footnote-marker="1"]`,
    );
    await expect(closedFootnote).toBeVisible();
    // Hold through a frame so blur cannot replace the pressed marker before mouseup.
    await closedFootnote.locator(".translation-language-panel__footnote-marker").click({ delay: 150 });
    await expect(footnoteField).toBeFocused();
    await expect(footnoteField).toHaveValue("");
  });

  for (const firstClick of ["whitespace", "text"]) {
    for (const reselectCurrentRow of [false, true]) {
      test(`delayed ${firstClick} activation yields to ${reselectCurrentRow ? "reselecting the current row" : "a newer row selection"}`, async ({ page }) => {
        await page.addInitScript(() => {
          let releaseRowLoad;
          const rowLoadGate = new Promise((resolve) => { releaseRowLoad = resolve; });
          window.__releaseMockRowLoad = releaseRowLoad;
          window.__gnosisMockTauriHandlers = {
            async load_gtms_editor_row(payload) {
              window.__mockRowLoadStarted = true;
              await rowLoadGate;
              return {
                row: {
                  rowId: payload.input.rowId,
                  orderKey: "00001",
                  lifecycleState: "active",
                  commentCount: 0,
                  commentsRevision: 0,
                  textStyle: "paragraph",
                  fields: { es: "reloaded source text", vi: "reloaded target text" },
                  footnotes: { es: "", vi: "" },
                  fieldStates: {
                    es: { reviewed: false, pleaseCheck: false },
                    vi: { reviewed: false, pleaseCheck: false },
                  },
                },
              };
            },
          };
        });
        await mountEditorFixture(page, { rowCount: 6, chapterStatus: "ready" }, { mockTauri: true });
        const clickCardWhitespace = async (rowId) => {
          const card = page.locator(`[data-editor-row-card][data-row-id="${rowId}"] .card--translation`);
          await card.scrollIntoViewIfNeeded();
          const bounds = await card.boundingBox();
          await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + 1);
        };
        if (reselectCurrentRow) {
          await clickCardWhitespace("fixture-row-0002");
          await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId))
            .toBe("fixture-row-0002");
        }
        await page.evaluate(() => window.__gnosisDebug.setEditorRowSyncState("fixture-row-0001", { freshness: "stale" }));
        if (firstClick === "whitespace") {
          await clickCardWhitespace("fixture-row-0001");
        } else {
          await page.locator('[data-editor-display-field][data-row-id="fixture-row-0001"][data-language-code="vi"]').click();
        }
        await page.waitForFunction(() => window.__mockRowLoadStarted === true);
        await clickCardWhitespace("fixture-row-0002");
        await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId))
          .toBe("fixture-row-0002");
        await page.evaluate(() => window.__releaseMockRowLoad());
        await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().rows
          .find((row) => row.rowId === "fixture-row-0001").fields.vi)).toBe("reloaded target text");
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        const snapshot = await page.evaluate(() => window.__gnosisDebug.readEditorState());
        expect(snapshot.activeRowId).toBe("fixture-row-0002");
        expect(snapshot.activeLanguageCode).toBe("es");
        expect(snapshot.mainFieldEditor.rowId).toBeNull();
        const selected = page.locator("[data-editor-language-panel].is-active");
        await expect(selected).toHaveCount(1);
        await expect(selected).toHaveAttribute("data-row-id", "fixture-row-0002");
        await expect(page.locator("[data-editor-row-field]")).toHaveCount(0);
      });
    }
  }

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

    // Activation controls only render once the row load completes, so click
    // the display field (activation pending behind the gated load), blur
    // away, then release the load: the late completion must not resurrect
    // the editing controls for the blurred row.
    const displayField = page.locator(
      '[data-editor-display-field][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );
    const searchInput = page.locator("[data-editor-search-input]");
    const footnoteButton = page.locator(
      '[data-editor-footnote-button][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    );

    await displayField.click();
    await searchInput.click();
    await expect(footnoteButton).toBeHidden();

    await page.evaluate(() => {
      window.__releaseMockRowLoad?.();
    });

    await expect(footnoteButton).toBeHidden();
    await expect(
      page.locator(
        '[data-editor-row-field][data-row-id="fixture-row-0001"][data-language-code="vi"]:not([data-content-kind])',
      ),
    ).toHaveCount(0);
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
    await expect(page.locator(
      '[data-action="open-editor-comments"][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    )).not.toHaveClass(/is-unread/);
    const deleteCommentButton = page.locator('[data-action^="delete-editor-comment:"]');
    await expect(deleteCommentButton).toBeVisible();

    await deleteCommentButton.click();
    await expect(page.locator(".history-empty")).toContainText("No comments yet for this row.");
    await expect(page.locator(
      '[data-action="open-editor-comments"][data-row-id="fixture-row-0001"][data-language-code="vi"]',
    )).not.toHaveClass(/is-active/);
  });

  test("a comment saved after selecting another row stays read for its author", async ({ page }) => {
    await page.addInitScript(() => {
      globalThis.__gnosisMockTauriHandlers = {
        async save_gtms_editor_row_comment({ input }) {
          await new Promise(resolve => { window.__releaseOwnCommentSave = resolve; });
          return { rowId: input.rowId, commentCount: 1, commentsRevision: 1,
            comments: [{ commentId: "own-comment", authorLogin: "fixture-user", authorName: "Fixture User",
              body: input.body, createdAt: "2026-04-13T09:12:33Z" }] };
        },
      };
    });
    await mountEditorFixture(page, { rowCount: 6 }, { mockTauri: true });
    const marker = page.locator('[data-action="open-editor-comments"][data-row-id="fixture-row-0001"][data-language-code="vi"]');
    await marker.click();
    await page.locator("[data-editor-comment-draft]").fill("My own comment.");
    await page.getByRole("button", { name: "Save comment" }).click();
    await page.waitForFunction(() => typeof window.__releaseOwnCommentSave === "function");
    await page.locator('[data-editor-display-field][data-row-id="fixture-row-0002"][data-language-code="vi"]').click();
    await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId)).toBe("fixture-row-0002");
    await page.evaluate(() => window.__releaseOwnCommentSave());
    await expect(marker).toHaveClass(/is-active/);
    await expect(marker).not.toHaveClass(/is-unread/);
    await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().commentSeenRevisions))
      .toMatchObject({ "fixture-row-0001": 1 });
    await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId)).toBe("fixture-row-0002");
  });

  // Scroll guarantee acceptance suite — pins the invariants listed in
  // plans/editor-scroll-ownership-redesign-plan.md. Every redesign phase must
  // keep these green (except the expected failure flagged for Phase 1).
  test.describe("scroll guarantees", () => {
    const STABLE_SCROLL_TOLERANCE_PX = 4;
    const FIXTURE_IMAGE_SVG_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="#3366aa"/></svg>',
    )}`;

    async function waitForStableRowLayout(page, rowId) {
      let previous = null;
      await expect.poll(async () => {
        const metrics = await readSingleRowLayoutMetrics(page, rowId);
        const stable =
          previous !== null
          && metrics !== null
          && Math.abs(metrics.targetHeight - previous.targetHeight) < 1
          && Math.abs(metrics.targetTop - previous.targetTop) < 1;
        previous = metrics;
        return stable;
      }).toBe(true);
      return previous;
    }


    test("guarantee 5: deleting an image keeps the image row anchored in the viewport", async ({ page }) => {
      const rowId = "fixture-row-0010";
      const languageCode = "vi";
      await mountEditorFixture(page, {
        rowCount: 40,
        imagesByRowId: {
          [rowId]: {
            [languageCode]: {
              kind: "url",
              url: FIXTURE_IMAGE_SVG_URL,
            },
          },
        },
      }, { mockTauri: true });

      await bringRowNearTop(page, rowId, 120);
      const imagePreview = page.locator(
        `[data-editor-language-image-preview-img][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
      );
      await expect(imagePreview).toBeVisible();

      // Activate the row's field first: clicking the remove button then moves
      // focus in Chrome, which is the anchor-capture path that regressed.
      await activateMainEditorField(page, rowId, languageCode);
      const before = await waitForStableRowLayout(page, rowId);
      expect(before).not.toBeNull();

      await page.locator(
        `[data-action="remove-editor-language-image"][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
      ).click();
      await expect(imagePreview).toHaveCount(0);

      await expect.poll(async () => {
        const after = await readSingleRowLayoutMetrics(page, rowId);
        return after ? Math.abs(after.targetTop - before.targetTop) : Number.POSITIVE_INFINITY;
      }).toBeLessThan(STABLE_SCROLL_TOLERANCE_PX);
    });

    test("guarantee 1: a queued image save completing after the user scrolls away must not snap the viewport back", async ({ page }) => {
      // Root cause D in the redesign plan: restores from stale snapshots must
      // not fight the user's scroll. Guarded by the generation arbitration in
      // editor-scroll-session.js (redesign Phase 1).
      const rowId = "fixture-row-0008";
      const languageCode = "vi";
      await mountEditorFixture(page, { rowCount: 60 }, { mockTauri: true });

      await page.evaluate(() => {
        globalThis.__gnosisMockTauriHandlers = {
          async save_gtms_editor_language_image_url() {
            await new Promise((resolve) => window.setTimeout(resolve, 900));
            return null;
          },
        };
      });

      await bringRowNearTop(page, rowId, 120);
      await activateMainEditorField(page, rowId, languageCode);
      await page.locator(
        `[data-action="open-editor-image-url"][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
      ).click();
      const urlInput = page.locator(
        `[data-editor-image-url-input][data-row-id="${rowId}"][data-language-code="${languageCode}"]`,
      );
      await expect(urlInput).toBeVisible();
      await urlInput.fill("https://example.com/pending.png");
      await urlInput.press("Enter");

      // The user scrolls away with the wheel while the save is in flight.
      const containerBox = await page.locator(".translate-main-scroll").boundingBox();
      expect(containerBox).not.toBeNull();
      await page.mouse.move(
        containerBox.x + containerBox.width / 2,
        containerBox.y + containerBox.height / 2,
      );
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(120);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(200);
      const scrolledTo = await readTranslateScrollTop(page);
      expect(scrolledTo).toBeGreaterThan(0);

      await expect.poll(async () => {
        const mockState = await readMockTauriState(page);
        return mockState?.invocations?.some(
          (entry) => entry.command === "save_gtms_editor_language_image_url",
        ) ?? false;
      }).toBe(true);
      // Let the delayed save resolve and any (buggy) viewport restore fire.
      await page.waitForTimeout(1400);

      expect(Math.abs((await readTranslateScrollTop(page)) - scrolledTo)).toBeLessThan(48);
    });

    test("guarantee 3: activating a row filter and returning to show-all restores the viewport", async ({ page }) => {
      const rowId = "fixture-row-0030";
      await mountEditorFixture(page, { rowCount: 60 }, { mockTauri: true });

      await bringRowNearTop(page, rowId, 100);
      const before = await waitForStableRowLayout(page, rowId);
      expect(before).not.toBeNull();

      await page.locator("[data-editor-filter-select]").selectOption("not-reviewed");
      await expect.poll(async () => await readTranslateScrollTop(page)).toBeLessThan(4);

      await page.locator("[data-editor-filter-select]").selectOption("show-all");
      await expect.poll(async () => {
        const after = await readSingleRowLayoutMetrics(page, rowId);
        return after ? Math.abs(after.targetTop - before.targetTop) : Number.POSITIVE_INFINITY;
      }).toBeLessThan(STABLE_SCROLL_TOLERANCE_PX);
    });

    test("guarantee 2: leaving to the glossary screen and returning restores the editor viewport", async ({ page }) => {
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

      const rowId = "fixture-row-0025";
      await mountEditorFixture(page, {
        rowCount: 60,
        glossary: true,
        chapterStatus: "ready",
      }, { mockTauri: true });

      await bringRowNearTop(page, rowId, 100);
      const before = await waitForStableRowLayout(page, rowId);
      expect(before).not.toBeNull();
      // Let the debounced editor-location save settle.
      await page.waitForTimeout(400);

      await page.locator('[data-action="open-editor-glossary"]').click();
      await expect(page.locator("h1.page-header__title")).toHaveText("Fixture Glossary");

      // Return through real navigation: the nav handler refreshes team access
      // (served by the installations mock) and reloads the chapter (served by
      // the chapter-data mock), then editor-location restores the viewport.
      await page.locator('[data-nav-target="translate"]').click();
      await expect(page.locator("[data-editor-search-input]")).toBeVisible();
      await expect(page.locator(`[data-editor-row-card][data-row-id="${rowId}"]`)).toBeVisible();

      // The restore aligns the saved anchor element exactly, but the reloaded
      // chapter lays out content above it slightly differently (async glossary
      // marks), so the row top can drift a few px. Guard against "landed at the
      // top" regressions, not pixel identity.
      await expect.poll(async () => {
        const after = await readSingleRowLayoutMetrics(page, rowId);
        return after ? Math.abs(after.targetTop - before.targetTop) : Number.POSITIVE_INFINITY;
      }).toBeLessThan(40);
    });

    test("guarantee 2: switching to preview mode and back restores the translate viewport", async ({ page }) => {
      const rowId = "fixture-row-0020";
      await mountEditorFixture(page, { rowCount: 60 }, { mockTauri: true });

      await bringRowNearTop(page, rowId, 100);
      const before = await waitForStableRowLayout(page, rowId);
      expect(before).not.toBeNull();

      await page.locator('[data-action="set-editor-mode:preview"]').click();
      await expect(page.locator(".translate-layout--preview")).toBeVisible();

      await page.locator('[data-action="set-editor-mode:translate"]').click();
      await expect(page.locator(".translate-layout--preview")).toHaveCount(0);
      await expect(page.locator(`[data-editor-row-card][data-row-id="${rowId}"]`)).toBeVisible();

      await expect.poll(async () => {
        const after = await readSingleRowLayoutMetrics(page, rowId);
        return after ? Math.abs(after.targetTop - before.targetTop) : Number.POSITIVE_INFINITY;
      }).toBeLessThan(STABLE_SCROLL_TOLERANCE_PX);
    });
  });
});

test.describe("subtitle timing", () => {
  const SRT_FIXTURE = {
    rowCount: 4,
    srt: true,
    // Row 2 starts before row 1 ends (overlap pair); row 4 is shorter than
    // the 250 ms minimum. Row 3 keeps its clean generated timing.
    srtTimingByRowId: {
      "fixture-row-0001": { startMs: 0, endMs: 3500 },
      "fixture-row-0002": { startMs: 3000, endMs: 6000 },
      "fixture-row-0004": { startMs: 12000, endMs: 12100 },
    },
  };

  function timingInput(page, rowId, languageCode, kind) {
    return page.locator(
      `[data-editor-timing-field][data-row-id="${rowId}"][data-language-code="${languageCode}"][data-timing-kind="${kind}"]`,
    );
  }

  test("timing inputs render above each language with imported errors marked on the inputs at fault", async ({ page }) => {
    await mountEditorFixture(page, SRT_FIXTURE, { mockTauri: true });

    // Both languages inherit the imported timing.
    await expect(timingInput(page, "fixture-row-0001", "es", "start")).toHaveValue("00:00:00,000");
    await expect(timingInput(page, "fixture-row-0001", "vi", "start")).toHaveValue("00:00:00,000");
    await expect(timingInput(page, "fixture-row-0002", "es", "start")).toHaveValue("00:00:03,000");

    // Overlap pair: row 1's end and row 2's start are marked, in every language.
    await expect(timingInput(page, "fixture-row-0001", "es", "end")).toHaveClass(/translation-timing__input--error/);
    await expect(timingInput(page, "fixture-row-0002", "es", "start")).toHaveClass(/translation-timing__input--error/);
    await expect(timingInput(page, "fixture-row-0001", "es", "start")).not.toHaveClass(/translation-timing__input--error/);
    await expect(timingInput(page, "fixture-row-0002", "es", "end")).not.toHaveClass(/translation-timing__input--error/);

    // Too-short row: both inputs are marked.
    await expect(timingInput(page, "fixture-row-0004", "es", "start")).toHaveClass(/translation-timing__input--error/);
    await expect(timingInput(page, "fixture-row-0004", "es", "end")).toHaveClass(/translation-timing__input--error/);

    // Clean row: no marks.
    await expect(timingInput(page, "fixture-row-0003", "es", "start")).not.toHaveClass(/translation-timing__input--error/);
    await expect(timingInput(page, "fixture-row-0003", "es", "end")).not.toHaveClass(/translation-timing__input--error/);
  });

  test("non-subtitle chapters render no timing inputs and no timing filter option", async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 3 }, { mockTauri: true });

    await expect(page.locator("[data-editor-timing-field]")).toHaveCount(0);
    await expect(
      page.locator('[data-editor-filter-select] option[value="has-timing-error"]'),
    ).toHaveCount(0);
  });

  test("the timing-error filter shows only rows with timing problems", async ({ page }) => {
    await mountEditorFixture(page, SRT_FIXTURE, { mockTauri: true });

    await page.locator("[data-editor-filter-select]").selectOption("has-timing-error");

    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0001"]')).toBeVisible();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0002"]')).toBeVisible();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0004"]')).toBeVisible();
    await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0003"]')).toHaveCount(0);
  });

  test("an invalid timestamp blocks persistence and keeps the typed text", async ({ page }) => {
    await mountEditorFixture(page, SRT_FIXTURE, { mockTauri: true });

    const startInput = timingInput(page, "fixture-row-0003", "es", "start");
    await startInput.fill("not a time");
    await startInput.blur();

    await expect(startInput).toHaveAttribute("data-timing-format-error", "true");
    await expect(startInput).toHaveClass(/translation-timing__input--error/);
    await expect(startInput).toHaveValue("not a time");

    const mockState = await readMockTauriState(page);
    const timingSaves = (mockState?.invocations ?? []).filter(
      (entry) =>
        entry.command === "update_gtms_editor_row_fields"
        && Object.keys(entry.payload?.input?.timings ?? {}).length > 0,
    );
    expect(timingSaves).toHaveLength(0);
  });

  test("a valid edit persists the override and refreshes neighbor overlap marks", async ({ page }) => {
    await mountEditorFixture(page, SRT_FIXTURE, { mockTauri: true });

    // Resolve the overlap by moving row 2's start after row 1's end.
    const startInput = timingInput(page, "fixture-row-0002", "es", "start");
    await startInput.fill("00:00:03,600");
    await startInput.blur();

    await expect(timingInput(page, "fixture-row-0002", "es", "start")).toHaveValue("00:00:03,600");
    await expect(timingInput(page, "fixture-row-0002", "es", "start")).not.toHaveClass(/translation-timing__input--error/);
    // The previous row's end mark clears without touching that row.
    await expect(timingInput(page, "fixture-row-0001", "es", "end")).not.toHaveClass(/translation-timing__input--error/);

    await expect.poll(async () => {
      const mockState = await readMockTauriState(page);
      return (mockState?.invocations ?? []).filter(
        (entry) =>
          entry.command === "update_gtms_editor_row_fields"
          && entry.payload?.input?.rowId === "fixture-row-0002"
          && entry.payload?.input?.timings?.es?.startMs === 3600,
      ).length;
    }).toBeGreaterThan(0);
  });
});

// Persistent sidebar connection: mounted and unmounted rows share the same UI.
for (const rowCount of [6, 200]) {
  test(`connected row outline and offscreen reveal (${rowCount} rows)`, async ({ page }) => {
    await mountEditorFixture(page, { rowCount, chapterStatus: "ready" });
    const notice = page.locator("[data-editor-row-connection]");
    const first = page.locator('[data-editor-row-card][data-row-id="fixture-row-0001"]');
    await expect(first).toHaveClass(/is-connected/);
    await expect(notice).toBeHidden();
    const background = await first.locator(".card--translation").evaluate((el) => getComputedStyle(el).background);
    await expect.poll(() => page.locator('[data-editor-row-card]:not(.is-connected) .card--translation').first()
      .evaluate((el) => getComputedStyle(el).background)).toBe(background);
    await setTranslateScrollTop(page, 1000000);
    await expect(notice).toContainText("Selected row is above the visible area");
    await expect(notice).toBeVisible();
    if (rowCount === 200) await expect(first).toHaveCount(0);
    await notice.click();
    await expect(first).toHaveClass(/is-connected/);
    await expect(notice).toBeHidden();
    await expect.poll(() => first.evaluate((el) => {
      const row = el.getBoundingClientRect(), pane = document.querySelector(".translate-main-scroll").getBoundingClientRect();
      return row.bottom > pane.top && row.top < pane.bottom;
    })).toBe(true);

    // Select a different row near the bottom, then leave it unmounted below.
    await setTranslateScrollTop(page, 1000000);
    // The virtual window updates asynchronously after scrolling. Keep the
    // locator tied to the intended row instead of reading a stale last card.
    const lastId = `fixture-row-${String(rowCount).padStart(4, "0")}`;
    const last = page.locator(`[data-editor-row-card][data-row-id="${lastId}"]`);
    await expect(last).toBeVisible();
    await last.locator('[data-editor-display-field][data-language-code="vi"]').click();
    await page.locator('[data-action="switch-editor-sidebar-tab:history"]').click();
    await page.locator("[data-editor-search-input]").focus();
    // Blurring the field closes its editor on the next animation frame, and
    // that re-render restores a viewport anchor captured at the bottom. A raw
    // scrollTop write is not user scroll intent (editor-scroll-session.js), so
    // scrolling before the anchored render lands lets the restore drag the
    // viewport back down and the row stays visible. Wait for the editor to
    // close, then express intent the way a user would before scrolling.
    await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().mainFieldEditor.rowId)).toBeNull();
    await page.locator(".translate-main-scroll").dispatchEvent("wheel", { deltaY: -1000 });
    await setTranslateScrollTop(page, 0);
    await expect(notice).toContainText("Selected row is below the visible area");
    await expect(notice).toBeVisible();
    await notice.focus();
    await page.keyboard.press("Enter");
    await expect(notice).toBeHidden();
    await expect(page.locator(`[data-editor-row-card][data-row-id="${lastId}"]`)).toHaveClass(/is-connected/);
    await expect(page.locator('[data-action="switch-editor-sidebar-tab:history"]')).toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-editor-row-card]")?.dataset.rowId)).toBe(lastId);

    await page.locator("[data-editor-search-input]").fill("no possible match 123456789");
    await expect(notice).toBeHidden();
    await expect(page.locator("[data-editor-row-card].is-connected")).toHaveCount(0);
    await page.locator("[data-editor-search-input]").fill("");
    await expect(page.locator("[data-editor-row-card].is-connected")).toHaveCount(0);
    await expect(notice).toBeHidden();
  });
}

test("connected row notice follows actual intersection even when editing pins the row", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 200, chapterStatus: "ready" });
  const notice = page.locator("[data-editor-row-connection]");
  const row = page.locator('[data-editor-row-card][data-row-id="fixture-row-0001"]');
  await row.locator('[data-editor-display-field][data-language-code="vi"]').click();
  const field = row.locator('[data-editor-row-field][data-language-code="vi"]');
  await expect(field).toBeFocused();
  const rowBottom = await row.evaluate((el) => {
    const pane = document.querySelector(".translate-main-scroll");
    return el.getBoundingClientRect().bottom - pane.getBoundingClientRect().top + pane.scrollTop;
  });
  await setTranslateScrollTop(page, rowBottom - 3);
  await expect(notice).toBeHidden();
  await setTranslateScrollTop(page, rowBottom + 3);
  await expect(notice).toContainText("Selected row is above");
  await expect(field).toBeFocused();
  await expect(row).toHaveCount(1); // pinned DOM presence is not visibility
  await notice.click();
  await expect(notice).toBeHidden();
  await expect(field).toBeFocused();
  await expect(row).toHaveClass(/is-connected/);
  await page.setViewportSize({ width: 1100, height: 620 });
  await expect(row).toHaveClass(/is-connected/);
  await expect(notice).toBeHidden();
});

test("connected row disconnects when a content change removes it from the active filter", async ({ page }) => {
  await mountEditorFixture(page, {
    rowCount: 6, chapterStatus: "ready", searchQuery: "unique connection token",
    fieldsByRowId: { "fixture-row-0001": { vi: "unique connection token" } },
  });
  await expect(page.locator("[data-editor-row-card].is-connected")).toHaveCount(1);
  await patchFixtureRow(page, "fixture-row-0001", { fields: { vi: "replacement without match" } });
  await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId)).toBeNull();
  await expect(page.locator("[data-editor-row-connection]")).toBeHidden();
  await page.locator("[data-editor-search-input]").fill("");
  await expect(page.locator("[data-editor-row-card].is-connected")).toHaveCount(0);
});

test("connected row reveal yields to newer scroll input", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 200, chapterStatus: "ready" });
  await setTranslateScrollTop(page, 1000000);
  await expect(page.locator("[data-editor-row-connection]")).toBeVisible();
  const top = await page.evaluate(() => new Promise((resolve) => {
    const pane = document.querySelector(".translate-main-scroll");
    // The delegated click action is async. Wait for its first scroll before
    // expressing newer intent, but do so before the next animation frame.
    pane.addEventListener("scroll", () => {
      pane.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 500 }));
      pane.scrollTop = 1500;
      resolve(pane.scrollTop);
    }, { once: true });
    document.querySelector("[data-editor-row-connection]").click();
  }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.poll(() => page.locator(".translate-main-scroll").evaluate((el) => el.scrollTop)).toBeGreaterThan(top / 2);
  await expect(page.locator("[data-editor-row-connection]")).toBeVisible();
});

test("connected deleted rows disconnect on section close and permanent deletion", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 200, chapterStatus: "ready" });
  const rowId = "fixture-row-0002";
  await softDeleteFixtureRow(page, rowId);
  const group = page.locator(`[data-editor-deleted-group][data-row-id="deleted-group:${rowId}"]`);
  await group.locator(".section-separator").click();
  const row = page.locator(`[data-editor-row-card][data-row-id="${rowId}"]`);
  await row.locator('[data-editor-display-field][data-language-code="vi"]').click();
  await expect(row).toHaveClass(/is-connected/);
  await page.locator('[data-action="switch-editor-sidebar-tab:history"]').click();
  await page.locator("[data-editor-search-input]").focus();
  await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().mainFieldEditor.rowId)).toBeNull();
  await page.locator(".translate-main-scroll").dispatchEvent("wheel", { deltaY: 1000 });
  await setTranslateScrollTop(page, 1000000);
  const notice = page.locator("[data-editor-row-connection]");
  await expect(notice).toBeVisible();
  // A selected row can remain mounted outside the virtual window. The
  // connection notice tracks viewport intersection, not DOM eviction.
  await expect(row).not.toBeInViewport();
  await notice.click();
  await expect(row).toHaveClass(/is-connected/);
  await expect(notice).toBeHidden();
  await group.locator(".section-separator").click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId)).toBeNull();
  await expect(notice).toBeHidden();
  await group.locator(".section-separator").click();
  await expect(row).not.toHaveClass(/is-connected/);
  await row.locator('[data-editor-display-field][data-language-code="vi"]').click();
  await expect(row).toHaveClass(/is-connected/);
  await page.locator(`[data-action="open-editor-row-permanent-delete:${rowId}"]`).click();
  await page.locator('[data-action="confirm-editor-row-permanent-delete"]').click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId)).toBeNull();
  await expect(notice).toBeHidden();
});

test("connected row remains selected when soft deletion joins an expanded section", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 6, chapterStatus: "ready" });
  await softDeleteFixtureRow(page, "fixture-row-0002");
  await page.locator("[data-editor-deleted-group] .section-separator").click();
  const rowId = "fixture-row-0003";
  const row = page.locator(`[data-editor-row-card][data-row-id="${rowId}"]`);
  await row.locator('[data-editor-display-field][data-language-code="vi"]').click();
  await row.locator(`[data-action="soft-delete-editor-row:${rowId}"]`).click();
  await expect(row).toHaveClass(/is-deleted/);
  await expect(row).toHaveClass(/is-connected/);
  await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId)).toBe(rowId);
  await page.locator("[data-editor-deleted-group] .section-separator").click();
  await expect.poll(() => page.evaluate(() => window.__gnosisDebug.readEditorState().activeRowId)).toBeNull();
});

test("AI review remains visible and diffs successive editor edits", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 6, chapterStatus: "ready" }, { mockTauri: true });
  const rowId = "fixture-row-0001";
  await activateMainEditorField(page, rowId, "vi");
  await page.evaluate(async (activeRowId) => {
    const { state } = await import(new URL("/app/state.js", window.location.href).href);
    state.editorChapter.aiReview = {
      status: "ready", rowId: activeRowId, languageCode: "vi",
      sourceText: state.editorChapter.rows.find((row) => row.rowId === activeRowId).fields.vi,
      suggestedText: "Reviewed translation",
      promptText: "Review this translation",
    };
  }, rowId);
  await page.locator('[data-action="switch-editor-sidebar-tab:review"]').click();
  const review = page.locator('[data-editor-review-section="ai-review"]');
  await expect(review.locator('[data-action="apply-editor-ai-review"]')).toBeVisible();
  await activateMainEditorField(page, rowId, "vi");
  const input = page.locator(`[data-editor-row-field][data-row-id="${rowId}"][data-language-code="vi"]`);
  for (const addition of [" edited", " edited again"]) {
    await input.fill(`Reviewed translation${addition}`);
    await expect(review.locator(".history-diff__delete")).toHaveText(addition);
    await expect(review.locator(".history-item__content")).toContainText("Reviewed translation");
    await expect(review.getByText("Compared with the current text in the editor.", { exact: true })).toBeVisible();
    await expect(review.getByText("The text changed since the last AI review.")).toHaveCount(0);
    await expect(input).toBeFocused();
  }
  await expect(review.locator('[data-action="apply-editor-ai-review"]')).toHaveCount(0);
  await expect(review.locator('[data-action="review-editor-text-now:meaning"]')).toBeVisible();
});

test("changed-after-my-edit filter shows other people's changes as diffs on the static fields", async ({ page }) => {
  const svgImage = (color) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="${color}"/></svg>`)}`;
  await mountEditorFixture(page, {
    rowCount: 4,
    chapterStatus: "ready",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "fa", name: "Persian", role: "target" },
    ],
    fieldsByRowId: {
      "fixture-row-0001": { es: "Yo leí el artículo", fa: "من مقاله را خواندم" },
      "fixture-row-0002": { es: "El <strong>gato</strong> negro", fa: "گربه سیاه" },
      "fixture-row-0003": { es: "Una imagen", fa: "یک تصویر" },
    },
    imagesByRowId: {
      "fixture-row-0003": { fa: { kind: "url", url: svgImage("#6aa84f") } },
    },
  }, { mockTauri: true });

  const oldImage = svgImage("#cc4125");
  await page.evaluate((previousImageUrl) => {
    const field = (plainText, extra = {}) => ({ plainText, footnote: "", imageCaption: "", image: null, imageDataUrl: null, ...extra });
    globalThis.__gnosisMockTauriHandlers = {
      ...(globalThis.__gnosisMockTauriHandlers ?? {}),
      async load_gtms_editor_changed_after_my_edit() {
        return {
          chapterId: "fixture-chapter",
          rows: [
            {
              rowId: "fixture-row-0001",
              baselineCommitSha: "base-1",
              baselineIsMine: true,
              baselineTextStyle: "paragraph",
              baselineFields: { es: field("Yo leí el artículo"), fa: field("من کتاب را خواندم") },
              edits: [],
            },
            {
              rowId: "fixture-row-0002",
              baselineCommitSha: "base-2",
              baselineIsMine: true,
              baselineTextStyle: "heading1",
              baselineFields: { es: field("El gato blanco"), fa: field("گربه سیاه") },
              edits: [],
            },
            {
              rowId: "fixture-row-0003",
              baselineCommitSha: "base-3",
              baselineIsMine: false,
              baselineTextStyle: "paragraph",
              baselineFields: {
                es: field("Una imagen"),
                fa: field("یک تصویر", { image: { kind: "url", url: previousImageUrl } }),
              },
              edits: [],
            },
          ],
        };
      },
    };
  }, oldImage);

  await page.locator("[data-editor-filter-select]").selectOption("changed-after-my-edit");
  await expect(page.locator("[data-editor-row-card]")).toHaveCount(3);
  await expect(page.locator('[data-editor-row-card][data-row-id="fixture-row-0004"]')).toHaveCount(0);

  const persianRow = page.locator('[data-editor-row-card][data-row-id="fixture-row-0001"]');
  await expect(persianRow.locator(".history-diff__delete")).toHaveText("کتاب");
  await expect(persianRow.locator(".history-diff__insert")).toHaveText("مقاله");

  const spanishRow = page.locator('[data-editor-row-card][data-row-id="fixture-row-0002"]');
  await expect(spanishRow.locator("strong .history-diff__format")).toHaveText("gato");
  await expect(spanishRow.locator(".history-diff__delete")).toHaveText("blanco");
  await expect(spanishRow.locator(".history-diff__insert")).toHaveText("negro");
  const styleButtons = spanishRow.locator('[data-language-code="es"] [data-editor-row-text-style-button]');
  await expect(styleButtons.locator('xpath=self::*[@data-text-style="paragraph"]')).toHaveClass(/change-insert/);
  await expect(styleButtons.locator('xpath=self::*[@data-text-style="heading1"]')).toHaveClass(/change-delete/);
  await expect(spanishRow.locator('[data-language-code="es"] [data-editor-row-text-style-button]').first()).toBeVisible();

  const imageRow = page.locator('[data-editor-row-card][data-row-id="fixture-row-0003"]');
  await expect(imageRow.locator(".translation-language-panel__image-preview--change-insert")).toHaveCount(1);
  await expect(imageRow.locator(".translation-language-panel__image-preview--change-previous img"))
    .toHaveAttribute("src", oldImage);

  // Clicking a changed field opens the normal editor on the current text.
  await persianRow.locator('[data-editor-display-field][data-language-code="fa"]').click();
  const editor = persianRow.locator('[data-editor-row-field][data-language-code="fa"]');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue("من مقاله را خواندم");

  await page.locator("[data-editor-filter-select]").selectOption("show-all");
  await expect(page.locator(".history-diff__insert")).toHaveCount(0);
});

test("quote attribution saves separately, previews at 90%, and appends when leaving Quote", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 8, chapterStatus: "ready" }, { mockTauri: true });
  const rowId = "fixture-row-0001";
  const style = (value) => page.locator(`[data-editor-row-text-style-button][data-row-id="${rowId}"][data-language-code="vi"][data-text-style="${value}"]`);
  await activateMainEditorField(page, rowId, "vi");
  const body = page.locator(`[data-editor-row-field][data-row-id="${rowId}"][data-language-code="vi"]:not([data-content-kind])`);
  const original = await body.inputValue();
  const normalSize = parseFloat(await body.evaluate((field) => getComputedStyle(field).fontSize));
  await style("quote").click();
  await expect(body).toHaveCSS("text-align", "left");
  expect(parseFloat(await body.evaluate((field) => getComputedStyle(field).fontSize))).toBeCloseTo(normalSize, 2);
  const attribution = page.locator(`[data-editor-row-field][data-content-kind="attribution"][data-row-id="${rowId}"][data-language-code="vi"]`);
  await expect(attribution).toBeHidden();
  const prompt = attribution.locator("..").getByText("Enter attribution", { exact: true });
  await expect(prompt).toBeVisible();
  await prompt.click();
  await expect(attribution).toBeFocused();
  await expect(attribution).toHaveAttribute("placeholder", "Enter attribution here.");
  await expect(attribution).toHaveValue("");
  await attribution.fill("Quote source author");
  await expect(attribution).toHaveCSS("text-align", "right");
  expect(parseFloat(await attribution.evaluate((field) => getComputedStyle(field).fontSize))).toBeCloseTo(normalSize * .9, 2);
  await expect(prompt).toBeHidden();
  await page.locator("[data-editor-search-input]").focus();
  await flushDirtyRows(page);
  await expect.poll(async () => {
    const mock = await readMockTauriState(page);
    return mock.invocations.some((entry) => entry.command === "update_gtms_editor_row_fields"
      && entry.payload.input.attributions?.vi === "Quote source author");
  }).toBe(true);
  await expect(attribution).toHaveValue("Quote source author");
  await page.screenshot({ path: "/tmp/gnosis-quote-editor.png" });
  await page.locator('[data-action="set-editor-mode:preview"]').click();
  const citation = page.locator('.translate-preview__attribution').first();
  await expect(citation).toHaveText("Quote source author");
  await expect(citation).toHaveCSS("text-align", "right");
  const sizes = await citation.evaluate((cite) => ({
    citation: parseFloat(getComputedStyle(cite).fontSize),
    quote: parseFloat(getComputedStyle(cite.parentElement).fontSize),
    normal: parseFloat(getComputedStyle(document.querySelector(".translate-preview__block--paragraph")).fontSize),
  }));
  expect(sizes.quote).toBeCloseTo(sizes.normal, 2);
  expect(sizes.citation).toBeCloseTo(sizes.normal * .9, 2);
  await expect(citation.locator("..")).toHaveCSS("text-align", "left");
  await page.screenshot({ path: "/tmp/gnosis-quote-preview.png" });
  await page.locator('[data-action="set-editor-mode:translate"]').click();
  await activateMainEditorField(page, rowId, "vi");
  await body.focus();
  await style("paragraph").click();
  await expect(attribution).toHaveCount(0);
  await activateMainEditorField(page, rowId, "vi");
  await expect(body).toHaveValue(`${original}\n\nQuote source author`);
  await page.screenshot({ path: "/tmp/gnosis-quote-editor-converted.png" });
});

test("SRT rows hide style and inline formatting controls", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 8, srt: true }, { mockTauri: true });
  await activateMainEditorField(page, "fixture-row-0001", "vi");
  await expect(page.locator("[data-editor-row-text-style-button], [data-editor-inline-style-button], [data-editor-separator-button]")).toHaveCount(0);
  await expect(page.locator('[data-editor-timing-field]').first()).toBeVisible();
});

test("empty quote attribution opens on click, keeps undo, and collapses again on blur", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 8, chapterStatus: "ready" }, { mockTauri: true });
  const rowId = "fixture-row-0001";
  await activateMainEditorField(page, rowId, "vi");
  await page.locator(`[data-editor-row-text-style-button][data-row-id="${rowId}"][data-language-code="vi"][data-text-style="quote"]`).click();
  await page.locator('[data-action="set-editor-mode:preview"]').click();
  await expect(page.locator(".translate-preview__attribution")).toHaveCount(0);
  await page.locator('[data-action="set-editor-mode:translate"]').click();
  const field = page.locator(`[data-content-kind="attribution"][data-row-id="${rowId}"][data-language-code="vi"]`);
  const prompt = field.locator("..").getByText("Enter attribution", { exact: true });
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveCSS("font-style", "italic");
  const promptSize = parseFloat(await prompt.evaluate((node) => getComputedStyle(node).fontSize));
  const attributionSize = parseFloat(await field.evaluate((node) => getComputedStyle(node).fontSize));
  expect(promptSize).toBeCloseTo(attributionSize * .8, 2);
  await expect(field).toBeHidden();
  await prompt.click();
  await expect(field).toBeFocused();
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("");
  await field.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  await field.pressSequentially("Author");
  await expect(field).toHaveValue("Author");
  expect(await field.evaluate((node) => node.matches(":placeholder-shown"))).toBe(false);
  await field.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(field).not.toHaveValue("Author");
  await field.fill("");
  await expect(field).toBeVisible();
  await page.locator("[data-editor-search-input]").focus();
  await expect(field).toBeHidden();
  await expect(prompt).toBeVisible();
  await flushDirtyRows(page);
  const mock = await readMockTauriState(page);
  for (const entry of mock.invocations.filter((item) => item.command === "update_gtms_editor_row_fields")) {
    expect(JSON.stringify(entry.payload)).not.toMatch(/Enter attribution/);
  }
  await page.screenshot({ path: "/tmp/gnosis-quote-empty-prompt.png" });
});

test("empty quote attribution keeps one prompt through window deactivation and reactivation", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 8, chapterStatus: "ready" }, { mockTauri: true });
  const rowId = "fixture-row-0001";
  await activateMainEditorField(page, rowId, "vi");
  await page.locator(`[data-editor-row-text-style-button][data-row-id="${rowId}"][data-language-code="vi"][data-text-style="quote"]`).click();
  const field = page.locator(`[data-content-kind="attribution"][data-row-id="${rowId}"][data-language-code="vi"]`);
  const wrapper = field.locator("..");
  const prompt = wrapper.getByText("Enter attribution", { exact: true });
  await prompt.click();
  await expect(field).toBeFocused();
  await expect(wrapper).toHaveAttribute("data-editor-attribution-editing", "");
  await expect(prompt).toBeHidden();
  // Headless Chromium emulates focus for background pages. Suspend that
  // emulation so the retained active textarea also experiences native blur.
  const session = await page.context().newCDPSession(page);
  const other = await page.context().newPage();
  try {
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    await other.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(wrapper).toHaveAttribute("data-editor-attribution-editing", "");
    await expect(prompt).toBeHidden();
    await expect(field).toBeVisible();
    await page.bringToFront();
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    await expect(prompt).toBeHidden();
    await field.pressSequentially("Author");
    await expect(field).toHaveValue("Author");
    await field.fill("");
    await page.locator("[data-editor-search-input]").focus();
    await expect(wrapper).not.toHaveAttribute("data-editor-attribution-editing");
    await expect(prompt).toBeVisible();
    await expect(prompt).toHaveCSS("font-style", "italic");
    await expect(field).toBeHidden();
  } finally {
    await session.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await session.detach(); await other.close();
  }
});

test("Quote block and Heading filters select styles and update when a style changes", async ({ page }) => {
  await mountEditorFixture(page, { rowCount: 4 }, { mockTauri: true });
  const setStyle = async (rowId, textStyle) => {
    const field = await activateMainEditorField(page, rowId, "vi");
    await field.focus();
    await page.locator(`[data-editor-row-text-style-button][data-row-id="${rowId}"][data-language-code="vi"][data-text-style="${textStyle}"]`).click();
  };
  await setStyle("fixture-row-0001", "heading1");
  await setStyle("fixture-row-0002", "quote");
  await setStyle("fixture-row-0003", "heading2");

  const filter = page.locator("[data-editor-filter-select]");
  const cards = page.locator("[data-editor-row-card]");
  await filter.selectOption({ label: "Quote block" });
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-row-id", "fixture-row-0002");
  await filter.selectOption({ label: "Heading" });
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute("data-row-id", "fixture-row-0001");
  await expect(cards.nth(1)).toHaveAttribute("data-row-id", "fixture-row-0003");

  const search = page.locator("[data-editor-search-input]");
  await search.fill("0003");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-row-id", "fixture-row-0003");
  await search.fill("");
  await setStyle("fixture-row-0003", "paragraph");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-row-id", "fixture-row-0001");
  await filter.selectOption({ label: "Show all" });
  await expect(cards).toHaveCount(4);
});

for (const { platform, modifier } of [
  { platform: "mac", modifier: "Meta" },
  { platform: "windows", modifier: "Control" },
]) {
  test(`formatting shortcuts match bold italic and underline buttons (${platform})`, async ({ page }) => {
    await mountEditorFixture(page, { rowCount: 4 }, { mockTauri: true, path: `/?platform=${platform}` });
    const rowId = "fixture-row-0001";
    const field = await activateMainEditorField(page, rowId, "vi");
    for (const { key, style, tag } of [
      { key: "b", style: "bold", tag: "strong" },
      { key: "i", style: "italic", tag: "em" },
      { key: "u", style: "underline", tag: "u" },
    ]) {
      const button = page.locator(`[data-editor-inline-style-button][data-row-id="${rowId}"][data-language-code="vi"][data-inline-style="${style}"]`);
      await field.fill("alpha beta gamma");
      await setEditorSelectionRange(page, rowId, "vi", 6, 10);
      await field.press(`${modifier}+${key}`);
      await expect(field).toHaveValue(`alpha <${tag}>beta</${tag}> gamma`);
      await expect(field).toBeFocused();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await field.press(`${modifier}+${key}`);
      await expect(field).toHaveValue("alpha beta gamma");
      await expect(button).toHaveAttribute("aria-pressed", "false");

      await setEditorSelectionRange(page, rowId, "vi", 1, 1);
      await field.press(`${modifier}+${key}`);
      await expect(field).toHaveValue(`<${tag}>alpha</${tag}> beta gamma`);
      await clickLocatorCenter(page, button);
      await expect(field).toHaveValue("alpha beta gamma");
    }

    await clickLocatorCenter(page, page.locator(`[data-editor-footnote-button][data-row-id="${rowId}"][data-language-code="vi"]`));
    const footnote = page.locator(`[data-editor-row-field][data-row-id="${rowId}"][data-language-code="vi"][data-content-kind="footnote"]`);
    await footnote.fill("foot note");
    const bodyWithMarker = await field.inputValue();
    await setEditorSelectionRange(page, rowId, "vi", 6, 6, "footnote");
    await footnote.press(`${modifier}+i`);
    await expect(footnote).toHaveValue("foot <em>note</em>");
    await expect(footnote).toBeFocused();
    await expect(field).toHaveValue(bodyWithMarker);
  });
}

test("formatting shortcuts leave SRT and custom HTML text unchanged", async ({ page }) => {
  for (const srt of [false, true]) {
    await mountEditorFixture(page, { rowCount: 4, srt }, { mockTauri: true, path: "/?platform=mac" });
    const rowId = "fixture-row-0001";
    const field = await activateMainEditorField(page, rowId, "vi");
    if (!srt) {
      await page.locator(`[data-editor-row-text-style-button][data-row-id="${rowId}"][data-language-code="vi"][data-text-style="custom_html"]`).click();
    }
    await field.fill("alpha beta gamma");
    for (const key of ["b", "i", "u"]) {
      const prevented = await field.evaluate((node, key) => {
        node.focus();
        node.setSelectionRange(6, 10);
        return !node.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true }));
      }, key);
      expect(prevented).toBe(false);
      await expect(field).toHaveValue("alpha beta gamma");
    }
  }
});

test("footnotes edit one at a time without a surrounding focus surface", async ({ page }) => {
  const rowId = "fixture-row-0001";
  await mountEditorFixture(page, { rowCount: 2, chapterStatus: "ready" }, { mockTauri: true });
  await page.evaluate(async (rowId) => {
    const { state } = await import("/app/state.js");
    const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
    row.footnotes.vi = [
      { marker: 1, text: "First independent footnote." },
      { marker: 2, text: "Second independent footnote." },
    ];
    row.persistedFootnotes = structuredClone(row.footnotes);
    state.editorChapter.rows = [...state.editorChapter.rows];
  }, rowId);
  await patchFixtureRow(page, rowId, { fields: { vi: "Body text with footnotes[1][2]." } });
  const panel = page.locator(`[data-editor-language-panel][data-row-id="${rowId}"][data-language-code="vi"]`);
  const notes = panel.locator(".translation-language-panel__field-stack--footnote");
  const fields = notes.locator('textarea[data-content-kind="footnote"]');
  await expect(fields).toHaveCount(0);
  const secondButton = panel.getByRole("button", { name: "Edit footnote 2", exact: true });
  await secondButton.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(secondButton).toBeFocused();
  await expect(secondButton).toHaveCSS("outline-style", "solid");
  await expect(notes).toHaveCSS("box-shadow", "none");
  await panel.getByRole("button", { name: "Edit footnote 1", exact: true }).click();
  await expect(fields).toHaveCount(1);
  const firstField = notes.locator('textarea[data-footnote-marker="1"]');
  await expect(firstField).toBeFocused();
  await expect(notes).toHaveCSS("box-shadow", "none");
  await expect(notes).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(notes).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(firstField.locator("..")).toHaveCSS("border-top-color", "rgba(236, 134, 9, 0.52)");
  await firstField.fill("Edited first independent footnote.");
  await panel.getByRole("button", { name: "Edit footnote 2", exact: true }).click();
  await expect(fields).toHaveCount(1);
  await expect(notes.locator('textarea[data-footnote-marker="2"]')).toBeFocused();
  await expect(panel.getByRole("button", { name: "Edit footnote 1", exact: true })).toHaveText("Edited first independent footnote.");
  await expect(notes).toHaveCSS("box-shadow", "none");
  await expect(notes).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await panel.screenshot({ path: "/tmp/gnosis-individual-footnote-editing.png" });
});

for (const canEdit of [false, true]) {
  for (const fontSize of [20, 28]) {
    test(`closed footnotes keep compact spacing (${canEdit ? "editable" : "read-only"}, ${fontSize}px)`, async ({ page }) => {
      await mountEditorFixture(page, { rowCount: 2 });
      await page.evaluate(async ({ fontSize, canEdit }) => {
        const { renderTranslationContentRow } = await import("/app/editor-row-render.js");
        const host = document.createElement("div");
        host.dataset.footnoteSpacingFixture = "true";
        host.style.cssText = `position:fixed;top:20px;left:20px;z-index:100;width:800px;max-width:calc(100% - 40px);background:#fff7e5;--translation-editor-font-size:${fontSize}px;`;
        host.innerHTML = renderTranslationContentRow({
          kind: "row", id: "spacing-fixture", rowId: "spacing-fixture",
          lifecycleState: "active", textStyle: "paragraph", canEdit,
          sections: [{
            code: "vi", baseCode: "vi", name: "Vietnamese", canEdit,
            text: "Body text above the footnotes.",
            hasVisibleFootnote: true,
            footnotes: [
              { marker: 1, text: 'First paragraph.\nSecond paragraph with <a href="https://example.com">a link</a>.' },
              { marker: 2, text: "Another footnote." },
            ],
          }],
        });
        document.body.append(host);
      }, { fontSize, canEdit });
      const host = page.locator("[data-footnote-spacing-fixture]");
      const footnote = host.locator(canEdit
        ? ".translation-language-panel__field-stack--footnote"
        : ".translation-language-panel__field-static--footnote");
      const gaps = await footnote.evaluate((node) => {
        const outer = node.getBoundingClientRect();
        const children = [...node.children];
        const first = children[0].getBoundingClientRect();
        const last = children.at(-1).getBoundingClientRect();
        return { top: first.top - outer.top, bottom: outer.bottom - last.bottom };
      });
      expect(gaps.top).toBeLessThanOrEqual(4);
      expect(gaps.bottom).toBeLessThanOrEqual(4);
      const entries = footnote.locator(canEdit
        ? ".translation-language-panel__footnote-display-text"
        : ".translation-language-panel__footnote-static");
      await expect(entries).toHaveCount(2);
      await expect(footnote.locator("a")).toHaveAttribute("href", "https://example.com");
      expect(await entries.first().innerText()).toContain("First paragraph.\nSecond paragraph");
      await expect(entries.first()).toHaveCSS("white-space", "pre-wrap");
      await host.screenshot({ path: `/tmp/footnote-spacing-${canEdit ? "editable" : "read-only"}-${fontSize}.png` });
    });
  }
}

for (const canEdit of [false, true]) {
  test(`search highlights all editor text fields (${canEdit ? "editable" : "read-only"})`, async ({ page }) => {
    const rowId = "fixture-row-0001";
    await mountEditorFixture(page, {
      rowCount: 2, chapterStatus: "ready",
      fieldsByRowId: { [rowId]: { vi: "Needle body[2][7]" } },
      imagesByRowId: { [rowId]: { vi: { kind: "url", url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='orange'/%3E%3C/svg%3E" } } },
    }, { mockTauri: true });
    await page.evaluate(async ({ rowId, canEdit }) => {
      const { state } = await import("/app/state.js");
      const row = state.editorChapter.rows.find((row) => row.rowId === rowId);
      row.footnotes.vi = [
        { marker: 2, text: 'A longer first note with <em>Needle</em> and <a href="https://example.com">a link</a>.' },
        { marker: 7, text: "Needle begins the second note." },
      ];
      row.imageCaptions.vi = "Picture <u>Needle</u> caption";
      row.persistedFootnotes = structuredClone(row.footnotes);
      row.persistedImageCaptions = { ...row.imageCaptions };
      // Publish new rows as a normal editor update would, invalidating its model cache.
      state.editorChapter.rows = [...state.editorChapter.rows];
      if (!canEdit) {
        state.editorChapter.writePermissionSnapshot = {
          ...state.editorChapter.writePermissionSnapshot, source: "test", canEditProjectFiles: false,
        };
      }
    }, { rowId, canEdit });
    const search = page.locator("[data-editor-search-input]");
    await search.fill("needle");
    const panel = page.locator(`[data-editor-language-panel][data-row-id="${rowId}"][data-language-code="vi"]`);
    const marks = panel.locator("mark.translation-language-panel__search-match");
    await expect(marks).toHaveCount(4);
    await expect(panel.locator("em mark")).toHaveText("Needle");
    await expect(panel.locator("u mark")).toHaveText("Needle");
    await expect(panel.locator('.translation-language-panel__footnote-marker').filter({ hasText: "[7]" })).toBeVisible();
    await expect(panel.locator('a[href="https://example.com"]')).toHaveText("a link");
    await panel.screenshot({ path: `/tmp/editor-search-highlighting-${canEdit ? "editable" : "read-only"}.png` });

    // A query found only in an attachment must retain the row and highlight it.
    for (const query of ["second note", "Picture", "body"]) {
      await search.fill(query);
      await expect(panel).toBeVisible();
      await expect(marks).toHaveCount(1);
      await expect(marks).toHaveText(query);
    }
    await search.fill("needle");
    await page.locator('[data-action="toggle-editor-search-case-sensitive"]').click();
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(0);
    await page.locator('[data-action="toggle-editor-search-case-sensitive"]').click();
    await expect(marks).toHaveCount(4);

    if (canEdit) {
      await panel.locator('[data-editor-footnote-display][data-footnote-marker="7"]').click();
      const footnote = panel.locator('textarea[data-content-kind="footnote"][data-footnote-marker="7"]');
      await expect(footnote).toBeFocused();
      const footnoteLayer = footnote.locator("..").locator("[data-editor-search-highlight]");
      await expect(footnoteLayer.locator("mark")).toHaveText("Needle");
      await expect(footnoteLayer).toBeVisible();
      await footnote.fill("   Needle changed, needle again.");
      await expect.poll(() => footnoteLayer.textContent()).toBe("   Needle changed, needle again.");
      await expect(footnoteLayer.locator("mark")).toHaveCount(2);
      await expect(footnote).toBeFocused();
      await footnote.locator("..").screenshot({ path: "/tmp/editor-search-footnote-editing.png" });

      await panel.locator("[data-editor-image-caption-button]").click();
      const caption = panel.locator('textarea[data-content-kind="image-caption"]');
      await expect(caption).toBeFocused();
      const captionLayer = caption.locator("..").locator("[data-editor-search-highlight]");
      await expect(captionLayer.locator("mark")).toHaveText("Needle");
      await expect(captionLayer).toBeVisible();
      await caption.fill("Needle changed caption, needle again.");
      await expect(captionLayer.locator("mark")).toHaveCount(2);
      await expect(caption).toBeFocused();
      await caption.locator("..").screenshot({ path: "/tmp/editor-search-caption-editing.png" });

      const body = await activateMainEditorField(page, rowId, "vi");
      await expect(body.locator("..").locator("[data-editor-search-highlight] mark")).toHaveText("Needle");
    }
    await search.fill("");
    await expect(marks).toHaveCount(0);
  });
}

for (const tab of ["review", "translate", "history", "comments"]) {
  test(`row selection preserves the ${tab === "translate" ? "assistant" : tab} sidebar tab`, async ({ page }) => {
    await mountEditorFixture(page, {
      rowCount: 4, chapterStatus: "ready",
      fieldsByRowId: {
        "fixture-row-0002": { vi: "" },
        "fixture-row-0003": { vi: "  \n  " },
      },
    }, { mockTauri: true });
    await activateMainEditorField(page, "fixture-row-0001", "vi");
    const tabButton = page.locator(`[data-action="switch-editor-sidebar-tab:${tab}"]`);
    await tabButton.click();
    await expect(tabButton).toHaveAttribute("aria-pressed", "true");
    for (const [rowId, languageCode] of [
      ["fixture-row-0002", "vi"], // empty
      ["fixture-row-0003", "vi"], // whitespace only
      ["fixture-row-0004", "vi"], // filled
      ["fixture-row-0002", "es"], // change language
      ["fixture-row-0001", "es"],
    ]) {
      await activateMainEditorField(page, rowId, languageCode);
      await expect(tabButton).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-editor-language-panel].is-active")).toHaveAttribute("data-row-id", rowId);
      await expect(page.locator("[data-editor-language-panel].is-active")).toHaveAttribute("data-language-code", languageCode);
    }
    const search = page.locator("[data-editor-search-input]");
    await search.fill("no matching row for tab preservation 123456789");
    await expect(page.locator("[data-editor-row-card]")).toHaveCount(0);
    await expect(tabButton).toHaveAttribute("aria-pressed", "true");
    await search.fill("");
    await activateMainEditorField(page, "fixture-row-0002", "vi");
    await expect(tabButton).toHaveAttribute("aria-pressed", "true");
    if (tab === "comments") {
      await expect.poll(() => page.evaluate(async () => (await import("/app/state.js")).state.editorChapter.comments.rowId)).toBe("fixture-row-0002");
    }
    // Direct tab navigation remains available after ordinary row selection.
    const otherTab = page.locator(`[data-action="switch-editor-sidebar-tab:${tab === "history" ? "review" : "history"}"]`);
    await otherTab.click();
    await expect(otherTab).toHaveAttribute("aria-pressed", "true");
  });
}
