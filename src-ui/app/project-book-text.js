import { escapeHtml } from "../lib/ui.js";

// Front matter uses LF for paragraphs and U+2028 for Shift+Return. Chapter-row
// newlines retain their existing soft-break semantics.
export function bookTextParts(value) {
  const parts = [];
  let text = "";
  let italicDepth = 0;
  let hasText = false;
  let afterParagraph = false;
  const paragraph = () => {
    parts.push({ kind: "text", text: text + "</i>".repeat(italicDepth) });
    text = "<i>".repeat(italicDepth);
    hasText = false;
  };
  for (const token of String(value || "").replace(/\r\n?/g, "\n").split(/(<\/?i>|<hr>|\n)/g)) {
    if (!token) continue;
    if (token === "<i>") { italicDepth += 1; text += token; }
    else if (token === "</i>") {
      if (italicDepth) { italicDepth -= 1; text += token; }
    } else if (token === "\n") { paragraph(); afterParagraph = true; }
    else if (token === "<hr>") {
      if (hasText) paragraph();
      parts.push({ kind: "separator" });
      afterParagraph = false;
    } else { text += token; hasText = true; afterParagraph = false; }
  }
  if (hasText || afterParagraph || !parts.length) paragraph();
  return parts;
}

export function renderBookTextHtml(value) {
  const parts = bookTextParts(value);
  const html = parts.map((part) => {
    if (part.kind === "separator") return "<hr>";
    const content = part.text.split(/(<\/?i>)/g).map((token) => ["<i>", "</i>"].includes(token)
      ? token : escapeHtml(token).replaceAll("\u2028", "<br>")).join("");
    return `<p>${content ? content + (content.endsWith("<br>") ? "<br>" : "") : "<br>"}</p>`;
  }).join("");
  return html + (parts.at(-1)?.kind === "separator" ? "<p><br></p>" : "");
}

export function bookEditorText(element) {
  const walk = (node) => {
    if (node.nodeType === 3) return node.textContent.replace(/\r\n?|\n/g, "\u2028");
    if (node.nodeType !== 1) return "";
    if (node.tagName === "HR") return "<hr>";
    // A lone BR is the browser's caret placeholder in an empty paragraph.
    if (node.tagName === "BR") {
      if (!node.nextSibling && node.previousSibling?.nodeName === "BR") return "";
      let parent = node.parentNode;
      while (parent?.childNodes.length === 1) {
        if (parent === element || ["P", "DIV"].includes(parent.tagName)) return "";
        parent = parent.parentNode;
      }
      return "\u2028";
    }
    const body = [...node.childNodes].map(walk).join("");
    if (["I", "EM"].includes(node.tagName)) return `<i>${body}</i>`;
    return ["DIV", "P"].includes(node.tagName) ? `${body}\n` : body;
  };
  const value = [...element.childNodes].map(walk).join("")
    .replace(/\n$/, "").replace(/\n<hr>/g, "<hr>").replace(/<hr>\n/g, "<hr>");
  return value.replace(/<\/?i>/g, "") ? value : "";
}
