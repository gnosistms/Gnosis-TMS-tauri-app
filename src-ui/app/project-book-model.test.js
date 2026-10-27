import test from "node:test";
import assert from "node:assert/strict";
import { addBookSection, bookChapterDefaultTitle, bookChapterPreviewBlocks, bookContentsItems, bookExportItems, bookItemIncluded, bookItemTitle, bookLanguages, includeBookItem, reconcileBookLayout, reorderBookItems } from "./project-book-model.js";
import { loadBookSettings, loadContentsTitle, saveBookSettings, saveContentsTitle } from "./project-book-settings.js";
import { setActiveStorageLogin, clearActiveStorageLogin } from "./team-storage.js";
const chapters = () => [
  { id: "10", name: "Chapter 10", languages: [{ code: "en" }] },
  { id: "2", name: "Chapter 2", languages: [{ code: "en" }, { code: "vi" }] },
  { id: "1", name: "Chapter 1", languages: [{ code: "vi" }] },
  { id: "deleted", name: "Deleted", status: "deleted", languages: [{ code: "en" }] },
];
test.afterEach(() => clearActiveStorageLogin());
test("book layout starts in natural order and offers the union of chapter languages", () => {
  const layout = reconcileBookLayout(chapters(), "en");
  assert.deepEqual(layout.items.filter((item) => !bookItemIncluded(item)).map((item) => item.id), ["1"]);
  assert.deepEqual(layout.items.filter(bookItemIncluded).map((item) => item.id), ["2", "10"]);
  assert.deepEqual(bookLanguages(chapters().filter((item) => item.status !== "deleted")).map((language) => language.code), ["en", "vi"]);
  assert.deepEqual(includeBookItem(layout.items, "1", true), layout.items);
});
test("manual ordering survives reconciliation, removed chapters disappear, and new chapters are inserted sensibly", () => {
  const initial = reconcileBookLayout(chapters(), "en");
  const moved = reorderBookItems(initial.items, "10", "2", false);
  const saved = { items: moved, selectedItemId: "10" };
  const next = reconcileBookLayout([...chapters().filter((chapter) => chapter.id !== "1"), { id: "3", name: "Chapter 3", languages: [{ code: "en" }] }], "en", saved);
  assert.deepEqual(next.items.map((item) => item.id), ["10", "2", "3"]);
  assert.equal(next.selectedItemId, "10");
});
test("re-including a chapter places it after its closest lexical predecessor without moving sections", () => {
  const initial = reconcileBookLayout(chapters(), "en");
  const withContents = addBookSection(initial.items, "contents", "Book", "Contents");
  const excluded = includeBookItem(withContents, "10", false);
  const included = includeBookItem(excluded, "10", true);
  assert.deepEqual(included.filter(bookItemIncluded).map((item) => item.kind === "chapter" ? item.id : item.kind), ["contents", "2", "10"]);
});
test("new front matter follows standard order, but contents can be moved to the end", () => {
  let items = reconcileBookLayout(chapters(), "en").items;
  for (const kind of ["contents", "dedication", "copyright", "title"]) items = addBookSection(items, kind, "The Book", "Mục lục");
  assert.deepEqual(items.filter(bookItemIncluded).map((item) => item.kind), ["title", "copyright", "dedication", "contents", "chapter", "chapter"]);
  const toc = items.find((item) => item.kind === "contents");
  items = reorderBookItems(items, toc.id, "10", true);
  assert.equal(items.filter(bookItemIncluded).at(-1).kind, "contents");
  assert.deepEqual(bookContentsItems(items).map((item) => item.kind), ["dedication", "chapter", "chapter"]);
  const exported = bookExportItems({ book: { items } });
  assert.equal(exported.at(-1).title, "Mục lục");
});
test("layouts and edits persist immediately per language and account, with no credentials or preview data", () => {
  setActiveStorageLogin("book-settings-test");
  const modal = { projectId: "p", languageCode: "en", selectedOptionId: "file:pdf", pdfPaperSize: "a5", omitCustomHtml: false, footnoteLinksAsPlainText: true, expandedCategoryIds: ["file"], wordpress: { title: "Post", password: "must-not-save", jobId: "temporary" }, book: { ...reconcileBookLayout(chapters(), "en"), previewBlocks: ["large preview"] } };
  modal.book.items = includeBookItem(modal.book.items, "10", false);
  saveBookSettings(modal);
  saveBookSettings({ ...modal, languageCode: "vi", book: reconcileBookLayout(chapters(), "vi") });
  const saved = loadBookSettings("p");
  assert.equal(saved.layouts.en.items.find((item) => item.id === "10").excluded, true);
  assert.equal(saved.layouts.vi.items.find((item) => item.id === "1").excluded, false);
  assert.equal(saved.options.pdfPaperSize, "a5");
  assert.doesNotMatch(JSON.stringify(saved), /must-not-save|large preview|available|temporary/);
  setActiveStorageLogin("another-book-user");
  assert.deepEqual(loadBookSettings("p"), {});
});
test("the latest contents spelling becomes the per-language default across projects", () => {
  setActiveStorageLogin("contents-default-test");
  saveContentsTitle("vi", "Mục lục");
  assert.equal(loadContentsTitle("vi"), "Mục lục");
  saveContentsTitle("vi", "MỤC LỤC");
  assert.equal(loadContentsTitle("vi"), "MỤC LỤC");
  assert.equal(loadContentsTitle("en"), "Table of Contents");
});

test("chapter defaults use only an opening H1 and overrides replace it without changing source blocks", () => {
  const heading = { kind: "text", textStyle: "heading1", text: "A <i>translated</i> heading", footnotes: [] };
  const paragraph = { kind: "text", textStyle: "paragraph", text: "Opening text" };
  assert.equal(bookChapterDefaultTitle([heading, paragraph], "File"), "A translated heading");
  assert.equal(bookChapterDefaultTitle([paragraph, heading], "File"), "File");
  assert.equal(bookChapterDefaultTitle([{ kind: "image" }, heading], "File"), "File");
  const item = { id: "c", chapterId: "c", kind: "chapter", name: "File", title: "Export heading" };
  const blocks = bookChapterPreviewBlocks(item, [heading, paragraph], "en");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, "Export heading");
  assert.equal(heading.text, "A <i>translated</i> heading");
  assert.equal(bookChapterPreviewBlocks(item, [paragraph, heading], "en")[0].text, "Export heading");
  const noted = { ...heading, footnotes: [{ marker: 2, text: "A note" }] };
  assert.equal(bookChapterPreviewBlocks(item, [noted], "en")[0].text, "Export heading[2]");
});

test("chapter title overrides persist per language; discovered defaults stay transient", () => {
  setActiveStorageLogin("chapter-title-settings-test");
  const english = reconcileBookLayout(chapters(), "en");
  english.items.find((item) => item.id === "2").title = "English title";
  english.items.find((item) => item.id === "10").defaultTitle = "Discovered H1";
  saveBookSettings({ projectId: "titles", languageCode: "en", book: english });
  const vietnamese = reconcileBookLayout(chapters(), "vi");
  vietnamese.items.find((item) => item.id === "2").title = "Tên tiếng Việt";
  saveBookSettings({ projectId: "titles", languageCode: "vi", book: vietnamese });
  const saved = loadBookSettings("titles");
  assert.equal(bookItemTitle(reconcileBookLayout(chapters(), "en", saved.layouts.en).items.find((item) => item.id === "2")), "English title");
  assert.equal(bookItemTitle(reconcileBookLayout(chapters(), "vi", saved.layouts.vi).items.find((item) => item.id === "2")), "Tên tiếng Việt");
  assert.doesNotMatch(JSON.stringify(saved), /Discovered H1/);
  const exported = bookExportItems({ book: english });
  assert.equal(exported.find((item) => item.id === "2").titleOverride, "English title");
  assert.equal(exported.find((item) => item.id === "10").titleOverride, null);
  assert.equal(exported.find((item) => item.id === "10").title, "Chapter 10");
});
