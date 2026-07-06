import { expect, test } from "@playwright/test";

// Projects page virtualization + scroll restore acceptance tests. The
// projects fixture writes visible state directly (no Tauri backend), so these
// tests exercise rendering, the TanStack virtual window, and scroll behavior.

// Each Playwright test gets a fresh browser context, so localStorage starts
// clean; `reload` simulates an app restart that keeps persistent storage.
async function mountProjectsFixture(page, options = {}, { reload = false } = {}) {
  if (!reload) {
    await page.goto("/");
  } else {
    await page.reload();
  }
  await page.waitForFunction(() => typeof window.__gnosisDebug?.mountProjectsFixture === "function");
  const summary = await page.evaluate(async (fixtureOptions) => {
    await window.__gnosisDebug.waitForBootstrap();
    return await window.__gnosisDebug.mountProjectsFixture(fixtureOptions);
  }, options);
  await expect(page.locator("[data-projects-virtual-list]")).toBeVisible();
  await dismissTelemetryDisclosureModal(page);
  return summary;
}

async function dismissTelemetryDisclosureModal(page) {
  const disclosureSave = page
    .locator(".modal-backdrop")
    .getByRole("button", { name: "Save" });
  if (await disclosureSave.count()) {
    await disclosureSave.click();
    await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  }
}

function renderedItemKeys(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-projects-item-key]")].map(
      (element) => element.dataset.projectsItemKey,
    ),
  );
}

async function scrollProjectsPage(page, scrollTop) {
  await page.evaluate((top) => {
    const container = document.querySelector(".page-body");
    container.scrollTop = top;
  }, scrollTop);
  // Let scroll events, the rAF-scheduled window render, and measurement settle.
  await page.waitForTimeout(120);
}

function readScrollState(page) {
  return page.evaluate(() => {
    const container = document.querySelector(".page-body");
    return {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      renderedItems: document.querySelectorAll("[data-projects-item-key]").length,
      topSpacer: Number.parseInt(
        document.querySelector('[data-projects-virtual-spacer="top"]')?.style.height ?? "0",
        10,
      ),
      bottomSpacer: Number.parseInt(
        document.querySelector('[data-projects-virtual-spacer="bottom"]')?.style.height ?? "0",
        10,
      ),
      firstKey: document.querySelector("[data-projects-item-key]")?.dataset.projectsItemKey ?? "",
    };
  });
}

function topVisibleAnchor(page) {
  return page.evaluate(() => {
    const container = document.querySelector(".page-body");
    const containerRect = container.getBoundingClientRect();
    const first = [...document.querySelectorAll("[data-projects-item-key]")].find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
    });
    return {
      key: first?.dataset.projectsItemKey ?? "",
      offset: first ? first.getBoundingClientRect().top - containerRect.top : null,
    };
  });
}

function offsetOfItem(page, itemKey) {
  return page.evaluate((anchorKey) => {
    const container = document.querySelector(".page-body");
    const containerRect = container.getBoundingClientRect();
    const element = document.querySelector(
      `[data-projects-item-key="${CSS.escape(anchorKey)}"]`,
    );
    return element ? element.getBoundingClientRect().top - containerRect.top : null;
  }, itemKey);
}

const LARGE_FIXTURE = { projectCount: 120, filesPerProject: 15, expandAll: true };

// Minimal Tauri mock so chapter metadata writes run their full optimistic +
// queued pipeline in the browser harness. Unknown commands resolve to null;
// metadata updates resolve asynchronously like a real backend.
async function installProjectsMockTauri(page) {
  await page.addInitScript(() => {
    const invokeLog = [];
    window.__projectsInvokeLog = invokeLog;
    window.__TAURI__ = {
      core: {
        async invoke(command, payload = {}) {
          invokeLog.push({ command, payload });
          if (command.startsWith("update_gtms_chapter_")) {
            return new Promise((resolve) => setTimeout(() => resolve(null), 30));
          }
          return null;
        },
      },
      event: {
        listen: async () => () => {},
      },
      opener: {
        openUrl() {},
      },
    };
  });
}

test.describe("projects page virtualization", () => {
  test("small lists render without virtualization", async ({ page }) => {
    await mountProjectsFixture(page, { projectCount: 5, filesPerProject: 4 });

    const state = await readScrollState(page);
    // 5 collapsed headers only — below the threshold, everything renders.
    expect(state.renderedItems).toBe(5);
    expect(state.topSpacer).toBe(0);
    expect(state.bottomSpacer).toBe(0);
  });

  test("large lists render a bounded window with spacers", async ({ page }) => {
    await mountProjectsFixture(page, LARGE_FIXTURE);

    const initial = await readScrollState(page);
    // 120 projects x (1 header + 15 files) = 1920 items; only a window mounts.
    expect(initial.renderedItems).toBeLessThan(120);
    expect(initial.topSpacer).toBe(0);
    expect(initial.bottomSpacer).toBeGreaterThan(10_000);
    expect(initial.firstKey).toBe("p:fixture-project-001");
  });

  test("scrolling moves the window and keeps DOM bounded", async ({ page }) => {
    await mountProjectsFixture(page, LARGE_FIXTURE);
    const { scrollHeight } = await readScrollState(page);

    await scrollProjectsPage(page, Math.floor(scrollHeight / 2));
    const middle = await readScrollState(page);
    expect(middle.renderedItems).toBeLessThan(120);
    expect(middle.topSpacer).toBeGreaterThan(10_000);
    expect(middle.firstKey).not.toBe("p:fixture-project-001");

    await scrollProjectsPage(page, scrollHeight);
    const bottom = await readScrollState(page);
    expect(bottom.bottomSpacer).toBe(0);
    const keys = await renderedItemKeys(page);
    expect(keys[keys.length - 1]).toMatch(/fixture-project-120/);

    await scrollProjectsPage(page, 0);
    const top = await readScrollState(page);
    expect(top.topSpacer).toBe(0);
    expect(top.firstKey).toBe("p:fixture-project-001");
  });

  test("scrolling in small steps never leaves a blank viewport", async ({ page }) => {
    await mountProjectsFixture(page, LARGE_FIXTURE);
    const { clientHeight, scrollHeight } = await readScrollState(page);

    let scrollTop = 0;
    while (scrollTop < Math.min(scrollHeight, clientHeight * 12)) {
      scrollTop += Math.floor(clientHeight * 0.8);
      await scrollProjectsPage(page, scrollTop);
      const coverage = await page.evaluate(() => {
        const container = document.querySelector(".page-body");
        const containerRect = container.getBoundingClientRect();
        const items = [...document.querySelectorAll("[data-projects-item-key]")];
        const overlapping = items.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
        });
        return { overlappingCount: overlapping.length };
      });
      expect(coverage.overlappingCount).toBeGreaterThan(0);
    }
  });

  test("toggling keeps the clicked header stationary", async ({ page }) => {
    await mountProjectsFixture(page, LARGE_FIXTURE);
    // Walk the scroll position until project 60's header is rendered, then
    // center it.
    const { scrollHeight, clientHeight } = await readScrollState(page);
    for (
      let target = Math.floor(scrollHeight * 0.3);
      target < scrollHeight;
      target += clientHeight * 3
    ) {
      await scrollProjectsPage(page, target);
      const found = await page.evaluate(() =>
        Boolean(document.querySelector('[data-projects-item-key="p:fixture-project-060"]')),
      );
      if (found) {
        break;
      }
    }
    await page.evaluate(() => {
      document
        .querySelector('[data-projects-item-key="p:fixture-project-060"]')
        ?.scrollIntoView({ block: "center" });
    });
    await page.waitForTimeout(150);

    const headerOffset = () =>
      page.evaluate(() => {
        const container = document.querySelector(".page-body");
        const header = document.querySelector('[data-projects-item-key="p:fixture-project-060"]');
        if (!header) {
          return null;
        }
        return header.getBoundingClientRect().top - container.getBoundingClientRect().top;
      });

    const before = await headerOffset();
    expect(before).not.toBeNull();

    await page.locator('[data-action="toggle-project:fixture-project-060"]').click();
    await page.waitForTimeout(150);
    const afterCollapse = await headerOffset();
    expect(Math.abs(afterCollapse - before)).toBeLessThanOrEqual(2);

    await page.locator('[data-action="toggle-project:fixture-project-060"]').click();
    await page.waitForTimeout(150);
    const afterExpand = await headerOffset();
    expect(Math.abs(afterExpand - before)).toBeLessThanOrEqual(2);
  });

  test("viewport is preserved when content above the anchor changes", async ({ page }) => {
    // Project 1 collapsed, everything else expanded.
    const expandedExceptFirst = Array.from({ length: 120 }, (_unused, index) =>
      `fixture-project-${String(index + 1).padStart(3, "0")}`,
    ).slice(1);
    await mountProjectsFixture(page, {
      projectCount: 120,
      filesPerProject: 15,
      expandedProjectIds: expandedExceptFirst,
    });

    const { scrollHeight } = await readScrollState(page);
    await scrollProjectsPage(page, Math.floor(scrollHeight / 2));
    const before = await page.evaluate(() => {
      const container = document.querySelector(".page-body");
      const containerRect = container.getBoundingClientRect();
      const first = [...document.querySelectorAll("[data-projects-item-key]")].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
      });
      return {
        key: first?.dataset.projectsItemKey ?? "",
        offset: first ? first.getBoundingClientRect().top - containerRect.top : null,
      };
    });
    expect(before.key).not.toBe("");

    // Re-render with project 1 expanded: ~15 new rows appear far above the
    // viewport. The anchored item must stay put even though raw scrollTop
    // is now off by the inserted height.
    await page.evaluate(async () => {
      await window.__gnosisDebug.mountProjectsFixture({
        projectCount: 120,
        filesPerProject: 15,
        expandAll: true,
      });
    });
    await page.waitForTimeout(150);

    const after = await page.evaluate((anchorKey) => {
      const container = document.querySelector(".page-body");
      const containerRect = container.getBoundingClientRect();
      const element = document.querySelector(
        `[data-projects-item-key="${CSS.escape(anchorKey)}"]`,
      );
      return element
        ? element.getBoundingClientRect().top - containerRect.top
        : null;
    }, before.key);
    expect(after).not.toBeNull();
    expect(Math.abs(after - before.offset)).toBeLessThanOrEqual(2);
  });

  test("leaving and returning within a session restores the viewport", async ({ page }) => {
    await mountProjectsFixture(page, LARGE_FIXTURE);
    const { scrollHeight } = await readScrollState(page);
    await scrollProjectsPage(page, Math.floor(scrollHeight * 0.4));
    const before = await page.evaluate(() => {
      const container = document.querySelector(".page-body");
      const containerRect = container.getBoundingClientRect();
      const first = [...document.querySelectorAll("[data-projects-item-key]")].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
      });
      return {
        key: first?.dataset.projectsItemKey ?? "",
        offset: first ? first.getBoundingClientRect().top - containerRect.top : null,
      };
    });

    // Leave to the start screen, then return to the projects screen.
    await page.evaluate(() => {
      window.__gnosisDebug.showStartAuthMessage("leaving projects");
    });
    await expect(page.locator("[data-projects-virtual-list]")).toHaveCount(0);
    await page.evaluate(async (fixtureOptions) => {
      await window.__gnosisDebug.mountProjectsFixture(fixtureOptions);
    }, LARGE_FIXTURE);
    await page.waitForTimeout(150);

    const after = await page.evaluate((anchorKey) => {
      const container = document.querySelector(".page-body");
      const containerRect = container.getBoundingClientRect();
      const element = document.querySelector(
        `[data-projects-item-key="${CSS.escape(anchorKey)}"]`,
      );
      return element
        ? element.getBoundingClientRect().top - containerRect.top
        : null;
    }, before.key);
    expect(after).not.toBeNull();
    expect(Math.abs(after - before.offset)).toBeLessThanOrEqual(2);
  });

  test("scroll position survives an app restart", async ({ page }) => {
    await mountProjectsFixture(page, LARGE_FIXTURE);
    const { scrollHeight } = await readScrollState(page);
    await scrollProjectsPage(page, Math.floor(scrollHeight * 0.4));
    // Wait out the debounced save.
    await page.waitForTimeout(500);
    const before = await topVisibleAnchor(page);
    expect(before.key).not.toBe("");

    await mountProjectsFixture(page, LARGE_FIXTURE, { reload: true });
    await page.waitForTimeout(150);

    const after = await offsetOfItem(page, before.key);
    expect(after).not.toBeNull();
    expect(Math.abs(after - before.offset)).toBeLessThanOrEqual(2);
  });

  test("a new project since the last save opens the page at the top", async ({ page }) => {
    await mountProjectsFixture(page, LARGE_FIXTURE);
    const { scrollHeight } = await readScrollState(page);
    await scrollProjectsPage(page, Math.floor(scrollHeight * 0.4));
    await page.waitForTimeout(500);

    // Restart with one extra project: its id is not in the saved set.
    await mountProjectsFixture(page, { ...LARGE_FIXTURE, projectCount: 121 }, { reload: true });
    await page.waitForTimeout(150);

    const state = await readScrollState(page);
    expect(state.scrollTop).toBe(0);
    expect(state.firstKey).toBe("p:fixture-project-001");
  });

  test("each team keeps its own saved position", async ({ page }) => {
    const teamA = { ...LARGE_FIXTURE, teamId: "team-a", teamName: "Team A" };
    const teamB = { ...LARGE_FIXTURE, teamId: "team-b", teamName: "Team B" };

    await mountProjectsFixture(page, teamA);
    const { scrollHeight } = await readScrollState(page);
    await scrollProjectsPage(page, Math.floor(scrollHeight * 0.3));
    await page.waitForTimeout(500);
    const teamAAnchor = await topVisibleAnchor(page);

    // Switch to team B (fresh team, no saved position -> top), scroll it
    // somewhere else.
    await page.evaluate(async (fixtureOptions) => {
      await window.__gnosisDebug.mountProjectsFixture(fixtureOptions);
    }, teamB);
    await page.waitForTimeout(150);
    const teamBEntry = await readScrollState(page);
    expect(teamBEntry.scrollTop).toBe(0);
    await scrollProjectsPage(page, Math.floor(scrollHeight * 0.7));
    await page.waitForTimeout(500);
    const teamBAnchor = await topVisibleAnchor(page);
    expect(teamBAnchor.key).not.toBe(teamAAnchor.key);

    // Back to team A: its own position restores.
    await page.evaluate(async (fixtureOptions) => {
      await window.__gnosisDebug.mountProjectsFixture(fixtureOptions);
    }, teamA);
    await page.waitForTimeout(150);
    const backOnTeamA = await offsetOfItem(page, teamAAnchor.key);
    expect(backOnTeamA).not.toBeNull();
    expect(Math.abs(backOnTeamA - teamAAnchor.offset)).toBeLessThanOrEqual(2);

    // And team B again: its position, not team A's.
    await page.evaluate(async (fixtureOptions) => {
      await window.__gnosisDebug.mountProjectsFixture(fixtureOptions);
    }, teamB);
    await page.waitForTimeout(150);
    const backOnTeamB = await offsetOfItem(page, teamBAnchor.key);
    expect(backOnTeamB).not.toBeNull();
    expect(Math.abs(backOnTeamB - teamBAnchor.offset)).toBeLessThanOrEqual(2);
  });

  test("after a restart with collapsed projects, a file anchor falls back to its project header", async ({ page }) => {
    await mountProjectsFixture(page, LARGE_FIXTURE);
    const { scrollHeight } = await readScrollState(page);
    let scrollTarget = Math.floor(scrollHeight * 0.5);
    await scrollProjectsPage(page, scrollTarget);
    let before = await topVisibleAnchor(page);
    // Nudge until the top visible item is a file row (not a header), so the
    // saved anchor points inside an expanded project.
    for (let attempt = 0; attempt < 10 && !before.key.startsWith("f:"); attempt += 1) {
      scrollTarget += 90;
      await scrollProjectsPage(page, scrollTarget);
      before = await topVisibleAnchor(page);
    }
    await page.waitForTimeout(500);
    expect(before.key).toMatch(/^f:/);
    const projectId = before.key.split(":")[1];

    // Restart with everything collapsed (in-memory expand state is gone).
    await mountProjectsFixture(
      page,
      { projectCount: 120, filesPerProject: 15, expandedProjectIds: [] },
      { reload: true },
    );
    await page.waitForTimeout(150);

    const anchorAfter = await topVisibleAnchor(page);
    expect(anchorAfter.key).toBe(`p:${projectId}`);
  });

  test("rapid status and glossary selections stick across rows", async ({ page }) => {
    await installProjectsMockTauri(page);
    await mountProjectsFixture(page, {
      projectCount: 3,
      filesPerProject: 4,
      glossaryCount: 2,
      expandedProjectIds: ["fixture-project-001"],
    });

    // Click through as fast as Playwright can: alternate glossary and status
    // selects across the first project's rows.
    const rows = [0, 1, 2, 3];
    for (const rowIndex of rows) {
      const chapterId = `fixture-chapter-0-${rowIndex}`;
      await page.selectOption(
        `[data-chapter-glossary-select][data-chapter-id="${chapterId}"]`,
        "fixture-glossary-2",
      );
      await page.selectOption(
        `[data-chapter-status-select][data-chapter-id="${chapterId}"]`,
        "review2",
      );
    }

    // Optimistic: every pill reflects the choice immediately.
    for (const rowIndex of rows) {
      const chapterId = `fixture-chapter-0-${rowIndex}`;
      await expect(
        page.locator(`[data-chapter-glossary-select][data-chapter-id="${chapterId}"]`),
      ).toHaveValue("fixture-glossary-2");
      await expect(
        page.locator(`[data-chapter-status-select][data-chapter-id="${chapterId}"]`),
      ).toHaveValue("review2");
    }

    // Every write reached the backend queue, and nothing reverted after the
    // async completions landed.
    await page.waitForFunction(() =>
      (window.__projectsInvokeLog ?? []).filter((entry) =>
        entry.command.startsWith("update_gtms_chapter_"),
      ).length === 8,
    );
    await page.waitForTimeout(150);
    for (const rowIndex of rows) {
      const chapterId = `fixture-chapter-0-${rowIndex}`;
      await expect(
        page.locator(`[data-chapter-glossary-select][data-chapter-id="${chapterId}"]`),
      ).toHaveValue("fixture-glossary-2");
      await expect(
        page.locator(`[data-chapter-status-select][data-chapter-id="${chapterId}"]`),
      ).toHaveValue("review2");
    }
  });

  test("background renders hold while a chapter select is engaged", async ({ page }) => {
    await mountProjectsFixture(page, {
      projectCount: 3,
      filesPerProject: 4,
      glossaryCount: 2,
      expandedProjectIds: ["fixture-project-001"],
    });

    const selectSelector =
      '[data-chapter-glossary-select][data-chapter-id="fixture-chapter-0-0"]';
    await page.focus(selectSelector);
    await page.evaluate((selector) => {
      document.querySelector(selector).__holdMarker = true;
    }, selectSelector);

    // A full render arriving while the select is engaged must not replace it.
    await page.evaluate(async (fixtureOptions) => {
      await window.__gnosisDebug.mountProjectsFixture(fixtureOptions);
    }, { projectCount: 3, filesPerProject: 4, glossaryCount: 2, expandedProjectIds: ["fixture-project-001"] });
    const heldState = await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return {
        stillSameElement: element?.__holdMarker === true,
        stillFocused: document.activeElement === element,
      };
    }, selectSelector);
    expect(heldState.stillSameElement).toBe(true);
    expect(heldState.stillFocused).toBe(true);

    // Disengaging flushes the held render: the element is rebuilt.
    await page.evaluate((selector) => {
      document.querySelector(selector).blur();
    }, selectSelector);
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.__holdMarker === undefined,
      selectSelector,
    );
  });

  test("expand and collapse work on virtualized rows", async ({ page }) => {
    await mountProjectsFixture(page, {
      projectCount: 120,
      filesPerProject: 15,
      expandedProjectIds: [],
    });

    // All collapsed: 120 header items, virtualized.
    const collapsed = await readScrollState(page);
    expect(collapsed.renderedItems).toBeLessThan(120);

    await page.locator('[data-action="toggle-project:fixture-project-001"]').click();
    await page.waitForTimeout(120);
    const keys = await renderedItemKeys(page);
    expect(keys).toContain("f:fixture-project-001:fixture-chapter-0-0");

    await page.locator('[data-action="toggle-project:fixture-project-001"]').click();
    await page.waitForTimeout(120);
    const keysAfterCollapse = await renderedItemKeys(page);
    expect(keysAfterCollapse).not.toContain("f:fixture-project-001:fixture-chapter-0-0");
  });
});
