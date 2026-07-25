import { escapeHtml, renderListboxControl } from "../lib/ui.js";

export function supportingText(text) {
  return `<p class="modal__supporting">${escapeHtml(text)}</p>`;
}

export function renderExportSelect({
  id,
  label,
  selectAttributes,
  placeholder,
  options,
  value,
  disabled = false,
}) {
  return `
    <div class="field editor-export-modal__field">
      ${renderListboxControl({
        id,
        label,
        value,
        placeholder,
        disabled,
        selectAttributes,
        options,
      })}
    </div>
  `;
}
