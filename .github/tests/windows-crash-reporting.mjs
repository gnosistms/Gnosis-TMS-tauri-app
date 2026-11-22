import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true", "This smoke test uses a fresh runner profile");
const exe = resolve(process.argv[2]);
const version = JSON.parse(readFileSync("package.json")).version;
const settingsPath = join(process.env.APPDATA, "com.gnosis.tms/app-state.json");
const database = join(process.env.LOCALAPPDATA, "com.gnosis.tms/native-crashes");
const marker = join(process.env.RUNNER_TEMP, "gnosis-crash-smoke-marker");
const dsn = new URL(process.env.VITE_SENTRY_DSN);
assert.equal(dsn.hostname, "127.0.0.1");
assert.equal(existsSync(settingsPath), false, "Expected an unused app profile");
for (const name of ["gnosis-crash-capture.dll", "sentry-crash.exe", "sentry-wer.dll"]) {
  assert.ok(existsSync(join(dirname(exe), "crash-reporter", name)), "Installer missing " + name);
}

const requests = [];
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (req.method === "POST") requests.push(Buffer.concat(chunks).toString());
  res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" }).end("{}");
});
server.listen(Number(dsn.port), dsn.hostname);
await once(server, "listening");

async function until(description, fn, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await delay(150);
  }
  throw new Error("Timed out waiting for " + description);
}
function pending() {
  const dir = join(database, "pending");
  return existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith(".json")) : [];
}
let port = 18900;
const running = new Set();
function launch(early = false) {
  if (existsSync(marker)) unlinkSync(marker);
  port += 1;
  const proc = spawn(exe, early ? ["--crash-before-window"] : ["--crash-on-marker", marker], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=" + port },
    stdio: "inherit",
  });
  running.add(proc);
  proc.once("exit", () => running.delete(proc));
  return { proc, closed: once(proc, "exit"), port };
}
async function crashed(app) {
  const [code] = await Promise.race([app.closed, delay(45_000, null, { ref: false }).then(() => { throw new Error("App did not exit"); })]);
  assert.notEqual(code, 0);
}
async function hero(app) {
  const url = "http://127.0.0.1:" + app.port;
  await until("WebView2", async () => {
    assert.equal(app.proc.exitCode, null, "App exited before reaching the hero page");
    try { return (await (await fetch(url + "/json/list")).json()).some(t => t.type === "page"); } catch { return false; }
  });
  const browser = await chromium.connectOverCDP(url);
  const page = browser.contexts()[0].pages()[0];
  await page.locator(".screen--start").waitFor();
  await page.evaluate(() => window.__gnosisDebug.waitForBootstrap());
  return page;
}
async function save(page, enabled, firstRun = false) {
  if (!firstRun) await page.evaluate(() => window.__TAURI__.event.emit("open-error-reporting"));
  const modal = page.locator('[data-modal-dialog="telemetry-disclosure"]');
  await modal.waitFor();
  const check = modal.locator("input");
  if (await check.isChecked() !== enabled) await modal.locator("label").click();
  assert.equal(await check.isChecked(), enabled);
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await modal.waitFor({ state: "detached" });
  const settings = JSON.parse(readFileSync(settingsPath));
  assert.equal(settings["telemetry-enabled"], enabled);
  assert.equal(settings["telemetry-disclosure-shown"], true);
}
function nativeEvents() {
  return requests.map(body => body.trim().split("\n")).filter(lines => {
    try { return JSON.parse(lines[2]).platform === "native"; } catch { return false; }
  });
}
function verify(lines) {
  assert.equal(lines.length, 3, "Native report must contain exactly one event item");
  assert.equal(JSON.parse(lines[1]).type, "event");
  const e = JSON.parse(lines[2]);
  assert.equal(e.release, "gnosis-tms@" + version);
  assert.equal(e.tags.install_id, JSON.parse(readFileSync(settingsPath))["telemetry-install-id"]);
  const exception = e.exception.values[0];
  assert.equal(exception.mechanism.meta.signal.number, 0xE0424242);
  const frames = exception.stacktrace.frames;
  assert.ok(frames.length);
  assert.ok(frames.every(f => Object.keys(f).join(",") === "instruction_addr"));
  assert.ok(!e.threads && !e.breadcrumbs && !e.extra && !e.server_name && !e.user);
  for (const i of e.debug_meta.images) {
    assert.doesNotMatch((i.code_file ?? "") + (i.debug_file ?? ""), /[\\/]/);
  }
  const appImage = e.debug_meta.images.find(i => i.code_file.toLowerCase() === basename(exe).toLowerCase());
  assert.ok(appImage?.debug_id && appImage.debug_file, "App PDB identifier missing from report");
  const pdb = resolve("src-tauri/target/release/gnosis_tms.pdb");
  assert.equal(appImage.debug_file.toLowerCase(), basename(pdb));
  const summary = execFileSync("llvm-pdbutil", ["dump", "-summary", pdb], { encoding: "utf8" });
  const guid = summary.match(/GUID:\s*\{?([\da-f-]{36})/i)?.[1];
  const age = summary.match(/Age:\s*(\d+)/i)?.[1];
  assert.ok(guid && age, "Could not read the release PDB identifier");
  assert.equal(appImage.debug_id.toLowerCase(), guid.toLowerCase() + "-" + Number(age).toString(16));
  const imageBase = BigInt(appImage.image_addr);
  const rvas = frames.map(f => BigInt(f.instruction_addr) - imageBase).filter(n => n >= 0n && n < BigInt(appImage.image_size));
  assert.ok(rvas.length, "No application frames");
  const linked = resolve("src-tauri/target/release/gnosis-tms.exe");
  assert.deepEqual(readFileSync(linked), readFileSync(exe), "Installer changed the linked binary");
  const symbols = execFileSync("llvm-symbolizer", ["--obj=" + linked, "--relative-address", ...rvas.map(n => "0x" + n.toString(16))], { encoding: "utf8" });
  assert.match(symbols, /gnosis_packaged_crash_probe/);
  return e.event_id;
}

try {
  await crashed(launch(true));
  await until("local undisclosed crash", () => pending().length === 1);
  assert.equal(requests.length, 0);
  console.log("Pre-window crash buffered locally before disclosure.");

  let app = launch();
  let page = await hero(app);
  await save(page, false, true);
  await until("discarded pending crash", () => pending().length === 0);
  writeFileSync(marker, "");
  await crashed(app);
  await crashed(launch(true));
  await delay(1500);
  assert.equal(requests.length, 0);
  assert.equal(pending().length, 0);
  console.log("Reporting off: zero requests after a hero-page crash and a pre-window crash on relaunch.");

  app = launch();
  page = await hero(app);
  await save(page, true);
  writeFileSync(marker, "");
  await crashed(app);
  await until("one hero-page crash report", () => nativeEvents().length === 1);
  const first = verify(nativeEvents()[0]);
  await crashed(launch(true));
  await until("one pre-window crash report", () => nativeEvents().length === 2);
  const second = verify(nativeEvents()[1]);
  assert.notEqual(first, second);
  await delay(1500);
  assert.equal(nativeEvents().length, 2);
  console.log("Reporting on: exactly one event per crash. Both stacks resolved to the packaged probe with the release PDB. No memory dump or private paths.");

  app = launch();
  page = await hero(app);
  await save(page, false);
  const afterOptOut = requests.length;
  writeFileSync(marker, "");
  await crashed(app);
  await delay(1500);
  assert.equal(requests.length, afterOptOut);
  assert.equal(pending().length, 0);
  console.log("Switching an already-enabled installation off stopped delivery in the same session.");

  // Exercise the other first-run choice in the disposable runner's profile.
  const profile = JSON.parse(readFileSync(settingsPath));
  delete profile["telemetry-enabled"];
  delete profile["telemetry-disclosure-shown"];
  writeFileSync(settingsPath, JSON.stringify(profile));
  await crashed(launch(true));
  await until("second undisclosed crash", () => pending().length === 1);
  assert.equal(requests.length, afterOptOut);
  app = launch();
  page = await hero(app);
  await save(page, true, true);
  await until("buffered crash sent after disclosure", () => nativeEvents().length === 3);
  verify(nativeEvents()[2]);
  await until("empty delivery queue", () => pending().length === 0);
  console.log("Accepting the first-run disclosure delivered the buffered crash exactly once.");
} finally {
  for (const app of running) app.kill();
  server.closeAllConnections();
  server.close();
}
