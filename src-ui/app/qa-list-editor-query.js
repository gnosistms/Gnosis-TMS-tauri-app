import { qaListEditorKeys } from "./query-client.js";
import { createRepoResourceEditorQuery } from "./repo-resource/editor-query.js";

const qaListEditorQuery = createRepoResourceEditorQuery({
  resourceIdFields: ["id", "qaListId"],
  inputResourceIdField: "qaListId",
  contextIdFields: ["qaListId", "id"],
  queryKey: qaListEditorKeys.byQaList,
  command: "load_gtms_qa_list_editor_data",
});

export const qaListEditorQueryKey = qaListEditorQuery.editorQueryKey;
export const createQaListEditorQueryOptions = qaListEditorQuery.createEditorQueryOptions;
export const getCachedQaListEditorPayload = qaListEditorQuery.getCachedEditorPayload;
export const setCachedQaListEditorPayload = qaListEditorQuery.setCachedEditorPayload;
export const removeQaListEditorQuery = qaListEditorQuery.removeEditorQuery;
