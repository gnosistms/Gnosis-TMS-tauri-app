// Accept only HTML already produced by an editor sanitizer. Reopen inline tags
// at paragraph boundaries so formatting/highlights may safely span a return.
// endsParagraph(tokens, index) says whether the newline token at index is a
// paragraph break; other newlines stay in the paragraph as line breaks.
function splitHtmlParagraphs(html, endsParagraph = () => true) {
  const stack = [];
  const paragraphs = [""];
  const tokens = String(html).replace(/\r\n?/g, "\n").split(/(<[^>]+>|\n)/g);
  for (const [index, token] of tokens.entries()) {
    if (token === "\n" && endsParagraph(tokens, index)) {
      paragraphs[paragraphs.length - 1] += [...stack].reverse().map(({ name }) => `</${name}>`).join("");
      paragraphs.push(stack.map(({ opening }) => opening).join(""));
      continue;
    }
    const opening = /^<([a-z][\w-]*)\b/i.exec(token);
    if (opening && !["br", "hr", "img", "input", "wbr"].includes(opening[1].toLowerCase()) && !token.endsWith("/>")) {
      stack.push({ name: opening[1], opening: token });
    } else if (/^<\//.test(token)) {
      stack.pop();
    }
    paragraphs[paragraphs.length - 1] += token.replaceAll("\u2028", "<br>");
  }
  return paragraphs;
}

function isSeparatorTag(token) {
  return /^<hr\b/i.test(token) || /\brole="separator"/.test(token);
}

// Tags (other than a separator), spaces and tabs may sit inside a blank line.
function isBlankLineFiller(token) {
  return /^[ \t]*$/.test(token) || (token.startsWith("<") && !isSeparatorTag(token));
}

function adjacentNewline(tokens, index, step) {
  for (let cursor = index + step; cursor >= 0 && cursor < tokens.length; cursor += step) {
    if (tokens[cursor] === "\n") return true;
    if (!isBlankLineFiller(tokens[cursor])) return false;
  }
  return false;
}

function isBlankLineNewline(tokens, index) {
  return adjacentNewline(tokens, index, -1) || adjacentNewline(tokens, index, 1);
}

function paragraphHasContent(paragraph) {
  return /\S/.test(paragraph.replace(/<[^>]*>/g, ""))
    || (paragraph.match(/<[^>]+>/g) ?? []).some(isSeparatorTag);
}

export function footnoteParagraphsHtml(html, tag = "span") {
  if (!/[\r\n\u2028]/.test(html)) return html;
  return splitHtmlParagraphs(html).map((paragraph, index) => {
    const indent = index ? "1.5em" : "0";
    const placeholder = paragraph.replace(/<[^>]*>/g, "") ? "" : "<br>";
    return `<${tag} class="footnote-paragraph" style="display:block;margin:0;text-indent:${indent}">${paragraph}${placeholder}</${tag}>`;
  }).join("");
}

// A blank line in a row is a paragraph break; a single return is a line break
// and stays in its paragraph. Empty paragraphs are dropped, as the previews
// and exports drop them.
export function rowTextParagraphsHtml(html) {
  if (!/\n[ \t\r]*(<[^>]+>[ \t\r]*)*\n/.test(html)) return html;
  return splitHtmlParagraphs(html, isBlankLineNewline)
    .filter(paragraphHasContent)
    .map((paragraph) => `<span class="translation-language-panel__paragraph">${paragraph}</span>`)
    .join("");
}
