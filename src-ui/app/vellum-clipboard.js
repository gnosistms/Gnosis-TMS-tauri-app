import { invoke } from "./runtime.js";

export const VELLUM_TEXT_EDITOR_CONTENT_TYPE = "co.180g.Vellum.TextEditorContent";

export async function copyVellumTextEditorContentToClipboard(input, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  return invokeCommand("copy_vellum_text_editor_content_to_clipboard", {
    input,
  });
}

export async function prepareVellumImageResources(input, operations = {}) {
  const invokeCommand = operations.invoke ?? invoke;
  return invokeCommand("prepare_vellum_image_resources", {
    input,
  });
}
