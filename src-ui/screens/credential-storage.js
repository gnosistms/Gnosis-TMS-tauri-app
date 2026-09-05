import { renderInlineStateBox, secondaryButton } from "../lib/ui.js";

export function renderCredentialStorageStatus(storage) {
  if (!storage?.message) return "";
  return `<div class="credential-storage-status">
    ${renderInlineStateBox({ tone: "warning", message: storage.message })}
    ${storage.mode === "locked" ? `<div class="modal__actions">
      ${secondaryButton("Retry secure storage", "retry-credential-storage")}
      ${secondaryButton("Use for this session only", "use-session-only-credentials")}
    </div>` : ""}
  </div>`;
}
