#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statfsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const GIB = 1024 ** 3;
const dryRun = process.argv.includes("--dry-run");

function positiveNumberFromEnvironment(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined) return fallback;

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} must be a positive number; received ${rawValue}`);
    process.exit(2);
  }

  return value;
}

const maxCacheGiB = positiveNumberFromEnvironment(
  "GNOSIS_RUST_CACHE_MAX_GIB",
  20,
);
const minFreeGiB = positiveNumberFromEnvironment(
  "GNOSIS_DISK_FREE_MIN_GIB",
  30,
);
const minAgeHours = positiveNumberFromEnvironment(
  "GNOSIS_RUST_CACHE_MIN_AGE_HOURS",
  6,
);
const maxCacheBytes = maxCacheGiB * GIB;
const minFreeBytes = minFreeGiB * GIB;

function commandOutput(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function formatGiB(bytes) {
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

function availableBytes(filePath) {
  const stats = statfsSync(filePath, { bigint: true });
  return Number(stats.bavail * stats.bsize);
}

function directorySizeBytes(directory) {
  const output = commandOutput("du", ["-sk", directory]);
  const kibibytes = Number.parseInt(output.split(/\s+/, 1)[0], 10);
  if (!Number.isFinite(kibibytes)) {
    throw new Error(`Could not determine the size of ${directory}`);
  }
  return kibibytes * 1024;
}

function worktreePaths(repositoryRoot) {
  const output = commandOutput(
    "git",
    ["worktree", "list", "--porcelain"],
    repositoryRoot,
  );

  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((worktreePath) => existsSync(worktreePath));
}

function cacheCandidate(worktreePath, relativeManifest, repositoryRoot) {
  const manifestPath = path.join(worktreePath, relativeManifest);
  const targetPath = path.join(path.dirname(manifestPath), "target");

  if (!existsSync(manifestPath) || !existsSync(targetPath)) return null;

  const activityPaths = [
    targetPath,
    path.join(targetPath, ".rustc_info.json"),
    path.join(targetPath, "debug", ".cargo-lock"),
  ].filter((activityPath) => existsSync(activityPath));
  const lastUsedAt = Math.max(
    ...activityPaths.map((activityPath) => statSync(activityPath).mtimeMs),
  );

  return {
    worktreePath,
    manifestPath,
    targetPath,
    sizeBytes: directorySizeBytes(targetPath),
    lastUsedAt,
    active: worktreePath === repositoryRoot,
    recent:
      worktreePath !== repositoryRoot &&
      Date.now() - lastUsedAt < minAgeHours * 60 * 60 * 1000,
  };
}

function cleanCandidate(candidate) {
  const label = candidate.active ? "active worktree" : "inactive worktree";
  console.log(
    `${dryRun ? "Would clean" : "Cleaning"} ${formatGiB(candidate.sizeBytes)} ` +
      `from ${candidate.targetPath} (${label})`,
  );

  if (dryRun) return;

  const result = spawnSync(
    "cargo",
    ["clean", "--manifest-path", candidate.manifestPath],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cargo clean failed for ${candidate.manifestPath}`);
  }
}

function thresholdsSatisfied(cacheBytes, freeBytes) {
  return cacheBytes <= maxCacheBytes && freeBytes >= minFreeBytes;
}

try {
  const repositoryRoot = commandOutput(
    "git",
    ["rev-parse", "--show-toplevel"],
    process.cwd(),
  );
  const worktrees = worktreePaths(repositoryRoot);
  const candidates = [];

  for (const worktreePath of worktrees) {
    const applicationCache = cacheCandidate(
      worktreePath,
      "src-tauri/Cargo.toml",
      repositoryRoot,
    );
    if (applicationCache) candidates.push(applicationCache);

    const alignmentCache = cacheCandidate(
      worktreePath,
      "alignment-lab/Cargo.toml",
      repositoryRoot,
    );
    if (alignmentCache) candidates.push(alignmentCache);
  }

  let totalCacheBytes = candidates.reduce(
    (total, candidate) => total + candidate.sizeBytes,
    0,
  );
  let freeBytes = availableBytes(repositoryRoot);

  console.log(
    `Rust build cache: ${formatGiB(totalCacheBytes)} / ${maxCacheGiB} GiB; ` +
      `disk free: ${formatGiB(freeBytes)} / ${minFreeGiB} GiB minimum`,
  );

  if (thresholdsSatisfied(totalCacheBytes, freeBytes)) {
    process.exit(0);
  }

  const recentCandidates = candidates.filter((candidate) => candidate.recent);
  const cleanupCandidates = candidates.filter((candidate) => !candidate.recent);

  if (recentCandidates.length > 0) {
    const recentSizeBytes = recentCandidates.reduce(
      (total, candidate) => total + candidate.sizeBytes,
      0,
    );
    console.log(
      `Protecting ${formatGiB(recentSizeBytes)} used by other worktrees within ` +
        `the last ${minAgeHours} hours`,
    );
  }

  // Prefer the least recently used inactive worktrees. The current worktree is
  // eligible only after all older build output has been removed.
  cleanupCandidates.sort((left, right) => {
    if (left.active !== right.active) return left.active ? 1 : -1;
    return left.lastUsedAt - right.lastUsedAt;
  });

  for (const candidate of cleanupCandidates) {
    if (thresholdsSatisfied(totalCacheBytes, freeBytes)) break;

    cleanCandidate(candidate);
    totalCacheBytes -= candidate.sizeBytes;
    freeBytes = dryRun
      ? freeBytes + candidate.sizeBytes
      : availableBytes(repositoryRoot);
  }

  console.log(
    `${dryRun ? "Projected" : "Current"} Rust build cache: ` +
      `${formatGiB(Math.max(0, totalCacheBytes))}; disk free: ` +
      `${formatGiB(freeBytes)}`,
  );

  if (!thresholdsSatisfied(totalCacheBytes, freeBytes)) {
    console.error(
      `Cannot satisfy the ${minFreeGiB} GiB free-space floor. ` +
        "Free additional disk space before starting a Rust build.",
    );
    process.exit(1);
  }
} catch (error) {
  console.error(`Rust build-cache guard failed: ${error.message}`);
  process.exit(1);
}
