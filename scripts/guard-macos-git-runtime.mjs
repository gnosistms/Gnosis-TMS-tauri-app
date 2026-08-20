#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const archivePath = path.join(
  repositoryRoot,
  "src-tauri",
  "resources",
  "macos",
  "git-runtime.tar.gz",
);
const requiredEntry = "libexec/git-core/git";

function normalizeArchiveEntry(entry) {
  return String(entry).trim().replace(/^\.\//, "").replace(/\/$/, "");
}

export function evaluateMacosGitArchive({
  platform,
  archiveExists,
  archiveSize = 0,
  entries = [],
}) {
  if (platform !== "darwin") {
    return { ok: true, skipped: true };
  }
  if (!archiveExists) {
    return { ok: false, reason: "missing" };
  }
  if (archiveSize <= 0) {
    return { ok: false, reason: "empty" };
  }
  if (!entries.some((entry) => normalizeArchiveEntry(entry) === requiredEntry)) {
    return { ok: false, reason: "incomplete" };
  }
  return { ok: true, skipped: false };
}

function printFailure(reason) {
  console.error("Cannot build the macOS app without its bundled Git runtime.");
  console.error(`Expected archive: ${archivePath}`);
  if (reason === "empty") {
    console.error("The archive exists but is empty.");
  } else if (reason === "incomplete") {
    console.error(`The archive does not contain ${requiredEntry}.`);
  }
  console.error(
    "Stage the signed runtime using the ‘Bundle macOS Git runtime’ steps in " +
      ".github/workflows/release-tauri.yml, then run the build again.",
  );
}

export function runMacosGitRuntimeGuard(platform = process.platform) {
  if (platform !== "darwin") {
    console.log("Skipping macOS Git runtime guard on this platform.");
    return 0;
  }

  const archiveExists = existsSync(archivePath);
  let archiveSize = 0;
  let entries = [];
  if (archiveExists) {
    archiveSize = statSync(archivePath).size;
    if (archiveSize > 0) {
      try {
        entries = execFileSync("tar", ["-tzf", archivePath], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }).split("\n");
      } catch (error) {
        console.error(`Could not read the macOS Git runtime archive: ${error.message}`);
        printFailure("incomplete");
        return 1;
      }
    }
  }

  const result = evaluateMacosGitArchive({
    platform,
    archiveExists,
    archiveSize,
    entries,
  });
  if (!result.ok) {
    printFailure(result.reason);
    return 1;
  }

  console.log("macOS Git runtime archive is present and complete.");
  return 0;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  process.exitCode = runMacosGitRuntimeGuard();
}
