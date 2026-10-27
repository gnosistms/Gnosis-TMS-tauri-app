#!/usr/bin/env node
// Copy verified public DLE evidence from preserved research; never edit studies.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const digest = (text) => createHash("sha256").update(text).digest("hex");
const directories = (root) => fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name)) : [];
export function prepareDleCache(appData, terms) {
  const requested = [...new Set(terms.map((term) => term.trim().normalize("NFC").toLowerCase()).filter(Boolean))];
  if (!requested.length) throw new Error("Provide the dictionary terms to prepare.");
  const candidates = new Map();
  for (const installation of directories(path.join(appData, "installations"))) {
    if (!/^installation-\d+$/u.test(path.basename(installation))) continue;
    for (const glossary of directories(path.join(installation, "research"))) {
      for (const research of directories(glossary)) {
        const source = path.join(research, "dictionary.json");
        if (!fs.existsSync(source)) continue;
        const bytes = fs.readFileSync(source); let value;
        try { value = JSON.parse(bytes); } catch { continue; }
        if (value.status !== "found" || !/(?:RAE|ASALE|DLE)/u.test(value.sourceName ?? "")) continue;
        let url; try { url = new URL(value.url); } catch { continue; }
        if (url.protocol !== "https:" || url.hostname !== "dle.rae.es" || url.search || url.hash) continue;
        const term = decodeURIComponent(url.pathname.slice(1)).normalize("NFC").toLowerCase();
        if (!requested.includes(term) || !value.articles?.length
          || !value.articles.every((article) => article.headword && (article.senses?.length || article.complexForms?.length))) continue;
        const stat = fs.statSync(source);
        if ((candidates.get(term)?.modified ?? -1) >= stat.mtimeMs) continue;
        candidates.set(term, { value, modified: stat.mtimeMs, hash: digest(bytes), sourceStudy: path.basename(research) });
      }
    }
  }
  const root = path.join(appData, "research-dictionaries", "dle");
  const prepared = []; const missing = [];
  for (const term of requested) {
    const candidate = candidates.get(term);
    if (!candidate) { missing.push(term); continue; }
    const requestUrl = `https://dle.rae.es/${encodeURIComponent(term)}`;
    const record = { schemaVersion: 1, requestUrl, retrievedAt: new Date(candidate.modified).toISOString(),
      provenance: { kind: "saved-dle-lookup", timeBasis: "original-cache-file-mtime", sourceStudy: candidate.sourceStudy, sourceSha256: candidate.hash },
      result: { status: "found", url: candidate.value.url,
        entry: { kind: "articles", articles: candidate.value.articles }, message: null, neededPerson: false } };
    fs.mkdirSync(root, { recursive: true });
    const output = path.join(root, `${digest(requestUrl)}.json`);
    const temporary = `${output}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record)); fs.renameSync(temporary, output);
    prepared.push({ term, senses: candidate.value.articles.reduce((sum, article) => sum + (article.senses?.length ?? 0), 0),
      sourceUrl: candidate.value.url, sourceStudy: candidate.sourceStudy, sourceSha256: candidate.hash });
  }
  return { prepared, missing, preparedCount: prepared.length, requestedCount: requested.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); const value = (flag) => args[args.indexOf(flag) + 1];
  if (!args.includes("--app-data") || !args.includes("--terms")) throw new Error("Usage: node scripts/prepare-dle-cache.mjs --app-data <folder> --terms <comma-separated terms>");
  console.log(JSON.stringify(prepareDleCache(path.resolve(value("--app-data")), value("--terms").split(",")), null, 2));
}
