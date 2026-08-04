#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readlinkSync,
  statfsSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

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
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

export function pathIsWithin(
  directory,
  candidatePath,
  platform = process.platform,
) {
  const pathApi = platform === "win32" ? path.win32 : path;
  const normalize = (value) => {
    const resolved = pathApi.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const root = normalize(directory);
  const candidate = normalize(candidatePath);
  const relative = pathApi.relative(root, candidate);
  return relative === "" || (
    !relative.startsWith("..") && !pathApi.isAbsolute(relative)
  );
}

export function targetUsedByLiveProcess(
  targetPath,
  executablePaths,
  platform = process.platform,
) {
  return executablePaths.some((executablePath) =>
    pathIsWithin(targetPath, executablePath, platform),
  );
}

export function parseLsofPaths(output) {
  return String(output)
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1))
    .filter(Boolean);
}

function linuxExecutablePaths() {
  return readdirSync("/proc", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .flatMap((entry) => {
      try {
        return [readlinkSync(`/proc/${entry.name}/exe`)];
      } catch {
        // Processes can exit or become inaccessible while /proc is scanned.
        return [];
      }
    });
}

function macExecutablePaths() {
  const userId = typeof process.getuid === "function" ? process.getuid() : null;
  if (userId === null) {
    throw new Error("Could not determine the current user for process inspection");
  }
  return parseLsofPaths(
    commandOutput("lsof", ["-Fn", "-a", "-u", String(userId), "-d", "txt"]),
  );
}

function windowsExecutablePaths() {
  const output = commandOutput("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-Process | ForEach-Object { try { $_.Path } catch {} }",
  ]);
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function liveExecutablePaths(platform = process.platform) {
  if (platform === "darwin") return macExecutablePaths();
  if (platform === "linux") return linuxExecutablePaths();
  if (platform === "win32") return windowsExecutablePaths();
  throw new Error(`Live-process inspection is unsupported on ${platform}`);
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

export function runRustBuildCacheGuard(cwd = process.cwd()) {
  const repositoryRoot = commandOutput(
    "git",
    ["rev-parse", "--show-toplevel"],
    cwd,
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
    return 0;
  }

  const executablePaths = liveExecutablePaths();
  for (const candidate of candidates) {
    candidate.inUse = targetUsedByLiveProcess(
      candidate.targetPath,
      executablePaths,
    );
  }

  const inUseCandidates = candidates.filter((candidate) => candidate.inUse);
  if (inUseCandidates.length > 0) {
    const inUseSizeBytes = inUseCandidates.reduce(
      (total, candidate) => total + candidate.sizeBytes,
      0,
    );
    console.log(
      `Protecting ${formatGiB(inUseSizeBytes)} used by running Rust binaries`,
    );
  }

  const recentCandidates = candidates.filter(
    (candidate) => candidate.recent && !candidate.inUse,
  );
  const cleanupCandidates = candidates.filter(
    (candidate) => !candidate.recent && !candidate.inUse,
  );

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
    return 1;
  }
  return 0;
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    process.exitCode = runRustBuildCacheGuard();
  } catch (error) {
    console.error(`Rust build-cache guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
