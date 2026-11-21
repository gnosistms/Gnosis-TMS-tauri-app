import { escapeHtml } from "../lib/ui.js";

const hexId = "[a-f0-9]{16}";
const wrappedId = "[`'\"“]?" + hexId + "[`'\"”]?";
const group = wrappedId + "(?:\\s*[,;]\\s*" + wrappedId + ")*";
const citation = new RegExp(
  `[ \\t]*(?:\\(\\s*(${group})\\s*\\)|\\[(?!\\s*")\\s*(${group})\\s*\\])|(?<![a-z0-9])${hexId}(?![a-z0-9])`, "giu",
);
const possibleHash = /[a-f0-9]{16}/iu;

// Only the visible wording goes through this parser. Action keys, source URLs,
// raw tool responses and paragraph IDs in storage retain their original values.
function* paragraphCitations(text, passages) {
  if (!possibleHash.test(text)) return;
  for (const match of text.matchAll(citation)) {
    const grouped = match[1] != null || match[2] != null;
    const ids = (match[1] ?? match[2] ?? match[0]).toLowerCase().match(/[a-f0-9]{16}/gu);
    const known = ids.filter((id) => Array.isArray(passages) ? passages.some((p) => p.id === id && p.text)
      : passages?.ids?.includes(id) || Boolean(passages?.[id]?.text));
    // An unlabelled decimal quantity can have the same length as a paragraph ID.
    if (!grouped && !known.length && /^\d+$/u.test(ids[0])
      && !/\b(?:paragraph(?:[_ ]?id)?|item[_ ]?id)\b["']?\s*[:=#]?\s*[`"']?$/iu.test(text.slice(Math.max(0, match.index - 40), match.index))) continue;
    yield { raw: match[0], index: match.index, known, grouped };
  }
}

export function studioCitationText(value, passages, plain = false, action = "studio:toggle-citation") {
  const text = String(value ?? "");
  const literal = plain ? (part) => part : escapeHtml;
  let result = "";
  let end = 0;
  for (const { raw, index, known, grouped } of paragraphCitations(text, passages)) {
    result += literal(text.slice(end, index));
    if (!plain && known.length) {
      result += (grouped ? " " : "") + known.map((id) =>
        `<button type="button" class="text-link studio-citation" data-action="${escapeHtml(action)}" data-studio-paragraph="${id}" aria-expanded="false">Show source</button>`).join(" ");
    } else if (!grouped) result += "source paragraph";
    end = index + raw.length;
  }
  return result + literal(text.slice(end));
}

// Apply an edit to the visible words. Citations attached to unchanged text stay
// in place, including a hidden citation immediately following a revised phrase.
export function applyResearchTextEdit(original, edited, passages) {
  const text = String(original ?? "");
  const next = studioCitationText(edited, passages, true);
  if (!possibleHash.test(text)) return next;
  const visible = studioCitationText(text, passages, true);
  if (next === visible) return text;
  if (!next) return "";
  let start = 0;
  while (start < next.length && start < visible.length && next[start] === visible[start]) start++;
  let oldEnd = visible.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && visible[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  let delta = 0;
  let result = next;
  const kept = [];
  for (const { raw, index, grouped } of paragraphCitations(text, passages)) {
    const length = grouped ? 0 : "source paragraph".length;
    const at = index + delta;
    delta += length - raw.length;
    if (at + length <= start) kept.push({ at, length, raw });
    else if (at >= oldEnd) kept.push({ at: at + newEnd - oldEnd, length, raw });
  }
  for (const { at, length, raw } of kept.reverse()) result = result.slice(0, at) + raw + result.slice(at + length);
  return result;
}

// The generic report and term-editor components also render links and controls.
// Clean their public text without changing hrefs, option values or action data.
export function cleanResearchInput(control, passages) {
  if (!control.matches?.('textarea, input[type="text"], input[type="search"], input:not([type])')) return;
  const visible = studioCitationText(control.value, passages, true);
  if (visible !== control.value) control.value = visible;
}

export function cleanResearchDisplay(root, passages, showSources = false) {
  if (!root?.ownerDocument?.createTreeWalker) return;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const cited = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!possibleHash.test(node.data)) continue;
    const visible = studioCitationText(node.data, passages, true);
    if (visible === node.data) continue;
    const parent = node.parentElement;
    if (parent?.tagName === "OPTION" && !parent.hasAttribute("value")) parent.value = parent.value;
    if (showSources && passages && parent?.closest("p,li,blockquote,td")
      && !parent.closest("a,button,label,select,textarea,summary,pre,code,[data-action]")) {
      cited.push(node);
    } else node.data = visible;
  }
  for (const node of cited) {
    const template = root.ownerDocument.createElement("template");
    template.innerHTML = studioCitationText(node.data, passages, false, "toggle-research-source");
    node.replaceWith(template.content);
  }
  for (const element of root.querySelectorAll('[aria-label], [aria-description], [title], [alt], [placeholder], [data-tooltip], input, textarea')) {
    for (const name of ["aria-label", "aria-description", "title", "alt", "placeholder", "data-tooltip"]) {
      const value = element.getAttribute(name);
      if (value && possibleHash.test(value)) element.setAttribute(name, studioCitationText(value, passages, true));
    }
    cleanResearchInput(element, passages);
  }
}

export function visibleResearchEntry(entry, passages) {
  const visible = (value) => studioCitationText(value, passages, true);
  const result = { ...entry };
  for (const key of ["sourceTerms", "targetTerms", "targetVariantNotes"]) {
    if (Array.isArray(entry[key])) result[key] = entry[key].map(visible);
  }
  for (const key of ["notesToTranslators", "footnote", "notice", "error", "sourceTermDuplicateWarning", "siblingError", "siblingInput"]) {
    if (typeof entry[key] === "string") result[key] = visible(entry[key]);
  }
  return result;
}

export function markedStudioText(text, spans, passages) {
  const citations = [...paragraphCitations(text, passages)];
  if (citations.length) {
    const offsetInDisplay = (offset) => {
      let visible = offset;
      for (const { index, raw, grouped } of citations) {
        if (index >= offset) break;
        visible -= Math.min(raw.length, offset - index);
        if (!grouped && offset >= index + raw.length) visible += "source paragraph".length;
      }
      return visible;
    };
    spans = spans.filter(Boolean).map(({ start, end }) => ({ start: offsetInDisplay(start), end: offsetInDisplay(end) }));
    text = studioCitationText(text, passages, true);
  }
  let offset = 0;
  let html = "";
  for (const span of [...spans].filter(Boolean).sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)
      || span.start < offset || span.end <= span.start || span.end > text.length) continue;
    html += escapeHtml(text.slice(offset, span.start)) + `<mark>${escapeHtml(text.slice(span.start, span.end))}</mark>`;
    offset = span.end;
  }
  return html + escapeHtml(text.slice(offset));
}

function citedHighlights(button, block, source) {
  const prefix = button.ownerDocument.createRange();
  prefix.selectNodeContents(block);
  prefix.setEndBefore(button);
  const quotes = [...prefix.toString().matchAll(/“([^”\n]+)”|«([^»\n]+)»|"([^"\n]+)"|‘([^’\n]+)’/gu)];

  for (const match of quotes.reverse()) {
    const quote = match.slice(1).find(Boolean);
    const literalWords = quote.trim().split(/\s+/u).map((word) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
    const found = new RegExp(literalWords.join("\\s+"), "iu").exec(source.text);
    if (found?.[0]) return [{ start: found.index, end: found.index + found[0].length }];
  }
  return source.occurrences ?? [];
}

let nextPanel = 0;

export function toggleStudioCitation(button, study) {
  if (!button) return;
  const document = button.ownerDocument;
  const panelId = button.getAttribute("aria-controls");
  const existing = panelId && document.getElementById(panelId);
  if (existing) {
    existing.remove();
    button.removeAttribute("aria-controls");
    button.setAttribute("aria-expanded", "false");
    button.textContent = "Show source";
    return;
  }
  const id = button.dataset.studioParagraph;
  const source = Array.isArray(study?.passages) ? study.passages.find((p) => p.id === id) : study?.passages?.[id];
  if (!source?.text) return;
  const block = button.closest("p, li, th, td, h4, blockquote") ?? button;
  const panel = document.createElement("article");
  panel.id = `studio-cited-paragraph-${++nextPanel}`;
  panel.className = "studio-passage studio-citation-panel";
  const reference = source.reference ?? source.representative ?? source.references?.[0];
  const label = typeof reference === "string" ? reference : [reference?.title ?? reference?.projectTitle, reference?.chapter_title ?? reference?.chapterTitle ?? reference?.chapter].filter(Boolean).join(" · ");
  if (label) {
    const heading = document.createElement("strong");
    heading.textContent = studioCitationText(label, study.passages, true);
    panel.append(heading);
  }
  const paragraph = document.createElement("p");
  paragraph.lang = study.scope?.sourceLanguage?.code ?? "";
  paragraph.innerHTML = markedStudioText(source.text, citedHighlights(button, block, source), study.passages);
  panel.append(paragraph);
  const siblings = [...block.querySelectorAll("button[data-studio-paragraph]")];
  const previous = siblings.slice(0, siblings.indexOf(button)).findLast((b) => b.hasAttribute("aria-controls"));
  if (previous) document.getElementById(previous.getAttribute("aria-controls")).after(panel);
  else if (block.matches("th, td, li")) block.append(panel);
  else block.after(panel);
  button.textContent = "Hide source";
  button.setAttribute("aria-expanded", "true");
  button.setAttribute("aria-controls", panel.id);
}
