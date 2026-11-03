import { test, expect } from "./test.js";

const AUDIO_URL = "https://media.example.test/wp-content/uploads/2026/07/evening-talk.wav";
const YOUTUBE_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SCREENSHOT_DIR = process.env.EDITOR_MEDIA_SCREENSHOT_DIR ?? "";

// Two seconds of a quiet 440 Hz tone, so the player has a real duration.
function wavTone(seconds = 2, sampleRate = 8000) {
  const samples = seconds * sampleRate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((index / sampleRate) * 2 * Math.PI * 440) * 2000), 44 + index * 2);
  }
  return buffer;
}

// A 16:9 grey PNG stands in for YouTube's poster image.
const POSTER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR4nGO4c+cOKYhhVMOohqGsAQBJ7LuW1wTrUQAAAABJRU5ErkJggg==",
  "base64",
);

async function routeMedia(page) {
  await page.route("https://media.example.test/**", (route) => route.fulfill({
    status: 200,
    contentType: "audio/wav",
    body: wavTone(),
  }));
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: POSTER_PNG,
  }));
  await page.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><body style='margin:0;background:#111;color:#eee;font:16px sans-serif;display:grid;place-items:center;height:100vh'>YouTube player</body>",
  }));
}

async function mountMediaFixture(page) {
  await routeMedia(page);
  await page.addInitScript(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {
      // Ignore local-storage access restrictions in the browser harness.
    }
  });
  await page.goto("/", { timeout: 45_000 });
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountEditorFixture === "function", undefined, {
    timeout: 45_000,
  });
  await page.evaluate(async ({ audioUrl, youtubeUrl }) => {
    await window.__gnosisDebug.waitForBootstrap();
    await window.__gnosisDebug.mountEditorFixture({
      rowCount: 6,
      chapterStatus: "ready",
      imagesByRowId: {
        "fixture-row-0002": { vi: { kind: "url", url: audioUrl } },
        "fixture-row-0003": { vi: { kind: "url", url: youtubeUrl } },
      },
    });
  }, { audioUrl: AUDIO_URL, youtubeUrl: YOUTUBE_URL });
  await expect(page.locator("[data-editor-search-input]")).toBeVisible();
  const disclosureSave = page.locator(".modal-backdrop").getByRole("button", { name: "Save" });
  if (await disclosureSave.count()) {
    await disclosureSave.click();
    await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  }
}

async function screenshot(page, name) {
  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
  }
}

test.describe("editor audio and video rows", () => {
  test("an audio row shows a file tile and plays in a player that survives a full render", async ({ page }) => {
    await mountMediaFixture(page);

    const audioTile = page.locator('[data-editor-media-kind="audio"][data-row-id="fixture-row-0002"]');
    await expect(audioTile).toBeVisible();
    await expect(audioTile).toContainText("evening-talk.wav");
    await expect(audioTile.locator("img")).toHaveCount(0);
    const videoTile = page.locator('[data-editor-media-kind="video"][data-row-id="fixture-row-0003"]');
    await expect(videoTile).toBeVisible();
    await expect(videoTile.locator("img")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    await screenshot(page, "editor-media-rows");

    await audioTile.click();
    const player = page.locator("[data-editor-media-player]");
    await expect(player).toBeVisible();
    await expect(player.getByRole("heading", { name: "evening-talk.wav" })).toBeVisible();
    await expect(player.locator("[data-media-player-duration]")).toHaveText("0:02");
    // The in-app image overlay stays closed for audio.
    await expect(page.locator(".editor-image-preview-overlay")).toHaveCount(0);

    await page.evaluate(() => {
      window.__mediaPlayerAudio = document.querySelector("[data-media-player-audio]");
    });
    const toggle = player.locator('[data-media-player-control="toggle"]');
    if (await toggle.getAttribute("aria-label") === "Play") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("aria-label", "Pause");
    await player.locator('[data-media-player-control="speed"]').click();
    await expect(player.locator('[data-media-player-control="speed"]')).toHaveText("1.25×");
    await screenshot(page, "editor-media-audio-player");

    // A full render (as background sync or a status change causes) leaves the
    // playing element alone.
    await page.evaluate(() => window.__gnosisDebug.setProjectsVirtualizationDisabled(false));
    await expect(page.locator("[data-editor-search-input]")).toBeVisible();
    expect(await page.evaluate(() => (
      document.querySelector("[data-media-player-audio]") === window.__mediaPlayerAudio
    ))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(player).toHaveCount(0);
    await expect(audioTile).toBeFocused();
  });

  test("a YouTube row opens the embedded player and closes from the backdrop", async ({ page }) => {
    await mountMediaFixture(page);

    await page.locator('[data-editor-media-kind="video"][data-row-id="fixture-row-0003"]').click();
    const player = page.locator("[data-editor-media-player]");
    await expect(player).toBeVisible();
    const frame = player.locator("iframe");
    await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1");
    await expect(player.getByRole("heading", { name: "YouTube video" })).toBeVisible();
    await expect(player.getByRole("button", { name: "Open on YouTube" })).toBeVisible();
    await screenshot(page, "editor-media-video-player");

    await player.click({ position: { x: 8, y: 300 } });
    await expect(player).toHaveCount(0);
  });

  test("the preview shows the same tiles and opens the same player", async ({ page }) => {
    await mountMediaFixture(page);
    await page.locator('[data-action="set-editor-mode:preview"]').click();
    await page.locator("[data-editor-preview-language-select]").selectOption("vi");

    const preview = page.locator("[data-editor-preview-document]");
    const audioTile = preview.locator('[data-editor-media-kind="audio"][data-row-id="fixture-row-0002"]');
    await expect(audioTile).toContainText("evening-talk.wav");
    await expect(preview.locator('[data-editor-media-kind="video"][data-row-id="fixture-row-0003"] img')).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    );
    await screenshot(page, "editor-media-preview");

    await audioTile.click();
    const player = page.locator("[data-editor-media-player]");
    await expect(player.getByRole("heading", { name: "evening-talk.wav" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(player).toHaveCount(0);
    await expect(audioTile).toBeFocused();
  });

  test("the insert tooltips name audio and video", async ({ page }) => {
    await mountMediaFixture(page);
    await page.locator('[data-editor-display-field][data-row-id="fixture-row-0001"][data-language-code="vi"]').click();
    const urlButton = page.locator('[data-action="open-editor-image-url"][data-row-id="fixture-row-0001"][data-language-code="vi"]');
    const uploadButton = page.locator('[data-action="open-editor-image-upload"][data-row-id="fixture-row-0001"][data-language-code="vi"]');
    await expect(urlButton).toHaveAttribute("data-tooltip", "Insert image, audio, or video by URL");
    await expect(uploadButton).toHaveAttribute("data-tooltip", "Upload image or audio");
  });
});
