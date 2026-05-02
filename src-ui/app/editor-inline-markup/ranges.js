import {
  parseInlineMarkup,
  collectTextSegments,
  collectElementNodes,
} from "./parser.js";

function collectBaseTextSegments(
  nodes,
  segments = [],
  state = { baseCursor: 0 },
  insideRubyAnnotation = false,
) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.type === "text") {
      if (!insideRubyAnnotation && node.text) {
        const baseStart = state.baseCursor;
        const baseEnd = baseStart + node.text.length;
        segments.push({
          text: node.text,
          baseStart,
          baseEnd,
          visibleStart: node.visibleStart,
          visibleEnd: node.visibleEnd,
        });
        state.baseCursor = baseEnd;
      }
      continue;
    }

    collectBaseTextSegments(
      node.children,
      segments,
      state,
      insideRubyAnnotation || node.tag === "rt",
    );
  }

  return segments;
}

function basePositionToVisibleOffset(parsed, basePosition, bias = "start") {
  const segments = collectBaseTextSegments(parsed.nodes);
  const baseLength = segments[segments.length - 1]?.baseEnd ?? 0;
  const boundedPosition = Math.max(
    0,
    Math.min(baseLength, Number.parseInt(basePosition ?? "", 10) || 0),
  );
  let previousSegment = null;

  for (const segment of segments) {
    if (boundedPosition < segment.baseStart) {
      return bias === "end" && previousSegment
        ? previousSegment.visibleEnd
        : segment.visibleStart;
    }

    if (boundedPosition < segment.baseEnd) {
      return segment.visibleStart + Math.max(0, boundedPosition - segment.baseStart);
    }

    if (boundedPosition === segment.baseEnd) {
      return bias === "end" ? segment.visibleEnd : segment.visibleStart + segment.text.length;
    }

    previousSegment = segment;
  }

  return previousSegment ? previousSegment.visibleEnd : 0;
}

function rawOffsetToVisiblePosition(parsed, rawOffset) {
  const boundedOffset = Math.max(0, Math.min(parsed.source.length, Number.parseInt(rawOffset ?? "", 10) || 0));
  const segments = collectTextSegments(parsed.nodes);
  let visibleCursor = 0;

  for (const segment of segments) {
    if (boundedOffset < segment.rawStart) {
      return visibleCursor;
    }

    if (boundedOffset <= segment.rawEnd) {
      return segment.visibleStart + Math.max(0, Math.min(segment.text.length, boundedOffset - segment.rawStart));
    }

    visibleCursor = segment.visibleEnd;
  }

  return parsed.visibleLength;
}

function isInlineMarkupWordCharacter(character) {
  return typeof character === "string" && /[\p{L}\p{M}\p{N}_]/u.test(character);
}

function collapsedWordVisibleRange(parsed, rawOffset) {
  const visibleText = String(parsed?.visibleText ?? "");
  if (!visibleText) {
    return null;
  }

  const visiblePosition = rawOffsetToVisiblePosition(parsed, rawOffset);
  const nextCharacter = visibleText[visiblePosition] ?? "";
  const anchorIndex = isInlineMarkupWordCharacter(nextCharacter) ? visiblePosition : -1;

  if (anchorIndex < 0) {
    return null;
  }

  let start = anchorIndex;
  let end = anchorIndex + 1;
  while (start > 0 && isInlineMarkupWordCharacter(visibleText[start - 1])) {
    start -= 1;
  }
  while (end < visibleText.length && isInlineMarkupWordCharacter(visibleText[end])) {
    end += 1;
  }

  return { start, end };
}

function visiblePositionToRawOffset(parsed, visiblePosition, bias = "start") {
  const boundedPosition = Math.max(0, Math.min(parsed.visibleLength, Number.parseInt(visiblePosition ?? "", 10) || 0));
  const segments = collectTextSegments(parsed.nodes);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const previousSegment = index > 0 ? segments[index - 1] : null;
    const nextSegment = index + 1 < segments.length ? segments[index + 1] : null;

    if (boundedPosition < segment.visibleStart) {
      return bias === "end" && previousSegment ? previousSegment.rawEnd : segment.rawStart;
    }

    if (boundedPosition === segment.visibleStart) {
      return bias === "end" && previousSegment ? previousSegment.rawEnd : segment.rawStart;
    }

    if (boundedPosition < segment.visibleEnd) {
      return segment.rawStart + Math.max(0, Math.min(segment.text.length, boundedPosition - segment.visibleStart));
    }

    if (boundedPosition === segment.visibleEnd) {
      if (bias === "start" && nextSegment) {
        return nextSegment.rawStart;
      }

      return segment.rawEnd;
    }
  }

  const finalSegment = segments[segments.length - 1] ?? null;
  return finalSegment ? finalSegment.rawEnd : parsed.source.length;
}

function selectedVisibleSegments(parsed, selectionStart, selectionEnd) {
  const start = Math.max(0, Math.min(parsed.source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(parsed.source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const segments = [];

  for (const segment of collectTextSegments(parsed.nodes)) {
    const overlapStart = Math.max(start, segment.rawStart);
    const overlapEnd = Math.min(end, segment.rawEnd);
    if (overlapEnd <= overlapStart) {
      continue;
    }

    segments.push({
      rawStart: overlapStart,
      rawEnd: overlapEnd,
      visibleStart: segment.visibleStart + (overlapStart - segment.rawStart),
      visibleEnd: segment.visibleStart + (overlapEnd - segment.rawStart),
    });
  }

  return segments;
}

function findSmallestElementByPredicate(parsed, tag, predicate) {
  const elements = collectElementNodes(parsed.nodes)
    .filter((node) => node.tag === tag)
    .filter(predicate);

  if (elements.length === 0) {
    return null;
  }

  return elements.sort((left, right) => {
    const leftSpan = left.rawEnd - left.rawStart;
    const rightSpan = right.rawEnd - right.rawStart;
    return leftSpan - rightSpan;
  })[0] ?? null;
}

function findElementContainingCursor(parsed, tag, rawOffset) {
  const cursor = Math.max(0, Math.min(parsed.source.length, Number.parseInt(rawOffset ?? "", 10) || 0));
  return findSmallestElementByPredicate(
    parsed,
    tag,
    (node) => cursor >= node.rawStart && cursor <= node.rawEnd,
  );
}

function findElementContainingSelection(parsed, tag, selectionStart, selectionEnd) {
  const visibleSegments = selectedVisibleSegments(parsed, selectionStart, selectionEnd);
  if (visibleSegments.length === 0) {
    const start = Math.max(0, Math.min(parsed.source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
    const end = Math.max(start, Math.min(parsed.source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
    return findSmallestElementByPredicate(
      parsed,
      tag,
      (node) => start >= node.rawStart && end <= node.rawEnd,
    );
  }

  return findSmallestElementByPredicate(
    parsed,
    tag,
    (node) =>
      visibleSegments.every((segment) => {
        const contentEnd = node.closeStart >= 0 ? node.closeStart : node.rawEnd;
        return segment.rawStart >= node.openEnd && segment.rawEnd <= contentEnd;
      }),
  );
}

export function mapInlineMarkupBaseRangesToVisibleRanges(value, ranges = []) {
  const parsed = parseInlineMarkup(value);
  return (Array.isArray(ranges) ? ranges : [])
    .map((range) => {
      const start = Math.max(0, Number.parseInt(range?.start ?? "", 10) || 0);
      const end = Math.max(start, Number.parseInt(range?.end ?? "", 10) || 0);
      const visibleStart = basePositionToVisibleOffset(parsed, start, "start");
      const visibleEnd = basePositionToVisibleOffset(parsed, end, "end");
      return {
        ...range,
        start: visibleStart,
        end: visibleEnd,
      };
    })
    .filter((range) => range.end > range.start);
}

function normalizeVisibleHighlightRanges(ranges, visibleLength = 0) {
  return (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(visibleLength, Number.parseInt(range?.start ?? "", 10) || 0)),
      end: Math.max(0, Math.min(visibleLength, Number.parseInt(range?.end ?? "", 10) || 0)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      return left.end - right.end;
    });
}

export {
  basePositionToVisibleOffset,
  rawOffsetToVisiblePosition,
  collapsedWordVisibleRange,
  visiblePositionToRawOffset,
  selectedVisibleSegments,
  findElementContainingCursor,
  findElementContainingSelection,
  normalizeVisibleHighlightRanges,
};
