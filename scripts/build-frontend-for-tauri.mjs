import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const distAssetsDir = join(rootDir, "dist", "assets");
const uploadRequested = process.env.GNOSIS_UPLOAD_SENTRY_SOURCEMAPS === "1";
const sentryReady = uploadRequested
  && Boolean(process.env.SENTRY_AUTH_TOKEN)
  && Boolean(process.env.SENTRY_ORG)
  && Boolean(process.env.SENTRY_PROJECT);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: options.env ?? process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`);
    if (!options.allowFailure) {
      process.exit(1);
    }
  }

  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status ?? 1);
  }

  return result.status ?? 1;
}

function removeSourceMaps(directory) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      removeSourceMaps(path);
    } else if (entry.endsWith(".map")) {
      rmSync(path);
    }
  }
}

const buildEnv = {
  ...process.env,
  ...(sentryReady ? { GNOSIS_EMIT_SOURCEMAPS: "1" } : {}),
};

if (uploadRequested && !sentryReady) {
  console.log(
    "Skipping Sentry source map upload; configure SENTRY_AUTH_TOKEN secret and SENTRY_ORG/SENTRY_PROJECT variables to enable it.",
  );
}

run("npm", ["run", "build"], { env: buildEnv });

if (!sentryReady) {
  removeSourceMaps(distAssetsDir);
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const release = `gnosis-tms@${pkg.version}`;

run("npx", ["--yes", "@sentry/cli", "releases", "new", release], { allowFailure: true });
run("npx", [
  "--yes",
  "@sentry/cli",
  "sourcemaps",
  "upload",
  "--release",
  release,
  "--url-prefix",
  "~/assets",
  "dist/assets",
]);
run("npx", ["--yes", "@sentry/cli", "releases", "finalize", release]);
removeSourceMaps(distAssetsDir);
