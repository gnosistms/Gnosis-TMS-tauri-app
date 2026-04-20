function roundAlignmentNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function clampAlignmentIndex(value, minimum, maximum) {
  const nextValue = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(nextValue)) {
    return minimum;
  }
  return Math.min(Math.max(nextValue, minimum), maximum);
}

function normalizeAlignmentWidths(options = {}) {
  if (Array.isArray(options?.widths) && options.widths.length > 0) {
    return options.widths
      .map((value) => Number.parseInt(String(value ?? ""), 10))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  const start = clampAlignmentIndex(options?.widthStart, 320, 100000);
  const end = clampAlignmentIndex(options?.widthEnd, start, 100000);
  const step = clampAlignmentIndex(options?.widthStep, 1, 10000);
  const widths = [];

  for (let width = start; width <= end; width += step) {
    widths.push(width);
  }

  if (widths[widths.length - 1] !== end) {
    widths.push(end);
  }

  return widths;
}

function escapeSelectorValue(value) {
  return typeof CSS?.escape === "function" ? CSS.escape(String(value ?? "")) : String(value ?? "");
}

function buildGlossaryFieldStackSelector(rowId, languageCode, contentKind = "field") {
  const contentKindSelector =
    contentKind === "footnote"
      ? '[data-content-kind="footnote"]'
      : ":not([data-content-kind])";
  return `[data-editor-glossary-field-stack][data-row-id="${escapeSelectorValue(rowId)}"][data-language-code="${escapeSelectorValue(languageCode)}"]${contentKindSelector}`;
}

function normalizeAlignmentRects(rectList, originRect) {
  return Array.from(rectList ?? [])
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => ({
      left: roundAlignmentNumber(rect.left - originRect.left),
      top: roundAlignmentNumber(rect.top - originRect.top),
      right: roundAlignmentNumber(rect.right - originRect.left),
      bottom: roundAlignmentNumber(rect.bottom - originRect.top),
      width: roundAlignmentNumber(rect.width),
      height: roundAlignmentNumber(rect.height),
    }));
}

function compareAlignmentRectSeries(overlayRects = [], referenceRects = [], thresholdPx = 1) {
  const pairedRectCount = Math.min(overlayRects.length, referenceRects.length);
  let maxEdgeDelta = 0;
  let maxSizeDelta = 0;

  for (let index = 0; index < pairedRectCount; index += 1) {
    const overlayRect = overlayRects[index];
    const referenceRect = referenceRects[index];
    if (!overlayRect || !referenceRect) {
      continue;
    }

    maxEdgeDelta = Math.max(
      maxEdgeDelta,
      Math.abs((overlayRect.left ?? 0) - (referenceRect.left ?? 0)),
      Math.abs((overlayRect.top ?? 0) - (referenceRect.top ?? 0)),
      Math.abs((overlayRect.right ?? 0) - (referenceRect.right ?? 0)),
      Math.abs((overlayRect.bottom ?? 0) - (referenceRect.bottom ?? 0)),
    );
    maxSizeDelta = Math.max(
      maxSizeDelta,
      Math.abs((overlayRect.width ?? 0) - (referenceRect.width ?? 0)),
      Math.abs((overlayRect.height ?? 0) - (referenceRect.height ?? 0)),
    );
  }

  const lineCountDelta = Math.abs(overlayRects.length - referenceRects.length);
  const matches = lineCountDelta === 0 && maxEdgeDelta <= thresholdPx && maxSizeDelta <= thresholdPx;

  return {
    matches,
    lineCountDelta,
    maxEdgeDelta: roundAlignmentNumber(maxEdgeDelta),
    maxSizeDelta: roundAlignmentNumber(maxSizeDelta),
  };
}

function collectFirstTextNode(element) {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  return walker.nextNode();
}

function createReferenceRangeMetrics(referenceLayer, start, end, originRect) {
  const textNode = collectFirstTextNode(referenceLayer);
  if (!(textNode instanceof Text)) {
    return [];
  }

  const safeStart = clampAlignmentIndex(start, 0, textNode.length);
  const safeEnd = clampAlignmentIndex(end, safeStart, textNode.length);
  const range = document.createRange();
  range.setStart(textNode, safeStart);
  range.setEnd(textNode, safeEnd);
  const rects = normalizeAlignmentRects(range.getClientRects(), originRect);
  range.detach?.();
  return rects;
}

function createGlossaryAlignmentHarness(sourceFieldStack, options = {}) {
  if (!(sourceFieldStack instanceof HTMLElement)) {
    return null;
  }

  const host = document.createElement("div");
  host.dataset.editorGlossaryAlignmentHarness = "";
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });

  if (typeof options?.cssText === "string" && options.cssText.trim()) {
    const style = document.createElement("style");
    style.dataset.editorGlossaryAlignmentHarnessStyle = "";
    style.textContent = options.cssText;
    host.append(style);
  }

  const clone = sourceFieldStack.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    return null;
  }

  clone.style.width = "100%";
  clone.style.maxWidth = "none";
  clone.style.minWidth = "0";

  const field = clone.querySelector("[data-editor-row-field]");
  const text = field instanceof HTMLTextAreaElement ? field.value : "";
  if (field instanceof HTMLTextAreaElement) {
    field.value = text;
    field.readOnly = true;
    field.setAttribute("readonly", "");
  }

  const glossaryLayer = clone.querySelector("[data-editor-glossary-highlight]");
  if (!(glossaryLayer instanceof HTMLElement)) {
    return null;
  }

  const referenceLayer = document.createElement("div");
  referenceLayer.className = "translation-language-panel__field-highlight translation-language-panel__glossary-highlight";
  referenceLayer.dataset.editorGlossaryAlignmentReference = "";
  referenceLayer.setAttribute("aria-hidden", "true");
  referenceLayer.lang = glossaryLayer.lang || field?.lang || "";
  referenceLayer.style.display = "block";
  referenceLayer.style.zIndex = "0";
  referenceLayer.textContent = text;
  clone.append(referenceLayer);

  host.append(clone);
  document.body.append(host);

  return {
    host,
    fieldStack: clone,
    glossaryLayer,
    referenceLayer,
  };
}

async function waitForGlossaryMarks(fieldStack, timeoutMs = 1000) {
  if (!(fieldStack instanceof HTMLElement)) {
    return 0;
  }

  const deadline = performance.now() + Math.max(0, timeoutMs);
  let markCount = fieldStack.querySelectorAll("[data-editor-glossary-mark]").length;
  while (markCount === 0 && performance.now() < deadline) {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    markCount = fieldStack.querySelectorAll("[data-editor-glossary-mark]").length;
  }

  return markCount;
}

function measureGlossaryAlignmentAtWidth(harness, width, thresholdPx = 1) {
  if (!harness?.host || !(harness.fieldStack instanceof HTMLElement)) {
    return null;
  }

  harness.host.style.width = `${width}px`;
  const originRect = harness.fieldStack.getBoundingClientRect();
  const marks = [...harness.glossaryLayer.querySelectorAll("[data-editor-glossary-mark]")];
  const markResults = [];
  let mismatchCount = 0;
  let maxEdgeDelta = 0;
  let maxSizeDelta = 0;

  for (const mark of marks) {
    if (!(mark instanceof HTMLElement)) {
      continue;
    }

    const start = Number.parseInt(mark.dataset.textStart ?? "", 10);
    const end = Number.parseInt(mark.dataset.textEnd ?? "", 10);
    const overlayRects = normalizeAlignmentRects(mark.getClientRects(), originRect);
    const referenceRects = createReferenceRangeMetrics(harness.referenceLayer, start, end, originRect);
    const comparison = compareAlignmentRectSeries(overlayRects, referenceRects, thresholdPx);
    const result = {
      text: mark.textContent ?? "",
      start: Number.isInteger(start) ? start : null,
      end: Number.isInteger(end) ? end : null,
      overlayRects,
      referenceRects,
      ...comparison,
    };

    if (!comparison.matches) {
      mismatchCount += 1;
    }
    maxEdgeDelta = Math.max(maxEdgeDelta, comparison.maxEdgeDelta ?? 0);
    maxSizeDelta = Math.max(maxSizeDelta, comparison.maxSizeDelta ?? 0);
    markResults.push(result);
  }

  return {
    width,
    markCount: markResults.length,
    mismatchCount,
    maxEdgeDelta: roundAlignmentNumber(maxEdgeDelta),
    maxSizeDelta: roundAlignmentNumber(maxSizeDelta),
    marks: markResults,
  };
}

export async function measureEditorGlossaryAlignment(options = {}) {
  if (document.fonts?.ready instanceof Promise) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font-loading errors in the debug harness.
    }
  }

  const rowId = typeof options?.rowId === "string" ? options.rowId.trim() : "";
  const languageCode = typeof options?.languageCode === "string" ? options.languageCode.trim() : "";
  if (!rowId || !languageCode) {
    return {
      ok: false,
      error: "rowId and languageCode are required.",
    };
  }

  const selector = buildGlossaryFieldStackSelector(rowId, languageCode, options?.contentKind);
  const sourceFieldStack = document.querySelector(selector);
  if (!(sourceFieldStack instanceof HTMLElement)) {
    return {
      ok: false,
      error: `No glossary field stack found for selector: ${selector}`,
    };
  }

  const widths = normalizeAlignmentWidths(options);
  if (widths.length === 0) {
    return {
      ok: false,
      error: "At least one width is required.",
    };
  }

  const thresholdPx = Number.isFinite(options?.thresholdPx) ? Number(options.thresholdPx) : 1;
  await waitForGlossaryMarks(
    sourceFieldStack,
    Number.isFinite(options?.waitForMarksTimeoutMs) ? Number(options.waitForMarksTimeoutMs) : 1000,
  );
  const harness = createGlossaryAlignmentHarness(sourceFieldStack, options);
  if (!harness) {
    return {
      ok: false,
      error: "The glossary alignment harness could not be created.",
    };
  }

  try {
    const measurements = widths
      .map((width) => measureGlossaryAlignmentAtWidth(harness, width, thresholdPx))
      .filter(Boolean);
    const badWidths = measurements
      .filter((measurement) => measurement.mismatchCount > 0)
      .map((measurement) => measurement.width);
    const worstMeasurement = measurements.reduce((worst, measurement) => {
      if (!worst) {
        return measurement;
      }
      if ((measurement.mismatchCount ?? 0) > (worst.mismatchCount ?? 0)) {
        return measurement;
      }
      if ((measurement.maxEdgeDelta ?? 0) > (worst.maxEdgeDelta ?? 0)) {
        return measurement;
      }
      return worst;
    }, null);

    return {
      ok: true,
      rowId,
      languageCode,
      thresholdPx,
      widthCount: measurements.length,
      badWidths,
      measurements,
      worstMeasurement,
    };
  } finally {
    harness.host.remove();
  }
}
