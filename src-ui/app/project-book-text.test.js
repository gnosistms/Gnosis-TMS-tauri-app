import test from "node:test";
import assert from "node:assert/strict";
import { bookTextParts, renderBookTextHtml, bookEditorText } from "./project-book-text.js";

test("front-matter returns make paragraphs while soft breaks stay inside them", () => {
  assert.deepEqual(bookTextParts("First\nSecond\u2028same paragraph"), [
    { kind: "text", text: "First" }, { kind: "text", text: "Second\u2028same paragraph" },
  ]);
  assert.equal(renderBookTextHtml("First\nSecond\u2028same paragraph"), "<p>First</p><p>Second<br>same paragraph</p>");
  assert.equal(renderBookTextHtml("First\u2028"), "<p>First<br><br></p>");
});

test("blank paragraphs, Windows returns, italics across paragraphs, and separators survive", () => {
  assert.equal(renderBookTextHtml("<i>First\r\n\r\nSecond<hr>Third</i>"),
    "<p><i>First</i></p><p><i></i></p><p><i>Second</i></p><hr><p><i>Third</i></p>");
  assert.equal(renderBookTextHtml("First\n"), "<p>First</p><p><br></p>");
  assert.equal(renderBookTextHtml("<hr>"), "<hr><p><br></p>");
  assert.equal(renderBookTextHtml(""), "<p><br></p>");
});

test("paragraph rendering escapes everything except limited italic and separator markup", () => {
  assert.equal(renderBookTextHtml('<script>alert("x")</script> & <i>italic</i>'),
    "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; <i>italic</i></p>");
});

function text(value) { return { nodeType: 3, textContent: value }; }
function node(tagName, ...childNodes) {
  const parent = { nodeType: 1, tagName, nodeName: tagName, childNodes };
  childNodes.forEach((child, i) => Object.assign(child, { parentNode: parent, previousSibling: childNodes[i - 1], nextSibling: childNodes[i + 1] }));
  return parent;
}

test("editor paragraphs and soft breaks serialize distinctly without placeholder breaks", () => {
  const editor = node("DIV", node("P", text("First")), node("P", text("Second"), node("BR"), text("same paragraph")), node("P", node("BR")));
  assert.equal(bookEditorText(editor), "First\nSecond\u2028same paragraph\n");
  assert.equal(bookEditorText(node("DIV", node("P", text("First"), node("BR"), node("BR")))), "First\u2028");
  assert.equal(bookEditorText(node("DIV", node("P", node("I", node("BR"))))), "");
  assert.equal(bookEditorText(node("DIV", node("P", node("BR")))), "");
  assert.equal(bookEditorText(node("DIV", node("P", text("First\nsoft line")))), "First\u2028soft line");
});

test("editor formatting and separators retain order without adding phantom paragraphs", () => {
  const editor = node("DIV", node("P", node("I", text("First"))), node("HR"), node("P", text("© Second")), node("P", node("EM", text("Third"))));
  assert.equal(bookEditorText(editor), "<i>First</i><hr>© Second\n<i>Third</i>");
  assert.equal(bookEditorText(node("DIV", node("P", text("First")), node("P", node("BR")), node("HR"), node("P", node("BR")))), "First\n<hr>");
});
