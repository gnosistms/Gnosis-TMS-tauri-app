import { test } from "@playwright/test";

// Scroll-performance probe: scrolls the virtualized projects list one step
// per animation frame and logs the frame-gap distribution. Not part of the
// regular suite (no assertions, timing-sensitive) — run on demand with:
//   PROJECTS_SCROLL_BENCH=1 npx playwright test tests/browser/projects-scroll-bench.spec.js
test.skip(!process.env.PROJECTS_SCROLL_BENCH, "opt-in perf probe");

test("projects scroll frame-time probe", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountProjectsFixture === "function");
  await page.evaluate(async () => {
    await window.__gnosisDebug.waitForBootstrap();
    await window.__gnosisDebug.mountProjectsFixture({
      projectCount: 150,
      filesPerProject: 20,
      expandAll: true,
    });
  });
  const disclosureSave = page.locator(".modal-backdrop").getByRole("button", { name: "Save" });
  if (await disclosureSave.count()) {
    await disclosureSave.click();
  }
  await page.waitForTimeout(300);

  const runProbe = (stepPx, totalPx) =>
    page.evaluate(
      ([step, total]) =>
        new Promise((resolve) => {
          const container = document.querySelector(".page-body");
          container.scrollTop = 0;
          const gaps = [];
          let scrolled = 0;
          let last = performance.now();

          function tick(now) {
            gaps.push(now - last);
            last = now;
            container.scrollTop += step;
            scrolled += step;
            if (scrolled < total) {
              requestAnimationFrame(tick);
              return;
            }

            gaps.shift(); // first gap includes setup
            const sorted = [...gaps].sort((a, b) => a - b);
            const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
            resolve({
              stepPx: step,
              frames: gaps.length,
              mean: gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
              p50: pick(0.5),
              p90: pick(0.9),
              p99: pick(0.99),
              max: sorted[sorted.length - 1],
              over17ms: gaps.filter((gap) => gap > 17).length,
              over34ms: gaps.filter((gap) => gap > 34).length,
            });
          }

          requestAnimationFrame(tick);
        }),
      [stepPx, totalPx],
    );

  // Steady scroll (~trackpad pace) and fast momentum flick (~200px/frame).
  const steady = await runProbe(40, 40_000);
  await page.waitForTimeout(400);
  const fast = await runProbe(200, 120_000);

  console.log("SCROLL BENCH", JSON.stringify({ steady, fast }, null, 2));
});
