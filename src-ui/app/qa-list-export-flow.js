import { createRepoResourceTmxExport } from "./repo-resource/export-flow.js";

export const downloadQaListAsTmx = createRepoResourceTmxExport({
  collectionField: "qaLists",
  resourceIdField: "qaListId",
  unavailableMessage: "The QA list is not available for export.",
  defaultFileBase: "qa-list",
  dialogTitle: "Export QA list as TMX",
  filterName: "TMX QA list",
  command: "export_gtms_qa_list_to_tmx",
});
