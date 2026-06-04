import { glossaryEditorKeys } from "./query-client.js";
import { createRepoResourceEditorQuery } from "./repo-resource/editor-query.js";
import { glossaryResourceDescriptor } from "./glossary-resource-descriptor.js";

const glossaryEditorQuery = createRepoResourceEditorQuery({
  ...glossaryResourceDescriptor,
  resourceIdFields: ["id", "glossaryId"],
  contextIdFields: ["glossaryId"],
  queryKey: glossaryEditorKeys.byGlossary,
  command: "load_gtms_glossary_editor_data",
});

export const glossaryEditorQueryKey = glossaryEditorQuery.editorQueryKey;
export const createGlossaryEditorQueryOptions = glossaryEditorQuery.createEditorQueryOptions;
export const getCachedGlossaryEditorPayload = glossaryEditorQuery.getCachedEditorPayload;
export const setCachedGlossaryEditorPayload = glossaryEditorQuery.setCachedEditorPayload;
export const removeGlossaryEditorQuery = glossaryEditorQuery.removeEditorQuery;
