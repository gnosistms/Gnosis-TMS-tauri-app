import test from "node:test";
import assert from "node:assert/strict";

import {
  areResourcePageWritesDisabled,
  clearResourcePageDataOwner,
  createResourcePageState,
  loadResourcePageFromCacheThenRefresh,
  refreshResourcePage,
  setResourcePageDataOwner,
  setResourcePageRefreshing,
  submitResourcePageWrite,
} from "./resource-page-controller.js";

test("resource page state starts in a non-refreshing non-writing state", () => {
  const pageState = createResourcePageState();

  assert.deepEqual(pageState, {
    cachedData: [],
    visibleData: [],
    isRefreshing: false,
    refreshStartedAt: null,
    writeState: "idle",
    selectedItemId: null,
    visibleTeamId: null,
    visibleCacheKey: null,
    cacheUpdatedAt: null,
    error: "",
    notice: "",
  });
  assert.equal(areResourcePageWritesDisabled(pageState), false);
});

test("resource page refresh timestamp stays stable across repeated refreshing updates", () => {
  const pageState = createResourcePageState();

  setResourcePageRefreshing(pageState, true, { startedAt: 123 });
  setResourcePageRefreshing(pageState, true, { startedAt: 456 });

  assert.equal(pageState.isRefreshing, true);
  assert.equal(pageState.refreshStartedAt, 123);

  setResourcePageRefreshing(pageState, false);

  assert.equal(pageState.isRefreshing, false);
  assert.equal(pageState.refreshStartedAt, null);
});

test("resource page state tracks visible data ownership", () => {
  const pageState = createResourcePageState();

  setResourcePageDataOwner(pageState, {
    teamId: " team-1 ",
    cacheKey: " installation:1 ",
    cacheUpdatedAt: " 2026-05-14T00:00:00.000Z ",
  });

  assert.equal(pageState.visibleTeamId, "team-1");
  assert.equal(pageState.visibleCacheKey, "installation:1");
  assert.equal(pageState.cacheUpdatedAt, "2026-05-14T00:00:00.000Z");

  clearResourcePageDataOwner(pageState);

  assert.equal(pageState.visibleTeamId, null);
  assert.equal(pageState.visibleCacheKey, null);
  assert.equal(pageState.cacheUpdatedAt, null);
});

test("resource page writes are disabled during refresh and during writes", () => {
  assert.equal(
    areResourcePageWritesDisabled(createResourcePageState({ isRefreshing: true })),
    true,
  );
  assert.equal(
    areResourcePageWritesDisabled(createResourcePageState({ writeState: "submitting" })),
    true,
  );
  assert.equal(
    areResourcePageWritesDisabled(createResourcePageState({ writeState: "refreshingAfterWrite" })),
    true,
  );
});

test("load from cache renders cached data first and then refreshed data", async () => {
  const pageState = createResourcePageState();
  const renders = [];

  await loadResourcePageFromCacheThenRefresh({
    pageState,
    readCache: async () => [{ id: "cached-1" }],
    loadData: async () => [{ id: "remote-1" }],
    render: () => {
      renders.push({
        cachedData: [...pageState.cachedData],
        visibleData: [...pageState.visibleData],
        isRefreshing: pageState.isRefreshing,
      });
    },
  });

  assert.deepEqual(pageState.cachedData, [{ id: "remote-1" }]);
  assert.deepEqual(pageState.visibleData, [{ id: "remote-1" }]);
  assert.deepEqual(renders, [
    {
      cachedData: [{ id: "cached-1" }],
      visibleData: [{ id: "cached-1" }],
      isRefreshing: false,
    },
    {
      cachedData: [{ id: "cached-1" }],
      visibleData: [{ id: "cached-1" }],
      isRefreshing: true,
    },
    {
      cachedData: [{ id: "remote-1" }],
      visibleData: [{ id: "remote-1" }],
      isRefreshing: false,
    },
  ]);
});

test("refresh does not run while a write is active unless explicitly allowed", async () => {
  const pageState = createResourcePageState({ writeState: "submitting" });
  let ran = false;

  const result = await refreshResourcePage({
    pageState,
    loadData: async () => {
      ran = true;
      return [{ id: "remote-1" }];
    },
  });

  assert.equal(result, null);
  assert.equal(ran, false);
  assert.deepEqual(pageState.visibleData, []);
});

test("write waits for mutation then refresh before completing", async () => {
  const pageState = createResourcePageState({
    cachedData: [{ id: "cached-1" }],
    visibleData: [{ id: "cached-1" }],
  });
  const calls = [];

  const result = await submitResourcePageWrite({
    pageState,
    render: () => {
      calls.push(["render", pageState.writeState, pageState.isRefreshing]);
    },
    runMutation: async () => {
      calls.push("runMutation");
      return { ok: true };
    },
    refreshOptions: {
      loadData: async () => {
        calls.push("loadData");
        return [{ id: "remote-1" }];
      },
    },
    onSuccess: async () => {
      calls.push("onSuccess");
    },
  });

  assert.equal(result, true);
  assert.equal(pageState.writeState, "idle");
  assert.equal(pageState.isRefreshing, false);
  assert.deepEqual(pageState.visibleData, [{ id: "remote-1" }]);
  assert.deepEqual(calls, [
    ["render", "submitting", false],
    "runMutation",
    ["render", "refreshingAfterWrite", false],
    ["render", "refreshingAfterWrite", true],
    "loadData",
    ["render", "refreshingAfterWrite", false],
    "onSuccess",
    ["render", "idle", false],
  ]);
});

test("failed write does not speculatively change visible data", async () => {
  const pageState = createResourcePageState({
    cachedData: [{ id: "cached-1" }],
    visibleData: [{ id: "cached-1" }],
  });
  const calls = [];

  const result = await submitResourcePageWrite({
    pageState,
    runMutation: async () => {
      calls.push("runMutation");
      throw new Error("mutation failed");
    },
    refreshOptions: {
      loadData: async () => {
        calls.push("loadData");
        return [{ id: "remote-1" }];
      },
    },
    onError: async (error) => {
      calls.push(["onError", error.message]);
    },
  });

  assert.equal(result, false);
  assert.equal(pageState.writeState, "idle");
  assert.equal(pageState.error, "mutation failed");
  assert.deepEqual(pageState.visibleData, [{ id: "cached-1" }]);
  assert.deepEqual(calls, [
    "runMutation",
    ["onError", "mutation failed"],
  ]);
});
