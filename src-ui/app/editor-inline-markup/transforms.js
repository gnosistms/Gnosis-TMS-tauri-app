import { rubyButtonConfig } from "./ruby.js";
import {
  STYLE_TO_TAG,
  TAG_TO_STYLE,
  elementNode,
  textNode,
  cloneNode,
  parseInlineMarkup,
  splitRubyNodeChildren,
} from "./parser.js";
import { serializeNodes } from "./serialize.js";
import {
  rawOffsetToVisiblePosition,
  collapsedWordVisibleRange,
  visiblePositionToRawOffset,
  findElementContainingCursor,
  findElementContainingSelection,
} from "./ranges.js";

function normalizeInlineStyle(style) {
  const normalized = typeof style === "string" ? style.trim().toLowerCase() : "";
  return STYLE_TO_TAG[normalized] ?? "";
}

function splitTextByVisibleRange(node, start, end) {
  const overlapStart = Math.max(start, node.visibleStart);
  const overlapEnd = Math.min(end, node.visibleEnd);
  if (overlapEnd <= overlapStart) {
    return {
      before: node.text,
      middle: "",
      after: "",
    };
  }

  const localStart = overlapStart - node.visibleStart;
  const localEnd = overlapEnd - node.visibleStart;
  return {
    before: node.text.slice(0, localStart),
    middle: node.text.slice(localStart, localEnd),
    after: node.text.slice(localEnd),
  };
}

function cloneElementWithChildren(node, children) {
  return {
    ...node,
    children,
  };
}

function materializeStyledSegments(segments, tag) {
  const nextNodes = [];
  let styledBuffer = [];

  function flushStyledBuffer() {
    if (styledBuffer.length === 0) {
      return;
    }

    nextNodes.push(elementNode(tag, styledBuffer));
    styledBuffer = [];
  }

  for (const segment of Array.isArray(segments) ? segments : []) {
    if (!segment?.node) {
      continue;
    }

    if (segment.styled) {
      styledBuffer.push(segment.node);
      continue;
    }

    flushStyledBuffer();
    nextNodes.push(segment.node);
  }

  flushStyledBuffer();
  return nextNodes;
}

function applyStyleSegments(nodes, tag, start, end, underTarget = false) {
  const segments = [];

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.type === "text") {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      const split = splitTextByVisibleRange(node, start, end);
      if (split.before) {
        segments.push({ styled: underTarget, node: textNode(split.before, 0, 0, 0) });
      }
      if (split.middle) {
        segments.push({ styled: true, node: textNode(split.middle, 0, 0, 0) });
      }
      if (split.after) {
        segments.push({ styled: underTarget, node: textNode(split.after, 0, 0, 0) });
      }
      continue;
    }

    if (node.tag === "ruby" && tag !== "ruby") {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      segments.push({ styled: true, node: cloneNode(node) });
      continue;
    }

    if (node.tag === tag) {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      const childSegments = applyStyleSegments(node.children, tag, start, end, true);
      segments.push({
        styled: underTarget,
        node: cloneElementWithChildren(node, materializeStyledSegments(childSegments, tag)),
      });
      continue;
    }

    if (end <= node.visibleStart || start >= node.visibleEnd) {
      segments.push({ styled: underTarget, node: cloneNode(node) });
      continue;
    }

    const childSegments = applyStyleSegments(node.children, tag, start, end, underTarget);
    for (const group of groupSegmentsByStyle(childSegments)) {
      segments.push({
        styled: group.styled,
        node: cloneElementWithChildren(node, group.nodes),
      });
    }
  }

  return segments;
}

function removeStyleSegments(nodes, tag, start, end, underTarget = false) {
  const segments = [];

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.type === "text") {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      const split = splitTextByVisibleRange(node, start, end);
      if (split.before) {
        segments.push({ styled: underTarget, node: textNode(split.before, 0, 0, 0) });
      }
      if (split.middle) {
        segments.push({ styled: false, node: textNode(split.middle, 0, 0, 0) });
      }
      if (split.after) {
        segments.push({ styled: underTarget, node: textNode(split.after, 0, 0, 0) });
      }
      continue;
    }

    if (node.tag === "ruby" && tag !== "ruby") {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      segments.push({ styled: false, node: cloneNode(node) });
      continue;
    }

    if (node.tag === tag) {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      segments.push(...removeStyleSegments(node.children, tag, start, end, true));
      continue;
    }

    if (end <= node.visibleStart || start >= node.visibleEnd) {
      segments.push({ styled: underTarget, node: cloneNode(node) });
      continue;
    }

    const childSegments = removeStyleSegments(node.children, tag, start, end, underTarget);
    for (const group of groupSegmentsByStyle(childSegments)) {
      segments.push({
        styled: group.styled,
        node: cloneElementWithChildren(node, group.nodes),
      });
    }
  }

  return segments;
}

function groupSegmentsByStyle(segments) {
  const groups = [];
  let current = null;

  for (const segment of Array.isArray(segments) ? segments : []) {
    if (!segment?.node) {
      continue;
    }

    if (!current || current.styled !== segment.styled) {
      current = {
        styled: segment.styled,
        nodes: [],
      };
      groups.push(current);
    }

    current.nodes.push(segment.node);
  }

  return groups;
}

function unwrapWholeElement(parsed, targetNode) {
  if (targetNode?.tag === "ruby") {
    const { baseChildren } = splitRubyNodeChildren(targetNode.children);
    return (
      parsed.source.slice(0, targetNode.rawStart)
      + serializeNodes(baseChildren)
      + parsed.source.slice(targetNode.closeEnd >= 0 ? targetNode.closeEnd : targetNode.rawEnd)
    );
  }

  const nextValue =
    parsed.source.slice(0, targetNode.rawStart)
    + parsed.source.slice(targetNode.openEnd, targetNode.closeStart >= 0 ? targetNode.closeStart : targetNode.rawEnd)
    + parsed.source.slice(targetNode.closeEnd >= 0 ? targetNode.closeEnd : targetNode.rawEnd);

  return nextValue;
}

function toggleResult(value, selectionStart, selectionEnd, selectionDirection = "none", changed = true) {
  return {
    value,
    selectionStart,
    selectionEnd,
    selectionDirection,
    changed,
  };
}

export function describeInlineMarkupSelection(value, selectionStart, selectionEnd) {
  const parsed = parseInlineMarkup(value);
  const start = Math.max(0, Math.min(parsed.source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(parsed.source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const collapsed = start === end;
  const activeStyles = {
    bold: false,
    italic: false,
    underline: false,
    ruby: false,
  };

  for (const [tag, style] of Object.entries(TAG_TO_STYLE)) {
    if (collapsed) {
      activeStyles[style] = Boolean(findElementContainingCursor(parsed, tag, start));
      continue;
    }

    activeStyles[style] = Boolean(findElementContainingSelection(parsed, tag, start, end));
  }

  return {
    collapsed,
    activeStyles,
  };
}

function insertPairAtCursor(value, selectionStart, selectionDirection, openTag, closeTag) {
  const source = String(value ?? "");
  const cursor = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const nextValue = source.slice(0, cursor) + openTag + closeTag + source.slice(cursor);
  const nextSelectionStart = cursor + openTag.length;

  return toggleResult(
    nextValue,
    nextSelectionStart,
    nextSelectionStart,
    selectionDirection,
  );
}

function insertRubyAtCursor(value, selectionStart, selectionDirection, placeholder) {
  const source = String(value ?? "");
  const cursor = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const openTag = "<ruby><rt>";
  const closeTag = "</rt></ruby>";
  const nextValue = source.slice(0, cursor) + openTag + placeholder + closeTag + source.slice(cursor);
  const selectionAnchor = cursor + openTag.length;

  return toggleResult(
    nextValue,
    selectionAnchor,
    selectionAnchor + placeholder.length,
    selectionDirection,
  );
}

function wrapRubySelection(value, selectionStart, selectionEnd, selectionDirection, placeholder) {
  const source = String(value ?? "");
  const start = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const selected = source.slice(start, end);
  const openTag = "<ruby>";
  const middleTag = "<rt>";
  const closeTag = "</rt></ruby>";
  const nextValue =
    source.slice(0, start)
    + openTag
    + selected
    + middleTag
    + placeholder
    + closeTag
    + source.slice(end);
  const placeholderStart = start + openTag.length + selected.length + middleTag.length;

  return toggleResult(
    nextValue,
    placeholderStart,
    placeholderStart + placeholder.length,
    selectionDirection,
  );
}

function rebuildValueAfterStyleTransform(parsed, nextNodes, selectionVisibleStart, selectionVisibleEnd, selectionDirection = "none") {
  const nextValue = serializeNodes(nextNodes);
  const nextParsed = parseInlineMarkup(nextValue);
  const nextSelectionStart = visiblePositionToRawOffset(nextParsed, selectionVisibleStart, "start");
  const nextSelectionEnd = visiblePositionToRawOffset(nextParsed, selectionVisibleEnd, "end");
  return toggleResult(
    nextValue,
    nextSelectionStart,
    nextSelectionEnd,
    selectionDirection,
  );
}

export function toggleInlineMarkupSelection({
  value,
  selectionStart,
  selectionEnd,
  selectionDirection = "none",
  style,
  languageCode = "",
}) {
  const tag = normalizeInlineStyle(style);
  if (!tag) {
    return toggleResult(String(value ?? ""), selectionStart ?? 0, selectionEnd ?? 0, selectionDirection, false);
  }

  const source = String(value ?? "");
  const start = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const parsed = parseInlineMarkup(source);
  const collapsedWordRange = start === end ? collapsedWordVisibleRange(parsed, start) : null;
  const selectionVisibleStart = collapsedWordRange
    ? collapsedWordRange.start
    : rawOffsetToVisiblePosition(parsed, start);
  const selectionVisibleEnd = collapsedWordRange
    ? collapsedWordRange.end
    : rawOffsetToVisiblePosition(parsed, end);
  const effectiveStart = collapsedWordRange
    ? visiblePositionToRawOffset(parsed, selectionVisibleStart, "start")
    : start;
  const effectiveEnd = collapsedWordRange
    ? visiblePositionToRawOffset(parsed, selectionVisibleEnd, "end")
    : end;
  const isCollapsed = effectiveStart === effectiveEnd;

  if (tag === "ruby") {
    const rubyConfig = rubyButtonConfig(languageCode);
    if (isCollapsed) {
      const activeRuby = findElementContainingCursor(parsed, "ruby", effectiveStart);
      if (activeRuby) {
        const nextValue = unwrapWholeElement(parsed, activeRuby);
        const nextParsed = parseInlineMarkup(nextValue);
        const nextVisiblePosition = rawOffsetToVisiblePosition(parsed, effectiveStart);
        const nextCursor = visiblePositionToRawOffset(nextParsed, nextVisiblePosition, "start");
        return toggleResult(nextValue, nextCursor, nextCursor, selectionDirection);
      }

      return insertRubyAtCursor(source, effectiveStart, selectionDirection, rubyConfig.placeholder);
    }

    const selectedRuby = findElementContainingSelection(parsed, "ruby", effectiveStart, effectiveEnd);
    if (selectedRuby) {
      const nextValue = unwrapWholeElement(parsed, selectedRuby);
      const nextParsed = parseInlineMarkup(nextValue);
      return toggleResult(
        nextValue,
        visiblePositionToRawOffset(nextParsed, selectionVisibleStart, "start"),
        visiblePositionToRawOffset(nextParsed, selectionVisibleEnd, "end"),
        selectionDirection,
      );
    }

    return wrapRubySelection(
      source,
      effectiveStart,
      effectiveEnd,
      selectionDirection,
      rubyConfig.placeholder,
    );
  }

  if (isCollapsed) {
    const activeElement = findElementContainingCursor(parsed, tag, effectiveStart);
    if (activeElement) {
      const nextValue = unwrapWholeElement(parsed, activeElement);
      const nextParsed = parseInlineMarkup(nextValue);
      const nextVisiblePosition = rawOffsetToVisiblePosition(parsed, effectiveStart);
      const nextCursor = visiblePositionToRawOffset(nextParsed, nextVisiblePosition, "start");
      return toggleResult(nextValue, nextCursor, nextCursor, selectionDirection);
    }

    return insertPairAtCursor(source, effectiveStart, selectionDirection, `<${tag}>`, `</${tag}>`);
  }

  const selectedElement = findElementContainingSelection(parsed, tag, effectiveStart, effectiveEnd);

  if (selectedElement) {
    const nextNodes = materializeStyledSegments(
      removeStyleSegments(parsed.nodes, tag, selectionVisibleStart, selectionVisibleEnd),
      tag,
    );
    return rebuildValueAfterStyleTransform(
      parsed,
      nextNodes,
      selectionVisibleStart,
      selectionVisibleEnd,
      selectionDirection,
    );
  }

  const nextNodes = materializeStyledSegments(
    applyStyleSegments(parsed.nodes, tag, selectionVisibleStart, selectionVisibleEnd),
    tag,
  );
  return rebuildValueAfterStyleTransform(
    parsed,
    nextNodes,
    selectionVisibleStart,
    selectionVisibleEnd,
    selectionDirection,
  );
}
