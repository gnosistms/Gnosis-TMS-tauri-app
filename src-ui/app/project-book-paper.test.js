import test from "node:test";
import assert from "node:assert/strict";
import { bookPaperStyle } from "./project-book-paper.js";

const measurements = (style) => Object.fromEntries(style.split(";").map((part) => part.split(":")));

test("A5 copyright verso swaps the export's 22mm inside and 19mm outside margins", () => {
  const copyright = measurements(bookPaperStyle({ pdfPaperSize: "a5" }, "copyright"));
  const chapter = measurements(bookPaperStyle({ pdfPaperSize: "a5" }, "chapter"));
  assert.equal(copyright["--book-paper-left"], chapter["--book-paper-right"]);
  assert.equal(copyright["--book-paper-right"], chapter["--book-paper-left"]);
  assert.ok(Math.abs(parseFloat(copyright["--book-paper-height"]) - 100 * 210 / 148) < .000001);
  assert.ok(Math.abs(parseFloat(copyright["--book-paper-font"]) - 100 * 9.2 * 25.4 / 72 / 148) < .000001);
});

test("invalid paper sizes use the export default rather than accepting style input", () => {
  assert.equal(bookPaperStyle({ pdfPaperSize: 'a5;bad:value' }, "copyright"), bookPaperStyle({ pdfPaperSize: "a4" }, "copyright"));
});
