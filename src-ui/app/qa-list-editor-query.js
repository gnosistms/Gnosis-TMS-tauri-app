import { qaListEditorKeys } from "./query-client.js";
import { createRepoResourceEditorQuery } from "./repo-resource/editor-query.js";
import { qaListResourceDescriptor } from "./qa-list-resource-descriptor.js";

const qaListEditorQuery = createRepoResourceEditorQuery({
  ...qaListResourceDescriptor,
  resourceIdFields: ["id", "qaListId"],
  contextIdFields: ["qaListId", "id"],
  queryKey: qaListEditorKeys.byQaList,
  command: "load_gtms_qa_list_editor_data",
});

export const qaListEditorQueryKey = qaListEditorQuery.editorQueryKey;
export const createQaListEditorQueryOptions = qaListEditorQuery.createEditorQueryOptions;
export const getCachedQaListEditorPayload = qaListEditorQuery.getCachedEditorPayload;
export const setCachedQaListEditorPayload = qaListEditorQuery.setCachedEditorPayload;
export const removeQaListEditorQuery = qaListEditorQuery.removeEditorQuery;
