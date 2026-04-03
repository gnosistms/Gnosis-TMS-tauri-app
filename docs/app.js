const OWNER = "gnosistms";
const REPO = "Gnosis-TMS-tauri-app";
const RELEASE_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;

const state = {
  release: null,
  detection: null,
};

function $(id) {
  return document.getElementById(id);
}

function formatBytes(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function classifyAssets(assets) {
  return {
    macArmZip: assets.find((asset) => /_aarch64\.zip$/i.test(asset.name)),
    macIntelZip: assets.find((asset) => /_x64\.zip$/i.test(asset.name)),
    windowsMsi: assets.find((asset) => /_x64_en-US\.msi$/i.test(asset.name)),
    windowsExe: assets.find((asset) => /_x64-setup\.exe$/i.test(asset.name)),
  };
}

async function detectClient() {
  const ua = navigator.userAgent || "";
  const uaData = navigator.userAgentData;
  const platformString = uaData?.platform || navigator.platform || "";

  let os = "unknown";
  if (/Win/i.test(platformString) || /Windows/i.test(ua)) {
    os = "windows";
  } else if (/Mac/i.test(platformString) || /Macintosh|Mac OS X/i.test(ua)) {
    os = "mac";
  }

  let arch = "unknown";
  if (uaData?.getHighEntropyValues) {
    try {
      const values = await uaData.getHighEntropyValues(["architecture", "bitness"]);
      const normalized = `${values.architecture || ""}${values.bitness || ""}`.toLowerCase();
      if (normalized.includes("arm")) {
        arch = "arm64";
      } else if (normalized.includes("x86") || normalized.includes("64")) {
        arch = "x64";
      }
    } catch {
      // Ignore and fall back to heuristics below.
    }
  }

  if (arch === "unknown") {
    if (/\b(aarch64|arm64)\b/i.test(ua)) {
      arch = "arm64";
    } else if (/\b(x86_64|win64|wow64|amd64)\b/i.test(ua)) {
      arch = "x64";
    } else if (os === "windows") {
      arch = "x64";
    }
  }

  return { os, arch };
}

function setDetectedPlatformText(detection) {
  const el = $("detected-platform");
  if (detection.os === "windows") {
    el.textContent = "Detected Windows";
    return;
  }
  if (detection.os === "mac" && detection.arch === "arm64") {
    el.textContent = "Detected macOS Apple Silicon";
    return;
  }
  if (detection.os === "mac" && detection.arch === "x64") {
    el.textContent = "Detected macOS Intel";
    return;
  }
  if (detection.os === "mac") {
    el.textContent = "Detected macOS";
    return;
  }
  el.textContent = "Choose your download";
}

function renderPrimary() {
  const title = $("primary-title");
  const copy = $("primary-copy");
  const actions = $("primary-actions");
  const version = $("release-version");
  const { release, detection } = state;

  if (!release) {
    version.textContent = "Loading latest release...";
    return;
  }

  const assets = classifyAssets(release.assets || []);
  version.textContent = release.tag_name || release.name || "Latest release";

  const links = [];
  if (detection.os === "windows" && assets.windowsMsi) {
    title.textContent = "Recommended for Windows";
    copy.textContent = "Download the latest Windows installer package.";
    links.push({
      href: assets.windowsMsi.browser_download_url,
      label: `Download Windows Installer (${formatBytes(assets.windowsMsi.size)})`,
      primary: true,
    });
    if (assets.windowsExe) {
      links.push({
        href: assets.windowsExe.browser_download_url,
        label: `Alternative EXE Setup (${formatBytes(assets.windowsExe.size)})`,
      });
    }
  } else if (detection.os === "mac" && detection.arch === "arm64" && assets.macArmZip) {
    title.textContent = "Recommended for macOS Apple Silicon";
    copy.textContent = "Download the latest Mac ZIP, unzip it, then open the DMG inside.";
    links.push({
      href: assets.macArmZip.browser_download_url,
      label: `Download for Apple Silicon (${formatBytes(assets.macArmZip.size)})`,
      primary: true,
    });
    if (assets.macIntelZip) {
      links.push({
        href: assets.macIntelZip.browser_download_url,
        label: `Need Intel Mac instead? (${formatBytes(assets.macIntelZip.size)})`,
      });
    }
  } else if (detection.os === "mac" && detection.arch === "x64" && assets.macIntelZip) {
    title.textContent = "Recommended for macOS Intel";
    copy.textContent = "Download the latest Mac ZIP, unzip it, then open the DMG inside.";
    links.push({
      href: assets.macIntelZip.browser_download_url,
      label: `Download for Intel Mac (${formatBytes(assets.macIntelZip.size)})`,
      primary: true,
    });
    if (assets.macArmZip) {
      links.push({
        href: assets.macArmZip.browser_download_url,
        label: `Need Apple Silicon instead? (${formatBytes(assets.macArmZip.size)})`,
      });
    }
  } else if (detection.os === "mac") {
    title.textContent = "Choose your Mac download";
    copy.textContent = "Browser detection could not confirm whether this Mac is Apple Silicon or Intel.";
    if (assets.macArmZip) {
      links.push({
        href: assets.macArmZip.browser_download_url,
        label: `Apple Silicon ZIP (${formatBytes(assets.macArmZip.size)})`,
        primary: true,
      });
    }
    if (assets.macIntelZip) {
      links.push({
        href: assets.macIntelZip.browser_download_url,
        label: `Intel Mac ZIP (${formatBytes(assets.macIntelZip.size)})`,
      });
    }
  } else {
    title.textContent = "Download the latest release";
    copy.textContent = "Use the manual links below if we cannot confidently identify your platform.";
    if (assets.windowsMsi) {
      links.push({
        href: assets.windowsMsi.browser_download_url,
        label: `Windows Installer (${formatBytes(assets.windowsMsi.size)})`,
        primary: true,
      });
    }
    if (assets.macArmZip) {
      links.push({
        href: assets.macArmZip.browser_download_url,
        label: `Mac Apple Silicon ZIP (${formatBytes(assets.macArmZip.size)})`,
      });
    }
    if (assets.macIntelZip) {
      links.push({
        href: assets.macIntelZip.browser_download_url,
        label: `Mac Intel ZIP (${formatBytes(assets.macIntelZip.size)})`,
      });
    }
  }

  actions.innerHTML = "";
  for (const link of links) {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.label;
    anchor.className = `button ${link.primary ? "button--primary" : "button--secondary"}`;
    actions.appendChild(anchor);
  }
}

function renderManualDownloads() {
  const container = $("manual-downloads");
  const { release } = state;
  if (!release) {
    return;
  }

  const assets = classifyAssets(release.assets || []);
  const items = [
    {
      title: "Mac Apple Silicon",
      detail: "ZIP containing the DMG installer",
      asset: assets.macArmZip,
    },
    {
      title: "Mac Intel",
      detail: "ZIP containing the DMG installer",
      asset: assets.macIntelZip,
    },
    {
      title: "Windows MSI Installer",
      detail: "Recommended Windows installer",
      asset: assets.windowsMsi,
    },
    {
      title: "Windows EXE Setup",
      detail: "Alternative Windows setup executable",
      asset: assets.windowsExe,
    },
  ].filter((item) => item.asset);

  container.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "download-item";
    row.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        <div class="download-item__meta">${item.detail} · ${formatBytes(item.asset.size)}</div>
      </div>
    `;
    const link = document.createElement("a");
    link.href = item.asset.browser_download_url;
    link.className = "button button--secondary";
    link.textContent = "Download";
    row.appendChild(link);
    container.appendChild(row);
  }
}

function renderFailure(message) {
  $("detected-platform").textContent = "Could not load release info";
  $("release-version").textContent = "GitHub API unavailable";
  $("primary-title").textContent = "Latest release unavailable";
  $("primary-copy").textContent = message;
  $("primary-actions").innerHTML = `
    <a class="button button--secondary" href="https://github.com/${OWNER}/${REPO}/releases" target="_blank" rel="noreferrer">
      Open GitHub Releases
    </a>
  `;
  $("manual-downloads").innerHTML = `
    <div class="download-item download-item--loading">
      <span>Open the GitHub Releases page to download installers directly.</span>
    </div>
  `;
}

async function init() {
  state.detection = await detectClient();
  setDetectedPlatformText(state.detection);

  try {
    const response = await fetch(RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }
    const release = await response.json();
    state.release = {
      tag_name: release.tag_name,
      name: release.name,
      assets: (release.assets || []).map((asset) => ({
        name: asset.name,
        size: asset.size,
        browser_download_url: asset.browser_download_url,
      })),
    };
    renderPrimary();
    renderManualDownloads();
  } catch (error) {
    renderFailure("We could not load the latest release automatically. Use the GitHub Releases page instead.");
  }
}

init();
