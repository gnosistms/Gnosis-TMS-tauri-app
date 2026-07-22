import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:https";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const VERSION = "0.15.1";
const RELEASES = {
  "aarch64-apple-darwin": {
    asset: "typst-aarch64-apple-darwin.tar.xz",
    sha256: "48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a",
  },
  "x86_64-apple-darwin": {
    asset: "typst-x86_64-apple-darwin.tar.xz",
    sha256: "7f9fdd9584866245de9a79e0add8f9236fae6f40a8a45e2c4771ccc14db4e0fa",
  },
  "x86_64-pc-windows-msvc": {
    asset: "typst-x86_64-pc-windows-msvc.zip",
    sha256: "19ce3551153c2fe7ee9fa2f95208310c8f4d3209fedb699e0333faf8913f6736",
  },
};

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const hostTarget = process.platform === "darwin"
  ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`
  : process.platform === "win32"
    ? "x86_64-pc-windows-msvc"
    : "";
const target = process.argv[2]
  || process.env.CARGO_BUILD_TARGET
  || process.env.TAURI_ENV_TARGET_TRIPLE
  || hostTarget;
const release = RELEASES[target];

if (!release) {
  console.error(`Gnosis TMS does not currently bundle Typst for target '${target || "unknown"}'.`);
  process.exit(1);
}

const destinationDir = join(rootDir, "src-tauri", "binaries");
const destination = join(
  destinationDir,
  `typst-${target}${target.includes("windows") ? ".exe" : ""}`,
);
const versionMarker = join(destinationDir, `.typst-sidecar-${target}.version`);
if (
  existsSync(destination)
  && existsSync(versionMarker)
  && readFileSync(versionMarker, "utf8").trim() === VERSION
) {
  console.log(`Typst ${VERSION} sidecar is ready for ${target}.`);
  process.exit(0);
}

function download(url, path, redirects = 0) {
  return new Promise((resolve, reject) => {
    get(url, { headers: { "User-Agent": "gnosis-tms-build" } }, (response) => {
      if (
        response.statusCode >= 300
        && response.statusCode < 400
        && response.headers.location
        && redirects < 5
      ) {
        response.resume();
        resolve(download(response.headers.location, path, redirects + 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Typst download failed with HTTP ${response.statusCode}.`));
        return;
      }
      const stream = createWriteStream(path, { flags: "wx" });
      response.pipe(stream);
      stream.on("finish", () => stream.close(resolve));
      stream.on("error", reject);
    }).on("error", reject);
  });
}

const workDir = mkdtempSync(join(tmpdir(), "gnosis-typst-sidecar-"));
try {
  const archivePath = join(workDir, release.asset);
  const url = `https://github.com/typst/typst/releases/download/v${VERSION}/${release.asset}`;
  console.log(`Downloading pinned Typst ${VERSION} for ${target}…`);
  await download(url, archivePath);
  const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  if (digest !== release.sha256) {
    throw new Error(`Typst archive integrity check failed (received ${digest}).`);
  }

  const extractedDir = join(workDir, "extracted");
  mkdirSync(extractedDir);
  const extraction = spawnSync("tar", ["-xf", archivePath, "-C", extractedDir], {
    stdio: "inherit",
    shell: false,
  });
  if (extraction.error || extraction.status !== 0) {
    throw extraction.error ?? new Error("Could not extract the Typst release archive.");
  }
  const source = join(
    extractedDir,
    basename(release.asset).replace(/\.(tar\.xz|zip)$/, ""),
    target.includes("windows") ? "typst.exe" : "typst",
  );
  if (!existsSync(source)) {
    throw new Error("The Typst release archive did not contain the expected executable.");
  }
  mkdirSync(destinationDir, { recursive: true });
  copyFileSync(source, destination);
  if (!target.includes("windows")) {
    chmodSync(destination, 0o755);
  }
  writeFileSync(versionMarker, `${VERSION}\n`);
  console.log(`Prepared ${destination}.`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
