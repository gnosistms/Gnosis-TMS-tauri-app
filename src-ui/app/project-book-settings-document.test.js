import test from "node:test";
import assert from "node:assert/strict";
import { portableBookSettings, bookSettingsEqual, mergeRemoteBookSettings } from "./project-book-settings-document.js";

const layout = (title) => ({ options: { pdfPaperSize: "a5" }, items: [{ id: "title", kind: "title", title, excluded: false }] });

test("Git settings contain page 1 setup and portable assets only", () => {
  const local = { options: { pdfPaperSize: "a5", selectedOptionId: "link:wordpress", wordpress: { password: "secret", connection: { siteUrl: "private" } } },
    languageCode: "en", layouts: { en: { selectedItemId: "title", items: [
      { id: "title", kind: "title", title: "Book\nTitle", subtitle: "Subtitle", image: { assetId: "hash.svg", fileName: "logo.svg", filePath: "/machine/logo.svg", dataUrl: "data:private" } },
      { id: "c", kind: "chapter", chapterId: "c", name: "Derived name", available: true, defaultTitle: "Derived title", numbered: false },
      { id: "contents", kind: "contents" },
    ] } } };
  const saved = portableBookSettings(local);
  assert.deepEqual(saved.layouts.en.options, { pdfPaperSize: "a5" });
  assert.deepEqual(saved.layouts.en.items[0].image, { assetId: "hash.svg", fileName: "logo.svg" });
  assert.equal(saved.layouts.en.items[0].title, "Book\nTitle");
  assert.equal(saved.layouts.en.items[1].numbered, false);
  assert.equal(saved.layouts.en.items[2].includeH1Headings, false);
  assert.doesNotMatch(JSON.stringify(saved), /private|secret|machine|Derived|selectedItemId|languageCode|selectedOptionId/);
});

test("comparison ignores key order and derived defaults but respects item order", () => {
  assert.ok(bookSettingsEqual({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }));
  assert.ok(!bookSettingsEqual({ b: [2, 3] }, { b: [3, 2] }));
  const first = portableBookSettings({ layouts: { en: { items: [{ id: "c", kind: "chapter" }] } } });
  const second = portableBookSettings({ layouts: { en: { items: [{ id: "c", kind: "chapter", numbered: true, excluded: false }] } } });
  assert.ok(bookSettingsEqual(first, second));
});

test("remote replaces languages quietly while retaining local destination preferences", () => {
  const local = { options: { selectedOptionId: "file:pdf", pdfPaperSize: "letter" }, layouts: {
    en: { ...layout("Local"), selectedItemId: "title", options: { selectedOptionId: "file:pdf", pdfPaperSize: "letter" } },
    vi: layout("Local vi"), obsolete: layout("Removed"),
  } };
  const remote = { layouts: { en: layout("Remote"), vi: layout("Remote vi") } };
  const pending = mergeRemoteBookSettings(local, remote, "en", true);
  assert.equal(pending.layouts.en.items[0].title, "Local");
  assert.equal(pending.layouts.vi.items[0].title, "Remote vi");
  assert.equal(pending.layouts.obsolete, undefined);
  const accepted = mergeRemoteBookSettings(local, remote, "en");
  assert.equal(accepted.layouts.en.items[0].title, "Remote");
  assert.equal(accepted.layouts.en.selectedItemId, "title");
  assert.equal(accepted.options.selectedOptionId, "file:pdf");
  assert.deepEqual(accepted.layouts.en.options, { pdfPaperSize: "a5" });
  assert.equal(accepted.options.pdfPaperSize, "a5");
});

test("legacy SVG preparation becomes a portable image reference", () => {
  const png = `${"a".repeat(64)}.png`;
  const saved = portableBookSettings({ layouts: { en: { items: [{ id: "title", kind: "title",
    image: { assetId: "original.svg", vellumFilePath: `C:\\cache\\${png}` },
  }] } } });
  assert.equal(saved.layouts.en.items[0].image.vellumAssetId, png);
  assert.doesNotMatch(JSON.stringify(saved), /cache|filePath/);
});
