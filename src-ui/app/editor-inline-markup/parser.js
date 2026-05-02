const STYLE_TO_TAG = {
  bold: "strong",
  italic: "em",
  underline: "u",
  ruby: "ruby",
  strong: "strong",
  em: "em",
  u: "u",
};

const TAG_TO_STYLE = {
  strong: "bold",
  em: "italic",
  u: "underline",
  ruby: "ruby",
};

const SUPPORTED_TAGS = new Set(["strong", "em", "u", "ruby", "rt"]);
const TAG_ALIASES = {
  b: "strong",
  i: "em",
};


function elementNode(tag, children = []) {
  return {
    type: "element",
    tag,
    children,
    openStart: -1,
    openEnd: -1,
    closeStart: -1,
    closeEnd: -1,
    rawStart: -1,
    rawEnd: -1,
    visibleStart: 0,
    visibleEnd: 0,
  };
}

function textNode(text, rawStart, rawEnd, visibleStart) {
  const value = String(text ?? "");
  return {
    type: "text",
    text: value,
    rawStart,
    rawEnd,
    visibleStart,
    visibleEnd: visibleStart + value.length,
  };
}

function cloneNode(node) {
  if (!node || typeof node !== "object") {
    return textNode("", 0, 0, 0);
  }

  if (node.type === "text") {
    return {
      ...node,
    };
  }

  return {
    ...node,
    children: cloneNodes(node.children),
  };
}

function cloneNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => cloneNode(node));
}

function parseTagToken(rawTag) {
  const match = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)\s*>$/.exec(rawTag);
  if (!match) {
    return null;
  }

  const isClosing = match[1] === "/";
  const rawName = match[2].toLowerCase();
  const normalizedName = TAG_ALIASES[rawName] ?? rawName;
  if (!SUPPORTED_TAGS.has(normalizedName)) {
    return null;
  }

  return {
    isClosing,
    tag: normalizedName,
  };
}

function finalizeElement(node, visibleEnd, rawEnd, closeStart = -1, closeEnd = -1) {
  node.visibleEnd = visibleEnd;
  node.rawEnd = rawEnd;
  node.closeStart = closeStart;
  node.closeEnd = closeEnd;
}

function parseInlineMarkup(value) {
  const source = String(value ?? "");
  const root = elementNode("root", []);
  const stack = [root];
  let cursor = 0;
  let visibleCursor = 0;

  function appendText(text, rawStart, rawEnd) {
    if (!text) {
      return;
    }

    stack[stack.length - 1].children.push(textNode(text, rawStart, rawEnd, visibleCursor));
    visibleCursor += text.length;
  }

  while (cursor < source.length) {
    if (source[cursor] !== "<") {
      const nextTagIndex = source.indexOf("<", cursor);
      const nextCursor = nextTagIndex >= 0 ? nextTagIndex : source.length;
      appendText(source.slice(cursor, nextCursor), cursor, nextCursor);
      cursor = nextCursor;
      continue;
    }

    const closingBracketIndex = source.indexOf(">", cursor + 1);
    if (closingBracketIndex < 0) {
      appendText(source.slice(cursor), cursor, source.length);
      cursor = source.length;
      continue;
    }

    const rawTag = source.slice(cursor, closingBracketIndex + 1);
    const token = parseTagToken(rawTag);
    if (!token) {
      appendText(rawTag, cursor, closingBracketIndex + 1);
      cursor = closingBracketIndex + 1;
      continue;
    }

    if (!token.isClosing) {
      const nextNode = elementNode(token.tag, []);
      nextNode.openStart = cursor;
      nextNode.openEnd = closingBracketIndex + 1;
      nextNode.rawStart = cursor;
      nextNode.visibleStart = visibleCursor;
      stack[stack.length - 1].children.push(nextNode);
      stack.push(nextNode);
      cursor = closingBracketIndex + 1;
      continue;
    }

    let matchedIndex = -1;
    for (let index = stack.length - 1; index >= 1; index -= 1) {
      if (stack[index].tag === token.tag) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex < 0) {
      appendText(rawTag, cursor, closingBracketIndex + 1);
      cursor = closingBracketIndex + 1;
      continue;
    }

    while (stack.length - 1 > matchedIndex) {
      finalizeElement(stack.pop(), visibleCursor, cursor);
    }

    const matchedNode = stack.pop();
    finalizeElement(
      matchedNode,
      visibleCursor,
      closingBracketIndex + 1,
      cursor,
      closingBracketIndex + 1,
    );
    cursor = closingBracketIndex + 1;
  }

  while (stack.length > 1) {
    finalizeElement(stack.pop(), visibleCursor, source.length);
  }

  finalizeElement(root, visibleCursor, source.length);
  return {
    source,
    nodes: root.children,
    visibleText: flattenNodesToVisibleText(root.children),
    visibleLength: visibleCursor,
  };
}

function flattenNodesToVisibleText(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => (node.type === "text" ? node.text : flattenNodesToVisibleText(node.children)))
    .join("");
}

function splitRubyNodeChildren(children) {
  const baseChildren = [];
  const annotationChildren = [];

  for (const child of Array.isArray(children) ? children : []) {
    if (child?.type === "element" && child.tag === "rt") {
      annotationChildren.push(...(Array.isArray(child.children) ? child.children : []));
      continue;
    }

    baseChildren.push(child);
  }

  return {
    baseChildren,
    annotationChildren,
  };
}

function collectTextSegments(nodes, segments = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.type === "text") {
      segments.push(node);
      continue;
    }

    collectTextSegments(node.children, segments);
  }

  return segments;
}

function collectElementNodes(nodes, elements = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || node.type !== "element") {
      continue;
    }

    elements.push(node);
    collectElementNodes(node.children, elements);
  }

  return elements;
}

export {
  STYLE_TO_TAG,
  TAG_TO_STYLE,
  SUPPORTED_TAGS,
  elementNode,
  textNode,
  cloneNode,
  cloneNodes,
  parseInlineMarkup,
  flattenNodesToVisibleText,
  splitRubyNodeChildren,
  collectTextSegments,
  collectElementNodes,
};
