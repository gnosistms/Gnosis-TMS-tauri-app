// Accept only HTML already produced by an editor sanitizer. Reopen inline tags
// at paragraph boundaries so formatting/highlights may safely span a return.
export function footnoteParagraphsHtml(html, tag = "span") {
  if (!/[\r\n\u2028]/.test(html)) return html;
  const stack = [];
  const paragraphs = [""];
  for (const token of String(html).replace(/\r\n?/g, "\n").split(/(<[^>]+>|\n)/g)) {
    if (token === "\n") {
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
  return paragraphs.map((paragraph, index) => {
    const indent = index ? "1.5em" : "0";
    const placeholder = paragraph.replace(/<[^>]*>/g, "") ? "" : "<br>";
    return `<${tag} class="footnote-paragraph" style="display:block;margin:0;text-indent:${indent}">${paragraph}${placeholder}</${tag}>`;
  }).join("");
}
