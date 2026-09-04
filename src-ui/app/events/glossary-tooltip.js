import {
  renderGlossaryRubyHtml,
  renderGlossaryRubyTermListHtml,
} from "../glossary-ruby.js";
import { canManageGlossaries } from "../glossary-shared.js";

// Double-click detection runs on pointerdown: the display-field pointerdown
// handler calls preventDefault, which suppresses the derived mousedown events, so
// mousedown never fires for marks inside display fields. The first click on a
// glossary mark also flips its row into edit mode synchronously — the mark is
// detached (its rectangle collapses to zero) before document-level bubble handlers
// run, and the second pointerdown lands on the textarea. The first click therefore
// records the term id and the click coordinates, and the second click matches when
// it lands within a small slop distance of the first (event.detail is not a
// reliable click counter on pointerdown across webviews).
const GLOSSARY_MARK_DOUBLE_CLICK_WINDOW_MS = 500;
const GLOSSARY_MARK_DOUBLE_CLICK_SLOP_PX = 8;

let activeGlossaryTooltipMark = null;
let activeGlossaryTooltipPointer = null;
let glossaryTooltipPlacementFrameId = 0;
let glossaryTooltipElement = null;
let pendingGlossaryMarkDoubleClick = null;

function glossaryMarkTermId(mark) {
  const termId = typeof mark?.dataset?.editorGlossaryTermId === "string"
    ? mark.dataset.editorGlossaryTermId.trim()
    : "";
  return termId || null;
}

function pointWithinGlossaryMarkClickSlop(previousClick, clientX, clientY) {
  return (
    Math.abs(clientX - previousClick.clientX) <= GLOSSARY_MARK_DOUBLE_CLICK_SLOP_PX
    && Math.abs(clientY - previousClick.clientY) <= GLOSSARY_MARK_DOUBLE_CLICK_SLOP_PX
  );
}

export function handleGlossaryMarkDoubleClick(event, dispatchAction) {
  if (event.button !== 0) {
    return false;
  }

  const mark = event.target instanceof Element
    ? event.target.closest("[data-editor-glossary-mark]")
    : null;
  const markTermId = glossaryMarkTermId(mark);
  const previousClick = pendingGlossaryMarkDoubleClick;
  pendingGlossaryMarkDoubleClick = null;

  const now = Date.now();
  const previousClickMatches = Boolean(
    previousClick
    && now - previousClick.time <= GLOSSARY_MARK_DOUBLE_CLICK_WINDOW_MS
    && pointWithinGlossaryMarkClickSlop(previousClick, event.clientX, event.clientY),
  );

  if (markTermId) {
    pendingGlossaryMarkDoubleClick = {
      termId: markTermId,
      clientX: event.clientX,
      clientY: event.clientY,
      time: now,
    };
  }

  if (event.detail < 2 && !previousClickMatches) {
    return false;
  }

  const jumpTermId = markTermId ?? (previousClickMatches ? previousClick.termId : null);
  if (!jumpTermId || !canManageGlossaries()) {
    return false;
  }

  event.preventDefault();
  pendingGlossaryMarkDoubleClick = null;
  deactivateGlossaryTooltipMark();
  void dispatchAction(`open-editor-glossary-term:${jumpTermId}`, event);
  return true;
}

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
  const mark = target instanceof Element
    ? target.closest(
      "[data-editor-glossary-mark][data-editor-glossary-tooltip-payload], [data-editor-glossary-mark][data-editor-glossary-tooltip], [data-editor-glossary-mark][data-tooltip]",
    )
    : null;
  return glossaryPopoverContextForMark(mark) ? mark : null;
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
      ? payload.variants
        .map((value) => {
          if (value && typeof value === "object") {
            return {
              text: String(value.text ?? "").trim(),
              note: String(value.note ?? "").trim(),
            };
          }
          return {
            text: String(value ?? "").trim(),
            note: "",
          };
        })
        .filter((value) => value.text || value.note)
      : [];
    const targetVariantNote =
      typeof payload.targetVariantNote === "string" ? payload.targetVariantNote.trim() : "";
    const rawNoTranslation =
      payload.noTranslation && typeof payload.noTranslation === "object"
        ? {
            position: String(payload.noTranslation.position ?? "").trim(),
            note: String(payload.noTranslation.note ?? "").trim(),
          }
        : null;
    const noTranslation =
      rawNoTranslation && (rawNoTranslation.position || rawNoTranslation.note)
        ? rawNoTranslation
        : null;
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
      && !noTranslation
      && !targetVariantNote
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
      noTranslation,
      targetVariantNote,
      translatorNotes,
      footnotes,
      originTerms,
    };
  } catch {
    return null;
  }
}

function renderStructuredGlossaryTooltipBody(
  body,
  payload,
  { showEditHint = false, showInsertHint = false, showFootnoteLabel = false } = {},
) {
  body.replaceChildren();
  body.classList.add("editor-glossary-info-card");

  if (showFootnoteLabel) {
    const label = document.createElement("p");
    label.className = "editor-glossary-info-card__label";
    label.textContent = "Footnote:";
    body.append(label);
  }

  if (payload.title) {
    const title = document.createElement("p");
    title.className = "editor-glossary-info-card__title";
    title.innerHTML = renderGlossaryRubyHtml(payload.title);
    body.append(title);
  }

  const displayVariants = [...payload.variants];
  if (payload.kind === "source" && payload.noTranslation) {
    displayVariants.push({
      text: "No translation",
      note: payload.noTranslation.note ?? "",
    });
  }

  if (displayVariants.length > 0) {
    const variants = document.createElement("div");
    variants.className = "editor-glossary-info-card__variants";
    const variantItems = displayVariants.map((variant) => {
      const text = typeof variant === "string" ? variant : variant?.text ?? "";
      const note = typeof variant === "string" ? "" : variant?.note ?? "";
      const row = document.createElement("p");
      row.className = "editor-glossary-info-card__variant";
      if (text) {
        const term = document.createElement("span");
        term.className = "editor-glossary-info-card__variant-term";
        term.innerHTML = renderGlossaryRubyHtml(text);
        row.append(term);
      }
      if (note) {
        const noteElement = document.createElement("span");
        noteElement.className = "editor-glossary-info-card__variant-note";
        noteElement.textContent = note;
        row.append(noteElement);
      }
      return row;
    });
    variants.append(...variantItems);
    body.append(variants);
  }

  if (payload.kind === "target" && payload.targetVariantNote) {
    const note = document.createElement("p");
    note.className = "editor-glossary-info-card__comment";
    note.textContent = payload.targetVariantNote;
    body.append(note);
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

  if (showEditHint || showInsertHint) {
    const footer = document.createElement("div");
    footer.className = "editor-glossary-info-card__footer";
    if (showEditHint) {
      const editHint = document.createElement("span");
      editHint.className = "editor-glossary-info-card__hint";
      editHint.textContent = "Double click to edit";
      footer.append(editHint);
    }
    if (showInsertHint) {
      const insertHint = document.createElement("span");
      insertHint.className = "editor-glossary-info-card__hint editor-glossary-info-card__hint--insert";
      insertHint.textContent = "Ctrl + F to insert footnote";
      footer.append(insertHint);
    }
    body.append(footer);
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

  const popoverContext = glossaryPopoverContextForMark(mark);
  const tooltipPayload = popoverContext?.payload ?? null;
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
    // Checked at render time (not baked into the cached highlight HTML) so
    // capability changes apply without invalidating the highlight cache.
    const showEditHint = Boolean(glossaryMarkTermId(mark)) && canManageGlossaries();
    const showFootnoteLabel = popoverContext?.kind === "footnote";
    const showInsertHint = showFootnoteLabel
      && Boolean(glossaryFootnoteInsertionRequestForMark(mark));
    renderStructuredGlossaryTooltipBody(body, tooltipPayload, {
      showEditHint,
      showInsertHint,
      showFootnoteLabel,
    });
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
  // Delegated pointer events can arrive out of order when moving between inline
  // sibling marks in WKWebView. A stale leave from the previous mark must not
  // hide the popover already activated for the new mark.
  if (mark && activeGlossaryTooltipMark !== mark) {
    return;
  }

  if (glossaryTooltipPlacementFrameId) {
    window.cancelAnimationFrame(glossaryTooltipPlacementFrameId);
    glossaryTooltipPlacementFrameId = 0;
  }

  hideGlossaryTooltip();

  activeGlossaryTooltipMark = null;
  activeGlossaryTooltipPointer = null;
}

export function handleGlossaryTooltipPointerMove(event) {
  const mark = glossaryTooltipMark(event.target);
  if (!mark) {
    if (activeGlossaryTooltipMark) {
      deactivateGlossaryTooltipMark();
    }
    return;
  }

  setActiveGlossaryTooltipPointer(event.clientX, event.clientY);
  if (activeGlossaryTooltipMark !== mark) {
    // Pointerover/out is normally sufficient, but inline marks can be adjacent
    // siblings (and WebKit may coalesce their boundary transition). Treat every
    // pointermove target as authoritative so each occurrence can take over the
    // popover even when the boundary events are skipped.
    activateGlossaryTooltipMark(mark);
    return;
  }

  updateGlossaryTooltipPlacement(mark);
}

export function glossaryFootnoteInsertionRequestForMark(mark) {
  const payload = glossaryFootnotePopoverPayloadForMark(mark);
  if (!payload || payload.footnotes.length !== 1) {
    return null;
  }

  const displayField = mark.closest("[data-editor-display-field][data-row-id][data-language-code]");
  const visibleInsertIndex = Number.parseInt(mark.dataset.textEnd ?? "", 10);
  if (!(displayField instanceof HTMLElement) || !Number.isInteger(visibleInsertIndex)) {
    return null;
  }

  const rowId = String(displayField.dataset.rowId ?? "").trim();
  const languageCode = String(displayField.dataset.languageCode ?? "").trim();
  if (!rowId || !languageCode) {
    return null;
  }

  return {
    rowId,
    languageCode,
    visibleInsertIndex,
    footnoteText: payload.footnotes[0],
  };
}

export function glossaryFootnotePopoverPayloadForMark(mark) {
  if (!(mark instanceof HTMLElement) || !mark.isConnected) {
    return null;
  }

  const payload = glossaryTooltipPayload(mark);
  if (payload?.kind !== "target" || payload.footnotes.length === 0) {
    return null;
  }

  // Open textareas render glossary marks in a highlight overlay. Only marks in
  // the closed field's display text are eligible for this popover.
  if (!(mark.closest("[data-editor-display-text]") instanceof HTMLElement)) {
    return null;
  }

  return payload;
}

export function glossaryPopoverContextForMark(mark) {
  if (!(mark instanceof HTMLElement) || !mark.isConnected) {
    return null;
  }

  const payload = glossaryTooltipPayload(mark);
  if (payload?.kind === "source") {
    // Source terms keep their ordinary glossary information card, but the
    // glossary footnote itself is reserved for the target-language footnote
    // card introduced by this feature.
    return {
      kind: "glossary",
      payload: {
        ...payload,
        footnotes: [],
      },
    };
  }

  if (
    payload?.kind !== "target"
    || !(mark.closest("[data-editor-display-text]") instanceof HTMLElement)
  ) {
    return null;
  }

  // Closed target fields always retain their normal glossary information card.
  // A populated footnote augments that card with the footnote label and insert
  // hint; it is not what makes the glossary popover itself eligible.
  return payload.footnotes.length > 0
    ? { kind: "footnote", payload }
    : { kind: "glossary", payload };
}

export function activeGlossaryFootnoteInsertionRequest() {
  return glossaryFootnoteInsertionRequestForMark(activeGlossaryTooltipMark);
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
