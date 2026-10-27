import test from "node:test";
import assert from "node:assert/strict";
import { renderProjectBookComposer } from "./project-book-composer.js";
import { addBookSection, reconcileBookLayout } from "../app/project-book-model.js";
const modal = () => ({ projectId: "p", projectTitle: "Book", languages: [{ code: "en", name: "English" }], languageCode: "en", book: { ...reconcileBookLayout([{ id: "a", name: "One", languages: [{ code: "en" }] }, { id: "b", name: "Two", languages: [{ code: "vi" }] }], "en"), previewStatus: "ready", previewChapterId: "a", previewBlocks: [] } });
test("book composer uses the shared drag handle, genuine chevrons, and standard inclusion tooltips", () => {
  const html = renderProjectBookComposer(modal());
  assert.match(html, /term-variant-row__drag-dots/);
  assert.match(html, /data-action="book-next"/);
  assert.match(html, /M3 2 7 6 3 10/);
  assert.match(html, /Exclude this item from the export\./);
  assert.match(html, /This chapter does not contain a translation in English\./);
  assert.match(html, /data-action="book-include:b" disabled/);
  assert.match(html, /Excluded/);
});
test("a book with every chapter included hides the excluded section", () => {
  const current = modal();
  current.book.items = current.book.items.slice(0, 1);
  assert.doesNotMatch(renderProjectBookComposer(current), /book-excluded-heading/);
});
test("front matter uses per-language editing controls, and copyright has the limited semi-WYSIWYG toolbar", () => {
  for (const kind of ["title", "copyright", "dedication", "contents", "image"]) {
    const current = modal();
    current.book.items = addBookSection(current.book.items, kind, "Book", "Mục lục");
    current.book.selectedItemId = current.book.items.find((item) => item.kind === kind).id;
    const html = renderProjectBookComposer(current);
    if (kind === "title") for (const placeholder of ["Title", "Subtitle", "Author", "Translator"]) assert.match(html, new RegExp(`placeholder="${placeholder}"`));
    if (kind === "copyright" || kind === "dedication") {
      assert.match(html, /contenteditable="true"/);
      assert.match(html, /book-copyright:italic/);
      assert.match(html, /book-copyright:symbol/);
      assert.match(html, /book-copyright:flourish/);
    }
    if (kind === "contents") { assert.match(html, /Mục lục/); assert.match(html, /final layout at export/); }
    if (kind === "image") { assert.match(html, /data-book-image-dropzone/); assert.match(html, /Enter image caption\./); }
  }
});

test("contents expose an off-page H1 checkbox and render optional subentries", () => {
  const current = modal();
  current.book.items = addBookSection(current.book.items, "contents", "Book", "Contents");
  const contents = current.book.items.find((item) => item.kind === "contents");
  current.book.selectedItemId = contents.id;
  let html = renderProjectBookComposer(current);
  assert.match(html, /type="checkbox" data-book-field="includeH1Headings" > Include H1 headings/);
  assert.ok(html.indexOf("includeH1Headings") < html.indexOf('<article class="book-page'));
  contents.includeH1Headings = true;
  current.book.contentsHeadings = { a: ["Inside the chapter"] };
  html = renderProjectBookComposer(current);
  assert.match(html, /data-book-field="includeH1Headings" checked/);
  assert.match(html, /book-contents__subheading"><span>Inside the chapter/);
});

test("title pages put every editing field beside the typeset proof", () => {
  const current = modal();
  current.book.items = [{ id: "title", kind: "title", title: "First\nSecond", subtitle: "Subtitle", author: "Author", translator: "Translator" }];
  current.book.selectedItemId = "title";
  current.book.titlePreview = { itemId: "title", status: "ready", pages: ["data:image/svg+xml;base64,PHN2Zy8+"] };
  const html = renderProjectBookComposer(current);
  assert.match(html, /<textarea[^>]*data-book-field="title"[^>]*>First\nSecond<\/textarea>/);
  for (const field of ["subtitle", "author", "translator"]) assert.match(html, new RegExp(`data-book-field="${field}"`));
  assert.match(html, /Publisher logo/);
  assert.match(html, /data-editor-export-paper-size-select/);
  assert.match(html, /data-book-title-proof aria-busy="false"/);
  assert.match(html, /src="data:image\/svg\+xml;base64,PHN2Zy8\+"/);
  assert.doesNotMatch(html, /contenteditable|Edit Title Info/);
});
