import {
  renderGlossaryRubyHtml,
  renderGlossaryRubyTermListHtml,
} from "../glossary-ruby.js";

let activeGlossaryTooltipMark = null;
let activeGlossaryTooltipPointer = null;
let glossaryTooltipPlacementFrameId = 0;
let glossaryTooltipElement = null;

function glossaryMarkOffsetFromDomPoint(mark, node, offset) {
  if (!(mark instanceof HTMLElement) || !(node instanceof Node)) {
    return null;
  }

  if (!mark.contains(node)) {
    return null;
  }

  const textLength = mark.textContent?.length ?? 0;
  if (textLength <= 0) {
    return 0;
  }

  const range = document.createRange();
  range.selectNodeContents(mark);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }

  return Math.max(0, Math.min(textLength, range.toString().length));
}

function glossaryMarkOffsetFromPoint(mark, clientX, clientY) {
  if (!(mark instanceof HTMLElement) || typeof document === "undefined") {
    return null;
  }

  if (typeof document.caretPositionFromPoint === "function") {
    const caretPosition = document.caretPositionFromPoint(clientX, clientY);
    const nextOffset = glossaryMarkOffsetFromDomPoint(
      mark,
      caretPosition?.offsetNode ?? null,
      caretPosition?.offset ?? 0,
    );
    if (Number.isInteger(nextOffset)) {
      return nextOffset;
    }
  }

  if (typeof document.caretRangeFromPoint === "function") {
    const caretRange = document.caretRangeFromPoint(clientX, clientY);
    const nextOffset = glossaryMarkOffsetFromDomPoint(
      mark,
      caretRange?.startContainer ?? null,
      caretRange?.startOffset ?? 0,
    );
    if (Number.isInteger(nextOffset)) {
      return nextOffset;
    }
  }

  return null;
}

function focusEditorFieldFromGlossaryMark(event) {
  const mark = event.target instanceof Element
    ? event.target.closest("[data-editor-glossary-mark]")
    : null;
  if (!mark) {
    return false;
  }

  const fieldStack = mark.closest("[data-editor-glossary-field-stack]");
  const field = fieldStack?.querySelector("[data-editor-row-field]");
  if (!(field instanceof HTMLTextAreaElement)) {
    return false;
  }

  event.preventDefault();
  field.focus({ preventScroll: true });

  const start = Number.parseInt(mark.dataset.textStart ?? "", 10);
  const end = Number.parseInt(mark.dataset.textEnd ?? "", 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) {
    return true;
  }

  const preciseOffset = glossaryMarkOffsetFromPoint(mark, event.clientX, event.clientY);
  if (Number.isInteger(preciseOffset)) {
    field.setSelectionRange(start + preciseOffset, start + preciseOffset, "none");
    return true;
  }

  const rect = mark.getBoundingClientRect();
  const ratio =
    rect.width > 0
      ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      : 1;
  const nextOffset = start + Math.round((end - start) * ratio);
  field.setSelectionRange(nextOffset, nextOffset, "none");
  return true;
}

function glossaryTooltipMark(target) {
  return target instanceof Element
    ? target.closest(
      "[data-editor-glossary-mark][data-editor-glossary-tooltip-payload], [data-editor-glossary-mark][data-editor-glossary-tooltip], [data-editor-glossary-mark][data-tooltip]",
    )
    : null;
}

function ensureGlossaryTooltipElement() {
  if (glossaryTooltipElement instanceof HTMLElement && glossaryTooltipElement.isConnected) {
    return glossaryTooltipElement;
  }

  const tooltip = document.createElement("div");
  tooltip.className = "editor-glossary-tooltip";
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.hidden = true;

  const body = document.createElement("div");
  body.className = "editor-glossary-tooltip__body";
  tooltip.append(body);

  document.body.append(tooltip);
  glossaryTooltipElement = tooltip;
  return tooltip;
}

function glossaryTooltipBodyElement() {
  const tooltip = ensureGlossaryTooltipElement();
  return tooltip.querySelector(".editor-glossary-tooltip__body");
}

function glossaryTooltipText(mark) {
  if (typeof mark?.dataset?.editorGlossaryTooltip === "string") {
    const explicitTooltip = mark.dataset.editorGlossaryTooltip.trim();
    if (explicitTooltip) {
      return explicitTooltip;
    }
  }

  return typeof mark?.dataset?.tooltip === "string"
    ? mark.dataset.tooltip.trim()
    : "";
}

function glossaryTooltipPayload(mark) {
  if (typeof mark?.dataset?.editorGlossaryTooltipPayload !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(mark.dataset.editorGlossaryTooltipPayload);
    if (payload?.kind !== "source" && payload?.kind !== "target") {
      return null;
    }

    const title = typeof payload.title === "string" ? payload.title.trim() : "";
    const variants = Array.isArray(payload.variants)
      ? payload.variants.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const translatorNotes = Array.isArray(payload.translatorNotes)
      ? payload.translatorNotes.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const footnotes = Array.isArray(payload.footnotes)
      ? payload.footnotes.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    const originTerms = Array.isArray(payload.originTerms)
      ? payload.originTerms.map((value) => String(value ?? "").trim()).filter(Boolean)
      : [];
    if (
      !title
      && variants.length === 0
      && translatorNotes.length === 0
      && footnotes.length === 0
      && originTerms.length === 0
    ) {
      return null;
    }

    return {
      kind: payload.kind,
      title,
      variants,
      translatorNotes,
      footnotes,
      originTerms,
    };
  } catch {
    return null;
  }
}

function renderStructuredGlossaryTooltipBody(body, payload) {
  body.replaceChildren();
  body.classList.add("editor-glossary-info-card");

  if (payload.title) {
    const title = document.createElement("p");
    title.className = "editor-glossary-info-card__title";
    title.innerHTML = renderGlossaryRubyHtml(payload.title);
    body.append(title);
  }

  if (payload.variants.length > 0) {
    const variants = document.createElement("p");
    variants.className = "editor-glossary-info-card__variants";
    variants.innerHTML = renderGlossaryRubyTermListHtml(payload.variants);
    body.append(variants);
  }

  const originTerms = Array.isArray(payload.originTerms) ? payload.originTerms : [];
  if (originTerms.length > 0) {
    const origin = document.createElement("p");
    origin.className = "editor-glossary-info-card__origin";
    origin.innerHTML = `Glossary source: ${renderGlossaryRubyTermListHtml(originTerms)}`;
    body.append(origin);
  }

  const translatorNotes = Array.isArray(payload.translatorNotes) ? payload.translatorNotes : [];
  const footnotes = Array.isArray(payload.footnotes) ? payload.footnotes : [];
  if (translatorNotes.length > 0 || footnotes.length > 0) {
    const comments = document.createElement("div");
    comments.className = "editor-glossary-info-card__comments";
    for (const note of translatorNotes) {
      const comment = String(note ?? "").trim();
      if (!comment) {
        continue;
      }

      const paragraph = document.createElement("p");
      paragraph.className = "editor-glossary-info-card__comment";
      paragraph.textContent = comment;
      comments.append(paragraph);
    }
    for (const footnote of footnotes) {
      const text = String(footnote ?? "").trim();
      if (!text) {
        continue;
      }

      const paragraph = document.createElement("p");
      paragraph.className = "editor-glossary-info-card__comment editor-glossary-info-card__footnote";
      paragraph.textContent = text;
      comments.append(paragraph);
    }

    if (comments.childElementCount > 0) {
      body.append(comments);
    }
  }
}

function setActiveGlossaryTooltipPointer(clientX, clientY) {
  if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
    activeGlossaryTooltipPointer = { clientX, clientY };
    return;
  }

  activeGlossaryTooltipPointer = null;
}

function glossaryTooltipMarkAtActivePointer() {
  const clientX = activeGlossaryTooltipPointer?.clientX;
  const clientY = activeGlossaryTooltipPointer?.clientY;
  if (
    !Number.isFinite(clientX)
    || !Number.isFinite(clientY)
    || typeof document.elementFromPoint !== "function"
  ) {
    return null;
  }

  const boundedClientX = Math.min(Math.max(0, clientX), Math.max(0, window.innerWidth - 1));
  const boundedClientY = Math.min(Math.max(0, clientY), Math.max(0, window.innerHeight - 1));
  return glossaryTooltipMark(document.elementFromPoint(boundedClientX, boundedClientY));
}

function hideGlossaryTooltip() {
  if (!(glossaryTooltipElement instanceof HTMLElement)) {
    return;
  }

  glossaryTooltipElement.hidden = true;
  glossaryTooltipElement.classList.remove("is-visible");
}

function updateGlossaryTooltipPlacement(mark) {
  if (!(mark instanceof HTMLElement) || !mark.isConnected) {
    hideGlossaryTooltip();
    return;
  }

  const tooltipPayload = glossaryTooltipPayload(mark);
  const tooltipText = glossaryTooltipText(mark);
  if (!tooltipPayload && !tooltipText) {
    hideGlossaryTooltip();
    return;
  }

  const tooltip = ensureGlossaryTooltipElement();
  const body = glossaryTooltipBodyElement();
  if (!(body instanceof HTMLElement)) {
    hideGlossaryTooltip();
    return;
  }

  if (tooltipPayload?.kind === "source" || tooltipPayload?.kind === "target") {
    tooltip.classList.add("editor-glossary-tooltip--structured");
    renderStructuredGlossaryTooltipBody(body, tooltipPayload);
  } else {
    tooltip.classList.remove("editor-glossary-tooltip--structured");
    body.classList.remove("editor-glossary-info-card");
    body.textContent = tooltipText;
  }
  tooltip.hidden = false;
  tooltip.classList.add("is-visible");
  const markRect = mark.getBoundingClientRect();
  const anchorClientX = Number.isFinite(activeGlossaryTooltipPointer?.clientX)
    ? activeGlossaryTooltipPointer.clientX
    : markRect.left;
  const anchorClientY = Number.isFinite(activeGlossaryTooltipPointer?.clientY)
    ? activeGlossaryTooltipPointer.clientY
    : markRect.top;
  const offsetHeight = tooltip.offsetHeight;
  const offsetWidth = tooltip.offsetWidth;
  const gap = 14;
  const left = Math.min(
    Math.max(gap, Math.round(anchorClientX + gap)),
    Math.max(gap, window.innerWidth - offsetWidth - gap),
  );
  const top = Math.max(gap, Math.round(anchorClientY - offsetHeight - gap));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function scheduleActiveGlossaryTooltipPlacementUpdate() {
  if (glossaryTooltipPlacementFrameId || !(activeGlossaryTooltipMark instanceof HTMLElement)) {
    return;
  }

  glossaryTooltipPlacementFrameId = window.requestAnimationFrame(() => {
    glossaryTooltipPlacementFrameId = 0;
    const hoveredMark = glossaryTooltipMarkAtActivePointer();
    if (hoveredMark && hoveredMark !== activeGlossaryTooltipMark) {
      activateGlossaryTooltipMark(hoveredMark);
      return;
    }

    if (!hoveredMark && activeGlossaryTooltipPointer) {
      deactivateGlossaryTooltipMark();
      return;
    }

    if (!(activeGlossaryTooltipMark instanceof HTMLElement) || !activeGlossaryTooltipMark.isConnected) {
      activeGlossaryTooltipMark = null;
      return;
    }

    updateGlossaryTooltipPlacement(activeGlossaryTooltipMark);
  });
}

function activateGlossaryTooltipMark(mark) {
  if (!(mark instanceof HTMLElement)) {
    return;
  }

  activeGlossaryTooltipMark = mark;
  updateGlossaryTooltipPlacement(mark);
}

function deactivateGlossaryTooltipMark(mark = activeGlossaryTooltipMark) {
  if (glossaryTooltipPlacementFrameId) {
    window.cancelAnimationFrame(glossaryTooltipPlacementFrameId);
    glossaryTooltipPlacementFrameId = 0;
  }

  hideGlossaryTooltip();

  if (!mark || activeGlossaryTooltipMark === mark) {
    activeGlossaryTooltipMark = null;
    activeGlossaryTooltipPointer = null;
  }
}

export function handleGlossaryTooltipPointerMove(event) {
  const mark = glossaryTooltipMark(event.target);
  if (mark && activeGlossaryTooltipMark === mark) {
    setActiveGlossaryTooltipPointer(event.clientX, event.clientY);
    updateGlossaryTooltipPlacement(mark);
  }
}

export function registerGlossaryTooltipEvents() {
  document.addEventListener("pointerover", (event) => {
    const mark = glossaryTooltipMark(event.target);
    if (!mark) {
      return;
    }

    setActiveGlossaryTooltipPointer(event.clientX, event.clientY);
    activateGlossaryTooltipMark(mark);
  });

  document.addEventListener("pointerout", (event) => {
    const mark = glossaryTooltipMark(event.target);
    if (!mark) {
      return;
    }

    const nextMark = glossaryTooltipMark(event.relatedTarget);
    if (nextMark === mark) {
      return;
    }

    deactivateGlossaryTooltipMark(mark);
  });

  document.addEventListener("scroll", () => {
    scheduleActiveGlossaryTooltipPlacementUpdate();
  }, true);

  window.addEventListener("resize", () => {
    scheduleActiveGlossaryTooltipPlacementUpdate();
  });
}

export {
  deactivateGlossaryTooltipMark,
  focusEditorFieldFromGlossaryMark,
};
