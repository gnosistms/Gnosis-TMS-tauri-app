import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";

// The smoke MSI alone loads this driver alongside the ordinary production frontend.
// Use a separate Tauri store to coordinate with the runner, so its real WebView2
// can keep the same developer-tools configuration as a shipping installation.
async function exerciseSettings() {
  const control = await window.__TAURI__.store.load("windows-crash-smoke.json");
  async function phase(value) {
    await control.set("phase", value);
    await control.save();
  }
  async function waitFor(label, read) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const result = read();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(label);
  }
  try {
    await phase("WebView loaded");
    await waitFor("hero page", () => document.querySelector(".screen--start") && window.__gnosisDebug?.waitForBootstrap);
    await window.__gnosisDebug.waitForBootstrap();
    await phase("hero ready");
    if (!await control.get("firstRun")) await window.__TAURI__.event.emit("open-error-reporting");
    const modal = () => document.querySelector('[data-modal-dialog="telemetry-disclosure"]');
    await waitFor("error reporting dialog", modal);
    const enabled = await control.get("enabled");
    if (modal().querySelector("input").checked !== enabled) modal().querySelector("label").click();
    await waitFor("requested checkbox state", () => modal()?.querySelector("input")?.checked === enabled);
    modal().querySelector('[data-action="save-error-reporting-settings"]').click();
    await waitFor("saved disclosure", () => !modal());
    await phase("saved");
  } catch (error) {
    await phase("failed at " + error.message);
  }
}

assert.equal(new URL(process.env.VITE_SENTRY_DSN).hostname, "127.0.0.1");
const html = readFileSync("dist/index.html", "utf8");
assert.ok(html.includes("</body>"));
writeFileSync("dist/windows-crash-smoke.js", "(" + exerciseSettings.toString() + ")();\n");
writeFileSync("dist/index.html", html.replace("</body>", '<script type="module" src="./windows-crash-smoke.js"></script></body>'));
