// Generates src-tauri/resources/THIRD-PARTY-NOTICES.md, the third-party
// license attribution file bundled into release builds (see bundle.resources
// in src-tauri/tauri.conf.json).
//
// Sections:
//   1. Rust crates — `cargo about generate` (src-tauri/about.toml + about.hbs)
//   2. npm packages — license-checker over production dependencies
//   3. Bundled/downloaded runtimes — Typst, EB Garamond, the modified Cormorant Garamond,
//      Shippori Mincho, and Noto print fonts
//   4. Vendored libraries — src-ui/lib/vendor/diff-match-patch.js (Apache-2.0)
//
// Runs as part of the Tauri beforeBuildCommand (build-frontend-for-tauri.mjs)
// so `npm run tauri:build` always ships a fresh file. Requires cargo-about:
//   cargo install --locked cargo-about

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const licenseChecker = require("license-checker");

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const srcTauriDir = join(rootDir, "src-tauri");
const outputPath = join(srcTauriDir, "resources", "THIRD-PARTY-NOTICES.md");

function generateCratesSection() {
  const result = spawnSync("cargo", ["about", "generate", "about.hbs"], {
    cwd: srcTauriDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error || result.status !== 0 || !result.stdout) {
    console.error(
      "Failed to run `cargo about generate`. Install cargo-about first:\n" +
        "  cargo install --locked cargo-about\n" +
        (result.error ? `(${result.error.message})` : ""),
    );
    process.exit(1);
  }

  return result.stdout;
}

function collectNpmPackages() {
  return new Promise((resolve, reject) => {
    licenseChecker.init(
      { start: rootDir, production: true, excludePrivatePackages: true },
      (error, packages) => (error ? reject(error) : resolve(packages)),
    );
  });
}

function generateNpmSection(packages) {
  const lines = [
    "## npm packages",
    "",
    "This application bundles the following npm packages.",
    "",
  ];

  for (const [packageId, info] of Object.entries(packages).sort()) {
    lines.push(`### ${packageId}`);
    lines.push("");
    const source = info.repository ?? `https://www.npmjs.com/package/${packageId}`;
    lines.push(`License: ${info.licenses} — ${source}`);
    lines.push("");
    if (info.licenseFile) {
      lines.push("```");
      lines.push(readFileSync(info.licenseFile, "utf8").trimEnd());
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

function generateVendoredSection() {
  const apacheText = readFileSync(
    join(rootDir, "scripts", "licenses", "apache-2.0.txt"),
    "utf8",
  ).trimEnd();

  return [
    "## Vendored libraries",
    "",
    "### diff-match-patch",
    "",
    "Copyright 2018 The diff-match-patch Authors.",
    "https://github.com/google/diff-match-patch",
    "",
    "Bundled as `src-ui/lib/vendor/diff-match-patch.js`, licensed under the",
    "Apache License, Version 2.0:",
    "",
    "```",
    apacheText,
    "```",
    "",
  ].join("\n");
}

function generatePdfRuntimeSection() {
  const apacheText = readFileSync(
    join(rootDir, "scripts", "licenses", "apache-2.0.txt"),
    "utf8",
  ).trimEnd();
  const oflText = readFileSync(
    join(rootDir, "src-ui", "assets", "fonts-variable", "noto-serif", "LICENSE"),
    "utf8",
  ).trimEnd();
  const oflLicenseStart = oflText.indexOf(
    "-----------------------------------------------------------",
  );
  if (oflLicenseStart < 0) {
    throw new Error("Could not locate the SIL OFL text used by the PDF fonts.");
  }
  const ebGaramondOflText = [
    "Copyright 2017 The EB Garamond Project Authors (https://github.com/octaviopardo/EBGaramond12)",
    "",
    "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
    "This license is copied below, and is also available with a FAQ at:",
    "https://openfontlicense.org",
    "",
    oflText.slice(oflLicenseStart),
  ].join("\n");
  const cormorantGaramondOflText = [
    "Copyright 2015 the Cormorant Project Authors (github.com/CatharsisFonts/Cormorant)",
    "",
    "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
    "This license is copied below, and is also available with a FAQ at:",
    "https://scripts.sil.org/OFL",
    "",
    oflText.slice(oflLicenseStart),
  ].join("\n");
  const shipporiOflText = [
    "Copyright 2021 The Shippori Mincho Project Authors (https://github.com/fontdasu/ShipporiMincho)",
    "",
    "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
    "This license is copied below, and is also available with a FAQ at:",
    "http://scripts.sil.org/OFL",
    "",
    oflText.slice(oflLicenseStart),
  ].join("\n");
  return [
    "## PDF export runtime and fonts",
    "",
    "### Typst 0.15.1",
    "",
    "https://github.com/typst/typst",
    "",
    "Bundled as the PDF compiler under the Apache License, Version 2.0:",
    "",
    "```",
    apacheText,
    "```",
    "",
    "### Noto Serif and Noto Naskh font families",
    "",
    "https://github.com/google/fonts",
    "",
    "Downloaded on demand for PDF export under the SIL Open Font License, Version 1.1:",
    "",
    "```",
    oflText,
    "```",
    "",
    "### Shippori Mincho",
    "",
    "https://github.com/fontdasu/ShipporiMincho",
    "",
    "Downloaded on demand for Japanese PDF export under the SIL Open Font License, Version 1.1:",
    "",
    "```",
    shipporiOflText,
    "```",
    "",
    "### EB Garamond",
    "",
    "https://github.com/octaviopardo/EBGaramond12",
    "",
    "Downloaded on demand for PDF export under the SIL Open Font License, Version 1.1:",
    "",
    "```",
    ebGaramondOflText,
    "```",
    "",
    "### Cormorant Garamond (modified)",
    "",
    "https://github.com/CatharsisFonts/Cormorant",
    "",
    "Bundled with the app for Latin-script PDF headings, as a modified version named",
    '"Cormorant Garamond Gnosis". Cormorant draws each Vietnamese accent twice — a',
    "compact form used when marks stack and a taller form used when one stands alone —",
    "so the two disagree within a single word. The modification replaces the taller",
    "circumflex, grave and acute with the compact forms the font already contains, and",
    "corrects the position of the tone mark above an uppercase circumflex. No outline",
    "is newly drawn. The change is reproducible from the upstream file with",
    "scripts/patch-cormorant-vietnamese-accents.py.",
    "",
    "Used under the SIL Open Font License, Version 1.1, under which this derivative",
    "also remains:",
    "",
    "```",
    cormorantGaramondOflText,
    "```",
    "",
  ].join("\n");
}

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));

const header = [
  "# Third-Party Notices",
  "",
  `Gnosis TMS ${pkg.version} bundles third-party software under the licenses`,
  "reproduced below.",
  "",
  "Generated by scripts/generate-third-party-notices.mjs — do not edit by hand.",
  "",
].join("\n");

const cratesSection = generateCratesSection();
const npmPackages = await collectNpmPackages();

mkdirSync(join(srcTauriDir, "resources"), { recursive: true });
writeFileSync(
  outputPath,
  [
    header,
    cratesSection.trimEnd(),
    "",
    generateNpmSection(npmPackages),
    generatePdfRuntimeSection(),
    generateVendoredSection(),
  ].join("\n"),
);

console.log(
  `Wrote ${outputPath} (${Object.keys(npmPackages).length} npm packages + Rust crates + vendored).`,
);
