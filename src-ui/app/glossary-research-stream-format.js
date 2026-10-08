// Readable live view of an AI answer or thinking while it streams in. The
// answer is usually JSON arriving a few characters at a time, so it is laid
// out from bracket depth and string state alone, character by character: it
// never parses, never throws, and works on any truncated prefix.

const INDENT = "  ";

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/** HTML for a (possibly unfinished) JSON answer; plain escaped text if it is not JSON. */
export function formatJsonStream(text) {
  const source = String(text ?? "");
  const start = source.search(/\S/);
  if (start < 0) return "";
  if (source[start] !== "{" && source[start] !== "[") return `<span class="research-stream__text">${escapeHtml(source)}</span>`;

  const out = [];
  const stack = []; // "{" or "["
  let inString = false;
  let escaped = false;
  let stringIsKey = false;
  let expectKey = false; // the next string in this object is a key
  let atLineStart = false;
  const newline = () => {
    out.push(`\n${INDENT.repeat(stack.length)}`);
    atLineStart = true;
  };

  for (let i = start; i < source.length; i += 1) {
    const c = source[i];
    if (inString) {
      out.push(escapeHtml(c));
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
        out.push("</span>");
      }
      continue;
    }
    if (/\s/.test(c)) continue;
    atLineStart = false;
    if (c === '"') {
      inString = true;
      stringIsKey = expectKey;
      expectKey = false;
      out.push(`<span class="${stringIsKey ? "research-stream__key" : "research-stream__string"}">&quot;`);
    } else if (c === "{" || c === "[") {
      out.push(`<span class="research-stream__punct">${c}</span>`);
      stack.push(c);
      expectKey = c === "{";
      newline();
    } else if (c === "}" || c === "]") {
      stack.pop();
      expectKey = false;
      newline();
      out.push(`<span class="research-stream__punct">${c}</span>`);
      atLineStart = false;
    } else if (c === ",") {
      out.push('<span class="research-stream__punct">,</span>');
      expectKey = stack.at(-1) === "{";
      newline();
    } else if (c === ":") {
      out.push('<span class="research-stream__punct">: </span>');
    } else {
      out.push(escapeHtml(c));
    }
  }
  if (inString) out.push("</span>");
  // A brace that has not arrived yet leaves no trailing indentation behind.
  if (atLineStart) out[out.length - 1] = "\n";
  return out.join("");
}

/** HTML for streamed thinking: a line that is exactly **Title** becomes a small heading. */
export function formatThinking(text) {
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(escapeHtml).join("<br>")}</p>`);
    paragraph = [];
  };
  for (const line of String(text ?? "").split("\n")) {
    const title = /^\s*\*\*(.+?)\*\*\s*$/.exec(line);
    if (title) {
      flush();
      blocks.push(`<h4 class="research-stream__title">${escapeHtml(title[1])}</h4>`);
    } else if (!line.trim()) {
      flush();
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks.join("");
}
