export function createResourcePageState(overrides = {}) {
  return {
    cachedData: Array.isArray(overrides.cachedData) ? overrides.cachedData : [],
    visibleData: Array.isArray(overrides.visibleData) ? overrides.visibleData : [],
    isRefreshing: overrides.isRefreshing === true,
    writeState:
      overrides.writeState === "submitting" || overrides.writeState === "refreshingAfterWrite"
        ? overrides.writeState
        : "idle",
    selectedItemId:
      typeof overrides.selectedItemId === "string" && overrides.selectedItemId.trim()
        ? overrides.selectedItemId.trim()
        : null,
    error: typeof overrides.error === "string" ? overrides.error : "",
    notice: typeof overrides.notice === "string" ? overrides.notice : "",
  };
}

export function areResourcePageWritesDisabled(pageState) {
  return pageState?.isRefreshing === true || pageState?.writeState !== "idle";
}

function normalizeData(items) {
  return Array.isArray(items) ? items : [];
}

function setPageData(pageState, items) {
  const normalized = normalizeData(items);
  pageState.cachedData = normalized;
  pageState.visibleData = normalized;
}

export async function loadResourcePageFromCacheThenRefresh(options) {
  const pageState = options?.pageState;
  if (!pageState) {
    return [];
  }

  const readCache =
    typeof options?.readCache === "function"
      ? options.readCache
      : async () => [];
  const render = options?.render;

  const cachedData = normalizeData(await readCache());
  pageState.cachedData = cachedData;
  pageState.visibleData = cachedData;
  pageState.error = "";
  render?.();

  await refreshResourcePage({
    ...options,
    skipWriteBlock: true,
  });

  return pageState.visibleData;
}

export async function refreshResourcePage(options) {
  const pageState = options?.pageState;
  if (!pageState) {
    return null;
  }

  const loadData =
    typeof options?.loadData === "function"
      ? options.loadData
      : async () => [];
  const render = options?.render;
  const onError = options?.onError;
  const skipWriteBlock = options?.skipWriteBlock === true;

  if (!skipWriteBlock && pageState.writeState !== "idle") {
    return null;
  }

  pageState.isRefreshing = true;
  pageState.error = "";
  render?.();

  try {
    const refreshedData = normalizeData(await loadData());
    setPageData(pageState, refreshedData);
    pageState.isRefreshing = false;
    render?.();
    return refreshedData;
  } catch (error) {
    pageState.isRefreshing = false;
    pageState.error = error?.message ?? String(error);
    await onError?.(error);
    render?.();
    throw error;
  }
}

export async function submitResourcePageWrite(options) {
  const pageState = options?.pageState;
  if (!pageState) {
    return false;
  }

  if (areResourcePageWritesDisabled(pageState)) {
    await options?.onBlocked?.();
    return false;
  }

  const runMutation =
    typeof options?.runMutation === "function"
      ? options.runMutation
      : async () => {};
  const refreshOptions =
    options?.refreshOptions && typeof options.refreshOptions === "object"
      ? options.refreshOptions
      : {};
  const render = options?.render;

  pageState.writeState = "submitting";
  pageState.error = "";
  render?.();

  try {
    const mutationResult = await runMutation();
    pageState.writeState = "refreshingAfterWrite";
    render?.();

    await refreshResourcePage({
      ...refreshOptions,
      pageState,
      render,
      skipWriteBlock: true,
    });

    pageState.writeState = "idle";
    await options?.onSuccess?.(mutationResult);
    render?.();
    return true;
  } catch (error) {
    pageState.writeState = "idle";
    pageState.error = error?.message ?? String(error);
    await options?.onError?.(error);
    render?.();
    return false;
  }
}
