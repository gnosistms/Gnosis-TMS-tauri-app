export function isProjectImportFormatError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.startsWith("PROJECT_IMPORT_INVALID_FORMAT:");
}

export function renderProjectImportFormatWarning() {
  return `The file you uploaded is not formatted for import to Gnosis TMS. <button type="button" class="text-link project-import-sample-link" data-action="download-project-import-sample">Click here to download a sample file</button> you can use as an example. We recommend you upload this sample file to an AI chat tool along with the file you just uploaded and ask it to modify your file to follow this format.`;
}
