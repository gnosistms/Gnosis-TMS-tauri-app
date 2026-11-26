import { recordAiModelList } from "../ai-model-history.js";
import { state } from "../state.js";

export function registerAiModelPickerEvents(doc = document) {
  function noteOpened(event) {
    if (event.defaultPrevented) return;
    const select = event.target.closest?.("[data-ai-settings-model-select]");
    if (!select || select.disabled || state.screen !== "aiKey") return;
    const models = Array.from(select.options, (option) => ({ id: option.value }));
    recordAiModelList(state.auth.session?.login, select.dataset.aiModelProvider, models, { viewed: true });
  }
  // Native selects open on mouse-down. A touch scroll does not produce the
  // compatibility mouse-down of a completed tap.
  doc.addEventListener("mousedown", (event) => {
    if (event.button === 0 && !event.ctrlKey) noteOpened(event);
  });
  doc.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Enter" || event.key === "F4"
      || (event.altKey && event.key === "ArrowDown")) noteOpened(event);
  });
  // Assistive technology can activate a select without a pointer event.
  doc.addEventListener("click", (event) => {
    if (event.detail === 0) noteOpened(event);
  });
}
