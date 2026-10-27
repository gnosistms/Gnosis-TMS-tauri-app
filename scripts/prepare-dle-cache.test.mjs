import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { prepareDleCache } from "./prepare-dle-cache.mjs";

test("preparation copies only real DLE evidence and preserves original files and full article data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gnosis-dle-preparation-"));
  try {
    const source = (installation, term, value) => {
      const file = path.join(root, "installations", `installation-${installation}`, "research", "glossary", `2026-10-08T04-11-07_${term}`, "dictionary.json");
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); return file;
    };
    const articles = [{ headword: "íntimo, ma", senses: [{ number: "1", definition: "Complete fixture sense" }], html: "<article>Full source evidence</article>" }];
    const original = source(7, "intimo", { status: "found", sourceName: "Diccionario de la lengua española (RAE/ASALE)", url: "https://dle.rae.es/%C3%ADntimo", articles });
    const bytes = fs.readFileSync(original);
    source(8, "fatal", { status: "found", sourceName: "Wiktionary", url: "https://en.wiktionary.org/wiki/fatal", articles });
    source(7, "sensible", { status: "unreachable", sourceName: "DLE", url: "https://dle.rae.es/sensible", articles });
    const report = prepareDleCache(root, ["Íntimo", "íntimo", "fatal", "sensible"]);
    assert.equal(report.preparedCount, 1); assert.equal(report.requestedCount, 3); assert.deepEqual(report.missing, ["fatal", "sensible"]);
    const key = createHash("sha256").update("https://dle.rae.es/%C3%ADntimo").digest("hex");
    const cached = JSON.parse(fs.readFileSync(path.join(root, "research-dictionaries", "dle", `${key}.json`)));
    assert.deepEqual(cached.result.entry.articles, articles); assert.equal(cached.result.url, "https://dle.rae.es/%C3%ADntimo");
    assert.equal(cached.provenance.timeBasis, "original-cache-file-mtime");
    assert.deepEqual(fs.readFileSync(original), bytes);
    assert.deepEqual(prepareDleCache(root, ["íntimo"]).prepared, report.prepared);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
