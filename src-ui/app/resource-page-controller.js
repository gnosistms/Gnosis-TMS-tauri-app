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

export function areResourcePageWriteSubmissionsDisabled(pageState) {
  return pageState?.writeState !== "idle";
}

function normalizeData(items) {
  return Array.isArray(items) ? items : [];
}

function setPageData(pageState, items) {
  const normalized = normalizeData(items);
  pageState.cachedData = normalized;
  pageState.visibleData = normalized;
}

function progressTextFor(options, key) {
  if (!options || typeof options !== "object") {
    return "";
  }

  const value = options[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
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
  const syncController = options?.syncController;
  const syncAlreadyActive = options?.syncAlreadyActive === true;
  const progressText = progressTextFor(options?.progressLabels, "refreshing");
  const setProgress =
    typeof options?.setProgress === "function"
      ? options.setProgress
      : null;
  const clearProgress =
    typeof options?.clearProgress === "function"
      ? options.clearProgress
      : null;

  if (!skipWriteBlock && pageState.writeState !== "idle") {
    return null;
  }

  if (!syncAlreadyActive) {
    syncController?.begin?.();
  }
  if (progressText) {
    setProgress?.(progressText);
  }
  pageState.isRefreshing = true;
  pageState.error = "";
  render?.();

  try {
    const refreshedData = normalizeData(await loadData());
    setPageData(pageState, refreshedData);
    pageState.isRefreshing = false;
    if (!syncAlreadyActive) {
      await syncController?.complete?.(render);
    }
    clearProgress?.();
    render?.();
    return refreshedData;
  } catch (error) {
    pageState.isRefreshing = false;
    pageState.error = error?.message ?? String(error);
    if (!syncAlreadyActive) {
      syncController?.fail?.();
    }
    clearProgress?.();
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
  const syncController = options?.syncController;
  const submittingProgressText = progressTextFor(options?.progressLabels, "submitting");
  const refreshingProgressText =
    progressTextFor(options?.progressLabels, "refreshing")
    || progressTextFor(refreshOptions?.progressLabels, "refreshing");
  const setProgress =
    typeof options?.setProgress === "function"
      ? options.setProgress
      : null;
  const clearProgress =
    typeof options?.clearProgress === "function"
      ? options.clearProgress
      : null;

  pageState.writeState = "submitting";
  pageState.error = "";
  syncController?.begin?.();
  options?.onMutationStarted?.();
  if (submittingProgressText) {
    setProgress?.(submittingProgressText);
  }
  render?.();

  try {
    const mutationResult = await runMutation();
    await options?.onMutationFinished?.(mutationResult);
    pageState.writeState = "refreshingAfterWrite";
    options?.onRefreshStarted?.(mutationResult);
    if (refreshingProgressText) {
      setProgress?.(refreshingProgressText);
    }
    render?.();

    await refreshResourcePage({
      ...refreshOptions,
      pageState,
      render,
      skipWriteBlock: true,
      syncController,
      syncAlreadyActive: true,
      setProgress,
      clearProgress,
      progressLabels: {
        ...(refreshOptions.progressLabels ?? {}),
        refreshing:
          progressTextFor(refreshOptions.progressLabels, "refreshing")
          || refreshingProgressText,
      },
    });

    pageState.writeState = "idle";
    await syncController?.complete?.(render);
    await options?.onRefreshFinished?.(mutationResult);
    clearProgress?.();
    await options?.onSuccess?.(mutationResult);
    render?.();
    return true;
  } catch (error) {
    pageState.writeState = "idle";
    pageState.error = error?.message ?? String(error);
    syncController?.fail?.();
    clearProgress?.();
    await options?.onError?.(error);
    render?.();
    return false;
  }
}
