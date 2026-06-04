import { createRepoResourceTmxExport } from "./repo-resource/export-flow.js";
import { glossaryResourceDescriptor } from "./glossary-resource-descriptor.js";

export const downloadGlossaryAsTmx = createRepoResourceTmxExport({
  ...glossaryResourceDescriptor,
  unavailableMessage: "The glossary is not available for export.",
  defaultFileBase: "glossary",
  dialogTitle: "Export glossary as TMX",
  filterName: "TMX glossary",
  command: "export_gtms_glossary_to_tmx",
});
