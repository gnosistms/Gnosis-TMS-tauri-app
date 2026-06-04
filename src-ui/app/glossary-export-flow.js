import { createRepoResourceTmxExport } from "./repo-resource/export-flow.js";

export const downloadGlossaryAsTmx = createRepoResourceTmxExport({
  collectionField: "glossaries",
  resourceIdField: "glossaryId",
  unavailableMessage: "The glossary is not available for export.",
  defaultFileBase: "glossary",
  dialogTitle: "Export glossary as TMX",
  filterName: "TMX glossary",
  command: "export_gtms_glossary_to_tmx",
});
