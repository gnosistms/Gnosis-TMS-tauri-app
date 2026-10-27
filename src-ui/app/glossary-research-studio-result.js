import { escapeHtml } from "../lib/ui.js";

// Internal corpus addresses are audit evidence, not reader-facing prose. Apply
// this only at display boundaries; never rewrite the saved model response.
export function studioNarrativeText(value) {
  const path = String.raw`/doc/[\w-]+(?:\?[\w%=&:+,~/-]+)?(?:#[\w-]+)?`;
  return String(value ?? "")
    .replace(new RegExp(String.raw`\[([^\]\n]+)\]\(\s*${path}\s*\)`, "gu"), "$1")
    .replace(new RegExp(String.raw`[ \t]*\(\s*${path}\s*\)`, "gu"), "")
    .replace(new RegExp(String.raw`[ \t]*\[\s*${path}\s*\]`, "gu"), "")
    .replace(new RegExp(String.raw`\x60${path}\x60`, "gu"), "")
    .replace(new RegExp(String.raw`(^|[\s([{,:;'"«])${path}`, "gmu"), "$1")
    .replace(/(\S)[ \t]{2,}(?=\S)/gu, "$1 ");
}

// A small, text-only Markdown subset for saved research. Raw HTML is always
// escaped, and source links accept only absolute web URLs.
function inline(text, plain = false) {
  const token = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^\n]+?)\*\*|__([^\n]+?)__|\*([^*\n]+)\*|\b_([^_\n]+)_\b/gu;
  let result = ""; let end = 0;
  for (const match of text.matchAll(token)) {
    result += plain ? text.slice(end, match.index) : escapeHtml(text.slice(end, match.index));
    const [, code, label, url, strong, alternateStrong, emphasis, alternateEmphasis] = match;
    if (code != null) result += plain ? code : `<code>${escapeHtml(code)}</code>`;
    else if (label != null) {
      let safe = false;
      try { safe = /^https?:\/\//iu.test(url) && ["http:", "https:"].includes(new URL(url).protocol); } catch { /* Render an invalid link as text. */ }
      result += plain ? inline(label, true) : safe
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${inline(label)}</a>`
        : inline(label);
    } else {
      const content = strong ?? alternateStrong ?? emphasis ?? alternateEmphasis;
      const tag = strong != null || alternateStrong != null ? "strong" : "em";
      result += plain ? inline(content, true) : `<${tag}>${inline(content)}</${tag}>`;
    }
    end = match.index + match[0].length;
  }
  return result + (plain ? text.slice(end) : escapeHtml(text.slice(end)));
}

const listItem = (line) => /^(\s*)([-+*]|\d+[.)])\s+(.+)$/u.exec(line);
const tableCells = (line) => line.trim().replace(/^\||\|$/gu, "").split("|").map((cell) => cell.trim());
const tableRule = (line) => line.includes("|") && tableCells(line).every((cell) => /^:?-{3,}:?$/u.test(cell));
const startsBlock = (lines, i) => /^(?:#{1,6}\s|\s*>|\s*```|\s*~~~|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/u.test(lines[i])
  || listItem(lines[i]) || (i + 1 < lines.length && tableRule(lines[i + 1]));

function blocks(lines) {
  const result = [];
  let i = 0;
  const add = (type, html, text) => result.push({ type, html, text });
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(```+|~~~+)/u.exec(line);
    if (fence) {
      const code = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      if (i < lines.length) i++;
      add("code", `<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`, code.join(" ")); continue;
    }
    const heading = /^#{1,6}\s+(.+?)(?:\s+#+)?\s*$/u.exec(line);
    if (heading) { add("heading", `<h4>${inline(heading[1])}</h4>`, inline(heading[1], true)); i++; continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) { add("rule", "<hr>", ""); i++; continue; }
    if (/^\s*>/u.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>/u.test(lines[i])) quoted.push(lines[i++].replace(/^\s*> ?/u, ""));
      const children = blocks(quoted);
      add("quote", `<blockquote>${children.map((b) => b.html).join("")}</blockquote>`, children.map((b) => b.text).join(" ")); continue;
    }
    if (i + 1 < lines.length && line.includes("|") && tableRule(lines[i + 1])) {
      const headers = tableCells(line); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(tableCells(lines[i++]));
      add("table", `<div class="studio-report-table"><table><thead><tr>${headers.map((cell) => `<th scope="col">${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, index) => `<td>${inline(row[index] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
        [headers, ...rows].map((row) => row.map((cell) => inline(cell, true)).join(" · ")).join("; ")); continue;
    }
    const first = listItem(line);
    if (first) {
      const ordered = /^\d/u.test(first[2]); const indent = first[1].length;
      const items = []; const texts = [];
      while (i < lines.length) {
        const item = listItem(lines[i]);
        if (!item || item[1].length !== indent || /^\d/u.test(item[2]) !== ordered) break;
        const content = [item[3]]; i++;
        while (i < lines.length && lines[i].trim() && /^\s+/u.test(lines[i]) && (lines[i].match(/^\s*/u)[0].length > indent)) {
          content.push(lines[i++].slice(indent + 2));
        }
        const children = blocks(content);
        items.push(`<li>${children.map((b) => b.html).join("")}</li>`);
        texts.push(children.map((b) => b.text).join(" "));
        if (!lines[i]?.trim() && listItem(lines[i + 1] ?? "")) i++;
      }
      const tag = ordered ? "ol" : "ul";
      const start = ordered && Number.parseInt(first[2], 10) !== 1 ? ` start="${Number.parseInt(first[2], 10)}"` : "";
      add("list", `<${tag}${start}>${items.join("")}</${tag}>`, texts.join("; ")); continue;
    }
    const paragraph = [line.trim()]; i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) paragraph.push(lines[i++].trim());
    const text = paragraph.join(" ");
    add("paragraph", `<p>${inline(text)}</p>`, inline(text, true));
  }
  return result;
}

export function studioResultPresentation(text) {
  const content = blocks(studioNarrativeText(text).replace(/\r\n?/gu, "\n").split("\n"));
  // Skip a leading title such as “Findings” in the collapsed preview.
  const previewText = (content.find((block) => block.type === "paragraph")?.text
    ?? content.find((block) => block.type !== "heading" && block.text)?.text ?? content[0]?.text ?? "").replace(/\s+/gu, " ").trim();
  const long = content.map((block) => block.text).join(" ").length > 300;
  const excerpt = previewText.length > 300 ? previewText.slice(0, 300).replace(/\s+\S*$/u, "") + "…" : previewText;
  return { html: content.map((block) => block.html).join(""), preview: excerpt, long };
}
