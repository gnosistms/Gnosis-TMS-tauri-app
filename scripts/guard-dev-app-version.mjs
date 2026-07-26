#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const VERSION_FILES = [
  {
    path: "package.json",
    readVersion(contents) {
      return JSON.parse(contents).version;
    },
  },
  {
    path: "src-tauri/Cargo.toml",
    readVersion(contents) {
      const packageSection = contents
        .split(/^\[/m)
        .find((section) => section.startsWith("package]"));
      return packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
    },
  },
  {
    path: "src-tauri/tauri.conf.json",
    readVersion(contents) {
      return JSON.parse(contents).version;
    },
  },
];

export function parseStableVersion(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return null;
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

export function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  if (!leftParts || !rightParts) {
    throw new Error(`Cannot compare app versions "${left}" and "${right}".`);
  }

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

export function newestStableTag(tags) {
  return tags
    .map((tag) => String(tag).trim())
    .filter((tag) => parseStableVersion(tag))
    .sort(compareStableVersions)
    .at(-1) ?? null;
}

export function evaluateDevVersion({ declaredVersions, releaseTag }) {
  const entries = Object.entries(declaredVersions);
  const distinctVersions = [...new Set(entries.map(([, version]) => version))];
  if (
    entries.length !== VERSION_FILES.length ||
    distinctVersions.length !== 1 ||
    !parseStableVersion(distinctVersions[0])
  ) {
    return {
      ok: false,
      reason: "inconsistent",
      declaredVersions,
    };
  }

  const declaredVersion = distinctVersions[0];
  if (!releaseTag || compareStableVersions(declaredVersion, releaseTag) >= 0) {
    return { ok: true, declaredVersion, releaseTag };
  }

  return {
    ok: false,
    reason: "stale",
    declaredVersion,
    releaseTag,
  };
}

function commandOutput(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function declaredVersions(repositoryRoot) {
  return Object.fromEntries(
    VERSION_FILES.map((versionFile) => {
      const contents = readFileSync(
        path.join(repositoryRoot, versionFile.path),
        "utf8",
      );
      return [versionFile.path, versionFile.readVersion(contents) ?? null];
    }),
  );
}

function printFailure(result) {
  if (result.reason === "inconsistent") {
    console.error("Development app version metadata is inconsistent:");
    for (const [file, version] of Object.entries(result.declaredVersions)) {
      console.error(`  ${file}: ${version ?? "missing"}`);
    }
    console.error("Synchronize all app version files before starting Tauri.");
    return;
  }

  console.error(
    `Development app version ${result.declaredVersion} is older than ` +
      `the latest local release ${result.releaseTag.replace(/^v/i, "")}.`,
  );
  console.error(
    "Merge or rebase the current branch onto current main, then restart the development app.",
  );
  console.error(
    "For intentional old-version testing only, set " +
      "GNOSIS_ALLOW_STALE_DEV_VERSION=1.",
  );
}

export function runDevVersionGuard(cwd = process.cwd()) {
  const repositoryRoot = commandOutput(
    "git",
    ["rev-parse", "--show-toplevel"],
    cwd,
  );
  let tagArgs = ["tag", "--list", "v*"];
  try {
    commandOutput(
      "git",
      ["rev-parse", "--verify", "refs/remotes/origin/main"],
      repositoryRoot,
    );
    tagArgs = ["tag", "--merged", "refs/remotes/origin/main", "--list", "v*"];
  } catch {
    // A clone without origin/main can still compare against its local release tags.
  }
  const tags = commandOutput("git", tagArgs, repositoryRoot)
    .split("\n")
    .filter(Boolean);
  const result = evaluateDevVersion({
    declaredVersions: declaredVersions(repositoryRoot),
    releaseTag: newestStableTag(tags),
  });

  if (result.ok) {
    console.log(
      `Development app version ${result.declaredVersion} is current` +
        (result.releaseTag ? ` (latest release ${result.releaseTag})` : "") +
        ".",
    );
    return 0;
  }

  printFailure(result);
  if (process.env.GNOSIS_ALLOW_STALE_DEV_VERSION === "1") {
    console.warn("Continuing because the stale development version override is set.");
    return 0;
  }
  return 1;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    process.exitCode = runDevVersionGuard();
  } catch (error) {
    console.error(`Development version guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
